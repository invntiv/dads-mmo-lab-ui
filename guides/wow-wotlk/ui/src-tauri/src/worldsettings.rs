//! World settings — player-facing global rates in `worldserver.conf`.
//!
//! Edits the live worldserver config (`<install>/env/dist/etc/worldserver.conf`)
//! and applies changes with SOAP `.reload config`, which re-reads the
//! `Rate.*` values without a restart. We expose a curated set of the
//! knobs the audience actually wants (XP / gold / reputation / honor)
//! rather than the hundreds of raw config keys.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::soap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldSettings {
    pub xp_kill: f64,
    pub xp_quest: f64,
    pub xp_explore: f64,
    pub drop_money: f64,
    pub reputation: f64,
    pub honor: f64,
}

/// (struct field accessor, worldserver.conf key). One source of truth
/// for both read and write so they can't drift.
fn rate_keys(s: &WorldSettings) -> [(&'static str, f64); 6] {
    [
        ("Rate.XP.Kill", s.xp_kill),
        ("Rate.XP.Quest", s.xp_quest),
        ("Rate.XP.Explore", s.xp_explore),
        ("Rate.Drop.Money", s.drop_money),
        ("Rate.Reputation.Gain", s.reputation),
        ("Rate.Honor", s.honor),
    ]
}

fn worldserver_conf_path() -> Result<PathBuf, String> {
    let install =
        crate::modules::first_install_path().ok_or_else(|| "No server install detected.".to_string())?;
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
    let get = |k: &str| {
        conf.get(k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(1.0)
    };
    Ok(WorldSettings {
        xp_kill: get("Rate.XP.Kill"),
        xp_quest: get("Rate.XP.Quest"),
        xp_explore: get("Rate.XP.Explore"),
        drop_money: get("Rate.Drop.Money"),
        reputation: get("Rate.Reputation.Gain"),
        honor: get("Rate.Honor"),
    })
}

/// Write the rates back to worldserver.conf, then `.reload config` so
/// they take effect without a restart. Returns the worldserver's reply
/// (or a note if the server is offline — the file is still updated and
/// will apply on next start).
#[tauri::command]
pub async fn set_world_settings(settings: WorldSettings) -> Result<String, String> {
    let path = worldserver_conf_path()?;
    for (key, value) in rate_keys(&settings) {
        crate::modules::conf_set_inplace(&path, key, &fmt_rate(value))?;
    }
    match soap::execute_command(".reload config").await {
        Ok(_) => Ok("Saved and applied.".to_string()),
        Err(e) => Ok(format!(
            "Saved to worldserver.conf, but couldn't reload live ({e}). Changes apply next time the server starts."
        )),
    }
}
