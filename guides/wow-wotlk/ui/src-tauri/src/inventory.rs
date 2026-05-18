//! Inventory commands for the Inventory page.
//!
//! Two operations the page needs:
//!  - `search_items` — fuzzy-match the worldserver's `item_template`
//!    table by name. Used to populate the browse / search panel.
//!  - `send_item_to_character` — deliver an item to a character's
//!    in-game mail via SOAP `.send items` (verified working without an
//!    in-world session, since the GM-target context isn't needed).
//!
//! Why mail rather than `.additem`: `.additem` requires a SELECTED
//! in-world target, which SOAP doesn't have. `.send items` only needs
//! the recipient's name and works whether the character is online or
//! offline.

use serde::{Deserialize, Serialize};

use crate::soap;

/// Pared-down `item_template` projection. We expose the fields the UI
/// actually displays — leaving the 100+ other columns in the table
/// alone. The icon name isn't in the SQL schema (it lives in the
/// `ItemDisplayInfo` DBC) so the frontend falls back to a Wowhead link
/// for the visual.
#[derive(Debug, Serialize, Clone)]
pub struct ItemSummary {
    pub entry: u32,
    pub name: String,
    /// 0..7 — Poor / Common / Uncommon / Rare / Epic / Legendary /
    /// Artifact / Heirloom.
    pub quality: u32,
    /// AC item `class` (Weapon / Armor / Container / Consumable / ...).
    pub class: u32,
    /// AC item `subclass` — context dependent on `class`.
    pub subclass: u32,
    pub inventory_type: u32,
    pub item_level: u32,
    pub required_level: u32,
    pub display_id: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItemsArgs {
    pub query: String,
    /// 0 means "all" — match the AC item.class enum otherwise.
    pub class: Option<u32>,
    pub quality_min: Option<u32>,
    pub limit: Option<u32>,
    /// When true (default), filter out rows whose name contains the
    /// substring "DEPRECATED" — Blizzard's marker for old/reworked
    /// items that aren't obtainable in-game anymore (and shouldn't
    /// crowd search results).
    pub hide_deprecated: Option<bool>,
}

/// Search by name (case-insensitive LIKE), optionally filtered by class
/// and minimum quality. Capped at 100 results by default to keep the
/// table snappy; raise via `limit` from the UI if needed.
#[tauri::command]
pub fn search_items(args: SearchItemsArgs) -> Result<Vec<ItemSummary>, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    let limit = args.limit.unwrap_or(100).min(500);
    let query_sanitized = args.query.replace('\'', "''");
    let mut where_clauses: Vec<String> = Vec::new();
    if !query_sanitized.is_empty() {
        where_clauses.push(format!("name LIKE '%{}%'", query_sanitized));
    }
    if let Some(c) = args.class {
        if c > 0 {
            where_clauses.push(format!("class = {}", c));
        }
    }
    if let Some(qmin) = args.quality_min {
        where_clauses.push(format!("Quality >= {}", qmin));
    }
    // Filter out DEPRECATED rows by default. The SQL pattern is
    // case-sensitive against the canonical "DEPRECATED" suffix Blizzard
    // uses (e.g. `Thunderfury, Blessed Blade of the Windseeker DEPRECATED`).
    if args.hide_deprecated.unwrap_or(true) {
        where_clauses.push("name NOT LIKE '%DEPRECATED%'".into());
    }
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT entry, name, Quality, class, subclass, InventoryType, ItemLevel, RequiredLevel, displayid \
         FROM acore_world.item_template \
         {where_sql} \
         ORDER BY Quality DESC, ItemLevel DESC, name ASC \
         LIMIT {limit};"
    );

    let out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 9 {
            continue;
        }
        let parse_u32 = |s: &str| s.trim().parse::<u32>().ok();
        let (Some(entry), Some(quality), Some(class), Some(subclass), Some(inv), Some(ilvl), Some(rlvl), Some(disp)) = (
            parse_u32(parts[0]),
            parse_u32(parts[2]),
            parse_u32(parts[3]),
            parse_u32(parts[4]),
            parse_u32(parts[5]),
            parse_u32(parts[6]),
            parse_u32(parts[7]),
            parse_u32(parts[8]),
        ) else {
            continue;
        };
        rows.push(ItemSummary {
            entry,
            name: parts[1].trim().to_string(),
            quality,
            class,
            subclass,
            inventory_type: inv,
            item_level: ilvl,
            required_level: rlvl,
            display_id: disp,
        });
    }
    Ok(rows)
}

/// Full item-template row projected for the WoW-style tooltip.
/// Snake-case in Rust; serializes to camelCase for the frontend.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetails {
    pub entry: u32,
    pub name: String,
    pub quality: u32,
    pub display_id: u32,
    /// 0=None, 1=BoP (when picked up), 2=BoE (when equipped),
    /// 3=BoU (when used), 4=Quest.
    pub bonding: u32,
    pub flags: u32,
    pub item_level: u32,
    pub required_level: u32,
    /// 0–28; mapped to "Head"/"Neck"/"One-Hand"/etc. on the frontend.
    pub inventory_type: u32,
    pub class: u32,
    pub subclass: u32,
    /// >0 = unique-equipped count cap (mostly `1` for Unique items).
    pub max_count: i32,
    pub max_durability: u32,
    pub armor: u32,
    pub dmg_min1: f32,
    pub dmg_max1: f32,
    /// 0=Physical, 1=Holy, 2=Fire, 3=Nature, 4=Frost, 5=Shadow, 6=Arcane.
    pub dmg_type1: u32,
    pub dmg_min2: f32,
    pub dmg_max2: f32,
    pub dmg_type2: u32,
    /// Attack speed in ms.
    pub delay: u32,
    pub holy_res: i32,
    pub fire_res: i32,
    pub nature_res: i32,
    pub frost_res: i32,
    pub shadow_res: i32,
    pub arcane_res: i32,
    /// Up to 10 (statType, statValue) pairs; only non-zero values are
    /// included. statType maps to ItemModType (3=Agility, 4=Strength,
    /// 7=Stamina, etc.).
    pub stats: Vec<ItemStat>,
    /// Up to 5 item-attached spells (e.g. proc / on-use abilities).
    /// Only entries with spell_id > 0 are returned.
    pub spells: Vec<ItemSpell>,
    /// Foreign key into ItemSet.dbc; 0 = no set.
    pub item_set: u32,
    /// Sell price in copper.
    pub sell_price: u32,
    /// Flavor text shown italicized at the bottom of the tooltip.
    pub description: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemStat {
    pub stat_type: u32,
    pub value: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemSpell {
    pub spell_id: u32,
    /// 0=Use, 1=Equip, 2=Chance on hit, 4=Soulstone, 5=Use (no delay),
    /// 6=Learn (recipe).
    pub trigger: u32,
    /// Cooldown in ms (for Use trigger). 0 = no cooldown.
    pub cooldown_ms: i32,
}

#[tauri::command]
pub fn get_item_details(entry: u32) -> Result<ItemDetails, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;

    // Pull every column the tooltip cares about in one shot. Tab-
    // separated mysql -B output, parsed below into the typed struct.
    let columns: &[&str] = &[
        "entry", "name", "Quality", "displayid", "bonding", "Flags",
        "ItemLevel", "RequiredLevel", "InventoryType", "class", "subclass",
        "maxcount", "MaxDurability", "armor",
        "dmg_min1", "dmg_max1", "dmg_type1",
        "dmg_min2", "dmg_max2", "dmg_type2", "delay",
        "holy_res", "fire_res", "nature_res", "frost_res", "shadow_res", "arcane_res",
        "stat_type1", "stat_value1", "stat_type2", "stat_value2",
        "stat_type3", "stat_value3", "stat_type4", "stat_value4",
        "stat_type5", "stat_value5", "stat_type6", "stat_value6",
        "stat_type7", "stat_value7", "stat_type8", "stat_value8",
        "stat_type9", "stat_value9", "stat_type10", "stat_value10",
        "spellid_1", "spelltrigger_1", "spellcooldown_1",
        "spellid_2", "spelltrigger_2", "spellcooldown_2",
        "spellid_3", "spelltrigger_3", "spellcooldown_3",
        "spellid_4", "spelltrigger_4", "spellcooldown_4",
        "spellid_5", "spelltrigger_5", "spellcooldown_5",
        "itemset", "SellPrice", "description",
    ];
    let select_list = columns.join(", ");
    let sql = format!(
        "SELECT {} FROM acore_world.item_template WHERE entry = {};",
        select_list, entry
    );

    let out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql])
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
        format!("no item_template row for entry {entry}")
    })?;
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < columns.len() {
        return Err(format!(
            "expected {} columns, got {}",
            columns.len(),
            parts.len()
        ));
    }

    // Tight little parse helpers — the mysql -N -B output uses literal
    // "NULL" for null fields, but item_template has NOT NULL on every
    // column we ask for, so we treat parse failures as 0.
    let mut i = 0;
    let mut next = || {
        let v = parts.get(i).copied().unwrap_or("");
        i += 1;
        v
    };
    let u32_at = |s: &str| s.trim().parse::<u32>().unwrap_or(0);
    let i32_at = |s: &str| s.trim().parse::<i32>().unwrap_or(0);
    let f32_at = |s: &str| s.trim().parse::<f32>().unwrap_or(0.0);

    let entry_v = u32_at(next());
    let name = next().trim().to_string();
    let quality = u32_at(next());
    let display_id = u32_at(next());
    let bonding = u32_at(next());
    let flags = u32_at(next());
    let item_level = u32_at(next());
    let required_level = u32_at(next());
    let inventory_type = u32_at(next());
    let class = u32_at(next());
    let subclass = u32_at(next());
    let max_count = i32_at(next());
    let max_durability = u32_at(next());
    let armor = u32_at(next());
    let dmg_min1 = f32_at(next());
    let dmg_max1 = f32_at(next());
    let dmg_type1 = u32_at(next());
    let dmg_min2 = f32_at(next());
    let dmg_max2 = f32_at(next());
    let dmg_type2 = u32_at(next());
    let delay = u32_at(next());
    let holy_res = i32_at(next());
    let fire_res = i32_at(next());
    let nature_res = i32_at(next());
    let frost_res = i32_at(next());
    let shadow_res = i32_at(next());
    let arcane_res = i32_at(next());

    let mut stats = Vec::new();
    for _ in 0..10 {
        let stat_type = u32_at(next());
        let value = i32_at(next());
        if value != 0 {
            stats.push(ItemStat { stat_type, value });
        }
    }

    let mut spells = Vec::new();
    for _ in 0..5 {
        let spell_id = u32_at(next());
        let trigger = u32_at(next());
        let cooldown_ms = i32_at(next());
        if spell_id > 0 {
            spells.push(ItemSpell { spell_id, trigger, cooldown_ms });
        }
    }

    let item_set = u32_at(next());
    let sell_price = u32_at(next());
    let description = next().trim().to_string();

    Ok(ItemDetails {
        entry: entry_v,
        name,
        quality,
        display_id,
        bonding,
        flags,
        item_level,
        required_level,
        inventory_type,
        class,
        subclass,
        max_count,
        max_durability,
        armor,
        dmg_min1,
        dmg_max1,
        dmg_type1,
        dmg_min2,
        dmg_max2,
        dmg_type2,
        delay,
        holy_res,
        fire_res,
        nature_res,
        frost_res,
        shadow_res,
        arcane_res,
        stats,
        spells,
        item_set,
        sell_price,
        description,
    })
}

/// Tiny projection used for set-member name lookups and any other
/// "I just need the name + quality color for this entry id" surface.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemMini {
    pub entry: u32,
    pub name: String,
    pub quality: u32,
}

/// Fetch (name, quality) for many item entries in one DB roundtrip.
/// The Item Tooltip uses this to render set-member names when an item
/// belongs to an ItemSet — a tooltip with N pieces does one query of
/// N rows instead of N separate get_item_details calls. Order of the
/// returned list matches insertion order in the DB (entry asc) — the
/// frontend re-sorts to match the original input order if needed.
#[tauri::command]
pub fn get_items_by_entries(entries: Vec<u32>) -> Result<Vec<ItemMini>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;
    // Cap aggressively — a single set has ≤17 items per the ItemSet.dbc
    // array, so even a malicious caller can't really pile this up.
    let id_list = entries
        .iter()
        .take(64)
        .map(|e| e.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT entry, name, Quality FROM acore_world.item_template WHERE entry IN ({id_list});"
    );
    let out = std::process::Command::new("docker")
        .args(["exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let Some(entry) = parts[0].trim().parse::<u32>().ok() else {
            continue;
        };
        let Some(quality) = parts[2].trim().parse::<u32>().ok() else {
            continue;
        };
        rows.push(ItemMini {
            entry,
            name: parts[1].trim().to_string(),
            quality,
        });
    }
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendItemArgs {
    pub character_name: String,
    pub item_id: u32,
    pub count: u32,
    pub subject: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SendItemResult {
    pub output: String,
}

/// Send an item to a character via in-game mail. The character can be
/// online or offline. AC's `.send items` syntax:
///   .send items "Name" "Subject" "Body" itemid:count
/// We provide friendly defaults for subject/body so the user only has
/// to pick a recipient + item.
#[tauri::command]
pub async fn send_item_to_character(args: SendItemArgs) -> Result<SendItemResult, String> {
    if args.count == 0 {
        return Err("count must be >= 1".into());
    }
    let subject = args.subject.unwrap_or_else(|| "A gift".to_string());
    let body = args
        .body
        .unwrap_or_else(|| "Sent from Dad's MMO Lab.".to_string());
    let cmd = format!(
        ".send items {recipient} \"{subject}\" \"{body}\" {item}:{count}",
        recipient = quote_if_needed(&args.character_name),
        subject = sanitize_quoted(&subject),
        body = sanitize_quoted(&body),
        item = args.item_id,
        count = args.count,
    );
    let r = soap::execute_command(&cmd).await?;
    Ok(SendItemResult { output: r.output })
}

// ── helpers ─────────────────────────────────────────────────────────

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

fn quote_if_needed(s: &str) -> String {
    if s.chars().any(|c| c.is_whitespace()) {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

/// Strip embedded `"` so a user-supplied subject can't break the quoted
/// command argument. AC's command parser doesn't honor `\"`, so the
/// safest move is to replace them with a single quote.
fn sanitize_quoted(s: &str) -> String {
    s.replace('"', "'")
}
