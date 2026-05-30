//! Transactional local-data migrations.
//!
//! When a new binary ships with a changed local-data format (settings.json,
//! install.json, party presets, gearsets, caches) it needs to migrate the
//! user's existing data forward — once, idempotently, with a clean rollback
//! if anything fails. This is deliberately scoped to LOCAL FILES under
//! `~/.config/dads-mmo-lab/`. Server-side SQL schema changes are out of
//! scope here (the data that changes between Lab versions lives in local
//! files); if a future multi-server-version feature needs DB migrations,
//! those get their own lazy on-Start-Server path.
//!
//! Model (matches the "embed in binary, gate on a flag" approach):
//!   - `AppSettings.last_applied_migration` is the high-water mark.
//!   - `MIGRATIONS` is an ordered registry; each runs once when its id is
//!     above the stored mark.
//!   - On launch the frontend asks `migrations_status`; if anything is
//!     pending it shows the full-screen Updating view and calls
//!     `run_migrations`, which snapshots the config dir, runs every pending
//!     migration in order, and on ANY failure restores the snapshot and
//!     surfaces a copyable log + a Restore-previous-version path.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::app_settings;

/// A single migration. `up` operates on local files only and must be
/// idempotent-safe to re-run on a restored snapshot (the runner guarantees
/// it only ever runs against a snapshot-backed state, but defensive
/// migrations age better).
struct Migration {
    id: u32,
    name: &'static str,
    up: fn(&MigrationCtx) -> Result<(), String>,
}

/// What a migration gets to work with. Just the config dir today; extend
/// as real migrations need more (e.g. install paths).
pub struct MigrationCtx {
    /// Unused until the first real migration needs it; the baseline ignores
    /// ctx entirely.
    #[allow(dead_code)]
    pub config_dir: PathBuf,
}

/// Ordered migration registry. Append new migrations with the next id;
/// never renumber or remove a shipped one (the stored high-water mark
/// refers to these ids). id 1 is the no-op baseline that establishes the
/// floor for users who predate this system.
const MIGRATIONS: &[Migration] = &[Migration {
    id: 1,
    name: "baseline",
    up: |_ctx| Ok(()),
}];

/// Directory name (inside the config dir) holding the pre-migration
/// snapshot. Excluded from the snapshot copy and from restore.
const SNAPSHOT_DIR: &str = ".dml-migration-snapshot";
/// Marker written on a failed run; holds the full step log so the UI can
/// show / copy / download it. Cleared on a successful run.
const FAILED_MARKER: &str = ".dml-migration-failed";

fn current_target() -> u32 {
    MIGRATIONS.iter().map(|m| m.id).max().unwrap_or(0)
}

fn config_dir() -> Result<PathBuf, String> {
    app_settings::settings_path()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "could not resolve config directory".to_string())
}

// ── status ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    /// Real migration work is waiting — the UI should show the Updating view.
    pub pending: bool,
    /// A prior run failed and left the binary in place; the UI should show
    /// the failure + Restore affordance.
    pub failed: bool,
    pub last: u32,
    pub target: u32,
    /// Full step log from the failed run, if any.
    pub failure_log: Option<String>,
    /// A `.bak` of the previous AppImage exists, so Restore is possible.
    pub can_restore: bool,
}

/// Called by the frontend on launch to decide whether to show the Updating
/// view. Side effect: a genuine first launch (no settings file yet) is
/// baselined straight to the current target so the Updating view never
/// shows for a brand-new user.
#[tauri::command]
pub fn migrations_status() -> MigrationStatus {
    let target = current_target();

    // Fresh install — nothing to migrate. Baseline to target silently.
    if !app_settings::exists() {
        let mut s = app_settings::load();
        s.last_applied_migration = target;
        let _ = app_settings::save(&s);
        return MigrationStatus {
            pending: false,
            failed: false,
            last: target,
            target,
            failure_log: None,
            can_restore: false,
        };
    }

    let last = app_settings::load().last_applied_migration;
    let dir = config_dir().ok();
    let failure_log = dir
        .as_ref()
        .and_then(|d| std::fs::read_to_string(d.join(FAILED_MARKER)).ok());

    MigrationStatus {
        pending: last < target,
        failed: failure_log.is_some(),
        last,
        target,
        failure_log,
        can_restore: backup_path().map(|p| p.exists()).unwrap_or(false),
    }
}

// ── run ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StepEvent {
    id: u32,
    name: String,
    /// "running" | "ok" | "failed"
    status: &'static str,
    detail: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub success: bool,
    pub log: String,
}

const EVT_MIGRATION_STEP: &str = "migration:step";

/// Run every pending migration in order, snapshotting first and rolling
/// back the snapshot on any failure. Emits `migration:step` events for live
/// progress; returns the final result (success + full log). Never bumps the
/// high-water mark unless ALL pending migrations succeed.
#[tauri::command]
pub async fn run_migrations(app: AppHandle) -> Result<RunResult, String> {
    let target = current_target();
    let dir = config_dir()?;
    let last = app_settings::load().last_applied_migration;
    let pending: Vec<&Migration> = MIGRATIONS.iter().filter(|m| m.id > last).collect();

    let mut log = String::new();
    macro_rules! logln {
        ($($arg:tt)*) => {{
            let line = format!($($arg)*);
            log.push_str(&line);
            log.push('\n');
        }};
    }

    if pending.is_empty() {
        return Ok(RunResult { success: true, log });
    }

    logln!("Updating local data ({} step(s))…", pending.len());

    // Snapshot the config dir so a failure rolls back cleanly. If we can't
    // snapshot, we must NOT run — there'd be no safe rollback.
    if let Err(e) = take_snapshot(&dir) {
        logln!("Could not back up your data before updating: {e}");
        write_failure(&dir, &log);
        return Ok(RunResult { success: false, log });
    }
    logln!("Backed up local data.");

    let ctx = MigrationCtx {
        config_dir: dir.clone(),
    };

    for m in &pending {
        let _ = app.emit(
            EVT_MIGRATION_STEP,
            StepEvent {
                id: m.id,
                name: m.name.to_string(),
                status: "running",
                detail: None,
            },
        );
        logln!("→ #{} {} …", m.id, m.name);

        match (m.up)(&ctx) {
            Ok(()) => {
                let _ = app.emit(
                    EVT_MIGRATION_STEP,
                    StepEvent {
                        id: m.id,
                        name: m.name.to_string(),
                        status: "ok",
                        detail: None,
                    },
                );
                logln!("  ✓ done");
            }
            Err(e) => {
                logln!("  ✗ failed: {e}");
                logln!("Rolling back your data to the previous state…");
                // Restore the snapshot. If even THAT fails, say so loudly —
                // the failure marker + Restore-previous-version are the
                // user's remaining safety nets.
                if let Err(re) = restore_snapshot(&dir) {
                    logln!("Rollback also failed: {re}");
                } else {
                    logln!("Your data was restored to before the update.");
                }
                let _ = app.emit(
                    EVT_MIGRATION_STEP,
                    StepEvent {
                        id: m.id,
                        name: m.name.to_string(),
                        status: "failed",
                        detail: Some(e),
                    },
                );
                write_failure(&dir, &log);
                return Ok(RunResult { success: false, log });
            }
        }
    }

    // All good — advance the high-water mark and clear any stale failure.
    let mut s = app_settings::load();
    s.last_applied_migration = target;
    if let Err(e) = app_settings::save(&s) {
        logln!("Migrations ran but recording the new version failed: {e}");
        write_failure(&dir, &log);
        return Ok(RunResult { success: false, log });
    }
    let _ = std::fs::remove_file(dir.join(FAILED_MARKER));
    logln!("Update complete.");
    Ok(RunResult { success: true, log })
}

fn write_failure(dir: &Path, log: &str) {
    let _ = std::fs::write(dir.join(FAILED_MARKER), log);
}

// ── snapshot / restore (config dir) ──────────────────────────────────

/// The user data worth protecting before a migration. Everything else in
/// the config dir is a regenerable cache (item-icons / tooltip-data /
/// talent-data, ~10MB) that a migration can simply rebuild — no point
/// copying it on every update. Add an entry here if a future kind of
/// precious local data lands in the config dir.
const SNAPSHOT_INCLUDE: &[&str] = &["settings.json", "party-presets", "gear-sets"];

fn take_snapshot(dir: &Path) -> Result<(), String> {
    let snap = dir.join(SNAPSHOT_DIR);
    if snap.exists() {
        std::fs::remove_dir_all(&snap).map_err(|e| format!("clear old snapshot: {e}"))?;
    }
    std::fs::create_dir_all(&snap).map_err(|e| format!("create snapshot dir: {e}"))?;
    for name in SNAPSHOT_INCLUDE {
        let src = dir.join(name);
        if !src.exists() {
            continue;
        }
        let dst = snap.join(name);
        if src.is_dir() {
            copy_dir_contents(&src, &dst, &[])?;
        } else {
            std::fs::copy(&src, &dst).map_err(|e| format!("snapshot {name}: {e}"))?;
        }
    }
    Ok(())
}

fn restore_snapshot(dir: &Path) -> Result<(), String> {
    let snap = dir.join(SNAPSHOT_DIR);
    if !snap.exists() {
        return Err("no snapshot to restore from".to_string());
    }
    // Restore each protected item to exactly its snapshot state, leaving the
    // regenerable caches (which we never snapshot) untouched.
    for name in SNAPSHOT_INCLUDE {
        let snapped = snap.join(name);
        if !snapped.exists() {
            continue;
        }
        let live = dir.join(name);
        if live.is_dir() {
            let _ = std::fs::remove_dir_all(&live);
        } else if live.exists() {
            let _ = std::fs::remove_file(&live);
        }
        if snapped.is_dir() {
            copy_dir_contents(&snapped, &live, &[])?;
        } else {
            std::fs::copy(&snapped, &live).map_err(|e| format!("restore {name}: {e}"))?;
        }
    }
    Ok(())
}

/// Recursively copy the CONTENTS of `src` into `dst`, skipping any top-level
/// entry whose file name is in `exclude`.
fn copy_dir_contents(src: &Path, dst: &Path, exclude: &[&str]) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if exclude.iter().any(|x| name == **x) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_dir_contents(&from, &to, &[])?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

// ── binary backup / restore (.bak AppImage) ──────────────────────────

/// Path to the running AppImage. Set by the AppImage runtime in `$APPIMAGE`.
/// Absent outside an AppImage (dev / other packaging) — binary backup and
/// restore are no-ops there.
fn appimage_path() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE").map(PathBuf::from)
}

fn backup_path() -> Option<PathBuf> {
    appimage_path().map(|p| {
        let mut s = p.into_os_string();
        s.push(".bak");
        PathBuf::from(s)
    })
}

/// Copy the running AppImage to `<appimage>.bak`. The updater calls this
/// right before downloading a new version, so the new binary always has the
/// previous one to roll back to if its migrations fail. No-op (Ok) outside
/// an AppImage.
#[tauri::command]
pub fn backup_current_binary() -> Result<bool, String> {
    let (Some(src), Some(bak)) = (appimage_path(), backup_path()) else {
        return Ok(false);
    };
    std::fs::copy(&src, &bak).map_err(|e| format!("back up AppImage: {e}"))?;
    Ok(true)
}

/// Restore the previous AppImage from `<appimage>.bak` and relaunch it. Used
/// by the Updating view's "Restore previous version" button after a failed
/// migration. Writes via a temp+rename so we never truncate the AppImage
/// file that's currently mounted and running.
#[tauri::command]
pub fn restore_previous_version(app: AppHandle) -> Result<(), String> {
    let (Some(live), Some(bak)) = (appimage_path(), backup_path()) else {
        return Err("Restore isn't available for this build (not an AppImage).".to_string());
    };
    if !bak.exists() {
        return Err("No previous version is saved to restore.".to_string());
    }

    // temp in the same dir → atomic rename over the running file's path.
    let tmp = {
        let mut s = live.clone().into_os_string();
        s.push(".restore-tmp");
        PathBuf::from(s)
    };
    std::fs::copy(&bak, &tmp).map_err(|e| format!("stage restore: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    std::fs::rename(&tmp, &live).map_err(|e| format!("swap in previous version: {e}"))?;

    // Clear the failure marker so the restored (older) binary launches clean.
    if let Ok(dir) = config_dir() {
        let _ = std::fs::remove_file(dir.join(FAILED_MARKER));
    }

    // Launch the restored AppImage fresh, then exit this process.
    std::process::Command::new(&live)
        .spawn()
        .map_err(|e| format!("relaunch previous version: {e}"))?;
    app.exit(0);
    Ok(())
}
