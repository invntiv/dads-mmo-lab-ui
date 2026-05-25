//! Playerbots browser — queries `acore_playerbots.playerbots_account_type`
//! joined to `acore_characters.characters` to enumerate the two bot
//! populations the mod manages:
//!
//!   - `account_type = 1` (RNDBot): the random bots living in the world.
//!     ~200 on a stock install, roaming level-appropriate zones.
//!   - `account_type = 2` (AddClass): the pre-leveled invite pool. 500
//!     characters split into "ready to invite" slots, never roam, just
//!     wait to be summoned into a player's party.
//!
//! Both populations are real `characters` rows — no separate bot table —
//! so we read everything (guid, name, class/race/gender/level, current
//! map+zone) from the standard char schema and just use the join to
//! distinguish the two types.
//!
//! Phase 1 of the Bots UI is read-only: this command feeds the browser.
//! Actions (invite-to-party, summon-to-me, refresh, levelup, etc.) flow
//! through SOAP and land in their own commands once the browser is
//! exercised and we know the UX we want.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::soap;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlayerbotSummary {
    pub guid: u64,
    pub name: String,
    pub race: u32,
    pub class: u32,
    /// 0 = male, 1 = female. Mirrors the `characters.gender` column.
    pub gender: u32,
    pub level: u32,
    /// Map id (0 EK, 1 Kalimdor, 530 Outland, 571 Northrend, etc.) plus
    /// zone id (lookup table in DBC — surfaced raw for now; the UI can
    /// resolve to names later).
    pub map: u32,
    pub zone: u32,
    pub account: u64,
    /// 1 = random bot (world-roaming), 2 = addclass (invite pool).
    pub bot_type: u32,
    /// Primary spec tab (0/1/2) inferred from talent distribution.
    /// `None` when the bot has no talents (low-level), the talent
    /// cache hasn't been extracted, or the inference failed. The
    /// frontend resolves to a display name via SPEC_NAMES[class][tab].
    pub spec_tab_index: Option<u8>,
}

#[tauri::command]
pub fn list_playerbots() -> Result<Vec<PlayerbotSummary>, String> {
    let container = find_database_container().ok_or_else(|| {
        "ac-database container not found — is the server running?".to_string()
    })?;

    // Single query for both populations. The UI tabs filter client-side
    // by bot_type — 700 rows is well within "fits in memory" territory
    // and one query beats two round-trips.
    let out = std::process::Command::new("docker")
        .args([
            "exec",
            &container,
            "mysql",
            "-uroot",
            "-ppassword",
            "-N",
            "-B",
            "-e",
            "SELECT c.guid, c.name, c.race, c.class, c.gender, c.level, \
                    c.map, c.zone, c.account, t.account_type \
             FROM acore_characters.characters c \
             JOIN acore_playerbots.playerbots_account_type t \
                 ON t.account_id = c.account \
             WHERE t.account_type IN (1, 2) \
             ORDER BY t.account_type, c.level DESC, c.name;",
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
    let mut rows = Vec::with_capacity(700);
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 10 {
            continue;
        }
        let parse_u64 = |s: &str| s.trim().parse::<u64>().ok();
        let parse_u32 = |s: &str| s.trim().parse::<u32>().ok();
        let (
            Some(guid),
            Some(race),
            Some(class),
            Some(gender),
            Some(level),
            Some(map),
            Some(zone),
            Some(account),
            Some(bot_type),
        ) = (
            parse_u64(parts[0]),
            parse_u32(parts[2]),
            parse_u32(parts[3]),
            parse_u32(parts[4]),
            parse_u32(parts[5]),
            parse_u32(parts[6]),
            parse_u32(parts[7]),
            parse_u64(parts[8]),
            parse_u32(parts[9]),
        )
        else {
            continue;
        };
        rows.push(PlayerbotSummary {
            guid,
            name: parts[1].trim().to_string(),
            race,
            class,
            gender,
            level,
            map,
            zone,
            account,
            bot_type,
            spec_tab_index: None,
        });
    }

    // Enrich with spec inference. The talent cache is built from
    // Talent.dbc + TalentTab.dbc and maps spell_id → tab_index (0/1/2
    // within the class). For each bot we count how many of their
    // character_talent rows fall into each tab; the tab with the most
    // points is their primary spec. Missing cache or missing talents
    // both gracefully leave spec_tab_index at None.
    if let Ok(cache) = crate::client_assets::load_talent_data() {
        let spell_to_tab: HashMap<i32, u8> = cache
            .spell_to_talent
            .iter()
            .filter_map(|(k, v)| k.parse::<i32>().ok().map(|sid| (sid, v.tab_index)))
            .collect();

        // One query for every bot's talents — joining via the same
        // playerbots filter so we only pull bot rows, not the user's
        // own characters. ~21k rows on a default install (~700 bots ×
        // ~30 talents each), trivially streams through docker exec.
        let talents_out = std::process::Command::new("docker")
            .args([
                "exec",
                &container,
                "mysql",
                "-uroot",
                "-ppassword",
                "-N",
                "-B",
                "-e",
                "SELECT ct.guid, ct.spell \
                 FROM acore_characters.character_talent ct \
                 INNER JOIN acore_characters.characters c ON c.guid = ct.guid \
                 INNER JOIN acore_playerbots.playerbots_account_type t \
                     ON t.account_id = c.account \
                 WHERE t.account_type IN (1, 2);",
            ])
            .output();

        if let Ok(out) = talents_out {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let mut counts: HashMap<u64, [u32; 3]> = HashMap::new();
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split('\t').collect();
                    if parts.len() < 2 {
                        continue;
                    }
                    let Some(guid) = parts[0].trim().parse::<u64>().ok() else {
                        continue;
                    };
                    let Some(spell) = parts[1].trim().parse::<i32>().ok() else {
                        continue;
                    };
                    if let Some(&tab) = spell_to_tab.get(&spell) {
                        let entry = counts.entry(guid).or_insert([0; 3]);
                        if (tab as usize) < entry.len() {
                            entry[tab as usize] += 1;
                        }
                    }
                }

                for row in &mut rows {
                    if let Some(c) = counts.get(&row.guid) {
                        let (max_idx, &max_val) = c
                            .iter()
                            .enumerate()
                            .max_by_key(|(_, &v)| v)
                            .unwrap_or((0, &0));
                        if max_val > 0 {
                            row.spec_tab_index = Some(max_idx as u8);
                        }
                    }
                }
            }
        }
    }

    Ok(rows)
}

/// Output of every bot action — surfaces the worldserver's raw reply
/// so the UI can show "Player not found" or "Level set to 40" verbatim.
#[derive(Debug, Serialize)]
pub struct BotActionResult {
    pub output: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLevelArgs {
    pub bot_name: String,
    pub level: u32,
}

/// `.character level <name> <level>` — works for offline characters too,
/// so the bot doesn't need to be in your party.
#[tauri::command]
pub async fn set_playerbot_level(args: SetLevelArgs) -> Result<BotActionResult, String> {
    if args.level < 1 || args.level > 80 {
        return Err(format!("Level must be 1-80 (got {})", args.level));
    }
    let cmd = format!(
        ".character level {} {}",
        quote_if_needed(&args.bot_name),
        args.level
    );
    let r = soap::execute_command(&cmd).await?;
    Ok(BotActionResult { output: r.output })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerollArgs {
    pub bot_name: String,
}

/// `.playerbots rndbot init <name>` — re-randomizes the bot's class,
/// race, gender, talents, and gear. Identity stays, everything else
/// gets rerolled. Useful for "I don't like this bot anymore".
#[tauri::command]
pub async fn reroll_playerbot(args: RerollArgs) -> Result<BotActionResult, String> {
    let cmd = format!(
        ".playerbots rndbot init {}",
        quote_if_needed(&args.bot_name)
    );
    let r = soap::execute_command(&cmd).await?;
    Ok(BotActionResult { output: r.output })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonArgs {
    pub bot_name: String,
    /// The user's character — we read their position from chardb. Note
    /// the position can be up to ~15min stale while they're logged in;
    /// `.saveall` is fired first to nudge a flush.
    pub character_name: String,
}

/// Teleport a bot to the user's saved chardb position. AC has no SOAP-
/// callable "summon X to Y" command, so we read Y's position from the
/// DB, drop a temp `game_tele` row at those coords, and `.tele name`
/// the bot to it. Same pattern teleport.rs uses for arbitrary coords.
#[tauri::command]
pub async fn summon_playerbot_to_character(
    args: SummonArgs,
) -> Result<BotActionResult, String> {
    // Nudge a chardb flush so the position we read is as fresh as we can
    // make it. Ignored if the server rejects it (rare).
    let _ = soap::execute_command(".saveall").await;

    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found".to_string())?;
    let (map, x, y, z) = fetch_character_position(&container, &args.character_name)?;

    // Build a unique temp tele name so concurrent summons don't collide.
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    let temp_name = format!("dml_summon_{}", suffix);

    let max_id = mysql_scalar_u32(
        &container,
        "SELECT COALESCE(MAX(id), 0) FROM acore_world.game_tele;",
    )?;
    let new_id = max_id + 1;
    let insert_sql = format!(
        "INSERT INTO acore_world.game_tele (id, position_x, position_y, position_z, orientation, map, name) \
         VALUES ({id}, {x}, {y}, {z}, 0, {map}, '{name}');",
        id = new_id,
        x = x,
        y = y,
        z = z,
        map = map,
        name = temp_name
    );
    mysql_exec(&container, &insert_sql)?;
    let _ = soap::execute_command(".reload game_tele").await;

    let tele_cmd = format!(
        ".tele name {} {}",
        quote_if_needed(&args.bot_name),
        temp_name
    );
    let tele_result = soap::execute_command(&tele_cmd).await;

    // Cleanup regardless of tele outcome so we don't litter game_tele
    // with orphan rows.
    let delete_sql = format!(
        "DELETE FROM acore_world.game_tele WHERE name = '{}';",
        temp_name
    );
    let _ = mysql_exec(&container, &delete_sql);
    let _ = soap::execute_command(".reload game_tele").await;

    match tele_result {
        Ok(r) => Ok(BotActionResult { output: r.output }),
        Err(e) => Err(e),
    }
}

// ── helpers ─────────────────────────────────────────────────────────

fn fetch_character_position(
    container: &str,
    name: &str,
) -> Result<(u32, f64, f64, f64), String> {
    // Direct quote escape — character names can't contain quotes per
    // AC's character-creation rules so this is safe.
    let sql = format!(
        "SELECT map, position_x, position_y, position_z \
         FROM acore_characters.characters WHERE name = '{}' LIMIT 1;",
        name.replace('\'', "''")
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
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
    let line = stdout.lines().next().ok_or_else(|| {
        format!("Character '{}' not found in chardb", name)
    })?;
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 4 {
        return Err(format!("Unexpected position row shape: {}", line));
    }
    let map = parts[0]
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("parse map: {e}"))?;
    let x = parts[1]
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("parse x: {e}"))?;
    let y = parts[2]
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("parse y: {e}"))?;
    let z = parts[3]
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("parse z: {e}"))?;
    Ok((map, x, y, z))
}

fn mysql_exec(container: &str, sql: &str) -> Result<(), String> {
    let out = std::process::Command::new("docker")
        .args(["exec", container, "mysql", "-uroot", "-ppassword", "-e", sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql exec failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

fn mysql_scalar_u32(container: &str, sql: &str) -> Result<u32, String> {
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql scalar failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.trim()
        .parse::<u32>()
        .map_err(|e| format!("parse scalar '{}': {}", text.trim(), e))
}

fn quote_if_needed(s: &str) -> String {
    if s.chars().any(|c| c.is_whitespace()) {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
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
