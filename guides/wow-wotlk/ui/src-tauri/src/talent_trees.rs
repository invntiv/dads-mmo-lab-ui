//! Extract per-class talent tree LAYOUTS to a static JSON bundled with
//! the UI.
//!
//! Why: the in-app talent tree view (player paperdoll + bot detail
//! page) wants the same 3-tab grid you see in-game — talents at
//! specific (row, col) coords, named, with icons, prereqs, and rank
//! ladders. The user's `character_talent` rows then just need to
//! overlay rank counts on this static structure.
//!
//! Source DBCs (3.3.5a):
//!   - TalentTab.dbc — 3 tabs × 10 classes, names + background_file
//!   - Talent.dbc    — every talent: tier/col, up to 9 ranks (spell ids),
//!                     up to 3 prereq talents
//!   - Spell.dbc     — per spell: localized name + spell_icon_id
//!   - SpellIcon.dbc — id → texture filename (we keep just the basename
//!                     so the frontend can resolve via Wowhead's CDN)
//!
//! Output: `<repo>/src/lib/talent-trees.json` — committed and bundled
//! via Vite's static JSON import. Re-run via the dev-only Settings
//! action after a client patch update. The data is otherwise static
//! across WotLK 3.3.5a installs.
//!
//! Companion to:
//!   - `talent_dataset.rs` — the spec-template (Wowhead-link) builds
//!   - `client_assets.rs::extract_talent_data` — the reverse spell→
//!     talent cache used by playerbots.rs

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::PathBuf;

use serde::Serialize;
use wow_dbc::DbcTable;
use wow_dbc::wrath_tables::spell::Spell;
use wow_dbc::wrath_tables::spell_icon::SpellIcon;
use wow_dbc::wrath_tables::talent::Talent;
use wow_dbc::wrath_tables::talent_tab::TalentTab;

use crate::app_settings;
use crate::client_assets::{
    SPELL_ICON_PATH, SPELL_PATH, TALENT_PATH, TALENT_TAB_PATH, loc, open_patch_chain,
};

const DATASET_VERSION: u32 = 1;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TalentTreesDataset {
    version: u32,
    extracted_at: String,
    source_dir: String,
    class_count: usize,
    talent_count: usize,
    classes: Vec<ClassTrees>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClassTrees {
    class_id: u8,
    tabs: Vec<TabTree>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabTree {
    tab_id: i32,
    /// 0/1/2 — the spec axis (Holy/Prot/Ret etc.).
    tab_index: u8,
    name: String,
    /// Spell icon basename for the tab crest (e.g. "spell_holy_holybolt").
    icon_name: String,
    /// Raw DBC value like "BeastMastery". Stored for future use if we
    /// ship ripped client backgrounds; currently the UI uses CSS gradients.
    background_file: String,
    talents: Vec<TalentNode>,
    /// Maximum row/col across this tab — UI sizes the grid from these.
    max_row: u8,
    max_col: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TalentNode {
    /// Talent.dbc primary key.
    id: i32,
    row: u8,
    col: u8,
    name: String,
    icon_name: String,
    /// Raw description from Spell.dbc; contains `$s1` / `$s2` template
    /// placeholders we render verbatim for now.
    description: String,
    max_rank: u8,
    /// spell_id per rank. Index 0 = rank 1.
    rank_spells: Vec<i32>,
    /// Required prior talent on this tree (None for base talents).
    prereq_talent_id: Option<i32>,
    /// Rank required in the prereq talent (1-based). Usually equals
    /// the prereq talent's `max_rank` ("5/5 in X required").
    prereq_rank: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTreesResult {
    pub class_count: usize,
    pub talent_count: usize,
    pub output_path: String,
}

#[tauri::command]
pub fn build_talent_trees() -> Result<BuildTreesResult, String> {
    let settings = app_settings::load();
    let client_dir = settings.wow_client_dir.ok_or_else(|| {
        "No WoW client connected — set one on the dashboard first.".to_string()
    })?;
    let wow_dir = PathBuf::from(&client_dir);

    let mut chain = open_patch_chain(&wow_dir, None)?;

    // 1. SpellIcon.dbc — spell_icon_id → texture basename.
    let icon_bytes = chain
        .read_file(SPELL_ICON_PATH)
        .map_err(|e| format!("read SpellIcon.dbc: {e}"))?;
    let spell_icons = SpellIcon::read(&mut Cursor::new(icon_bytes))
        .map_err(|e| format!("parse SpellIcon.dbc: {e:?}"))?;
    let mut icon_lookup: BTreeMap<i32, String> = BTreeMap::new();
    for row in &spell_icons.rows {
        icon_lookup.insert(row.id.id, basename_lower(&row.texture_filename));
    }

    // 2. Spell.dbc — spell_id → (name, icon_id, description). The big
    //    DBC (~47MB) but we walk it once and only retain the fields
    //    talents need.
    struct SpellMeta {
        name: String,
        icon_id: i32,
        description: String,
    }
    let spell_bytes = chain
        .read_file(SPELL_PATH)
        .map_err(|e| format!("read Spell.dbc: {e}"))?;
    let spells = Spell::read(&mut Cursor::new(spell_bytes))
        .map_err(|e| format!("parse Spell.dbc: {e:?}"))?;
    let mut spell_lookup: BTreeMap<i32, SpellMeta> = BTreeMap::new();
    for row in &spells.rows {
        spell_lookup.insert(
            row.id.id,
            SpellMeta {
                name: loc(&row.name_lang),
                icon_id: row.spell_icon_id.id,
                description: loc(&row.description_lang),
            },
        );
    }

    // 3. TalentTab.dbc — tab_id → tab metadata.
    struct TabMeta {
        class_id: u8,
        tab_index: u8,
        name: String,
        icon_name: String,
        background_file: String,
    }
    let tab_bytes = chain
        .read_file(TALENT_TAB_PATH)
        .map_err(|e| format!("read TalentTab.dbc: {e}"))?;
    let tabs_dbc = TalentTab::read(&mut Cursor::new(tab_bytes))
        .map_err(|e| format!("parse TalentTab.dbc: {e:?}"))?;
    let mut tab_lookup: BTreeMap<i32, TabMeta> = BTreeMap::new();
    for row in &tabs_dbc.rows {
        if row.class_mask == 0 {
            continue;
        }
        let class_id = (row.class_mask as u32).trailing_zeros() as u8 + 1;
        let icon_name = icon_lookup
            .get(&row.spell_icon_id.id)
            .cloned()
            .unwrap_or_default();
        tab_lookup.insert(
            row.id.id,
            TabMeta {
                class_id,
                tab_index: row.order_index as u8,
                name: loc(&row.name_lang),
                icon_name,
                background_file: row.background_file.clone(),
            },
        );
    }

    // 4. Talent.dbc — walk every talent, group by (class, tab_index).
    let talent_bytes = chain
        .read_file(TALENT_PATH)
        .map_err(|e| format!("read Talent.dbc: {e}"))?;
    let talents_dbc = Talent::read(&mut Cursor::new(talent_bytes))
        .map_err(|e| format!("parse Talent.dbc: {e:?}"))?;

    /// Accumulator per (class_id, tab_index): tab metadata + growing
    /// talent list + running max row/col.
    struct TabAccum {
        tab_id: i32,
        name: String,
        icon_name: String,
        background_file: String,
        talents: Vec<TalentNode>,
        max_row: u8,
        max_col: u8,
    }
    let mut grouped: BTreeMap<(u8, u8), TabAccum> = BTreeMap::new();

    for talent in &talents_dbc.rows {
        let Some(meta) = tab_lookup.get(&talent.tab_id) else {
            continue;
        };

        let rank_spells: Vec<i32> = talent
            .spell_rank
            .iter()
            .copied()
            .filter(|&s| s != 0)
            .collect();
        if rank_spells.is_empty() {
            continue;
        }

        // Talent display info comes from the rank-1 spell.
        let first_spell = rank_spells[0];
        let Some(spell_meta) = spell_lookup.get(&first_spell) else {
            continue;
        };
        let icon_name = icon_lookup
            .get(&spell_meta.icon_id)
            .cloned()
            .unwrap_or_default();

        // First non-zero prereq pair. Talent.dbc has up to 3 prereq
        // slots; classic WotLK trees only use one.
        let mut prereq_talent_id: Option<i32> = None;
        let mut prereq_rank: Option<u8> = None;
        for (i, &pid) in talent.prereq_talent.iter().enumerate() {
            if pid != 0 {
                prereq_talent_id = Some(pid);
                let r = talent.prereq_rank[i];
                // DBC stores 0-based rank index ("rank 0" = need 1
                // point). We surface 1-based ("need 1+ point").
                prereq_rank = if r >= 0 { Some((r + 1) as u8) } else { None };
                break;
            }
        }

        let row = talent.tier_id as u8;
        let col = talent.column_index as u8;

        let entry = grouped
            .entry((meta.class_id, meta.tab_index))
            .or_insert_with(|| TabAccum {
                tab_id: talent.tab_id,
                name: meta.name.clone(),
                icon_name: meta.icon_name.clone(),
                background_file: meta.background_file.clone(),
                talents: Vec::new(),
                max_row: 0,
                max_col: 0,
            });
        if row > entry.max_row {
            entry.max_row = row;
        }
        if col > entry.max_col {
            entry.max_col = col;
        }
        entry.talents.push(TalentNode {
            id: talent.id.id,
            row,
            col,
            name: spell_meta.name.clone(),
            icon_name,
            description: spell_meta.description.clone(),
            max_rank: rank_spells.len() as u8,
            rank_spells,
            prereq_talent_id,
            prereq_rank,
        });
    }

    // 5. Flatten + sort.
    let mut classes_map: BTreeMap<u8, Vec<TabTree>> = BTreeMap::new();
    for ((class_id, tab_index), mut acc) in grouped {
        acc.talents.sort_by_key(|t| (t.row, t.col));
        classes_map.entry(class_id).or_default().push(TabTree {
            tab_id: acc.tab_id,
            tab_index,
            name: acc.name,
            icon_name: acc.icon_name,
            background_file: acc.background_file,
            talents: acc.talents,
            max_row: acc.max_row,
            max_col: acc.max_col,
        });
    }
    let mut classes: Vec<ClassTrees> = Vec::new();
    for (class_id, mut tabs) in classes_map {
        tabs.sort_by_key(|t| t.tab_index);
        classes.push(ClassTrees { class_id, tabs });
    }

    let talent_count: usize = classes
        .iter()
        .flat_map(|c| c.tabs.iter())
        .map(|t| t.talents.len())
        .sum();
    let class_count = classes.len();

    let dataset = TalentTreesDataset {
        version: DATASET_VERSION,
        extracted_at: now_iso(),
        source_dir: client_dir,
        class_count,
        talent_count,
        classes,
    };

    let json = serde_json::to_string_pretty(&dataset)
        .map_err(|e| format!("serialize dataset: {e}"))?;
    let output_path = output_path();
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    std::fs::write(&output_path, json)
        .map_err(|e| format!("write {}: {}", output_path.display(), e))?;

    Ok(BuildTreesResult {
        class_count,
        talent_count,
        output_path: output_path.display().to_string(),
    })
}

fn basename_lower(p: &str) -> String {
    // SpellIcon.texture_filename is typically
    // "Interface\\Icons\\spell_nature_ravenform" (no extension).
    // Wowhead's CDN serves icons by lowercase basename.
    p.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("src/lib/talent-trees.json"))
        .expect("CARGO_MANIFEST_DIR should have a parent")
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let secs_today = secs % 86_400;
    let (y, m, d) = days_to_ymd(days as i64);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        secs_today / 3600,
        (secs_today % 3600) / 60,
        secs_today % 60
    )
}

fn days_to_ymd(mut days: i64) -> (i32, u32, u32) {
    days += 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let doe = (days - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year as i32, m as u32, d as u32)
}
