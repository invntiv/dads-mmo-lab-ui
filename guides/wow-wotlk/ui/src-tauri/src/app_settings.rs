//! App-level (not install-specific) settings persisted as JSON.
//!
//! Lives at `~/.config/dads-mmo-lab/settings.json` on Linux, following
//! the XDG Base Directory spec. The directory and file are created on
//! first save; loads against a missing file return defaults without
//! erroring — that's the "fresh user, no settings yet" path.
//!
//! Kept deliberately small + flat. Anything install-specific belongs
//! in `<install>/.dads-mmo-lab/install.json` instead.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct AppSettings {
    /// Path to the user's WoW 3.3.5a client install. Set via the
    /// WoW-client picker on the dashboard. Used by wow_client for
    /// realmlist management and (later) addon installation.
    pub wow_client_dir: Option<String>,
}

fn settings_path() -> Option<PathBuf> {
    // dirs::config_dir() returns ~/.config on Linux per XDG.
    dirs::config_dir().map(|p| p.join("dads-mmo-lab").join("settings.json"))
}

/// Read settings from disk. Returns defaults if the file is missing
/// or unreadable — callers don't need to distinguish "first run" from
/// "I/O error" for this surface.
pub fn load() -> AppSettings {
    let Some(path) = settings_path() else {
        return AppSettings::default();
    };
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

/// Atomically replace settings.json with the new contents. Creates
/// the parent directory if it doesn't exist yet.
pub fn save(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()
        .ok_or_else(|| "Could not resolve config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("serialize settings: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}
