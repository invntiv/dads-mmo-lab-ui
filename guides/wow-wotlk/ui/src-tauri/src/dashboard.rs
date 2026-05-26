//! Dashboard player-view backend.
//!
//! Surfaces the data the dashboard's paperdoll needs (level/class,
//! current + max HP / power / armor / resistances, equipped items by
//! slot, money) and the small set of GM "act on my character"
//! commands the player can trigger from there (set HP, set power, set
//! money, revive).
//!
//! Why direct SQL and not SOAP:
//!  - AC's `.modify <stat>` family targets the GM's selected in-world
//!    target. Sent over SOAP there's no target, so the commands fail.
//!  - There IS no `.modify hp name <player>` variant for most stats.
//!  - Direct `UPDATE acore_characters.characters` works for OFFLINE
//!    characters with no surprises. For ONLINE characters the change
//!    only takes effect on next login; the frontend surfaces an
//!    "Applies on next login" hint when `online = 1`.
//! Future: pair these with `.kick name <player>` so an online char
//! gets bounced to login and picks up the change immediately.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EquippedItem {
    /// Equipment slot 0..18 (Head/Neck/.../Tabard — see EQUIP_SLOT_LABELS
    /// on the frontend for the mapping).
    pub slot: u32,
    /// item_template.entry — the frontend uses this as the tooltip
    /// lookup key (via get_item_details).
    pub entry: u32,
    /// item_template.displayid — the frontend uses THIS (not entry)
    /// to look up the icon name in the icon-cache map (which is keyed
    /// by displayid). Used to be missing; without it every paperdoll
    /// slot rendered the fallback "#entry" chit.
    pub display_id: u32,
    /// 0..7 item quality. Lets ItemIconFramed color the fallback chit
    /// when no icon is cached yet.
    pub quality: u32,
    /// Stack count. Always 1 for true equip slots but included for
    /// consistency with bag/bank slot rendering.
    pub count: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CharacterPaperdoll {
    pub guid: u64,
    pub name: String,
    pub account: u64,
    pub level: u32,
    pub race: u32,
    pub class: u32,
    pub gender: u32,
    pub online: bool,
    /// Copper. Frontend renders as Xg Ys Zc.
    pub money: u64,
    /// Current values from `characters` table.
    pub health: u32,
    pub power1: u32,
    pub power2: u32,
    pub power3: u32,
    pub power4: u32,
    pub power7: u32,
    /// Max values from `character_stats` snapshot (updated each login
    /// / save). May lag if the player just gained max-HP buffs in this
    /// session; close-enough for our purposes.
    pub max_health: u32,
    pub max_power1: u32,
    pub max_power2: u32,
    pub max_power3: u32,
    pub max_power4: u32,
    pub max_power7: u32,
    /// All equipped items in slot order. Missing slots aren't in the
    /// list — the frontend renders an empty slot for those.
    pub equipped: Vec<EquippedItem>,
}

#[tauri::command]
pub fn get_character_paperdoll(guid: u64) -> Result<CharacterPaperdoll, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    // One round-trip — characters + character_stats joined to inventory
    // would be a single fat join but it's clearer (and avoids row-
    // multiplication for items) as two queries. Both are tiny.
    let base_sql = format!(
        "SELECT c.guid, c.name, c.account, c.level, c.race, c.class, c.gender, c.online, c.money, \
                c.health, c.power1, c.power2, c.power3, c.power4, c.power7, \
                COALESCE(s.maxhealth, 0), COALESCE(s.maxpower1, 0), COALESCE(s.maxpower2, 0), \
                COALESCE(s.maxpower3, 0), COALESCE(s.maxpower4, 0), COALESCE(s.maxpower7, 0) \
         FROM acore_characters.characters c \
         LEFT JOIN acore_characters.character_stats s ON s.guid = c.guid \
         WHERE c.guid = {guid};"
    );
    let base_out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &base_sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !base_out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&base_out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&base_out.stdout);
    let line = stdout
        .lines()
        .next()
        .ok_or_else(|| format!("character {guid} not found"))?;
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 21 {
        return Err(format!(
            "characters/character_stats join returned {} columns (expected 21)",
            parts.len()
        ));
    }
    let u64_at = |s: &str| s.trim().parse::<u64>().unwrap_or(0);
    let u32_at = |s: &str| s.trim().parse::<u32>().unwrap_or(0);

    // Equipped items: bag = 0 + slot < 19. Join item_template so we
    // can return displayid (for icon lookup — iconMap is keyed by
    // displayid, not entry) and quality (for the fallback chit color).
    let equip_sql = format!(
        "SELECT ci.slot, ii.itemEntry, COALESCE(it.displayid, 0), \
                COALESCE(it.Quality, 0), ii.count \
         FROM acore_characters.character_inventory ci \
         JOIN acore_characters.item_instance ii ON ii.guid = ci.item \
         LEFT JOIN acore_world.item_template it ON it.entry = ii.itemEntry \
         WHERE ci.guid = {guid} AND ci.bag = 0 AND ci.slot < 19 \
         ORDER BY ci.slot;"
    );
    let equip_out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &equip_sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !equip_out.status.success() {
        return Err(format!(
            "equip query failed: {}",
            String::from_utf8_lossy(&equip_out.stderr).trim()
        ));
    }
    let mut equipped = Vec::new();
    for row in String::from_utf8_lossy(&equip_out.stdout).lines() {
        let p: Vec<&str> = row.split('\t').collect();
        if p.len() < 5 {
            continue;
        }
        equipped.push(EquippedItem {
            slot: u32_at(p[0]),
            entry: u32_at(p[1]),
            display_id: u32_at(p[2]),
            quality: u32_at(p[3]),
            count: u32_at(p[4]).max(1),
        });
    }

    Ok(CharacterPaperdoll {
        guid: u64_at(parts[0]),
        name: parts[1].trim().to_string(),
        account: u64_at(parts[2]),
        level: u32_at(parts[3]),
        race: u32_at(parts[4]),
        class: u32_at(parts[5]),
        gender: u32_at(parts[6]),
        online: u32_at(parts[7]) != 0,
        money: u64_at(parts[8]),
        health: u32_at(parts[9]),
        power1: u32_at(parts[10]),
        power2: u32_at(parts[11]),
        power3: u32_at(parts[12]),
        power4: u32_at(parts[13]),
        power7: u32_at(parts[14]),
        max_health: u32_at(parts[15]),
        max_power1: u32_at(parts[16]),
        max_power2: u32_at(parts[17]),
        max_power3: u32_at(parts[18]),
        max_power4: u32_at(parts[19]),
        max_power7: u32_at(parts[20]),
        equipped,
    })
}

// ── GM action commands ─────────────────────────────────────────────
// All direct UPDATE statements; effective immediately for offline
// characters, on-next-login for online. Frontend surfaces the
// implication via the `online` flag returned above.

fn run_update(sql: &str) -> Result<(), String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found".to_string())?;
    let out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-e", sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql update failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn gm_set_money(guid: u64, copper: u64) -> Result<(), String> {
    // AC's money column is INT UNSIGNED — clamp to 32-bit max so we
    // don't write a value that the worldserver rejects.
    let clamped = copper.min(u32::MAX as u64);
    run_update(&format!(
        "UPDATE acore_characters.characters SET money = {clamped} WHERE guid = {guid};"
    ))
}

#[tauri::command]
pub fn gm_set_health_pct(guid: u64, pct: u32) -> Result<(), String> {
    let pct = pct.min(100);
    run_update(&format!(
        "UPDATE acore_characters.characters c \
         LEFT JOIN acore_characters.character_stats s ON s.guid = c.guid \
         SET c.health = CAST(COALESCE(s.maxhealth, c.health) * {pct} / 100 AS UNSIGNED) \
         WHERE c.guid = {guid};"
    ))
}

#[tauri::command]
pub fn gm_set_power_pct(guid: u64, power_index: u32, pct: u32) -> Result<(), String> {
    // Only powers 1..7 are valid; refuse anything else outright so we
    // never inject a wrong column name.
    if !(1..=7).contains(&power_index) {
        return Err(format!("invalid power_index {power_index}"));
    }
    let pct = pct.min(100);
    let power_col = format!("power{power_index}");
    let max_col = format!("maxpower{power_index}");
    run_update(&format!(
        "UPDATE acore_characters.characters c \
         LEFT JOIN acore_characters.character_stats s ON s.guid = c.guid \
         SET c.{power_col} = CAST(COALESCE(s.{max_col}, c.{power_col}) * {pct} / 100 AS UNSIGNED) \
         WHERE c.guid = {guid};"
    ))
}

#[tauri::command]
pub fn gm_revive(guid: u64) -> Result<(), String> {
    // Revive = full HP. AC also clears other death-related state when
    // the player respawns in-world, but for an offline char setting
    // health > 0 is enough — on next login the engine treats them as
    // alive with the new HP value.
    gm_set_health_pct(guid, 100)
}

/// Fetch a character's current talent allocations as a flat map
/// keyed by Talent.dbc primary key → 1-based rank (number of points
/// spent in that talent). Used by the My Talents dashboard tab + the
/// Bot Detail page's Talents tab.
///
/// `character_talent.spell` stores the spell_id of the *learned*
/// rank (each rank of a talent is its own spell_id). We resolve that
/// through the talent cache built from Talent.dbc + TalentTab.dbc —
/// every spell_id maps to a (talent_id, rank) pair. Rank is 0-indexed
/// in the cache; we return 1-indexed so the frontend can render
/// "{rank}/{maxRank}" directly.
#[tauri::command]
pub fn get_character_talents(guid: u64) -> Result<std::collections::HashMap<i32, u8>, String> {
    let cache = crate::client_assets::load_talent_data().map_err(|e| {
        format!(
            "Talent cache not loaded: {e}. Run Settings → Talents → \
             Extract talents first."
        )
    })?;

    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    let sql = format!(
        "SELECT spell FROM acore_characters.character_talent WHERE guid = {guid};"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let mut result: std::collections::HashMap<i32, u8> = std::collections::HashMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let Some(spell_str) = line.trim().split('\t').next() else {
            continue;
        };
        if spell_str.is_empty() {
            continue;
        }
        // The cache keys are stringified spell_ids — match the same.
        let Some(info) = cache.spell_to_talent.get(spell_str) else {
            continue;
        };
        // Prefer the highest rank we see for a given talent. Normally
        // each talent has one row, but defensive in case duplicates
        // sneak in across dual-spec / glyph migrations.
        let rank_1based = info.rank.saturating_add(1);
        result
            .entry(info.talent_id)
            .and_modify(|r| {
                if rank_1based > *r {
                    *r = rank_1based;
                }
            })
            .or_insert(rank_1based);
    }
    Ok(result)
}

/// True iff the character is currently logged into the game world.
///
/// Used by party-management flows (Add-to-Party, etc.) to bail with a
/// useful toast before issuing commands that require the character to
/// be in-world (e.g. summoning a bot to their position, .group join).
/// Returns Err only on database connection issues — a missing character
/// row returns Ok(false), since "not logged in" is the same outcome
/// either way.
#[tauri::command]
pub fn is_character_online(guid: u64) -> Result<bool, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;
    let sql = format!(
        "SELECT online FROM acore_characters.characters WHERE guid = {guid};"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let val: u32 = stdout.lines().next().and_then(|l| l.trim().parse().ok()).unwrap_or(0);
    Ok(val == 1)
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
