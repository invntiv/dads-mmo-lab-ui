//! Player gear sets — save / list / delete / import / export named gear
//! loadouts for the user's own character.
//!
//! Same idea as party presets, scaled to a single character's equipment:
//! a named set of items keyed by slot, stored as a shareable TOML file in
//! `~/.config/dads-mmo-lab/gear-sets/`. The ID is the source of truth;
//! `name` is advisory (human-readable).
//!
//! ```toml
//! schema_version = 1
//! name = "Prot Warrior — Pre-raid BiS"
//! class = "warrior"
//! note = "swap trinket2 for the AoE one on trash"
//!
//! [gear.head]
//! id = 12640
//! name = "Crown of Destruction"
//! ```
//!
//! v1 is reference-only — there's no GM command to force-equip the
//! player's own character, so the app stores/displays/shares sets and the
//! player equips in-game. (A future "mail me this set" action could use
//! `inventory::send_item_to_character`.)

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const CURRENT_SCHEMA_VERSION: u32 = 1;

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GearPiece {
    pub id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GearSet {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub name: String,
    /// Advisory class keyword the set is built for (warrior, mage, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// slot → { id, name }. BTreeMap so the on-disk TOML has a stable
    /// (alphabetical) slot order.
    #[serde(default)]
    pub gear: BTreeMap<String, GearPiece>,
}

#[derive(Serialize, Clone, Debug)]
pub struct GearSetEntry {
    pub id: String,
    pub raw_toml: String,
    pub set: GearSet,
}

fn gearsets_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "Could not resolve the user config directory".to_string())?;
    let dir = base.join("dads-mmo-lab").join("gear-sets");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create gear-sets directory: {e}"))?;
    Ok(dir)
}

fn unique_id(dir: &PathBuf, slug: &str) -> String {
    if !dir.join(format!("{slug}.toml")).exists() {
        return slug.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{slug}-{n}");
        if !dir.join(format!("{candidate}.toml")).exists() {
            return candidate;
        }
        n += 1;
    }
}

fn write_set(dir: &PathBuf, id: &str, set: &GearSet) -> Result<GearSetEntry, String> {
    let raw = toml::to_string_pretty(set)
        .map_err(|e| format!("Could not serialise gear set to TOML: {e}"))?;
    fs::write(dir.join(format!("{id}.toml")), &raw)
        .map_err(|e| format!("Could not write gear set: {e}"))?;
    Ok(GearSetEntry {
        id: id.to_string(),
        raw_toml: raw,
        set: set.clone(),
    })
}

#[tauri::command]
pub fn save_gear_set(set: GearSet) -> Result<GearSetEntry, String> {
    if set.name.trim().is_empty() {
        return Err("Give the gear set a name.".to_string());
    }
    let dir = gearsets_dir()?;
    let id = unique_id(&dir, &crate::presets::slugify(&set.name));
    write_set(&dir, &id, &set)
}

#[tauri::command]
pub fn list_gear_sets() -> Result<Vec<GearSetEntry>, String> {
    let dir = gearsets_dir()?;
    let mut entries = Vec::new();
    for dirent in fs::read_dir(&dir).map_err(|e| format!("Could not read gear-sets dir: {e}"))? {
        let Ok(dirent) = dirent else { continue };
        let path = dirent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        match toml::from_str::<GearSet>(&raw) {
            Ok(set) => entries.push(GearSetEntry {
                id: stem.to_string(),
                raw_toml: raw,
                set,
            }),
            Err(e) => log::warn!("Skipping unparseable gear set {stem}.toml: {e}"),
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub fn delete_gear_set(id: String) -> Result<(), String> {
    if !crate::presets::id_is_safe(&id) {
        return Err("Invalid gear set id".to_string());
    }
    let path = gearsets_dir()?.join(format!("{id}.toml"));
    if !path.exists() {
        return Err(format!("Gear set '{id}' not found"));
    }
    fs::remove_file(&path).map_err(|e| format!("Could not delete gear set: {e}"))
}

#[tauri::command]
pub fn export_gear_set_toml(id: String) -> Result<String, String> {
    if !crate::presets::id_is_safe(&id) {
        return Err("Invalid gear set id".to_string());
    }
    fs::read_to_string(gearsets_dir()?.join(format!("{id}.toml")))
        .map_err(|e| format!("Could not read gear set: {e}"))
}

#[tauri::command]
pub fn import_gear_set_toml(toml_text: String) -> Result<GearSetEntry, String> {
    let mut set: GearSet = toml::from_str(&toml_text)
        .map_err(|e| format!("That doesn't look like a valid gear set:\n{e}"))?;
    if set.name.trim().is_empty() {
        set.name = "Imported gear set".to_string();
    }
    let dir = gearsets_dir()?;
    let id = unique_id(&dir, &crate::presets::slugify(&set.name));
    write_set(&dir, &id, &set)
}
