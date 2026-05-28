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
    /// Notice IDs the user has clicked-to-dismiss. We persist these
    /// so a dismissal sticks across restarts — e.g. the "enrich your
    /// items in Settings" well on the Inventory page. List rather than
    /// set so the JSON shape stays diff-friendly; lookups are O(n)
    /// against a tiny list which is fine.
    pub dismissed_notices: Vec<String>,
    /// Inventory page: include items whose names contain "DEPRECATED"
    /// (Blizzard's marker for items that are no longer obtainable,
    /// usually the old version of an item that got reworked). Off by
    /// default since most searches want the live/current item only.
    pub inventory_show_deprecated: bool,
    /// GUID of the user's active "main" character, surfaced via the
    /// sidebar's GlobalCharacterCard and consumed by any page that
    /// acts on "the player's character" (Inventory send, Teleport,
    /// etc.). Stored as the i64 GUID rather than the row index so a
    /// chardb wipe doesn't silently rebind to whatever new char took
    /// that slot. None when nothing's selected. Frontend silently
    /// clears the selection if the GUID no longer exists.
    pub selected_character_guid: Option<u64>,
    /// GUIDs the user added to the sidebar character switcher — a curated
    /// subset of their characters they quick-switch between (different
    /// classes/roles). Distinct from the chardb: removing one here only
    /// drops it from the switcher, it never deletes the character.
    /// `selected_character_guid` is the active one among these.
    pub switcher_character_guids: Vec<u64>,
    /// When ON, the worldserver auto-stops when the user's WoW client
    /// process (`Wow.exe`, launched via Steam/Proton) exits. The
    /// background watcher only triggers AFTER it has seen the client
    /// running at least once — so toggling this on with no client open
    /// doesn't immediately kill the server.
    pub auto_shutdown_on_client_exit: bool,
    /// Warcraft-themed cursor inside The Lab's window. One of:
    /// `"default"` (system cursor), `"human"`, `"elf"`, `"undead"`,
    /// `"orc"`. None = treat as the default ("human") — that's our
    /// chosen first-run default. Scoped to the Tauri webview, so it
    /// never bleeds into other applications.
    pub cursor_faction: Option<String>,
    /// SOAP credentials captured from the install wizard. Used by
    /// `soap::execute_command` to authenticate every GM command the
    /// app sends. We persist these (rather than re-prompting each
    /// session) because the audience expects "just works" — but the
    /// file is chmod'd 0600 on every save, and both fields get
    /// cleared on uninstall along with selected character / switcher.
    /// None = fall back to admin/admin (matches install-wow-ui.sh's
    /// default when DML_ADMIN_USER / DML_ADMIN_PASS weren't set).
    pub admin_user: Option<String>,
    pub admin_pass: Option<String>,
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
/// the parent directory if it doesn't exist yet. File mode is forced
/// to 0600 (owner read/write only) after each write — admin_pass
/// lives here, and 644 default mode would expose it to any other
/// user on the box.
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
    // Tighten perms. Best-effort: a chmod failure (rare — same FS we
    // just wrote to) shouldn't surface as a settings-save error.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ =
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ── Dismissable-notice plumbing ─────────────────────────────────────
// Notices are small dismiss-once UI prompts (e.g. "Enrich items in
// Settings"). We use opaque string IDs rather than enums so frontend
// can add new notices without round-tripping a Rust change. Frontend
// owns the canonical ID strings.

#[tauri::command]
pub fn is_notice_dismissed(notice_id: String) -> bool {
    load().dismissed_notices.iter().any(|n| n == &notice_id)
}

#[tauri::command]
pub fn dismiss_notice(notice_id: String) -> Result<(), String> {
    let mut s = load();
    if !s.dismissed_notices.iter().any(|n| n == &notice_id) {
        s.dismissed_notices.push(notice_id);
        save(&s)?;
    }
    Ok(())
}

#[tauri::command]
pub fn undismiss_notice(notice_id: String) -> Result<(), String> {
    let mut s = load();
    let before = s.dismissed_notices.len();
    s.dismissed_notices.retain(|n| n != &notice_id);
    if s.dismissed_notices.len() != before {
        save(&s)?;
    }
    Ok(())
}

// ── Inventory preferences ───────────────────────────────────────────
// Persisted alongside the rest of AppSettings rather than in a separate
// per-page preferences file — Inventory only has the one toggle today;
// when there are several we can group into a struct.

#[tauri::command]
pub fn get_inventory_show_deprecated() -> bool {
    load().inventory_show_deprecated
}

#[tauri::command]
pub fn set_inventory_show_deprecated(value: bool) -> Result<(), String> {
    let mut s = load();
    if s.inventory_show_deprecated == value {
        return Ok(());
    }
    s.inventory_show_deprecated = value;
    save(&s)
}

// ── Selected (main) character ───────────────────────────────────────

#[tauri::command]
pub fn get_selected_character_guid() -> Option<u64> {
    load().selected_character_guid
}

#[tauri::command]
pub fn set_selected_character_guid(guid: Option<u64>) -> Result<(), String> {
    let mut s = load();
    if s.selected_character_guid == guid {
        return Ok(());
    }
    s.selected_character_guid = guid;
    save(&s)
}

// ── Character switcher list ─────────────────────────────────────────

#[tauri::command]
pub fn get_switcher_character_guids() -> Vec<u64> {
    load().switcher_character_guids
}

#[tauri::command]
pub fn set_switcher_character_guids(guids: Vec<u64>) -> Result<(), String> {
    let mut s = load();
    s.switcher_character_guids = guids;
    save(&s)
}

// ── Auto-shutdown on WoW client exit ────────────────────────────────

#[tauri::command]
pub fn get_auto_shutdown_on_client_exit() -> bool {
    load().auto_shutdown_on_client_exit
}

#[tauri::command]
pub fn set_auto_shutdown_on_client_exit(value: bool) -> Result<(), String> {
    let mut s = load();
    if s.auto_shutdown_on_client_exit == value {
        return Ok(());
    }
    s.auto_shutdown_on_client_exit = value;
    save(&s)
}

// ── Cursor faction (warcraftcn cursor variant) ──────────────────────

/// Default cursor faction on first run. Surfaced via the Settings
/// dropdown as the first option after "Default" (system cursor).
const DEFAULT_CURSOR_FACTION: &str = "human";

#[tauri::command]
pub fn get_cursor_faction() -> String {
    load()
        .cursor_faction
        .unwrap_or_else(|| DEFAULT_CURSOR_FACTION.to_string())
}

#[tauri::command]
pub fn set_cursor_faction(value: String) -> Result<(), String> {
    // Defensive: reject anything not in the known set so the UI can't
    // poke arbitrary class-name fragments into the webview's root.
    if !matches!(
        value.as_str(),
        "default" | "human" | "elf" | "undead" | "orc"
    ) {
        return Err(format!("unknown cursor faction: {value}"));
    }
    let mut s = load();
    if s.cursor_faction.as_deref() == Some(&value) {
        return Ok(());
    }
    s.cursor_faction = Some(value);
    save(&s)
}
