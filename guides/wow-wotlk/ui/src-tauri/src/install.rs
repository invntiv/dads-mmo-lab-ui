use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;

/// Tracks the PID of the currently-running install script so the cancel
/// command can signal it. The PID is also the process *group* leader's PID
/// because we spawn with `process_group(0)`, which means a single
/// `kill(-pid, SIGTERM)` takes down the whole tree (bash + git + docker).
#[derive(Default)]
pub struct InstallState {
    pub running_pid: Mutex<Option<u32>>,
}

#[derive(Serialize, Clone)]
pub struct DetectedInstall {
    pub path: String,
    pub variant: String,
    /// True when `.dads-mmo-lab/install.json` exists at the install root.
    /// install.json is the last thing the install script writes, so its
    /// presence is the source of truth for "install ran to completion".
    /// An install with docker-compose.yml but no install.json is a
    /// partial install that needs the bootstrap step finished — the UI
    /// shows a "Finish setup" affordance for these.
    pub complete: bool,
}

#[derive(Serialize)]
pub struct DetectionResult {
    pub installs: Vec<DetectedInstall>,
}

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AhBotConfig {
    pub items_per_cycle: Option<u32>,
    pub elapsing_time_class: Option<u8>, // 0=long, 1=medium, 2=short per AC enum
    pub enable_buyer: Option<bool>,
    pub vendor_items: Option<bool>,
    pub profession_items: Option<bool>,
}

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndividualProgressionConfig {
    pub authentic_difficulty: Option<bool>,
    pub disable_rdf: Option<bool>,
    pub dk_requires_tbc: Option<bool>,
}

/// Subset of per-module config the wizard knows how to ask about during
/// onboarding. Anything not set here uses the upstream `.conf.dist`
/// defaults. Post-install reconfigure (Modules page) extends this to
/// the power-user knobs.
#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleConfig {
    #[serde(default)]
    pub ahbot: Option<AhBotConfig>,
    #[serde(default)]
    pub ip: Option<IndividualProgressionConfig>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub server_type: String,
    #[serde(default)]
    pub build_method: Option<String>,
    #[serde(default = "default_admin_user")]
    pub admin_user: String,
    #[serde(default = "default_admin_pass")]
    pub admin_pass: String,
    #[serde(default)]
    pub force: bool,
    /// When true, the install script skips clone/compile and only runs
    /// the wait-for-server + bootstrap + write-metadata steps. Used to
    /// recover from a crash that interrupted a near-finished install.
    #[serde(default)]
    pub resume: bool,
    /// Module keys to install (e.g. `["mod-ah-bot", "mod-solocraft"]`).
    /// Translated to `DML_MODULES_ADD` (comma-separated) before spawn.
    /// Ignored when `resume=true` (modules are already cloned + built).
    #[serde(default)]
    pub modules: Vec<String>,
    /// Per-module config from the wizard. Each Some(...) variant maps to
    /// a set of `DML_MOD_*` env vars; None means "module not configured
    /// or not selected — use defaults".
    #[serde(default)]
    pub module_config: ModuleConfig,
}

fn default_admin_user() -> String {
    "admin".into()
}
fn default_admin_pass() -> String {
    "admin".into()
}

#[derive(Serialize, Clone)]
struct OutputEvent {
    stream: &'static str,
    line: String,
    /// True when the source delimiter was a carriage return (`\r`) — i.e.
    /// the line is a progress update that should overwrite the previous
    /// transient line of the same stream rather than append to history.
    transient: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SectionEvent {
    /// "start" or "end"
    stage: &'static str,
    /// Only present on `start`. Human-readable section header shown by the UI.
    title: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CleanupEvent {
    stage: &'static str, // "started" | "finished"
    path: String,
    deleted: bool,
    skipped_reason: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
struct DoneEvent {
    success: bool,
    code: Option<i32>,
    message: Option<String>,
    cancelled: bool,
}

pub const EVT_OUTPUT: &str = "install:output";
pub const EVT_SECTION: &str = "install:section";
pub const EVT_CLEANUP: &str = "install:cleanup";
pub const EVT_DONE: &str = "install:done";

/// Sentinel prefixes emitted by `install-wow-ui.sh`'s `section_start` /
/// `section_end` helpers. forward_lines watches for these and converts
/// them into `install:section` events, suppressing the marker line from
/// the console output so the user never sees the raw sentinel.
const SECTION_START_PREFIX: &str = "::DML::SECTION::START::";
const SECTION_START_SUFFIX: &str = "::";
const SECTION_END_MARKER: &str = "::DML::SECTION::END::";

fn target_dir_for(server_type: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(match server_type {
        "base" => home.join("wow-server"),
        "npcbots" => home.join("wow-server-npcbots"),
        "playerbots" => home.join("wow-server-playerbots"),
        _ => return None,
    })
}

#[tauri::command]
pub fn detect_installs() -> Result<DetectionResult, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve home directory".to_string())?;
    let entries = std::fs::read_dir(&home).map_err(|e| format!("read $HOME: {e}"))?;

    let mut installs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.starts_with("wow-server") {
            continue;
        }
        // An install is "real" only if it has docker-compose.yml at the root.
        if !path.join("docker-compose.yml").exists() {
            continue;
        }
        let variant = match name {
            "wow-server" => "base",
            "wow-server-npcbots" => "npcbots",
            "wow-server-playerbots" => "playerbots",
            _ => "unknown",
        }
        .to_string();
        // Layered completeness check:
        //   1. install.json must exist — that's the script's "I finished"
        //      marker. Without it we definitely treat as incomplete.
        //   2. If install.json exists AND the worldserver container is
        //      up, do a fast SELECT against acore_auth.account for the
        //      admin user recorded in install.json. A missing admin row
        //      means an earlier install run wrote install.json but the
        //      bootstrap step (account creation) silently failed — the
        //      buggy `python3 + hostile PYTHONHOME` path from before the
        //      fix in install-wow-ui.sh. Mark as incomplete so the UI
        //      offers "Finish setup" and re-runs bootstrap in resume mode.
        //   3. If the DB isn't reachable (container down, mysql slow to
        //      start, etc.) we DON'T flip to incomplete — that would
        //      false-flag healthy installs whenever the server is off.
        //      DB-side check defers to `bootstrap_appears_complete`.
        let marker_exists = path.join(".dads-mmo-lab").join("install.json").exists();
        let complete = if marker_exists {
            bootstrap_appears_complete(&path).unwrap_or(true)
        } else {
            false
        };
        installs.push(DetectedInstall {
            path: path.to_string_lossy().into_owned(),
            variant,
            complete,
        });
    }

    Ok(DetectionResult { installs })
}

/// Verify that the admin account recorded in `install.json` actually
/// exists in `acore_auth.account`. Returns:
///   - `Some(true)`  — install.json + admin row both present
///   - `Some(false)` — install.json says admin=X but the auth DB has
///                     no row for X (bootstrap step silently failed)
///   - `None`        — couldn't reach the DB (container down, etc.).
///                     Caller should NOT treat this as "incomplete";
///                     fall back to trusting install.json.
fn bootstrap_appears_complete(root: &Path) -> Option<bool> {
    let json_path = root.join(".dads-mmo-lab").join("install.json");
    let json = std::fs::read_to_string(&json_path).ok()?;
    // Cheap one-field grep — pulling in serde_json::Value just to read
    // a single string is overkill. install.json has one admin_user line.
    let admin_user = json
        .lines()
        .find_map(|l| {
            let l = l.trim();
            let prefix = "\"admin_user\":";
            if !l.starts_with(prefix) {
                return None;
            }
            let rest = l[prefix.len()..].trim().trim_end_matches(',').trim();
            let unquoted = rest.trim_matches('"');
            if unquoted.is_empty() { None } else { Some(unquoted.to_string()) }
        })?;
    // "unknown" is what `adopt_install` writes for externally-installed
    // servers — no real admin account to check, so trust the marker.
    if admin_user == "unknown" {
        return Some(true);
    }

    let container = std::process::Command::new("docker")
        .args(["ps", "--format", "{{.Names}}"])
        .output()
        .ok()?;
    if !container.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&container.stdout)
        .lines()
        .find(|n| n.to_lowercase().contains("database"))
        .map(|s| s.to_string())?;

    let safe = admin_user.replace('\'', "''");
    let sql = format!(
        "SELECT 1 FROM acore_auth.account WHERE UPPER(username) = UPPER('{}') LIMIT 1;",
        safe
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &name, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    Some(!line.is_empty())
}

/// Adopt an externally-installed server — one created by a different but
/// compatible script (e.g. the original `install-wow.sh`), which doesn't
/// write our `.dads-mmo-lab/install.json` marker. We verify the server is
/// actually up, then write a minimal marker so the app treats it as a
/// complete, managed install. Unlike the "Finish setup" resume path, this
/// does NOT run the account/AHBot bootstrap — the foreign install already
/// has its own accounts and we mustn't clobber them.
#[tauri::command]
pub fn adopt_install(path: String) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.join("docker-compose.yml").exists() {
        return Err(format!(
            "{} doesn't look like a server install (no docker-compose.yml).",
            path
        ));
    }

    // Guard: only adopt a server that's actually running, so we never mark
    // a broken or half-built install "complete". Mirrors the worldserver
    // guard in the install script.
    let ps = std::process::Command::new("docker")
        .args(["ps", "--format", "{{.Names}}"])
        .output()
        .map_err(|e| format!("docker ps failed: {e}"))?;
    let worldserver_up = ps.status.success()
        && String::from_utf8_lossy(&ps.stdout)
            .to_lowercase()
            .contains("worldserver");
    if !worldserver_up {
        return Err(
            "No running worldserver container found — start the server first, then adopt it."
                .into(),
        );
    }

    let variant = match root.file_name().and_then(|n| n.to_str()) {
        Some("wow-server-npcbots") => "npcbots",
        Some("wow-server-playerbots") => "playerbots",
        _ => "base",
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let meta_dir = root.join(".dads-mmo-lab");
    std::fs::create_dir_all(&meta_dir)
        .map_err(|e| format!("create {}: {e}", meta_dir.display()))?;
    // `build_method: "external"` flags this as an adopted, non-UI install.
    let json = format!(
        "{{\n  \"version\": \"external\",\n  \"server_type\": \"{variant}\",\n  \"server_name\": \"WoW 3.3.5a (adopted)\",\n  \"build_method\": \"external\",\n  \"admin_user\": \"unknown\",\n  \"installed_at\": \"{ts}\"\n}}\n"
    );
    std::fs::write(meta_dir.join("install.json"), json)
        .map_err(|e| format!("write install.json: {e}"))?;
    Ok(())
}

/// Resolve the install-wow-ui.sh script. Resolution order:
/// 1. `$DML_INSTALL_SCRIPT` override (testing).
/// 2. The Tauri resource dir — this is where the script lands in a bundled
///    app (AppImage / installed), declared via `bundle.resources`.
/// 3. Walk up from the running binary — the in-repo dev case.
fn resolve_install_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("DML_INSTALL_SCRIPT") {
        let p = PathBuf::from(override_path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!(
            "DML_INSTALL_SCRIPT set but does not exist: {}",
            p.display()
        ));
    }

    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("install-wow-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut cursor: Option<&Path> = exe.parent();
    while let Some(dir) = cursor {
        let candidate = dir.join("install-wow-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
        cursor = dir.parent();
    }
    Err(format!(
        "install-wow-ui.sh not found (checked resource dir + walked up from {})",
        exe.display()
    ))
}

#[tauri::command]
pub async fn start_install(
    app: AppHandle,
    state: State<'_, InstallState>,
    request: InstallRequest,
) -> Result<(), String> {
    let target_dir = target_dir_for(&request.server_type)
        .ok_or_else(|| format!("invalid server_type: {}", request.server_type))?;

    {
        let guard = state.running_pid.lock().unwrap();
        if guard.is_some() {
            return Err("an install is already running".into());
        }
    }

    let script = resolve_install_script(&app)?;

    let mut cmd = Command::new("bash");
    cmd.arg(&script)
        .env("DML_RESUME", if request.resume { "1" } else { "0" })
        .env("DML_SERVER_TYPE", &request.server_type)
        .env("DML_ADMIN_USER", &request.admin_user)
        .env("DML_ADMIN_PASS", &request.admin_pass)
        .env("DML_FORCE", if request.force { "1" } else { "0" })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    if let Some(build_method) = &request.build_method {
        cmd.env("DML_BUILD_METHOD", build_method);
    }

    // ── Module env vars ─────────────────────────────────────────────
    // Comma-separated list of module keys the user picked in the wizard.
    // Empty / unset = no modules. Script handles both gracefully.
    if !request.modules.is_empty() {
        cmd.env("DML_MODULES_ADD", request.modules.join(","));
    }

    // Per-module config — only set env vars the user actually picked
    // values for. The script reads each var with `${VAR:-}` so unset
    // means "use the .conf.dist default".
    if let Some(ah) = &request.module_config.ahbot {
        if let Some(v) = ah.items_per_cycle {
            cmd.env("DML_MOD_AHBOT_ITEMS_PER_CYCLE", v.to_string());
        }
        if let Some(v) = ah.elapsing_time_class {
            cmd.env("DML_MOD_AHBOT_ELAPSING_TIME_CLASS", v.to_string());
        }
        if let Some(v) = ah.enable_buyer {
            cmd.env("DML_MOD_AHBOT_ENABLE_BUYER", if v { "1" } else { "0" });
        }
        if let Some(v) = ah.vendor_items {
            cmd.env("DML_MOD_AHBOT_VENDOR_ITEMS", if v { "1" } else { "0" });
        }
        if let Some(v) = ah.profession_items {
            cmd.env("DML_MOD_AHBOT_PROFESSION_ITEMS", if v { "1" } else { "0" });
        }
    }
    if let Some(ip) = &request.module_config.ip {
        if let Some(v) = ip.authentic_difficulty {
            cmd.env(
                "DML_MOD_IP_AUTHENTIC_DIFFICULTY",
                if v { "1" } else { "0" },
            );
        }
        if let Some(v) = ip.disable_rdf {
            cmd.env("DML_MOD_IP_DISABLE_RDF", if v { "1" } else { "0" });
        }
        if let Some(v) = ip.dk_requires_tbc {
            cmd.env("DML_MOD_IP_DK_REQUIRES_TBC", if v { "1" } else { "0" });
        }
    }

    // Put the script in its own process group so cancel can SIGTERM the
    // whole tree. Without this, killing bash leaves git/docker orphaned.
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(|e| format!("spawn install script: {e}"))?;
    let pid = child.id().ok_or("could not read child PID")?;

    {
        let mut guard = state.running_pid.lock().unwrap();
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    // Spawn the readers and hold their handles. The wait task will await
    // these before doing anything else, so all of the subprocess's pipe
    // output is drained and emitted before our own system lines (cleanup,
    // done) get a chance to interleave.
    let stdout_handle = tokio::spawn(forward_lines(stdout, app.clone(), "stdout"));
    let stderr_handle = tokio::spawn(forward_lines(stderr, app.clone(), "stderr"));

    let app_done = app.clone();
    let target_for_cleanup = target_dir.clone();
    tokio::spawn(async move {
        let result = child.wait().await;
        // Clear PID first so the UI never sees "running" with no live process.
        if let Some(state) = app_done.try_state::<InstallState>() {
            let mut guard = state.running_pid.lock().unwrap();
            *guard = None;
        }

        // Drain stdout/stderr fully before emitting cleanup or done. When
        // the child exits, its pipes close, the readers hit EOF, and these
        // joins complete on their own — bounded wait.
        let _ = stdout_handle.await;
        let _ = stderr_handle.await;

        match result {
            Ok(status) => {
                // SIGTERM from cancel typically shows up as a signal-based
                // exit (code is None on Unix when terminated by a signal).
                let cancelled = status.code().is_none();

                if cancelled {
                    perform_cleanup(&app_done, &target_for_cleanup).await;
                }

                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        success: status.success(),
                        code: status.code(),
                        message: if cancelled {
                            Some("install cancelled".into())
                        } else {
                            None
                        },
                        cancelled,
                    },
                );
            }
            Err(e) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        success: false,
                        code: None,
                        message: Some(format!("wait failed: {e}")),
                        cancelled: false,
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_install(state: State<'_, InstallState>) -> Result<bool, String> {
    let pid = {
        let guard = state.running_pid.lock().unwrap();
        *guard
    };
    let Some(pid) = pid else {
        return Ok(false);
    };

    #[cfg(unix)]
    unsafe {
        // Negative PID = signal the entire process group, which we
        // created above via process_group(0).
        let pgid = -(pid as i32);
        if libc::kill(pgid, libc::SIGTERM) != 0 {
            let err = std::io::Error::last_os_error();
            // ESRCH (no such process) just means it already exited — fine.
            if err.raw_os_error() != Some(libc::ESRCH) {
                return Err(format!("kill({pgid}, SIGTERM): {err}"));
            }
        }
    }

    #[cfg(not(unix))]
    {
        let _ = pid;
        return Err("cancel is only implemented on Unix".into());
    }

    Ok(true)
}

/// Cleanup after a cancelled install.
///
/// Safety: never delete a directory that contains `.dads-mmo-lab/install.json`
/// — that file is written only at the end of a successful install, so its
/// presence means "completed server, don't touch." A directory without it
/// is either non-existent or a partial install from the run we just killed,
/// which is safe to remove.
///
/// Best-effort: if there's a docker-compose.yml in the dir, run
/// `docker compose down -v` first to stop any containers and volumes the
/// script may have started. Failures are surfaced as system lines but
/// don't block the rm.
async fn perform_cleanup(app: &AppHandle, target: &Path) {
    let path_str = target.to_string_lossy().into_owned();

    let _ = app.emit(
        EVT_CLEANUP,
        CleanupEvent {
            stage: "started",
            path: path_str.clone(),
            deleted: false,
            skipped_reason: None,
            error: None,
        },
    );

    if !target.exists() {
        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream: "system",
                line: format!("Nothing to clean up — {} doesn't exist.", path_str),
                transient: false,
            },
        );
        let _ = app.emit(
            EVT_CLEANUP,
            CleanupEvent {
                stage: "finished",
                path: path_str,
                deleted: false,
                skipped_reason: Some("not-found".into()),
                error: None,
            },
        );
        return;
    }

    // Safety check: refuse to delete a completed install.
    let metadata_path = target.join(".dads-mmo-lab").join("install.json");
    if metadata_path.exists() {
        let msg = format!(
            "Refusing to clean {} — install.json exists, which means this is a completed server.",
            path_str
        );
        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream: "system",
                line: msg,
                transient: false,
            },
        );
        let _ = app.emit(
            EVT_CLEANUP,
            CleanupEvent {
                stage: "finished",
                path: path_str,
                deleted: false,
                skipped_reason: Some("completed-install".into()),
                error: None,
            },
        );
        return;
    }

    // Best-effort container teardown before nuking the dir.
    if target.join("docker-compose.yml").exists() {
        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream: "system",
                line: format!("Stopping any containers started from {} ...", path_str),
                transient: false,
            },
        );
        let down = Command::new("docker")
            .args(["compose", "down", "-v"])
            .current_dir(target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
        match down {
            Ok(s) if s.success() => {
                let _ = app.emit(
                    EVT_OUTPUT,
                    OutputEvent {
                        stream: "system",
                        line: "Containers stopped.".into(),
                        transient: false,
                    },
                );
            }
            _ => {
                let _ = app.emit(
                    EVT_OUTPUT,
                    OutputEvent {
                        stream: "system",
                        line: "Container teardown skipped (none running, or docker compose down failed).".into(),
                        transient: false,
                    },
                );
            }
        }
    }

    let _ = app.emit(
        EVT_OUTPUT,
        OutputEvent {
            stream: "system",
            line: format!("Removing partial install at {} ...", path_str),
            transient: false,
        },
    );

    match std::fs::remove_dir_all(target) {
        Ok(()) => {
            let _ = app.emit(
                EVT_OUTPUT,
                OutputEvent {
                    stream: "system",
                    line: "Cleanup complete.".into(),
                    transient: false,
                },
            );
            let _ = app.emit(
                EVT_CLEANUP,
                CleanupEvent {
                    stage: "finished",
                    path: path_str,
                    deleted: true,
                    skipped_reason: None,
                    error: None,
                },
            );
        }
        Err(e) => {
            let err = format!("rm -rf {} failed: {}", path_str, e);
            let _ = app.emit(
                EVT_OUTPUT,
                OutputEvent {
                    stream: "stderr",
                    line: err.clone(),
                    transient: false,
                },
            );
            let _ = app.emit(
                EVT_CLEANUP,
                CleanupEvent {
                    stage: "finished",
                    path: path_str,
                    deleted: false,
                    skipped_reason: None,
                    error: Some(err),
                },
            );
        }
    }
}

/// Forward subprocess output line-by-line, distinguishing `\n` (committed
/// new line) from `\r` (transient progress update that should overwrite the
/// previous progress line in a real terminal). The frontend uses the
/// `transient` flag to decide whether to append to history or replace the
/// pending update slot. `\r\n` pairs are normalised to a single final
/// emission.
async fn forward_lines<R: AsyncRead + Unpin>(
    reader: R,
    app: AppHandle,
    stream: &'static str,
) {
    let mut reader = BufReader::new(reader);
    let mut buf = [0u8; 4096];
    let mut line = String::new();
    // True if the immediately-previous byte was a bare `\r` — we hold off
    // emission until we know if the next byte is `\n` (CRLF → final) or
    // something else (bare CR → transient).
    let mut saw_cr = false;

    let emit_line = |line: &mut String, transient: bool, app: &AppHandle| {
        if line.is_empty() {
            return;
        }
        let stripped = strip_ansi(line);
        line.clear();

        // Section sentinels are only meaningful when they arrive as final
        // (non-transient) lines — they're plain `echo` output from the
        // script. Catch them here and translate to install:section events
        // without emitting the marker text itself.
        if !transient {
            let trimmed = stripped.trim();
            if let Some(rest) = trimmed.strip_prefix(SECTION_START_PREFIX) {
                let title = rest
                    .strip_suffix(SECTION_START_SUFFIX)
                    .unwrap_or(rest)
                    .to_string();
                let _ = app.emit(
                    EVT_SECTION,
                    SectionEvent {
                        stage: "start",
                        title: Some(title),
                    },
                );
                return;
            }
            if trimmed == SECTION_END_MARKER {
                let _ = app.emit(
                    EVT_SECTION,
                    SectionEvent {
                        stage: "end",
                        title: None,
                    },
                );
                return;
            }
        }

        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream,
                line: stripped,
                transient,
            },
        );
    };

    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        let chunk = String::from_utf8_lossy(&buf[..n]);

        for ch in chunk.chars() {
            if saw_cr {
                saw_cr = false;
                if ch == '\n' {
                    // `\r\n` — commit the buffered line as a final, non-
                    // transient update and consume the `\n`.
                    emit_line(&mut line, false, &app);
                    continue;
                } else {
                    // Bare `\r` — the buffered line was a transient
                    // progress update. Emit it and fall through so `ch`
                    // is treated as the start of the next line.
                    emit_line(&mut line, true, &app);
                }
            }

            if ch == '\r' {
                saw_cr = true;
            } else if ch == '\n' {
                emit_line(&mut line, false, &app);
            } else {
                line.push(ch);
            }
        }
    }

    // End of stream — flush any trailing content. If we ended on a bare
    // `\r` it was a transient progress line; otherwise treat it as final.
    emit_line(&mut line, saw_cr, &app);
}

/// Strip CSI (most common ANSI) escape sequences. Doesn't try to handle
/// OSC or DEC sequences — the install script only uses simple SGR codes.
fn strip_ansi(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() && !(bytes[i] as char).is_ascii_alphabetic() {
                i += 1;
            }
            if i < bytes.len() {
                i += 1;
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
