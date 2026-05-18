//! WoW 3.3.5a client integration.
//!
//! Manages the user's WoW client install directory (where their game
//! lives, separate from our server install). The directory choice
//! persists in `~/.config/dads-mmo-lab/settings.json` via app_settings.
//!
//! Current scope:
//! - Validate a candidate path is actually a WoW 3.3.5a install
//! - Locate + read `realmlist.wtf` (auto-detect the locale subdir)
//! - Detect tampering: report whether the realmlist points at 127.0.0.1
//! - Rewrite realmlist to the local-server value
//!
//! Future scope (same module): install addons like ConsolePortLK into
//! `Interface/AddOns/`, manage the WTF config dir, etc. — all reasons
//! we save the path once and reuse it.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::app_settings;

/// Locales WoW 3.3.5a clients ship with. Used to find the
/// `realmlist.wtf` under `Data/<locale>/`. Order matters only for
/// auto-detection: if a client somehow has multiple locale dirs we
/// pick the first match.
const KNOWN_LOCALES: &[&str] = &[
    "enUS", "enGB", "deDE", "esES", "esMX", "frFR", "itIT", "koKR",
    "ptBR", "ruRU", "zhCN", "zhTW",
];

/// The realmlist value we want the user's client to use. Server runs
/// on the same machine the UI is running on (Steam Deck couch case).
const EXPECTED_REALMLIST: &str = "set realmlist 127.0.0.1";

#[derive(Serialize, Clone, Debug)]
pub struct WowClientState {
    /// User-selected WoW directory, or null if not yet picked.
    pub directory: Option<String>,
    /// Auto-detected locale subdir inside Data/ (e.g. "enUS").
    pub locale: Option<String>,
    /// Path to realmlist.wtf, or null if dir/locale unknown.
    pub realmlist_path: Option<String>,
    /// Verbatim contents of realmlist.wtf (or null on read error).
    pub realmlist_contents: Option<String>,
    /// True iff realmlist contents include `set realmlist 127.0.0.1`
    /// as an effective line. Tolerant of trailing comments/whitespace
    /// and case in the keyword `set realmlist`.
    pub realmlist_correct: bool,
}

/// Check that a candidate path looks like a WoW 3.3.5a install.
/// Heuristic: at least one of the known locale subdirs under Data/
/// must exist AND contain a realmlist.wtf file. If yes, return the
/// locale; if no, return an error string the UI can show inline.
fn detect_locale(wow_dir: &Path) -> Result<String, String> {
    if !wow_dir.is_dir() {
        return Err(format!(
            "Path is not a directory: {}",
            wow_dir.display()
        ));
    }
    let data_dir = wow_dir.join("Data");
    if !data_dir.is_dir() {
        return Err(format!(
            "Not a WoW client — no Data/ directory at {}",
            wow_dir.display()
        ));
    }
    for locale in KNOWN_LOCALES {
        let realmlist = data_dir.join(locale).join("realmlist.wtf");
        if realmlist.is_file() {
            return Ok((*locale).to_string());
        }
    }
    Err(format!(
        "Not a WoW 3.3.5a client — no realmlist.wtf found under \
         {}/Data/<locale>/ (looked for: {})",
        wow_dir.display(),
        KNOWN_LOCALES.join(", ")
    ))
}

/// Parse the realmlist.wtf contents and decide whether the active
/// `set realmlist <host>` line points at our local server. The file
/// can contain multiple settings (e.g. patchlist, portal); we only
/// care about realmlist. Lines starting with `#` or `//` are ignored.
/// First non-comment `set realmlist` line wins.
fn realmlist_is_correct(contents: &str) -> bool {
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        // Case-insensitive keyword match; the realmlist host itself is
        // case-sensitive in WoW's parser (IPs are obviously, hostnames
        // are sometimes mixed-case — but for "127.0.0.1" case is moot).
        let lower = line.to_lowercase();
        if let Some(rest) = lower.strip_prefix("set realmlist") {
            let host = rest.trim();
            return host == "127.0.0.1" || host.starts_with("127.0.0.1 ");
        }
    }
    false
}

/// Read the saved WoW dir + everything derivable from it. Always
/// returns Ok with `directory=None` if no dir is configured — the UI
/// uses that as the "not set up yet" signal.
#[tauri::command]
pub fn get_wow_client_state() -> Result<WowClientState, String> {
    let settings = app_settings::load();
    let Some(dir) = settings.wow_client_dir else {
        return Ok(WowClientState {
            directory: None,
            locale: None,
            realmlist_path: None,
            realmlist_contents: None,
            realmlist_correct: false,
        });
    };
    let dir_path = PathBuf::from(&dir);
    let locale = detect_locale(&dir_path).ok();
    let realmlist_path = locale
        .as_ref()
        .map(|l| dir_path.join("Data").join(l).join("realmlist.wtf"));
    let realmlist_contents = realmlist_path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok());
    let realmlist_correct = realmlist_contents
        .as_deref()
        .map(realmlist_is_correct)
        .unwrap_or(false);
    Ok(WowClientState {
        directory: Some(dir),
        locale,
        realmlist_path: realmlist_path.map(|p| p.to_string_lossy().into_owned()),
        realmlist_contents,
        realmlist_correct,
    })
}

/// Validate the directory the user picked and save it to settings.
/// Returns the same state shape as `get_wow_client_state` so the
/// caller doesn't need a second roundtrip to refresh the UI.
#[tauri::command]
pub fn set_wow_directory(path: String) -> Result<WowClientState, String> {
    let dir_path = PathBuf::from(&path);
    // Validation happens upfront; if it fails we don't save anything
    // so the UI surfaces the inline error and the user can retry.
    detect_locale(&dir_path)?;
    let mut settings = app_settings::load();
    settings.wow_client_dir = Some(path);
    app_settings::save(&settings)?;
    get_wow_client_state()
}

#[tauri::command]
pub fn clear_wow_directory() -> Result<WowClientState, String> {
    let mut settings = app_settings::load();
    settings.wow_client_dir = None;
    app_settings::save(&settings)?;
    get_wow_client_state()
}

/// Overwrite realmlist.wtf with our expected value
/// (`set realmlist 127.0.0.1`). Returns the refreshed state, which
/// the UI uses to confirm the rewrite stuck.
#[tauri::command]
pub fn fix_realmlist() -> Result<WowClientState, String> {
    let state = get_wow_client_state()?;
    let Some(path_str) = state.realmlist_path.clone() else {
        return Err("No WoW client directory configured.".into());
    };
    let path = PathBuf::from(&path_str);
    std::fs::write(&path, format!("{}\n", EXPECTED_REALMLIST))
        .map_err(|e| format!("Couldn't write {}: {}", path.display(), e))?;
    get_wow_client_state()
}
