//! SteamOS update detection + the "Fix after SteamOS update" runner.
//!
//! SteamOS ships an immutable, A/B-updated rootfs. A system update swaps
//! the active partition, which routinely wipes the user-installed Docker
//! and invalidates the pacman keyring — so a server that worked yesterday
//! suddenly can't start. The standalone `fix-after-update.sh` repairs
//! this; here we (a) detect that an update happened by remembering the
//! last-seen OS version, and (b) run the non-interactive UI companion
//! (`fix-after-update-ui.sh`) as root via pkexec, streaming its output
//! through the install console's plumbing.
//!
//! Version string = `VERSION_ID (BUILD_ID)` from /etc/os-release, so both
//! point releases (3.7.24 → 3.7.25) and same-version rebuilds (BUILD_ID
//! date bump) count as "an update happened".

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

pub const EVT_FIX_OUTPUT: &str = "steamos_fix:output";
pub const EVT_FIX_SECTION: &str = "steamos_fix:section";
pub const EVT_FIX_DONE: &str = "steamos_fix:done";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamOsStatus {
    /// True only on an actual SteamOS host. The fix is SteamOS-specific;
    /// on Ubuntu/WSL2 the whole feature stays hidden.
    pub is_steamos: bool,
    pub current_version: Option<String>,
    pub last_version: Option<String>,
    /// True when we're on SteamOS, have a recorded baseline, and the live
    /// version differs from it — i.e. an update landed since last launch.
    pub update_pending: bool,
}

#[derive(Serialize, Clone)]
struct FixDoneEvent {
    success: bool,
    code: Option<i32>,
    message: Option<String>,
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').trim_matches('\'').to_string()
}

/// (`ID`, combined `VERSION_ID (BUILD_ID)`) from /etc/os-release.
fn read_os_release() -> (Option<String>, Option<String>) {
    let Ok(content) = std::fs::read_to_string("/etc/os-release") else {
        return (None, None);
    };
    let mut id = None;
    let mut version_id = None;
    let mut build_id = None;
    for line in content.lines() {
        if let Some(v) = line.strip_prefix("ID=") {
            id = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("VERSION_ID=") {
            version_id = Some(unquote(v));
        } else if let Some(v) = line.strip_prefix("BUILD_ID=") {
            build_id = Some(unquote(v));
        }
    }
    let combined = match (version_id, build_id) {
        (Some(v), Some(b)) => Some(format!("{v} ({b})")),
        (Some(v), None) => Some(v),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };
    (id, combined)
}

fn write_baseline(version: Option<String>) -> Result<(), String> {
    let mut s = crate::app_settings::load();
    s.last_steamos_version = version;
    crate::app_settings::save(&s)
}

/// Current SteamOS update status. Side effect: on a SteamOS host with no
/// recorded baseline yet (fresh install / first launch after this feature
/// shipped), records the current version so future updates can be diffed.
#[tauri::command]
pub fn steamos_status() -> SteamOsStatus {
    let (id, current) = read_os_release();
    let is_steamos = id.as_deref() == Some("steamos");
    let last = crate::app_settings::load().last_steamos_version;

    let mut update_pending = false;
    if is_steamos {
        match (&current, &last) {
            (Some(cur), None) => {
                // First launch — set the baseline, nothing pending yet.
                let _ = write_baseline(Some(cur.clone()));
            }
            (Some(cur), Some(prev)) => {
                update_pending = cur != prev;
            }
            _ => {}
        }
    }

    SteamOsStatus {
        is_steamos,
        current_version: current,
        last_version: last,
        update_pending,
    }
}

/// True when running under gamescope (Steam Deck Gaming Mode). Mirrors
/// the detection in `lib.rs` setup(). pkexec has no PolicyKit agent in
/// Gaming Mode, so the SteamOS fix can only get a password prompt from
/// Desktop Mode — the UI uses this to gate the "Run the fix" button.
#[tauri::command]
pub fn is_gaming_mode() -> bool {
    std::env::var("GAMESCOPE_WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_CURRENT_DESKTOP")
            .map(|v| v.eq_ignore_ascii_case("gamescope"))
            .unwrap_or(false)
}

/// Record the current OS version as the acknowledged baseline. Clears the
/// "update pending" flag. Called after a successful fix run, or when the
/// user dismisses the prompt without running it.
#[tauri::command]
pub fn acknowledge_steamos_version() -> Result<(), String> {
    let (_, current) = read_os_release();
    write_baseline(current)
}

/// Resolve `fix-after-update-ui.sh`: `$DML_FIX_SCRIPT` override → Tauri
/// resource dir (bundled app) → walk up from the binary (in-repo dev).
fn resolve_fix_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("DML_FIX_SCRIPT") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("DML_FIX_SCRIPT set but missing: {}", p.display()));
    }
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("fix-after-update-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut cursor: Option<&Path> = exe.parent();
    while let Some(dir) = cursor {
        let candidate = dir.join("fix-after-update-ui.sh");
        if candidate.exists() {
            return Ok(candidate);
        }
        cursor = dir.parent();
    }
    Err(format!(
        "fix-after-update-ui.sh not found (checked resource dir + walked up from {})",
        exe.display()
    ))
}

fn pkexec_available() -> bool {
    std::process::Command::new("pkexec")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Run the SteamOS fix as root via pkexec, streaming output through the
/// `steamos_fix:*` event channel. The script is root-heavy (pacman,
/// keyring, systemctl), so the whole thing runs elevated — unlike the
/// install, which only elevates the small bootstrap. On success we
/// advance the acknowledged baseline so the "update pending" flag clears.
#[tauri::command]
pub async fn run_steamos_fix(app: AppHandle) -> Result<(), String> {
    if !pkexec_available() {
        return Err("Can't request permissions: pkexec (PolicyKit) isn't available. \
                    Run fix-after-update.sh once in a terminal instead."
            .into());
    }

    let script = resolve_fix_script(&app)?;
    // AppImage runs from a FUSE mount root can't read — stage the script
    // in a 0600 temp file the elevated process can read (mirrors
    // bootstrap.rs).
    let contents = std::fs::read(&script)
        .map_err(|e| format!("read fix script {}: {e}", script.display()))?;
    let tmp = std::env::temp_dir().join(format!("dml-fix-{}.sh", std::process::id()));
    std::fs::write(&tmp, &contents).map_err(|e| format!("stage fix script: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }

    // pkexec wipes the environment, so $HOME inside the script would be
    // /root, not the user's home. The script's compose-dir fallback scans
    // a home directory, so pass the real user's home as $1.
    let user_home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut cmd = Command::new("pkexec");
    cmd.arg("bash")
        .arg(&tmp)
        .arg(&user_home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch pkexec: {e}"))?;

    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    let h1 = tokio::spawn(crate::install::forward_lines(
        stdout,
        app.clone(),
        "stdout",
        EVT_FIX_OUTPUT,
        EVT_FIX_SECTION,
    ));
    let h2 = tokio::spawn(crate::install::forward_lines(
        stderr,
        app.clone(),
        "stderr",
        EVT_FIX_OUTPUT,
        EVT_FIX_SECTION,
    ));

    let app_done = app.clone();
    tokio::spawn(async move {
        let result = child.wait().await;
        let _ = h1.await;
        let _ = h2.await;
        let _ = std::fs::remove_file(&tmp);

        let (success, code) = match result {
            Ok(status) => (status.success(), status.code()),
            Err(_) => (false, None),
        };

        let message = if success {
            // Advance the baseline so the badge clears.
            let _ = acknowledge_steamos_version();
            None
        } else {
            match code {
                // pkexec: 126 = dismissed, 127 = no auth agent (Gaming Mode).
                Some(126) | Some(127) => Some(
                    "Couldn't get permission. Approve the system password prompt to continue. \
                     (Steam Deck Gaming Mode has no password dialog — switch to Desktop Mode to run the fix.)"
                        .to_string(),
                ),
                Some(c) => Some(format!("The fix exited with code {c}.")),
                None => Some("The fix was interrupted.".to_string()),
            }
        };

        let _ = app_done.emit(
            EVT_FIX_DONE,
            FixDoneEvent {
                success,
                code,
                message,
            },
        );
    });

    Ok(())
}
