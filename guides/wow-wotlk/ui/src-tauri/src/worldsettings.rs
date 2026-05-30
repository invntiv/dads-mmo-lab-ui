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

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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
