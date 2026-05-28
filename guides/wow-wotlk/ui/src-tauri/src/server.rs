use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;

/// Tracks the PID of any in-flight `docker compose up/down` so the UI's
/// stop button can SIGTERM the whole group if needed. Spawned with
/// `process_group(0)` so `kill(-pid, SIGTERM)` takes down the tree.
///
/// `client_watcher_alive` is a CAS flag so the auto-shutdown watcher
/// (see `ensure_client_watcher`) can't spawn more than once at a time —
/// the frontend calls the ensure-fn liberally (every server start, every
/// toggle flip) and we rely on this flag to coalesce.
#[derive(Default)]
pub struct ServerControlState {
    pub running_pid: Mutex<Option<u32>>,
    pub client_watcher_alive: AtomicBool,
}

/// AzerothCore worldserver listens on this host port (mapped from the
/// container's 8085). All three variants (base, npcbots, playerbots)
/// inherit this from acore-docker's compose, so it's safe to hardcode
/// for now. If a user ever needs a different host port, we'll parse it
/// out of `docker inspect`.
const WORLDSERVER_PORT: u16 = 8085;

#[derive(Serialize, Clone)]
struct OutputEvent {
    stream: &'static str,
    line: String,
    transient: bool,
}

#[derive(Serialize, Clone)]
struct DoneEvent {
    action: &'static str, // "start" | "stop"
    success: bool,
    code: Option<i32>,
    message: Option<String>,
}

pub const EVT_OUTPUT: &str = "server:output";
pub const EVT_DONE: &str = "server:done";
/// Fired when the auto-shutdown watcher triggers a stop because the WoW
/// client exited. The UI shows an AlertDialog explaining the shutdown
/// so users don't think the server crashed on its own.
pub const EVT_AUTO_SHUTDOWN_FIRED: &str = "server:auto-shutdown-fired";

/// Server runtime status from the Docker daemon's POV — used by both the
/// initial detection on app startup and by the post-action recheck.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorldserverStatus {
    /// No worldserver container exists.
    NotPresent,
    /// Container exists but is not running.
    Stopped,
    /// Container is running but not yet accepting connections — the
    /// worldserver process is still initialising.
    Starting,
    /// Container is in docker's `restarting` state — almost always means
    /// the worldserver process is segfaulting / exiting on launch and
    /// docker's restart policy keeps re-spawning it. UI surfaces this so
    /// the user sees "crashed" instead of "starting…" forever.
    Crashed,
    /// Container is running and accepting TCP connections on the
    /// worldserver port.
    Running,
}

#[derive(Serialize, Clone)]
pub struct ServerStatus {
    pub worldserver: WorldserverStatus,
    pub install_path: Option<String>,
}

fn first_install_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let entries = std::fs::read_dir(&home).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("wow-server") {
            continue;
        }
        if path.join("docker-compose.yml").exists() {
            return Some(path);
        }
    }
    None
}

fn worldserver_container_name() -> Option<String> {
    let out = std::process::Command::new("docker")
        .args(["ps", "-a", "--format", "{{.Names}}"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|n| n.to_lowercase().contains("worldserver"))
        .map(|s| s.to_string())
}

/// Returns docker's reported container state for `name` — one of
/// `created`, `running`, `paused`, `restarting`, `removing`, `exited`,
/// `dead`. None on error or unknown container.
///
/// We deliberately read `.State.Status` rather than `.State.Running`:
/// `.State.Running` returns `true` for both `running` *and* `restarting`,
/// which means a container in a crash loop looks identical to a healthy
/// running container. `.State.Status` distinguishes them, which is the
/// only way the UI can tell "still booting" apart from "crash-looping".
fn container_state(name: &str) -> Option<String> {
    let out = std::process::Command::new("docker")
        .args(["inspect", "--format", "{{.State.Status}}", name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Returns true if the compose stack at `install_path` defines a service
/// with the given name. Used to decide whether `--scale phpmyadmin=0` is
/// safe to pass on start — Base / NPCBots-prebuilt installs use
/// acore-docker which includes phpmyadmin; the Playerbots fork doesn't
/// define that service, so passing the flag there errors out with
/// "no such service: phpmyadmin".
fn compose_has_service(install_path: &Path, service: &str) -> bool {
    let compose_file = install_path.join("docker-compose.yml");
    let Some(compose_str) = compose_file.to_str() else {
        return false;
    };
    let Ok(out) = std::process::Command::new("docker")
        .args(["compose", "-f", compose_str, "config", "--services"])
        .current_dir(install_path)
        .output()
    else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.trim() == service)
}

/// Try to open a TCP connection to the worldserver's host port. The
/// worldserver only starts accepting connections once world init is
/// fully done, so this is a direct signal of "ready for clients" — much
/// cheaper and more reliable than scanning docker logs for the "ready..."
/// marker. Short timeout because localhost is instant when up.
fn worldserver_accepts_connections() -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr: SocketAddr = ([127, 0, 0, 1], WORLDSERVER_PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

#[tauri::command]
pub fn get_server_status() -> Result<ServerStatus, String> {
    let install_path = first_install_path();
    let container = worldserver_container_name();

    let worldserver = match container {
        None => WorldserverStatus::NotPresent,
        Some(name) => match container_state(&name).as_deref() {
            Some("running") => {
                if worldserver_accepts_connections() {
                    WorldserverStatus::Running
                } else {
                    WorldserverStatus::Starting
                }
            }
            Some("restarting") => WorldserverStatus::Crashed,
            // exited / created / paused / dead / removing / unknown / None
            _ => WorldserverStatus::Stopped,
        },
    };

    Ok(ServerStatus {
        worldserver,
        install_path: install_path.map(|p| p.to_string_lossy().into_owned()),
    })
}

async fn spawn_compose(
    action: &'static str,
    app: AppHandle,
    state: State<'_, ServerControlState>,
    install_path: &Path,
    extra_args: &[&str],
) -> Result<(), String> {
    {
        let guard = state.running_pid.lock().unwrap();
        if guard.is_some() {
            return Err(format!("a server action is already running"));
        }
    }

    // Do NOT pass `-f docker-compose.yml` here. Per the Docker Compose
    // docs, passing `-f` explicitly disables auto-detection of
    // `docker-compose.override.yml` — and the Playerbots install relies
    // on the override for the `./modules:/azerothcore/modules` mount and
    // the `AC_PLAYERBOTS_*` env vars. Without those the worldserver
    // can't find its module source and segfaults in a restart loop.
    //
    // Relying on `current_dir` is what the canonical install +
    // wow-playerbots-launcher.sh scripts do; it picks up both compose
    // files automatically. The 2026-05-17 incident traced back to this
    // exact divergence — see the post-mortem in the dev log.
    let mut cmd = Command::new("docker");
    cmd.arg("compose")
        .args(extra_args)
        .current_dir(install_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn docker compose: {e}"))?;
    let pid = child.id().ok_or("could not read child PID")?;

    {
        let mut guard = state.running_pid.lock().unwrap();
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    // Tag both pipes as "stdout" so the console renders them neutral.
    // docker compose writes container lifecycle messages (Created /
    // Starting / Healthy / etc.) to stderr by convention, but they are
    // informational, not errors. A real failure shows up as the action's
    // exit code, surfaced via the install:done event — not via stderr
    // coloring. Avoids "every line is red and looks scary".
    let stdout_handle = tokio::spawn(forward_lines(stdout, app.clone(), "stdout"));
    let stderr_handle = tokio::spawn(forward_lines(stderr, app.clone(), "stdout"));

    let app_done = app.clone();
    tokio::spawn(async move {
        let result = child.wait().await;
        if let Some(state) = app_done.try_state::<ServerControlState>() {
            let mut guard = state.running_pid.lock().unwrap();
            *guard = None;
        }
        // Drain output pipes before emitting done so the user sees the
        // last few lines in the right order.
        let _ = stdout_handle.await;
        let _ = stderr_handle.await;

        // For `up -d` we additionally poll for the worldserver's
        // "ready..." log line — `up -d` returns as soon as containers
        // start, but the worldserver itself takes 5–30+ seconds to
        // finish initializing (much longer on first run after compile).
        // We emit progress system lines so the user knows we're waiting.
        let mut wait_success = true;
        let mut wait_message: Option<String> = None;
        if action == "start" {
            if let Ok(s) = &result {
                if s.success() {
                    match wait_for_world_ready(&app_done).await {
                        Ok(()) => {}
                        Err(e) => {
                            wait_success = false;
                            wait_message = Some(e);
                        }
                    }
                }
            }
        }

        match result {
            Ok(status) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        action,
                        success: status.success() && wait_success,
                        code: status.code(),
                        message: wait_message,
                    },
                );
            }
            Err(e) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        action,
                        success: false,
                        code: None,
                        message: Some(format!("wait failed: {e}")),
                    },
                );
            }
        }
    });

    Ok(())
}

async fn wait_for_world_ready(app: &AppHandle) -> Result<(), String> {
    // Poll the worldserver's TCP port every few seconds until it accepts
    // connections. Cap at 30 minutes (first launch after compile is the
    // slow case — Playerbots database migration). If the container dies
    // mid-wait, bail with a clear error.
    const POLL_INTERVAL_SECS: u64 = 2;
    const MAX_SECS: u64 = 30 * 60;

    let _ = app.emit(
        EVT_OUTPUT,
        OutputEvent {
            stream: "system",
            line: format!(
                "Waiting for worldserver to accept connections on 127.0.0.1:{WORLDSERVER_PORT}…"
            ),
            transient: false,
        },
    );

    let mut elapsed = 0u64;
    loop {
        if let Some(name) = worldserver_container_name() {
            match container_state(&name).as_deref() {
                Some("running") => {} // ok — fall through to TCP check
                Some("restarting") => {
                    return Err(format!(
                        "worldserver container '{}' is crash-looping. Check `docker logs {}` for the cause.",
                        name, name
                    ));
                }
                _ => {
                    return Err(format!(
                        "worldserver container '{}' is not running",
                        name
                    ));
                }
            }
            if worldserver_accepts_connections() {
                let _ = app.emit(
                    EVT_OUTPUT,
                    OutputEvent {
                        stream: "system",
                        line: "Worldserver ready.".into(),
                        transient: false,
                    },
                );
                return Ok(());
            }
        }

        if elapsed >= MAX_SECS {
            return Err(format!(
                "worldserver did not accept connections within {} seconds",
                MAX_SECS
            ));
        }

        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream: "system",
                line: format!("…still initialising ({}s)", elapsed),
                transient: true,
            },
        );

        tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
        elapsed += POLL_INTERVAL_SECS;
    }
}

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    state: State<'_, ServerControlState>,
) -> Result<(), String> {
    let install_path = first_install_path().ok_or_else(|| {
        "no install detected — install a server before trying to start it".to_string()
    })?;

    // phpmyadmin is an optional debugging service. When present we scale
    // it to 0 so it doesn't eat resources; when absent (Playerbots fork)
    // the flag would error, so skip it.
    let mut args: Vec<&str> = vec!["up", "-d"];
    if compose_has_service(&install_path, "phpmyadmin") {
        args.extend(["--scale", "phpmyadmin=0"]);
    }

    spawn_compose("start", app, state, &install_path, &args).await
}

#[tauri::command]
pub async fn stop_server(
    app: AppHandle,
    state: State<'_, ServerControlState>,
) -> Result<(), String> {
    let install_path = first_install_path()
        .ok_or_else(|| "no install detected".to_string())?;
    spawn_compose("stop", app, state, &install_path, &["down"]).await
}

/// Restart in one shot: `docker compose down && docker compose up -d`
/// run as a single bash invocation so the UI gets one streamed action
/// and one `server:done` event. The combined command handles the
/// recovery case where the user's container is stuck in a bad state —
/// equivalent to clicking Stop then Start, but one click and no risk
/// of forgetting the second half.
#[tauri::command]
pub async fn restart_server(
    app: AppHandle,
    state: State<'_, ServerControlState>,
) -> Result<(), String> {
    let install_path = first_install_path()
        .ok_or_else(|| "no install detected".to_string())?;

    {
        let guard = state.running_pid.lock().unwrap();
        if guard.is_some() {
            return Err("a server action is already running".into());
        }
    }

    let stdout_handle;
    let stderr_handle;
    let pid;
    let mut child;
    {
        let mut cmd = Command::new("bash");
        cmd.arg("-c")
            .arg("docker compose down && docker compose up -d")
            .current_dir(&install_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        #[cfg(unix)]
        cmd.process_group(0);
        child = cmd
            .spawn()
            .map_err(|e| format!("spawn docker compose (restart): {e}"))?;
        pid = child.id().ok_or("could not read child PID")?;
        let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
        let stderr = child.stderr.take().ok_or("missing stderr pipe")?;
        // Same neutral coloring as the regular start/stop — compose
        // writes lifecycle messages to stderr but they're informational.
        stdout_handle = tokio::spawn(forward_lines(stdout, app.clone(), "stdout"));
        stderr_handle = tokio::spawn(forward_lines(stderr, app.clone(), "stdout"));
    }

    {
        let mut guard = state.running_pid.lock().unwrap();
        *guard = Some(pid);
    }

    let app_done = app.clone();
    tokio::spawn(async move {
        let result = child.wait().await;
        if let Some(state) = app_done.try_state::<ServerControlState>() {
            let mut guard = state.running_pid.lock().unwrap();
            *guard = None;
        }
        let _ = stdout_handle.await;
        let _ = stderr_handle.await;

        // After the compose up half, wait for the worldserver to be
        // ready — same pattern as start.
        let mut wait_success = true;
        let mut wait_message: Option<String> = None;
        if let Ok(s) = &result {
            if s.success() {
                if let Err(e) = wait_for_world_ready(&app_done).await {
                    wait_success = false;
                    wait_message = Some(e);
                }
            }
        }

        match result {
            Ok(status) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        action: "restart",
                        success: status.success() && wait_success,
                        code: status.code(),
                        message: wait_message,
                    },
                );
            }
            Err(e) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        action: "restart",
                        success: false,
                        code: None,
                        message: Some(format!("wait failed: {e}")),
                    },
                );
            }
        }
    });

    Ok(())
}

async fn forward_lines<R: AsyncRead + Unpin>(
    reader: R,
    app: AppHandle,
    stream: &'static str,
) {
    let mut reader = BufReader::new(reader);
    let mut buf = [0u8; 4096];
    let mut line = String::new();
    let mut saw_cr = false;

    let emit_line = |line: &mut String, transient: bool, app: &AppHandle| {
        if line.is_empty() {
            return;
        }
        let _ = app.emit(
            EVT_OUTPUT,
            OutputEvent {
                stream,
                line: strip_ansi(line),
                transient,
            },
        );
        line.clear();
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
                    emit_line(&mut line, false, &app);
                    continue;
                } else {
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

    emit_line(&mut line, saw_cr, &app);
}

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

// ── Auto-shutdown-on-client-exit watcher ────────────────────────────
//
// Polls every 5s for the WoW client process. The loop enters in a
// "looking for the client" state; once it sees `Wow.exe` running it
// flips to "watching for exit" — that two-phase design is why toggling
// the setting on with no client open doesn't immediately kill a server
// the user is doing other work against.
//
// Exits early on any of:
//   * `auto_shutdown_on_client_exit` setting flipped off
//   * worldserver no longer Running (Stopped, Crashed, etc.)
//   * client was seen, then went away — in which case it ALSO fires
//     stop_server before exiting
//
// Single-instance guard via the `client_watcher_alive` CAS flag in
// ServerControlState. The frontend calls `ensure_client_watcher`
// liberally (after start, on toggle-on); the CAS makes duplicate calls
// no-ops.

const CLIENT_POLL_INTERVAL_SECS: u64 = 5;

/// True iff `pgrep -f Wow.exe` finds any process. Steam Deck users run
/// WoW under Proton/Wine, where the Windows EXE name appears verbatim
/// in the process command line — `pgrep -f` matches against /proc/<pid>/cmdline.
fn wow_client_is_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-f", "Wow.exe"])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Idempotent: if a watcher is already running, returns without doing
/// anything. Otherwise spawns one. Safe to call any time; the watcher
/// re-checks the auto-shutdown setting on every tick and self-exits
/// if it's been turned off.
///
/// Must be `async fn` (not `fn`) — sync Tauri commands run on a worker
/// thread without an attached tokio reactor, so `tokio::spawn` inside
/// would panic with "no reactor running". `async fn` commands are
/// dispatched on Tauri's tokio runtime.
#[tauri::command]
pub async fn ensure_client_watcher(
    app: AppHandle,
    state: State<'_, ServerControlState>,
) -> Result<(), String> {
    // CAS the "alive" flag — if we lose the race, another task is
    // already watching and we have nothing to do.
    if state
        .client_watcher_alive
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }

    let app = app.clone();
    tokio::spawn(async move {
        let mut seen_client = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(CLIENT_POLL_INTERVAL_SECS))
                .await;

            // Bail if the setting got turned off mid-flight.
            if !crate::app_settings::load().auto_shutdown_on_client_exit {
                log::info!("client watcher: setting disabled, exiting");
                break;
            }

            // Bail if the server isn't actually running anymore — no
            // point watching a stopped server. We check via the same
            // detection get_server_status uses so transient states
            // (Starting/Crashed) don't trip the watcher.
            let still_running = worldserver_container_name()
                .and_then(|n| container_state(&n))
                .as_deref()
                == Some("running")
                && worldserver_accepts_connections();
            if !still_running {
                log::info!("client watcher: worldserver no longer running, exiting");
                break;
            }

            let running = wow_client_is_running();
            if running {
                if !seen_client {
                    log::info!("client watcher: WoW client detected — armed");
                }
                seen_client = true;
                continue;
            }
            if seen_client {
                log::info!("client watcher: WoW client exited — auto-stopping server");
                let state = app.state::<ServerControlState>();
                match stop_server(app.clone(), state).await {
                    Ok(()) => {
                        // Notify the UI so we can surface an AlertDialog
                        // explaining why the server just stopped. Silent
                        // shutdowns are confusing — "I quit WoW for a
                        // minute, came back, server's off?".
                        if let Err(e) = app.emit(EVT_AUTO_SHUTDOWN_FIRED, ()) {
                            log::warn!("emit auto-shutdown event: {e}");
                        }
                    }
                    Err(e) => {
                        log::warn!("client watcher: stop_server failed: {e}");
                    }
                }
                break;
            }
            // !running && !seen_client → keep polling (user hasn't
            // launched the client yet)
        }
        // Release the single-instance flag so the next ensure_client_watcher
        // call can spawn a fresh watcher.
        let state = app.state::<ServerControlState>();
        state.client_watcher_alive.store(false, Ordering::Release);
    });
    Ok(())
}
