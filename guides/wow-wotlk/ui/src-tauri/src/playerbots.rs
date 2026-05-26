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
    /// Kept around for backend behavioral hints (auto-pick talents,
    /// can-reroll, etc.) but the UI's "In the World" vs "Bot Pool"
    /// split is driven by `online` instead — that's the question the
    /// user actually cares about.
    pub bot_type: u32,
    /// True when the bot is currently logged into the game world.
    /// Random bots cycle on/off via BotActiveAlone scaling; AddClass
    /// bots are offline by default until invited.
    pub online: bool,
    /// Primary spec tab (0/1/2) inferred from talent distribution.
    /// `None` when the bot has no talents (low-level), the talent
    /// cache hasn't been extracted, or the inference failed. The
    /// frontend resolves to a display name via SPEC_NAMES[class][tab].
    pub spec_tab_index: Option<u8>,
    /// Total talent ranks spent in each tab (0/1/2). Sum across the
    /// array is the bot's total talent points used. `None` mirrors
    /// `spec_tab_index` — present when we managed to classify talents.
    pub talent_distribution: Option<[u32; 3]>,
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
                    c.map, c.zone, c.account, t.account_type, c.online \
             FROM acore_characters.characters c \
             JOIN acore_playerbots.playerbots_account_type t \
                 ON t.account_id = c.account \
             WHERE t.account_type IN (1, 2) \
             ORDER BY c.online DESC, c.level DESC, c.name;",
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
        if parts.len() < 11 {
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
        let online = parts[10].trim() == "1";
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
            online,
            bot_type,
            spec_tab_index: None,
            talent_distribution: None,
        });
    }

    // Enrich with spec inference + per-tab point counts. The talent
    // cache maps spell_id → (tab_index, rank). Each `character_talent.spell`
    // row stores the final-rank spell id for one talent; we look up
    // (tab, rank) and sum rank+1 per tab to get total points spent.
    //
    // `talent_distribution` is the X/Y/Z numbers the UI surfaces on
    // bot cards; `spec_tab_index` is the tab with the most points
    // (i.e. argmax of distribution). Missing cache or missing talents
    // leaves both fields at None.
    if let Ok(cache) = crate::client_assets::load_talent_data() {
        let spell_to_tab_rank: HashMap<i32, (u8, u8)> = cache
            .spell_to_talent
            .iter()
            .filter_map(|(k, v)| k.parse::<i32>().ok().map(|sid| (sid, (v.tab_index, v.rank))))
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
                    if let Some(&(tab, rank)) = spell_to_tab_rank.get(&spell) {
                        let entry = counts.entry(guid).or_insert([0; 3]);
                        if (tab as usize) < entry.len() {
                            // rank is 0-indexed; rank=4 means 5 points
                            // spent on this talent (1st through 5th).
                            entry[tab as usize] += (rank as u32) + 1;
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
                            row.talent_distribution = Some(*c);
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
pub struct AddBotToPartyArgs {
    /// AC class id 1..11 (10 unused). Mapped to the mod's classname
    /// string ("warrior", "paladin", ...) for the addclass call.
    pub class_id: u8,
    /// Bot's target spawn level. mod-playerbots smart-scales by
    /// default but we override explicitly via `.character level`.
    pub target_level: u32,
    /// Wowhead-format talent link from the chosen build. Applied via
    /// `talents apply <link>` whisper.
    pub wowhead_link: String,
    /// The user's character — the bot is added to their group.
    pub character_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddBotToPartyResult {
    /// Name of the bot that joined. None if no new member showed up
    /// within the poll window (caller decides whether to surface the
    /// partial step list as a useful diagnostic).
    pub bot_name: Option<String>,
    /// Per-step status. Lets the UI tell the user "level set OK, but
    /// autogear whisper failed — try whispering `autogear` manually".
    pub steps: Vec<StepResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub label: String,
    pub ok: bool,
    /// Trimmed SOAP / SQL output; empty on success when there's
    /// nothing to surface.
    pub detail: String,
}

/// End-to-end "spawn + configure + add to party" pipeline. Driven by
/// the Add-to-Party wizard's onConfirm.
///
/// Sequence:
///   1. `dml_addclass <player> <classname>` → Eluna runs
///      `.playerbots addclass <classname>` from the player's session,
///      which spawns a bot from the AddClass pool and joins the
///      player's group via mod-playerbots' post-login hook.
///   2. Poll `acore_characters.group_member` for ~6 s, waiting for a
///      new bot to attach to the player's group. Returns the bot's
///      name (the first member who wasn't there before the addclass).
///   3. `.character level <bot> <targetLevel>` — explicit level set,
///      since smart-scale is approximate.
///   4. `dml_whisper <player> <bot> talents apply <link>` — applies
///      the chosen wowhead-format template.
///   5. `dml_whisper <player> <bot> autogear` — equips gear matching
///      the bot's class+spec at its current level.
///   6. `dml_whisper <player> <bot> maintenance` — fills any
///      remaining template entries, skills, spells, reputation.
///
/// Each step's result is captured in `steps` so the UI can render a
/// useful checklist even on partial failure.
#[tauri::command]
pub async fn add_bot_to_party(args: AddBotToPartyArgs) -> Result<AddBotToPartyResult, String> {
    if !(1..=80).contains(&args.target_level) {
        return Err(format!("Level must be 1-80 (got {})", args.target_level));
    }
    let classname = class_id_to_name(args.class_id)
        .ok_or_else(|| format!("Unknown class id {}", args.class_id))?;
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    let mut steps: Vec<StepResult> = Vec::new();

    // Snapshot the player's group BEFORE addclass so we can diff the
    // new member out of the (possibly already-populated) group.
    let player_guid = fetch_character_guid(&container, &args.character_name)?
        .ok_or_else(|| format!("Character '{}' not found", args.character_name))?;
    let before: std::collections::HashSet<u64> =
        fetch_group_member_guids(&container, player_guid)?.into_iter().collect();

    // Step 1 — addclass via Eluna.
    let addclass_cmd = format!(
        "dml_addclass {} {}",
        quote_if_needed(&args.character_name),
        classname
    );
    match soap::execute_command(&addclass_cmd).await {
        Ok(_) => steps.push(StepResult {
            label: format!("Spawn {} bot", classname),
            ok: true,
            detail: String::new(),
        }),
        Err(e) => {
            steps.push(StepResult {
                label: format!("Spawn {} bot", classname),
                ok: false,
                detail: e,
            });
            return Ok(AddBotToPartyResult { bot_name: None, steps });
        }
    }

    // Step 2 — poll for the new group member. Six seconds covers a
    // typical post-login + group-invite-op latency on the Deck.
    let bot = poll_new_group_member(&container, player_guid, &before, 6_000, 250).await;
    let Some(bot_info) = bot else {
        steps.push(StepResult {
            label: "Detect new party member".to_string(),
            ok: false,
            detail: "No new member joined the group within 6 s. The bot may have spawned but not yet attached — check in-game.".to_string(),
        });
        return Ok(AddBotToPartyResult { bot_name: None, steps });
    };
    steps.push(StepResult {
        label: format!("Joined party: {}", bot_info.name),
        ok: true,
        detail: String::new(),
    });

    // Step 3 — explicit level set.
    let level_cmd = format!(
        ".character level {} {}",
        quote_if_needed(&bot_info.name),
        args.target_level
    );
    match soap::execute_command(&level_cmd).await {
        Ok(_) => steps.push(StepResult {
            label: format!("Set level {}", args.target_level),
            ok: true,
            detail: String::new(),
        }),
        Err(e) => steps.push(StepResult {
            label: format!("Set level {}", args.target_level),
            ok: false,
            detail: e,
        }),
    }

    // Step 4 — apply talents via whisper.
    let talents_cmd = format!(
        "dml_whisper {} {} talents apply {}",
        quote_if_needed(&args.character_name),
        quote_if_needed(&bot_info.name),
        args.wowhead_link
    );
    match soap::execute_command(&talents_cmd).await {
        Ok(_) => steps.push(StepResult {
            label: "Apply talents".to_string(),
            ok: true,
            detail: String::new(),
        }),
        Err(e) => steps.push(StepResult {
            label: "Apply talents".to_string(),
            ok: false,
            detail: e,
        }),
    }

    // Step 5 — autogear.
    let gear_cmd = format!(
        "dml_whisper {} {} autogear",
        quote_if_needed(&args.character_name),
        quote_if_needed(&bot_info.name)
    );
    match soap::execute_command(&gear_cmd).await {
        Ok(_) => steps.push(StepResult {
            label: "Apply gear".to_string(),
            ok: true,
            detail: String::new(),
        }),
        Err(e) => steps.push(StepResult {
            label: "Apply gear".to_string(),
            ok: false,
            detail: e,
        }),
    }

    // Step 6 — maintenance pass to fill skills, spells, reputation.
    let maint_cmd = format!(
        "dml_whisper {} {} maintenance",
        quote_if_needed(&args.character_name),
        quote_if_needed(&bot_info.name)
    );
    match soap::execute_command(&maint_cmd).await {
        Ok(_) => steps.push(StepResult {
            label: "Maintenance pass".to_string(),
            ok: true,
            detail: String::new(),
        }),
        Err(e) => steps.push(StepResult {
            label: "Maintenance pass".to_string(),
            ok: false,
            detail: e,
        }),
    }

    Ok(AddBotToPartyResult {
        bot_name: Some(bot_info.name),
        steps,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyMember {
    pub guid: u64,
    pub name: String,
    pub class_id: u32,
    pub race: u32,
    pub level: u32,
    pub online: bool,
    /// True for the group leader (the user's own character). The UI
    /// uses this to identify which row to render as "You".
    pub is_leader: bool,
    /// Primary spec tab (0/1/2). None if the member has no talents.
    pub spec_tab_index: Option<u8>,
    /// Total talent points per tab. None mirrors `spec_tab_index`.
    pub talent_distribution: Option<[u32; 3]>,
}

/// All members of the group the given character is in, including the
/// leader. Returns an empty vec when the character isn't in any group
/// (solo) — the UI then renders all-empty party slots.
///
/// Polled by the My Party tab so additions / kicks / disconnects
/// reflect in real time.
#[tauri::command]
pub fn get_user_party(player_guid: u64) -> Result<Vec<PartyMember>, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    // group_id for the player. Two SQL paths: leader (groups.leaderGuid)
    // or member (group_member.memberGuid). UNION both.
    let group_id_sql = format!(
        "SELECT guid FROM acore_characters.groups WHERE leaderGuid = {pg} \
         UNION SELECT guid FROM acore_characters.group_member WHERE memberGuid = {pg} \
         LIMIT 1;",
        pg = player_guid
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &group_id_sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let group_id: Option<u64> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .and_then(|l| l.trim().parse().ok());
    let Some(group_id) = group_id else {
        return Ok(Vec::new());
    };

    // `group_member` contains every member of the group INCLUDING the
    // leader, so a single join gets us everyone. We compute the
    // is_leader flag by comparing `memberGuid` against `groups.leaderGuid`.
    // An earlier UNION'd version emitted the leader twice — once from
    // `groups`, once from `group_member` — and made the user show up
    // both in the "You" header and one of the bot slots.
    let members_sql = format!(
        "SELECT c.guid, c.name, c.class, c.race, c.level, c.online, \
                CASE WHEN gm.memberGuid = g.leaderGuid THEN 1 ELSE 0 END AS is_leader \
         FROM acore_characters.group_member gm \
         JOIN acore_characters.groups g ON g.guid = gm.guid \
         JOIN acore_characters.characters c ON c.guid = gm.memberGuid \
         WHERE gm.guid = {gid};",
        gid = group_id
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &members_sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let mut members = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 7 {
            continue;
        }
        let Ok(guid) = parts[0].trim().parse::<u64>() else { continue };
        members.push(PartyMember {
            guid,
            name: parts[1].trim().to_string(),
            class_id: parts[2].trim().parse().unwrap_or(0),
            race: parts[3].trim().parse().unwrap_or(0),
            level: parts[4].trim().parse().unwrap_or(0),
            online: parts[5].trim() == "1",
            is_leader: parts[6].trim() == "1",
            spec_tab_index: None,
            talent_distribution: None,
        });
    }

    // Enrich each member with per-tab talent point counts. Same logic
    // as list_playerbots — load the talent cache (spell_id → (tab,
    // rank)) and sum rank+1 per tab over each member's
    // character_talent rows.
    if !members.is_empty() {
        if let Ok(cache) = crate::client_assets::load_talent_data() {
            let spell_to_tab_rank: std::collections::HashMap<i32, (u8, u8)> = cache
                .spell_to_talent
                .iter()
                .filter_map(|(k, v)| k.parse::<i32>().ok().map(|sid| (sid, (v.tab_index, v.rank))))
                .collect();
            let guid_list = members
                .iter()
                .map(|m| m.guid.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let talents_sql = format!(
                "SELECT guid, spell FROM acore_characters.character_talent WHERE guid IN ({});",
                guid_list
            );
            let tout = std::process::Command::new("docker")
                .args([
                    "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e",
                    &talents_sql,
                ])
                .output();
            if let Ok(o) = tout {
                if o.status.success() {
                    let mut counts: std::collections::HashMap<u64, [u32; 3]> =
                        std::collections::HashMap::new();
                    for line in String::from_utf8_lossy(&o.stdout).lines() {
                        let p: Vec<&str> = line.split('\t').collect();
                        if p.len() < 2 {
                            continue;
                        }
                        let Ok(g) = p[0].trim().parse::<u64>() else { continue };
                        let Ok(spell) = p[1].trim().parse::<i32>() else { continue };
                        if let Some(&(tab, rank)) = spell_to_tab_rank.get(&spell) {
                            let entry = counts.entry(g).or_insert([0; 3]);
                            if (tab as usize) < entry.len() {
                                entry[tab as usize] += (rank as u32) + 1;
                            }
                        }
                    }
                    for m in &mut members {
                        if let Some(c) = counts.get(&m.guid) {
                            let (max_idx, &max_val) = c
                                .iter()
                                .enumerate()
                                .max_by_key(|(_, &v)| v)
                                .unwrap_or((0, &0));
                            if max_val > 0 {
                                m.spec_tab_index = Some(max_idx as u8);
                                m.talent_distribution = Some(*c);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(members)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BringOnlineArgs {
    pub bot_name: String,
    pub character_name: String,
}

/// Log an offline party bot back into the world under the user's
/// account. Mechanism: `dml_login <player> <bot>` Eluna script runs
/// `.playerbots bot login <bot>` from the player's session. The
/// mod's post-login hook re-attaches the bot to the master's group
/// automatically (it walks the existing GroupInviteOperation queue).
///
/// Used when the user has been logged out (inactivity kick, manual
/// logout) and returns to find their party bots offline. Iterate
/// from the frontend to bring multiple bots back without bundling
/// a batch command — each call is fast and the per-bot result tells
/// the user which ones failed if any do.
#[tauri::command]
pub async fn bring_bot_online(args: BringOnlineArgs) -> Result<BotActionResult, String> {
    let cmd = format!(
        "dml_login {} {}",
        quote_if_needed(&args.character_name),
        quote_if_needed(&args.bot_name)
    );
    let r = soap::execute_command(&cmd).await?;
    Ok(BotActionResult { output: r.output })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KickBotArgs {
    pub bot_name: String,
}

/// Remove a bot from whatever group they're in, via the
/// `dml_uninvite` Eluna script which calls `Player:RemoveFromGroup`
/// internally. Works whether the bot is online (the common case)
/// or in a stranded ghost-group state.
///
/// No "player" arg — the bot knows its own group; we just tell it
/// to leave. Remaining members get the standard group-update packet.
#[tauri::command]
pub async fn kick_bot_from_party(args: KickBotArgs) -> Result<BotActionResult, String> {
    let cmd = format!("dml_uninvite {}", quote_if_needed(&args.bot_name));
    let r = soap::execute_command(&cmd).await?;
    Ok(BotActionResult { output: r.output })
}

/// AC class id → mod-playerbots addclass keyword. The mod accepts
/// these specific lowercase strings; anything else returns "Error:
/// Invalid Class." from `.playerbots addclass`.
fn class_id_to_name(class_id: u8) -> Option<&'static str> {
    match class_id {
        1 => Some("warrior"),
        2 => Some("paladin"),
        3 => Some("hunter"),
        4 => Some("rogue"),
        5 => Some("priest"),
        6 => Some("dk"),
        7 => Some("shaman"),
        8 => Some("mage"),
        9 => Some("warlock"),
        11 => Some("druid"),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct GroupMember {
    // guid is parsed from SQL but currently only consumed by future
    // kick-from-party logic — keep it populated so the callers don't
    // need to re-query.
    #[allow(dead_code)]
    guid: u64,
    name: String,
}

fn fetch_character_guid(container: &str, name: &str) -> Result<Option<u64>, String> {
    let sql = format!(
        "SELECT guid FROM acore_characters.characters WHERE name = '{}';",
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
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if line.is_empty() {
        return Ok(None);
    }
    line.parse::<u64>()
        .map(Some)
        .map_err(|e| format!("parse guid: {e}"))
}

/// All members of the group containing `player_guid`, INCLUDING the
/// leader. AC's `group_member` table only stores non-leader members;
/// the leader lives on `groups.leaderGuid` and we union it in.
fn fetch_group_member_guids(container: &str, player_guid: u64) -> Result<Vec<u64>, String> {
    let sql = format!(
        "SELECT gm.memberGuid FROM acore_characters.group_member gm \
         INNER JOIN acore_characters.groups g ON g.guid = gm.guid \
         WHERE g.guid IN ( \
           SELECT guid FROM acore_characters.group_member WHERE memberGuid = {pg} \
           UNION SELECT guid FROM acore_characters.groups WHERE leaderGuid = {pg} \
         ) \
         UNION SELECT leaderGuid FROM acore_characters.groups g2 \
         WHERE g2.guid IN ( \
           SELECT guid FROM acore_characters.group_member WHERE memberGuid = {pg} \
           UNION SELECT guid FROM acore_characters.groups WHERE leaderGuid = {pg} \
         );",
        pg = player_guid
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
    let mut out_vec = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Ok(g) = line.trim().parse::<u64>() {
            out_vec.push(g);
        }
    }
    Ok(out_vec)
}

/// Resolve guids → (guid, name) tuples. Returns only the rows that
/// matched a character; missing guids are silently dropped.
fn fetch_member_names(
    container: &str,
    guids: &[u64],
) -> Result<Vec<GroupMember>, String> {
    if guids.is_empty() {
        return Ok(Vec::new());
    }
    let list = guids
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT guid, name FROM acore_characters.characters WHERE guid IN ({});",
        list
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
    let mut out_vec = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        if let Ok(guid) = parts[0].trim().parse::<u64>() {
            out_vec.push(GroupMember {
                guid,
                name: parts[1].trim().to_string(),
            });
        }
    }
    Ok(out_vec)
}

/// Poll the player's group every `interval_ms` for up to `timeout_ms`,
/// returning the first member whose guid wasn't in `before`.
async fn poll_new_group_member(
    container: &str,
    player_guid: u64,
    before: &std::collections::HashSet<u64>,
    timeout_ms: u64,
    interval_ms: u64,
) -> Option<GroupMember> {
    let start = std::time::Instant::now();
    let interval = std::time::Duration::from_millis(interval_ms);
    let deadline = std::time::Duration::from_millis(timeout_ms);
    loop {
        let current = match fetch_group_member_guids(container, player_guid) {
            Ok(v) => v,
            Err(_) => Vec::new(),
        };
        let new_guids: Vec<u64> = current
            .into_iter()
            .filter(|g| *g != player_guid && !before.contains(g))
            .collect();
        if !new_guids.is_empty() {
            if let Ok(members) = fetch_member_names(container, &new_guids) {
                // Prefer the FIRST new member; addclass spawns one at
                // a time so this is unambiguous in practice.
                if let Some(m) = members.into_iter().next() {
                    return Some(m);
                }
            }
        }
        if start.elapsed() >= deadline {
            return None;
        }
        tokio::time::sleep(interval).await;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteBotArgs {
    pub bot_name: String,
    pub character_name: String,
}

/// Trigger the playerbots invite flow for an existing (in-world) bot.
///
/// Mechanism: whisper "invite" to the bot via the Eluna `dml_whisper`
/// bridge. mod-playerbots' `InviteToGroupAction` handles "invite" as a
/// chat command — when whispered TO the bot FROM the player, the bot
/// calls `inviter->GetSession()->HandleGroupInviteOpcode(...)` with
/// the player as target. The player sees a standard in-game group
/// invite popup and clicks accept. (See
/// `mod-playerbots/src/Ai/Base/Actions/InviteToGroupAction.cpp:16`.)
///
/// Both characters must be online for `Player:Whisper` to route the
/// message. Caller (frontend) preflights `is_character_online` on the
/// player; the bot's "in the world" status is implicit from the tile
/// being rendered on the In-the-World tab.
#[tauri::command]
pub async fn invite_bot_to_party(args: InviteBotArgs) -> Result<BotActionResult, String> {
    let cmd = format!(
        "dml_whisper {} {} invite",
        quote_if_needed(&args.character_name),
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
