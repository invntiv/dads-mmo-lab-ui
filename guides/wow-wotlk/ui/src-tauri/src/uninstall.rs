//! Uninstall: tears down a single WoW install by spawning the
//! non-interactive `uninstall-wow-ui.sh`. Streams output through the same
//! transient/final + collapsible-section primitives the install flow uses,
//! but under a separate `uninstall:*` event namespace so the UI state
//! machines don't collide.
//!
//! Why a shell script instead of a pure-Rust teardown:
//!   - The base repo's uninstall.sh is the source of truth for "what does
//!     a clean WoW-WoTLK uninstall look like." Keeping our flow as a thin
//!     env-driven variant means we automatically pick up upstream cleanup
//!     improvements when we re-sync.
//!   - Docker, sudo, network/volume cleanup are all things bash already
//!     handles well — wrapping them in tokio::process buys us nothing.
//!
//! Safety:
//!   - Target path is *derived* from `variant` on the Rust side. The UI
//!     sends `variant` (base|npcbots|playerbots); we never let the
//!     frontend pass an arbitrary directory path through to `rm -rf`.
//!   - The script's `safe_rm_rf` refuses anything outside `$HOME`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::Command;

/// Tracks the PID of an in-flight uninstall so a future cancel can signal
/// it. We don't expose cancel today (the uninstall is short and the user
/// would likely leave the app in a half-cleaned state if they killed it
/// mid-run), but reserving the slot keeps the door open.
#[derive(Default)]
pub struct UninstallState {
    pub running_pid: Mutex<Option<u32>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UninstallRequest {
    /// One of "base" | "npcbots" | "playerbots".
    pub variant: String,
    /// Keep the `ac-client-data` volume (the extracted maps/DBCs).
    /// Defaults to true — re-extracting takes ~15min.
    #[serde(default = "default_true")]
    pub keep_client_data: bool,
    /// Remove docker images (~3-5GB). Defaults to false — Eluna's build
    /// is the slowest part of install, and keeping it speeds future runs.
    #[serde(default)]
    pub remove_images: bool,
    /// Wipe ~/.config/dads-mmo-lab/settings.json (selected character,
    /// dismissed notices, etc). Useful for fresh-install testing.
    #[serde(default)]
    pub wipe_app_config: bool,
    /// Wipe the item-icons / tooltip-data / talent-data JSON caches.
    /// These are universal across 3.3.5a clients, so the default is to
    /// preserve them — re-extracting takes minutes.
    #[serde(default)]
    pub wipe_caches: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Clone)]
struct OutputEvent {
    stream: &'static str,
    line: String,
    transient: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SectionEvent {
    stage: &'static str,
    title: Option<String>,
}

#[derive(Serialize, Clone)]
struct DoneEvent {
    success: bool,
    code: Option<i32>,
    message: Option<String>,
}

const EVT_OUTPUT: &str = "uninstall:output";
const EVT_SECTION: &str = "uninstall:section";
pub const EVT_DONE: &str = "uninstall:done";

// Sentinel prefixes — same shape as install.rs since uninstall-wow-ui.sh
// reuses the section_start/section_end helpers.
const SECTION_START_PREFIX: &str = "::DML::SECTION::START::";
const SECTION_START_SUFFIX: &str = "::";
const SECTION_END_MARKER: &str = "::DML::SECTION::END::";

fn target_dir_for(variant: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(match variant {
        "base" => home.join("wow-server"),
        "npcbots" => home.join("wow-server-npcbots"),
        "playerbots" => home.join("wow-server-playerbots"),
        _ => return None,
    })
}

/// Resolve uninstall-wow-ui.sh. Same lookup order as the install script:
/// env override → Tauri resource dir → walk up from the running binary.
fn resolve_uninstall_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("DML_UNINSTALL_SCRIPT") {
        let p = PathBuf::from(override_path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!(
            "DML_UNINSTALL_SCRIPT set but does not exist: {}",
            p.display()
        ));
    }

    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("uninstall-wow-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut cursor: Option<&Path> = exe.parent();
    while let Some(dir) = cursor {
        let candidate = dir.join("uninstall-wow-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
        cursor = dir.parent();
    }
    Err(format!(
        "uninstall-wow-ui.sh not found (checked resource dir + walked up from {})",
        exe.display()
    ))
}

#[tauri::command]
pub async fn start_uninstall(
    app: AppHandle,
    state: State<'_, UninstallState>,
    request: UninstallRequest,
) -> Result<(), String> {
    let target_dir = target_dir_for(&request.variant)
        .ok_or_else(|| format!("invalid variant: {}", request.variant))?;

    {
        let guard = state.running_pid.lock().unwrap();
        if guard.is_some() {
            return Err("an uninstall is already running".into());
        }
    }

    let script = resolve_uninstall_script(&app)?;

    let mut cmd = Command::new("bash");
    cmd.arg(&script)
        .env("DML_VARIANT", &request.variant)
        .env("DML_TARGET_DIR", &target_dir)
        .env(
            "DML_KEEP_CLIENT_DATA",
            if request.keep_client_data { "1" } else { "0" },
        )
        .env(
            "DML_REMOVE_IMAGES",
            if request.remove_images { "1" } else { "0" },
        )
        .env(
            "DML_WIPE_APP_CONFIG",
            if request.wipe_app_config { "1" } else { "0" },
        )
        .env(
            "DML_WIPE_CACHES",
            if request.wipe_caches { "1" } else { "0" },
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn uninstall script: {e}"))?;
    let pid = child.id().ok_or("could not read child PID")?;

    {
        let mut guard = state.running_pid.lock().unwrap();
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    let stdout_handle = tokio::spawn(forward_lines(stdout, app.clone(), "stdout"));
    let stderr_handle = tokio::spawn(forward_lines(stderr, app.clone(), "stderr"));

    let app_done = app.clone();
    tokio::spawn(async move {
        let result = child.wait().await;
        if let Some(state) = app_done.try_state::<UninstallState>() {
            let mut guard = state.running_pid.lock().unwrap();
            *guard = None;
        }

        let _ = stdout_handle.await;
        let _ = stderr_handle.await;

        match result {
            Ok(status) => {
                let _ = app_done.emit(
                    EVT_DONE,
                    DoneEvent {
                        success: status.success(),
                        code: status.code(),
                        message: None,
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
                    },
                );
            }
        }
    });

    Ok(())
}

// ── Reader plumbing ──────────────────────────────────────────────
//
// Mirrors `install::forward_lines` but emits to `uninstall:*` events.
// Pulled in as a local copy rather than refactoring the shared helper —
// `forward_lines` captures event names as const strings via `EVT_OUTPUT`
// / `EVT_SECTION`, so the cheapest path to a second namespace is a small
// duplicate here. ~90 lines total.

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
        let stripped = strip_ansi(line);
        line.clear();

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
