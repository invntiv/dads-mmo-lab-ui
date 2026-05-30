//! World settings — player-facing global rates in `worldserver.conf`.
//!
//! Edits the live worldserver config (`<install>/env/dist/etc/worldserver.conf`)
//! and applies changes with SOAP `.reload config`, which re-reads the
//! `Rate.*` / `AllowTwoSide.*` values without a restart. We expose a
//! curated set of the knobs the audience actually wants rather than the
//! hundreds of raw config keys.
//!
//! Some UI fields fan out to several conf keys (e.g. "Monster damage"
//! scales normal + every elite tier, plus their spell-damage variants)
//! so one slider does the intuitive thing. On read we sample a single
//! representative key per field.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::soap;

// ── multi-key groups (write all; read the first) ─────────────────────

const CREATURE_DAMAGE_KEYS: &[&str] = &[
    "Rate.Creature.Normal.Damage",
    "Rate.Creature.Elite.Elite.Damage",
    "Rate.Creature.Elite.RARE.Damage",
    "Rate.Creature.Elite.RAREELITE.Damage",
    "Rate.Creature.Elite.WORLDBOSS.Damage",
    "Rate.Creature.Normal.SpellDamage",
    "Rate.Creature.Elite.Elite.SpellDamage",
    "Rate.Creature.Elite.RARE.SpellDamage",
    "Rate.Creature.Elite.RAREELITE.SpellDamage",
    "Rate.Creature.Elite.WORLDBOSS.SpellDamage",
];
const CREATURE_HP_KEYS: &[&str] = &[
    "Rate.Creature.Normal.HP",
    "Rate.Creature.Elite.Elite.HP",
    "Rate.Creature.Elite.RARE.HP",
    "Rate.Creature.Elite.RAREELITE.HP",
    "Rate.Creature.Elite.WORLDBOSS.HP",
];
const LOOT_KEYS: &[&str] = &[
    "Rate.Drop.Item.Poor",
    "Rate.Drop.Item.Normal",
    "Rate.Drop.Item.Uncommon",
    "Rate.Drop.Item.Rare",
    "Rate.Drop.Item.Epic",
    "Rate.Drop.Item.Legendary",
    "Rate.Drop.Item.Artifact",
];
const REST_KEYS: &[&str] = &[
    "Rate.Rest.InGame",
    "Rate.Rest.Offline.InTavernOrCity",
    "Rate.Rest.Offline.InWilderness",
];
const CROSS_FACTION_KEYS: &[&str] = &[
    "AllowTwoSide.Interaction.Calendar",
    "AllowTwoSide.Interaction.Chat",
    "AllowTwoSide.Interaction.Channel",
    "AllowTwoSide.Interaction.Group",
    "AllowTwoSide.Interaction.Guild",
    "AllowTwoSide.Interaction.Arena",
    "AllowTwoSide.Interaction.Auction",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldSettings {
    // Experience
    pub xp_kill: f64,
    pub xp_quest: f64,
    pub xp_explore: f64,
    // Rewards
    pub drop_money: f64,
    pub reputation: f64,
    pub honor: f64,
    // Difficulty
    pub monster_damage: f64,
    pub monster_health: f64,
    pub loot: f64,
    // Quality of life
    pub rested_xp: f64,
    pub move_speed: f64,
    pub cross_faction: bool,
}

/// (write-keys, value) for every rate field, in one place so read +
/// write can't drift.
fn rate_groups(s: &WorldSettings) -> [(&'static [&'static str], f64); 11] {
    [
        (&["Rate.XP.Kill"], s.xp_kill),
        (&["Rate.XP.Quest"], s.xp_quest),
        (&["Rate.XP.Explore"], s.xp_explore),
        (&["Rate.Drop.Money"], s.drop_money),
        (&["Rate.Reputation.Gain"], s.reputation),
        (&["Rate.Honor"], s.honor),
        (CREATURE_DAMAGE_KEYS, s.monster_damage),
        (CREATURE_HP_KEYS, s.monster_health),
        (LOOT_KEYS, s.loot),
        (REST_KEYS, s.rested_xp),
        (&["Rate.MoveSpeed.Player"], s.move_speed),
    ]
}

fn worldserver_conf_path() -> Result<PathBuf, String> {
    let install = crate::modules::first_install_path()
        .ok_or_else(|| "No server install detected.".to_string())?;
    let path = install.join("env/dist/etc/worldserver.conf");
    if !path.exists() {
        return Err(format!(
            "worldserver.conf not found at {} — has the server run at least once?",
            path.display()
        ));
    }
    Ok(path)
}

/// Trim float fuzz and render without trailing zeros (1.0 → "1",
/// 2.5 → "2.5") so the conf stays tidy.
fn fmt_rate(v: f64) -> String {
    let rounded = (v.max(0.0) * 100.0).round() / 100.0;
    rounded.to_string()
}

#[tauri::command]
pub fn get_world_settings() -> Result<WorldSettings, String> {
    let path = worldserver_conf_path()?;
    let conf = crate::modules::parse_conf(&path);
    let rate = |k: &str| {
        conf.get(k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(1.0)
    };
    let flag = |k: &str| conf.get(k).map(|v| v.trim() == "1").unwrap_or(false);
    Ok(WorldSettings {
        xp_kill: rate("Rate.XP.Kill"),
        xp_quest: rate("Rate.XP.Quest"),
        xp_explore: rate("Rate.XP.Explore"),
        drop_money: rate("Rate.Drop.Money"),
        reputation: rate("Rate.Reputation.Gain"),
        honor: rate("Rate.Honor"),
        monster_damage: rate("Rate.Creature.Normal.Damage"),
        monster_health: rate("Rate.Creature.Normal.HP"),
        loot: rate("Rate.Drop.Item.Normal"),
        rested_xp: rate("Rate.Rest.InGame"),
        move_speed: rate("Rate.MoveSpeed.Player"),
        cross_faction: flag("AllowTwoSide.Interaction.Group"),
    })
}

/// Write the settings back to worldserver.conf, then `.reload config` so
/// they take effect without a restart. Returns the worldserver's reply
/// (or a note if the server is offline — the file is still updated and
/// will apply on next start).
#[tauri::command]
pub async fn set_world_settings(settings: WorldSettings) -> Result<String, String> {
    let path = worldserver_conf_path()?;
    for (keys, value) in rate_groups(&settings) {
        let v = fmt_rate(value);
        for key in keys {
            crate::modules::conf_set_inplace(&path, key, &v)?;
        }
    }
    let flag = if settings.cross_faction { "1" } else { "0" };
    for key in CROSS_FACTION_KEYS {
        crate::modules::conf_set_inplace(&path, key, flag)?;
    }
    match soap::execute_command(".reload config").await {
        Ok(_) => Ok("Saved and applied.".to_string()),
        Err(e) => Ok(format!(
            "Saved to worldserver.conf, but couldn't reload live ({e}). Changes apply next time the server starts."
        )),
    }
}

// ── message of the day ───────────────────────────────────────────────

#[tauri::command]
pub fn get_motd() -> Result<String, String> {
    let path = worldserver_conf_path()?;
    let conf = crate::modules::parse_conf(&path);
    Ok(conf
        .get("Motd")
        .map(|v| v.trim().trim_matches('"').to_string())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn set_motd(text: String) -> Result<String, String> {
    // Single line — `.server set motd` takes the rest of the command line.
    let clean = text.replace(['\n', '\r'], " ");
    let path = worldserver_conf_path()?;
    // Persist to conf (best-effort across restarts) and set it live.
    let escaped = clean.replace('"', "'");
    crate::modules::conf_set_inplace(&path, "Motd", &format!("\"{escaped}\""))?;
    match soap::execute_command(&format!(".server set motd {clean}")).await {
        Ok(_) => Ok("Message of the day updated.".to_string()),
        Err(e) => Ok(format!(
            "Saved, but couldn't apply live ({e}). It'll show next time the server starts."
        )),
    }
}

// ── summon a service NPC (mod-transmog "Transmogrifier") to the player ─

fn first_db_container() -> Option<String> {
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

/// Look up the mod-transmog NPC's creature entry. The mod ships it as
/// entry 190010 (named "Warpweaver") — per its SQL + the catalogue
/// (`.npc add 190010`), NOT a "transmog"-named row — so we match that
/// exact entry first and only fall back to a name search if a fork
/// renumbered it. Returns None when mod-transmog isn't installed.
fn find_transmog_entry() -> Option<u32> {
    let container = first_db_container()?;
    let sql = "SELECT entry FROM acore_world.creature_template \
               WHERE entry = 190010 \
                  OR name LIKE '%Warpweaver%' OR name LIKE '%ransmog%' \
               ORDER BY (entry = 190010) DESC, entry LIMIT 1;";
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", sql,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .and_then(|l| l.trim().parse::<u32>().ok())
}

/// Resolve the bundled `dml_summon_npc.lua` (resource dir → walk up from
/// the binary, same strategy as the install/bootstrap scripts).
fn resolve_eluna_script(app: &AppHandle, name: &str) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("eluna-scripts").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let mut cursor: Option<&Path> = exe.parent();
    while let Some(dir) = cursor {
        let candidate = dir.join("eluna-scripts").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
        cursor = dir.parent();
    }
    None
}

/// Make sure `dml_summon_npc.lua` is present in the install's mounted
/// `lua_scripts/` dir, copying the bundled copy in if it's missing.
/// Returns true when a copy was made (caller should reload Eluna).
fn ensure_summon_script(app: &AppHandle, install: &Path) -> bool {
    let dest = install.join("lua_scripts").join("dml_summon_npc.lua");
    if dest.exists() {
        return false;
    }
    let Some(src) = resolve_eluna_script(app, "dml_summon_npc.lua") else {
        return false;
    };
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::copy(&src, &dest).is_ok()
}

/// Summon the mod-transmog NPC next to the player via the
/// `dml_summon_npc` Eluna bridge. Best-effort deploy of the bridge
/// script if it's missing (newly-added after this install was created).
#[tauri::command]
pub async fn summon_transmog_npc(
    app: AppHandle,
    character_name: String,
) -> Result<String, String> {
    let entry = find_transmog_entry().ok_or_else(|| {
        "Couldn't find the Transmogrifier NPC — make sure mod-transmog is installed (Settings → Modules)."
            .to_string()
    })?;

    if let Some(install) = crate::modules::first_install_path() {
        if ensure_summon_script(&app, &install) {
            // The bridge script was just added — nudge mod-ale to (re)load
            // scripts. `.reload config` re-runs the Eluna config hook.
            let _ = soap::execute_command(".reload config").await;
        }
    }

    let cmd = format!("dml_summon_npc {character_name} {entry}");
    let _ = soap::execute_command(&cmd).await?;
    Ok("Transmogrifier summoned — look next to your character in-game.".to_string())
}
