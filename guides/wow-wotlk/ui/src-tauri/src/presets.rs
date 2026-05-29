//! Party presets — save / list / delete / import / export complete bot
//! party compositions as TOML.
//!
//! A preset captures a 4-bot party (the user is the implicit 5th slot)
//! so it can be torn down and re-summoned with one click, or shared as
//! a TOML block in Discord. The schema mirrors `preset_system_handoff.md`
//! so a paste from another user parses here:
//!
//! ```toml
//! schema_version = 1
//!
//! [preset_info]
//! name = "Early BRD"
//! author = "Me"
//! target = { type = "dungeon", name = "BRD" }
//!
//! [party.player]
//! role = "dps"
//!
//! [[party.bots]]
//! role = "tank"
//! class = "warrior"
//! level = 54
//! talents = "3022032023335100002012211231241"
//! ```
//!
//! `talents` is the digit-dash string that mod-playerbots' `talents
//! apply <link>` consumes (one rank digit per talent in Row/Col order,
//! tabs separated by `-`). It is exactly the talent segment of a
//! Wowhead WotLK talent-calc URL, so on import we accept raw URLs and
//! markdown links too and normalise down to the bare string.
//!
//! Gear today: the spawn pipeline (`playerbots::add_bot_to_party`) runs
//! mod-playerbots `autogear`, which re-kits a bot with level/spec
//! appropriate gear. Equipping *specific* items needs an item-grant
//! step that isn't built yet (the `outfit` command only equips items
//! the bot already owns), so any explicit `[party.bots.gear]` an
//! imported preset carries is preserved verbatim for human review and
//! forward-compat but is NOT applied in v1.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const CURRENT_SCHEMA_VERSION: u32 = 1;

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

/// `target = { type = "dungeon", name = "BRD" }`. `type` is a Rust
/// keyword, so it maps to `kind`; `name` is the content name and is
/// absent for type-only targets (leveling / pvp).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Target {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PresetInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// ISO timestamp. Set by the frontend on save; advisory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub target: Target,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PlayerSlot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BotSpec {
    /// tank | healer | dps
    pub role: String,
    /// mod-playerbots addclass keyword: warrior, paladin, hunter, rogue,
    /// priest, dk, shaman, mage, warlock, druid.
    pub class: String,
    pub level: u32,
    /// Digit-dash talent string. None → spawn with mod autopick.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub talents: Option<String>,
    /// Advisory display name for the spec (e.g. "Protection").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
    /// Optional fixed bot name (advisory — the pool picks the name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Author's intended gear. Preserved for review/forward-compat;
    /// NOT applied in v1 (autogear handles gear). Kept as an opaque
    /// TOML value so any slot shape round-trips.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gear: Option<toml::Value>,
    /// Author's intended glyphs. Preserved, not applied in v1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glyphs: Option<toml::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Party {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub player: Option<PlayerSlot>,
    #[serde(default)]
    pub bots: Vec<BotSpec>,
}

/// The on-disk TOML shape. `id` is never part of the file — it's the
/// filename stem, injected when listing (see `PresetEntry`).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PartyPreset {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub preset_info: PresetInfo,
    pub party: Party,
}

/// A listed preset: the parsed body plus its file id and the raw TOML
/// (so the UI can offer copy/export without a second round-trip).
#[derive(Serialize, Clone, Debug)]
pub struct PresetEntry {
    pub id: String,
    pub raw_toml: String,
    pub preset: PartyPreset,
}

/// Result of an import — the saved entry plus any non-fatal warnings
/// (unknown role defaulted, talents unparseable and dropped, etc.) so
/// the UI can tell the user what we adjusted.
#[derive(Serialize, Clone, Debug)]
pub struct ImportResult {
    pub entry: PresetEntry,
    pub warnings: Vec<String>,
}

// ── storage ──────────────────────────────────────────────────────────

fn presets_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "Could not resolve the user config directory".to_string())?;
    let dir = base.join("dads-mmo-lab").join("party-presets");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create presets directory: {e}"))?;
    Ok(dir)
}

/// Lowercase, collapse non-alphanumerics to single dashes, trim. Empty
/// input falls back to "preset".
pub(crate) fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "preset".to_string()
    } else {
        trimmed
    }
}

/// Pick a free `<slug>.toml` (or `<slug>-2.toml`, …) so two presets with
/// the same name don't clobber each other.
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

/// Guard against path traversal in ids coming from the frontend.
pub(crate) fn id_is_safe(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn write_preset(dir: &PathBuf, id: &str, preset: &PartyPreset) -> Result<PresetEntry, String> {
    let raw = toml::to_string_pretty(preset)
        .map_err(|e| format!("Could not serialise preset to TOML: {e}"))?;
    let path = dir.join(format!("{id}.toml"));
    fs::write(&path, &raw).map_err(|e| format!("Could not write preset file: {e}"))?;
    Ok(PresetEntry {
        id: id.to_string(),
        raw_toml: raw,
        preset: preset.clone(),
    })
}

// ── commands ─────────────────────────────────────────────────────────

/// Persist a preset built by the frontend (from the live party). Returns
/// the saved entry, including its generated id.
#[tauri::command]
pub fn save_party_preset(preset: PartyPreset) -> Result<PresetEntry, String> {
    let dir = presets_dir()?;
    let slug = slugify(&preset.preset_info.name);
    let id = unique_id(&dir, &slug);
    write_preset(&dir, &id, &preset)
}

/// Every saved preset, newest-name-first is not meaningful so we sort by
/// id for stable ordering. Unparseable files are skipped (a malformed
/// hand-edited file shouldn't break the whole list).
#[tauri::command]
pub fn list_party_presets() -> Result<Vec<PresetEntry>, String> {
    let dir = presets_dir()?;
    let mut entries = Vec::new();
    for dirent in fs::read_dir(&dir).map_err(|e| format!("Could not read presets dir: {e}"))? {
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
        match toml::from_str::<PartyPreset>(&raw) {
            Ok(preset) => entries.push(PresetEntry {
                id: stem.to_string(),
                raw_toml: raw,
                preset,
            }),
            Err(e) => log::warn!("Skipping unparseable preset {stem}.toml: {e}"),
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub fn delete_party_preset(id: String) -> Result<(), String> {
    if !id_is_safe(&id) {
        return Err("Invalid preset id".to_string());
    }
    let dir = presets_dir()?;
    let path = dir.join(format!("{id}.toml"));
    if !path.exists() {
        return Err(format!("Preset '{id}' not found"));
    }
    fs::remove_file(&path).map_err(|e| format!("Could not delete preset: {e}"))
}

/// Return the raw TOML for a preset (for copy-to-clipboard / sharing).
#[tauri::command]
pub fn export_party_preset_toml(id: String) -> Result<String, String> {
    if !id_is_safe(&id) {
        return Err("Invalid preset id".to_string());
    }
    let dir = presets_dir()?;
    let path = dir.join(format!("{id}.toml"));
    fs::read_to_string(&path).map_err(|e| format!("Could not read preset: {e}"))
}

/// Overwrite an existing preset with raw, user-edited TOML. The text is
/// written verbatim (preserving the author's formatting + comments) but
/// must parse first, so a syntax error is caught before we clobber the
/// file. Returns the re-read entry.
#[tauri::command]
pub fn save_preset_toml(id: String, toml_text: String) -> Result<PresetEntry, String> {
    if !id_is_safe(&id) {
        return Err("Invalid preset id".to_string());
    }
    let preset: PartyPreset = toml::from_str(&toml_text)
        .map_err(|e| format!("This TOML doesn't parse — fix the syntax and try again:\n{e}"))?;
    let dir = presets_dir()?;
    let path = dir.join(format!("{id}.toml"));
    if !path.exists() {
        return Err(format!("Preset '{id}' not found"));
    }
    std::fs::write(&path, &toml_text).map_err(|e| format!("Could not write preset: {e}"))?;
    Ok(PresetEntry {
        id,
        raw_toml: toml_text,
        preset,
    })
}

/// Parse a pasted TOML block, normalise + lightly validate it, save it,
/// and return the saved entry plus any warnings.
#[tauri::command]
pub fn import_party_preset_toml(toml_text: String) -> Result<ImportResult, String> {
    let mut preset: PartyPreset = toml::from_str(&toml_text)
        .map_err(|e| format!("That doesn't look like a valid preset:\n{e}"))?;

    let mut warnings: Vec<String> = Vec::new();

    if preset.schema_version > CURRENT_SCHEMA_VERSION {
        warnings.push(format!(
            "Preset is schema v{} but this app understands v{CURRENT_SCHEMA_VERSION}. Newer fields are ignored.",
            preset.schema_version
        ));
    }

    if preset.preset_info.name.trim().is_empty() {
        preset.preset_info.name = "Imported party".to_string();
        warnings.push("Preset had no name — saved as \"Imported party\".".to_string());
    }

    if preset.party.bots.is_empty() {
        return Err("This preset has no bots in [[party.bots]].".to_string());
    }

    // The explicit-gear caveat is identical for every bot, so we note it
    // once after the loop rather than repeating it per bot.
    let mut any_explicit_gear = false;

    for (i, bot) in preset.party.bots.iter_mut().enumerate() {
        let label = format!("bot[{}]", i + 1);

        // Class must map to an addclass keyword.
        let normalised_class = bot.class.trim().to_lowercase();
        if class_keyword_to_id(&normalised_class).is_none() {
            return Err(format!(
                "{label} has unknown class '{}'. Use one of: warrior, paladin, hunter, rogue, priest, dk, shaman, mage, warlock, druid.",
                bot.class
            ));
        }
        bot.class = normalised_class;

        // Role: tank/healer/dps, default dps with a warning.
        let role = bot.role.trim().to_lowercase();
        if !matches!(role.as_str(), "tank" | "healer" | "dps") {
            warnings.push(format!(
                "{label} role '{}' isn't tank/healer/dps — treated as dps.",
                bot.role
            ));
            bot.role = "dps".to_string();
        } else {
            bot.role = role;
        }

        // Level clamp.
        if bot.level < 1 || bot.level > 80 {
            warnings.push(format!(
                "{label} level {} is out of range — clamped to 1-80.",
                bot.level
            ));
            bot.level = bot.level.clamp(1, 80);
        }

        // Talents: normalise URL/markdown/bare → digit-dash string.
        if let Some(raw) = bot.talents.clone() {
            match normalize_talents(&raw) {
                Some(clean) => bot.talents = Some(clean),
                None => {
                    warnings.push(format!(
                        "{label} talents couldn't be read ('{}') — the bot will auto-pick talents.",
                        raw.trim()
                    ));
                    bot.talents = None;
                }
            }
        }

        if bot_has_explicit_gear(bot) {
            any_explicit_gear = true;
        }
    }

    if any_explicit_gear {
        warnings.push(
            "One or more bots list specific gear. Equipping exact items isn't supported yet — bots are auto-geared for their level and spec. The gear list is kept for reference.".to_string(),
        );
    }

    // Cross-check gear IDs against the server's item_template: a preset
    // authored from memory (or by an LLM) often pairs a real item NAME
    // with the wrong ID, and since tooltips resolve by ID, the two would
    // silently disagree. Best-effort — if the DB is unreachable (server
    // off) we just skip the check.
    let named_gear = collect_gear_named_ids(&preset.party.bots);
    if !named_gear.is_empty() {
        let ids: Vec<i64> = named_gear.iter().map(|(id, _)| *id).collect();
        if let Some(real) = lookup_item_names(&ids) {
            let mut mismatches: Vec<(i64, String, String)> = Vec::new();
            let mut unknown = 0;
            for (id, toml_name) in &named_gear {
                match real.get(id) {
                    Some(real_name) => {
                        if !real_name.eq_ignore_ascii_case(toml_name.trim()) {
                            mismatches.push((*id, toml_name.clone(), real_name.clone()));
                        }
                    }
                    None => unknown += 1,
                }
            }
            if let Some((eid, ename, ereal)) = mismatches.first() {
                warnings.push(format!(
                    "{} of {} gear items have IDs that don't match their names — tooltips show the real item for each ID. e.g. id {} is \"{}\", not \"{}\". Double-check this preset's item IDs.",
                    mismatches.len(),
                    named_gear.len(),
                    eid,
                    ereal,
                    ename
                ));
            }
            if unknown > 0 {
                warnings.push(format!(
                    "{unknown} gear item ID(s) aren't in your item database — those slots won't resolve to a real item."
                ));
            }
        }
    }

    let dir = presets_dir()?;
    let slug = slugify(&preset.preset_info.name);
    let id = unique_id(&dir, &slug);
    let entry = write_preset(&dir, &id, &preset)?;
    Ok(ImportResult { entry, warnings })
}

// ── helpers ──────────────────────────────────────────────────────────

/// True if any bot names at least one EXPLICIT gear slot (a `[…gear.<slot>]`
/// table carrying an `id`). The `auto` pseudo-slot and `auto = true` slots
/// don't count — a pure-auto preset shouldn't trigger the "specific gear
/// isn't applied yet" warning. See the gear schema in
/// `preset_system_handoff.md`.
fn bot_has_explicit_gear(bot: &BotSpec) -> bool {
    let Some(toml::Value::Table(gear)) = &bot.gear else {
        return false;
    };
    gear.iter().any(|(slot, v)| {
        slot != "auto"
            && matches!(v, toml::Value::Table(t)
                if t.get("id").and_then(|x| x.as_integer()).is_some())
    })
}

/// Pull every `(id, name)` gear pair out of a parsed preset's bots so we
/// can cross-check IDs ↔ names against the live item DB.
fn collect_gear_named_ids(bots: &[BotSpec]) -> Vec<(i64, String)> {
    let mut out = Vec::new();
    for bot in bots {
        let Some(toml::Value::Table(gear)) = &bot.gear else {
            continue;
        };
        for item in gear.values() {
            if let toml::Value::Table(slot) = item {
                let id = slot.get("id").and_then(|v| v.as_integer());
                let name = slot.get("name").and_then(|v| v.as_str());
                if let (Some(id), Some(name)) = (id, name) {
                    out.push((id, name.to_string()));
                }
            }
        }
    }
    out
}

/// Resolve item entry → name from `acore_world.item_template`. Returns
/// None when the database container isn't reachable (server off), so the
/// caller can treat the cross-check as "couldn't verify" rather than
/// "everything's wrong".
fn lookup_item_names(ids: &[i64]) -> Option<std::collections::HashMap<i64, String>> {
    if ids.is_empty() {
        return Some(std::collections::HashMap::new());
    }
    let container = find_database_container()?;
    let list = ids
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT entry, name FROM acore_world.item_template WHERE entry IN ({list});"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut map = std::collections::HashMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut parts = line.splitn(2, '\t');
        if let (Some(e), Some(n)) = (parts.next(), parts.next()) {
            if let Ok(id) = e.trim().parse::<i64>() {
                map.insert(id, n.trim().to_string());
            }
        }
    }
    Some(map)
}

fn find_database_container() -> Option<String> {
    let out = std::process::Command::new("docker")
        .args(["ps", "--format", "{{.Names}}"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|n| n.to_lowercase().contains("database"))
        .map(|s| s.to_string())
}

/// Mirror of `playerbots::class_id_to_name`, reversed. Kept local so the
/// preset module owns its own validation surface.
fn class_keyword_to_id(keyword: &str) -> Option<u8> {
    match keyword {
        "warrior" => Some(1),
        "paladin" => Some(2),
        "hunter" => Some(3),
        "rogue" => Some(4),
        "priest" => Some(5),
        "dk" => Some(6),
        "shaman" => Some(7),
        "mage" => Some(8),
        "warlock" => Some(9),
        "druid" => Some(11),
        _ => None,
    }
}

/// Pull the digit-dash talent string out of any of the three author
/// input forms (see handoff "Talent URL Parsing"):
///   1. raw URL:      https://www.wowhead.com/wotlk/talent-calc/warrior/053000003-0500030023
///   2. markdown:     [text](https://.../talent-calc/warrior/053000003-...)
///   3. bare string:  053000003-0500030023
/// The glyph blob after `_` is discarded. Returns None when no valid
/// digit-dash run can be found.
fn normalize_talents(raw: &str) -> Option<String> {
    let raw = raw.trim();

    let candidate = if let Some(idx) = raw.find("talent-calc/") {
        // Everything after "talent-calc/" is "<class>/<talents>...".
        let after = &raw[idx + "talent-calc/".len()..];
        // Skip the class segment.
        let talents_part = after.split('/').nth(1)?;
        talents_part
    } else {
        raw
    };

    // Keep only the leading [0-9-] run; stop at '_' (glyphs), ')', ']',
    // whitespace, or anything else.
    let mut cleaned = String::new();
    for ch in candidate.chars() {
        if ch.is_ascii_digit() || ch == '-' {
            cleaned.push(ch);
        } else {
            break;
        }
    }
    let cleaned = cleaned.trim_matches('-').to_string();

    // Must contain at least one non-zero digit to be a real build.
    if cleaned.chars().any(|c| c.is_ascii_digit() && c != '0') {
        Some(cleaned)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_bare_string() {
        assert_eq!(
            normalize_talents("053000003-0500030023-05"),
            Some("053000003-0500030023-05".to_string())
        );
    }

    #[test]
    fn normalize_url() {
        assert_eq!(
            normalize_talents(
                "https://www.wowhead.com/wotlk/talent-calc/warrior/053000003-0500030023"
            ),
            Some("053000003-0500030023".to_string())
        );
    }

    #[test]
    fn normalize_url_with_glyphs() {
        assert_eq!(
            normalize_talents(
                "https://www.wowhead.com/wotlk/talent-calc/priest/2305201-035-_001rzx11"
            ),
            Some("2305201-035".to_string())
        );
    }

    #[test]
    fn normalize_markdown() {
        assert_eq!(
            normalize_talents(
                "[arms](https://www.wowhead.com/wotlk/talent-calc/warrior/300200-05)"
            ),
            Some("300200-05".to_string())
        );
    }

    #[test]
    fn normalize_rejects_empty_build() {
        assert_eq!(normalize_talents("000-000"), None);
        assert_eq!(normalize_talents(""), None);
    }

    #[test]
    fn slugify_basics() {
        assert_eq!(slugify("Early BRD"), "early-brd");
        assert_eq!(slugify("  !!!  "), "preset");
        assert_eq!(slugify("PvP // Arena 2v2"), "pvp-arena-2v2");
    }
}
