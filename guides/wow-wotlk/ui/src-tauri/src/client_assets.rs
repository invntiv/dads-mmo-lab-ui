//! Extract item-icon metadata from the user's WoW 3.3.5a client.
//!
//! Why: the worldserver's `item_template` table has `displayid` but not
//! the icon NAME (e.g. "inv_sword_84"). Icon names live in
//! `DBFilesClient/ItemDisplayInfo.dbc` inside the client's MPQ archives.
//! Once we have the `displayid → icon` mapping, the frontend can render
//! `https://wow.zamimg.com/images/wow/icons/medium/<icon>.jpg` (Wowhead
//! CDN, publicly served) for a Wowhead-quality visual without scraping
//! Wowhead itself.
//!
//! Workflow:
//!  1. User picks their WoW install dir via `wow_client::set_wow_directory`.
//!  2. User clicks "Enrich icons" on the Inventory page → calls
//!     `extract_item_icons`. We open the patch-chain of MPQs in priority
//!     order (later patches override earlier ones), pull
//!     `ItemDisplayInfo.dbc`, parse it, and cache the result as JSON in
//!     the app config dir.
//!  3. The Inventory screen calls `load_item_icon_map` once on mount and
//!     uses the cached map for all subsequent renders. Cache is small
//!     (~40k entries × ~30 chars = ~1.2MB JSON).

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use wow_dbc::DbcTable;
use wow_dbc::wrath_tables::item_display_info::ItemDisplayInfo;
use wow_dbc::wrath_tables::item_set::ItemSet;
use wow_dbc::wrath_tables::spell::Spell;
use wow_dbc::wrath_tables::spell_icon::SpellIcon;
use wow_mpq::PatchChain;

use crate::app_settings;

/// Base MPQs in 3.3.5a priority order (lowest-priority first). Later
/// patches override earlier ones; `wow_mpq::PatchChain` does the
/// merging. See `project-client-data-layout` memory for the full map.
const BASE_MPQS: &[&str] = &[
    "common.MPQ",
    "common-2.MPQ",
    "expansion.MPQ",
    "lichking.MPQ",
    "patch.MPQ",
    "patch-2.MPQ",
    "patch-3.MPQ",
];

/// Locale MPQs (English). Added at HIGHEST priority so localized DBC
/// rows (Spell.dbc with English text, Item.dbc with translated names,
/// etc.) shadow the placeholder rows in the base MPQs. Without these
/// our spell/item-set extractor returns empty `name`/`description`
/// strings since the base DBCs ship those columns blank.
const LOCALE_DIR: &str = "enUS";
const LOCALE_MPQS: &[&str] = &[
    "base-enUS.MPQ",
    "locale-enUS.MPQ",
    "expansion-locale-enUS.MPQ",
    "lichking-locale-enUS.MPQ",
    "patch-enUS.MPQ",
    "patch-enUS-2.MPQ",
    "patch-enUS-3.MPQ",
];

/// DBC paths inside the MPQ. Note the backslash separator — MPQ
/// archive names use Windows-style paths and `wow_mpq` doesn't
/// normalize.
const ITEM_DISPLAY_INFO_PATH: &str = "DBFilesClient\\ItemDisplayInfo.dbc";
const SPELL_PATH: &str = "DBFilesClient\\Spell.dbc";
const SPELL_ICON_PATH: &str = "DBFilesClient\\SpellIcon.dbc";
const ITEM_SET_PATH: &str = "DBFilesClient\\ItemSet.dbc";

/// Open the standard 3.3.5a patch-chain. Skips MPQs that aren't
/// present (some clients ship without certain patches). Returns an
/// error if NO base MPQs are present, since that means the user
/// pointed us at the wrong directory.
fn open_patch_chain(wow_dir: &Path) -> Result<PatchChain, String> {
    let data_dir = wow_dir.join("Data");
    if !data_dir.is_dir() {
        return Err(format!(
            "WoW Data directory not found at {} — is this the right install dir?",
            data_dir.display()
        ));
    }

    let mut chain = PatchChain::new();
    let mut priority = 0i32;
    let mut added = 0;
    for name in BASE_MPQS {
        let path = data_dir.join(name);
        if !path.exists() {
            continue;
        }
        chain
            .add_archive(&path, priority)
            .map_err(|e| format!("open {}: {}", path.display(), e))?;
        priority += 1;
        added += 1;
    }
    // Locale MPQs go LAST (highest priority) so their localized DBC
    // text shadows the empty base rows.
    let locale_root = data_dir.join(LOCALE_DIR);
    for name in LOCALE_MPQS {
        let path = locale_root.join(name);
        if !path.exists() {
            continue;
        }
        chain
            .add_archive(&path, priority)
            .map_err(|e| format!("open {}: {}", path.display(), e))?;
        priority += 1;
    }
    if added == 0 {
        return Err(format!(
            "No MPQ archives found in {}. Make sure this is your WoW install root (one level above Data/).",
            data_dir.display()
        ));
    }
    Ok(chain)
}

/// Pick the best non-empty locale string out of an ExtendedLocalizedString.
/// 3.3.5a clients write English to `en_gb`; some forks use `en_us`. Fall
/// back across both.
fn loc(s: &wow_dbc::ExtendedLocalizedString) -> String {
    if !s.en_gb.is_empty() {
        return s.en_gb.clone();
    }
    // Order matches our locale chain (English first, then closest
    // neighbors). Bail with empty string if every slot is blank —
    // caller decides whether that's a skip-row signal.
    for candidate in [&s.fr_fr, &s.de_de, &s.es_es, &s.it_it] {
        if !candidate.is_empty() {
            return candidate.clone();
        }
    }
    String::new()
}

/// JSON shape persisted to disk. Versioned so we can evolve the schema
/// without breaking older caches.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IconCache {
    pub version: u32,
    /// ISO-8601 UTC timestamp of when the extraction ran. Surfaced in
    /// the UI so the user knows whether to re-extract after patching.
    pub extracted_at: String,
    /// Path the cache was extracted from — lets us detect "user
    /// changed clients" and offer a re-extract.
    pub source_dir: String,
    pub count: u32,
    /// displayid → icon-name (lowercased, no extension). The frontend
    /// renders `https://wow.zamimg.com/images/wow/icons/medium/<v>.jpg`.
    /// Keys are strings because serde_json serializes integer keys as
    /// strings anyway, and BTreeMap keeps the JSON file diff-friendly.
    pub icons: BTreeMap<String, String>,
}

const CACHE_VERSION: u32 = 1;

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum IconCacheStatus {
    /// User hasn't connected a WoW client yet — the Inventory page
    /// should point them at the WowClientCard first.
    NoClient,
    /// Client connected but no cache extracted yet — show the
    /// "Enrich icons" call-to-action.
    NotExtracted { client_dir: String },
    /// Cache exists. `stale` is true when the source_dir doesn't match
    /// the currently-selected client dir (the user pointed at a different
    /// install), prompting a re-extract.
    Ready {
        count: u32,
        extracted_at: String,
        source_dir: String,
        stale: bool,
    },
}

#[derive(Serialize, Debug, Clone)]
pub struct ExtractResult {
    pub count: u32,
    pub extracted_at: String,
}

fn cache_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("dads-mmo-lab").join("item-icons.json"))
}

fn now_iso() -> String {
    // tiny chrono-less ISO formatter — we already avoid pulling in
    // chrono elsewhere in this crate.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days_since_epoch = (secs / 86_400) as i64;
    let sec_of_day = secs % 86_400;
    let h = sec_of_day / 3600;
    let m = (sec_of_day % 3600) / 60;
    let s = sec_of_day % 60;
    // Convert days since 1970-01-01 to Y/M/D via Hinnant's civil_from_days
    let (y, mo, d) = civil_from_days(days_since_epoch);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

/// Howard Hinnant's date algorithm — days-since-1970 → (year, month, day).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z / 146097 } else { (z - 146096) / 146097 };
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

fn load_cache_file() -> Option<IconCache> {
    let path = cache_path()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn save_cache_file(cache: &IconCache) -> Result<(), String> {
    let path = cache_path()
        .ok_or_else(|| "Could not resolve config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string(cache)
        .map_err(|e| format!("serialize cache: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn get_icon_cache_status() -> IconCacheStatus {
    let settings = app_settings::load();
    let client_dir = match settings.wow_client_dir {
        Some(d) => d,
        None => return IconCacheStatus::NoClient,
    };
    let cache = load_cache_file();
    match cache {
        None => IconCacheStatus::NotExtracted { client_dir },
        Some(c) if c.version != CACHE_VERSION => IconCacheStatus::NotExtracted { client_dir },
        Some(c) => IconCacheStatus::Ready {
            count: c.count,
            extracted_at: c.extracted_at,
            stale: c.source_dir != client_dir,
            source_dir: c.source_dir,
        },
    }
}

/// Async wrapper around the CPU-heavy icon extraction. MPQ decompression
/// + DBC parse blocks for several seconds on a real client, which would
/// freeze the Tauri runtime thread if we ran it synchronously. We hop
/// onto the blocking pool via `spawn_blocking` so the renderer stays
/// responsive and progress events can stream through.
#[tauri::command]
pub async fn extract_item_icons(window: tauri::Window) -> Result<ExtractResult, String> {
    let settings = app_settings::load();
    let client_dir = settings
        .wow_client_dir
        .ok_or_else(|| "No WoW client connected — set one on the dashboard first.".to_string())?;

    tokio::task::spawn_blocking(move || extract_item_icons_blocking(window, client_dir))
        .await
        .map_err(|e| format!("blocking task join: {e}"))?
}

fn extract_item_icons_blocking(window: tauri::Window, client_dir: String) -> Result<ExtractResult, String> {
    emit_progress(&window, "icons", "Opening MPQ patch chain…", None);
    let mut chain = open_patch_chain(Path::new(&client_dir))?;

    emit_progress(&window, "icons", "Reading ItemDisplayInfo.dbc…", None);
    let bytes = chain
        .read_file(ITEM_DISPLAY_INFO_PATH)
        .map_err(|e| format!("read {ITEM_DISPLAY_INFO_PATH} from MPQs: {e}"))?;

    emit_progress(&window, "icons", "Parsing DBC rows…", None);
    let dbc = ItemDisplayInfo::read(&mut Cursor::new(bytes))
        .map_err(|e| format!("parse ItemDisplayInfo.dbc: {e:?}"))?;
    let mut icons = BTreeMap::new();
    for row in &dbc.rows {
        let icon = row.inventory_icon[0].trim();
        if icon.is_empty() {
            continue;
        }
        let id = row.id.id;
        if id <= 0 {
            continue;
        }
        icons.insert((id as u32).to_string(), icon.to_ascii_lowercase());
    }

    let count = icons.len() as u32;
    let extracted_at = now_iso();
    emit_progress(
        &window,
        "icons",
        "Writing cache…",
        Some(format!("{} icons", count)),
    );
    let cache = IconCache {
        version: CACHE_VERSION,
        extracted_at: extracted_at.clone(),
        source_dir: client_dir,
        count,
        icons,
    };
    save_cache_file(&cache)?;
    emit_progress(
        &window,
        "icons",
        "Done.",
        Some(format!("{} icons cached", count)),
    );
    Ok(ExtractResult { count, extracted_at })
}

/// Return the full icon map for the frontend. Called once after the
/// Inventory page sees `Ready` status — the frontend keeps it in memory
/// and looks up by displayid as it renders item tiles.
#[tauri::command]
pub fn load_item_icon_map() -> Result<BTreeMap<String, String>, String> {
    let cache = load_cache_file()
        .ok_or_else(|| "No icon cache present yet — run extract first.".to_string())?;
    Ok(cache.icons)
}

// ── Progress events ─────────────────────────────────────────────────
// Emitted from inside `spawn_blocking` so the Settings page can show
// the current phase (Opening MPQs / Reading Spell.dbc / etc.) instead
// of a generic "Extracting…" spinner. Frontend listens on
// `client_assets:progress`.

#[derive(Serialize, Clone, Debug)]
struct ExtractProgress<'a> {
    /// Which extractor this belongs to: "icons" or "tooltips".
    kind: &'a str,
    /// Short user-facing phase label, e.g. "Reading Spell.dbc…".
    phase: &'a str,
    /// Optional detail, e.g. "27,234 spells found".
    detail: Option<String>,
}

fn emit_progress(window: &tauri::Window, kind: &str, phase: &str, detail: Option<String>) {
    use tauri::Emitter;
    let _ = window.emit(
        "client_assets:progress",
        ExtractProgress { kind, phase, detail },
    );
}

// ── Tooltip data extraction ─────────────────────────────────────────
// Pulls Spell.dbc + SpellIcon.dbc + ItemSet.dbc into a single JSON
// cache. The frontend uses this to render Wowhead-style tooltips:
//   - Equip: / Use: / Chance on hit: lines come from Spell.description
//   - Set bonuses (name + members + bonus spell text) come from ItemSet
//   - Spell icons (different table from item icons!) come from SpellIcon
//
// Why one cache for two DBC tables: a single tooltip render usually
// needs both (e.g. a set piece needs both the per-slot spell descriptions
// and the set-bonus spell descriptions). One IPC load on mount, then
// every tooltip looks up in-memory.

const TOOLTIP_CACHE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SpellEntry {
    pub name: String,
    /// Tooltip prose. May contain unresolved `$1s` / `$2d` / etc.
    /// variables — the frontend renders them as-is for v1; future
    /// work can substitute via SpellDescriptionVariables.dbc + the
    /// spell's own effect_base_points.
    pub description: String,
    /// Alternative description used when the spell is the active
    /// aura on the player. Items rarely care; included for the future
    /// Spellbook page.
    pub aura_description: String,
    /// Wowhead-compatible icon name (lowercased, no extension).
    /// Resolved by joining `spell_icon_id` against SpellIcon.dbc.
    /// Empty when the spell has no icon (passive auras, internal etc.).
    pub icon: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SetBonusEntry {
    /// Number of set pieces required to trigger this bonus.
    pub threshold: u32,
    /// Spell whose description text is shown as the bonus.
    pub spell_id: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ItemSetEntry {
    pub name: String,
    /// Member item entry IDs. Trimmed of trailing 0s (the DBC fixes
    /// the array at 17 slots).
    pub items: Vec<u32>,
    pub bonuses: Vec<SetBonusEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TooltipCache {
    pub version: u32,
    pub extracted_at: String,
    pub source_dir: String,
    pub spell_count: u32,
    pub set_count: u32,
    pub spells: BTreeMap<String, SpellEntry>,
    pub sets: BTreeMap<String, ItemSetEntry>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TooltipCacheStatus {
    NoClient,
    NotExtracted {
        client_dir: String,
    },
    Ready {
        spell_count: u32,
        set_count: u32,
        extracted_at: String,
        source_dir: String,
        stale: bool,
    },
}

#[derive(Serialize, Debug, Clone)]
pub struct TooltipExtractResult {
    pub spell_count: u32,
    pub set_count: u32,
    pub extracted_at: String,
}

fn tooltip_cache_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("dads-mmo-lab").join("tooltip-data.json"))
}

fn load_tooltip_cache_file() -> Option<TooltipCache> {
    let path = tooltip_cache_path()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn save_tooltip_cache_file(cache: &TooltipCache) -> Result<(), String> {
    let path = tooltip_cache_path()
        .ok_or_else(|| "Could not resolve config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    // Compact JSON — pretty-printing 30k+ spells balloons the file.
    let json = serde_json::to_string(cache)
        .map_err(|e| format!("serialize tooltip cache: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn get_tooltip_cache_status() -> TooltipCacheStatus {
    let settings = app_settings::load();
    let client_dir = match settings.wow_client_dir {
        Some(d) => d,
        None => return TooltipCacheStatus::NoClient,
    };
    match load_tooltip_cache_file() {
        None => TooltipCacheStatus::NotExtracted { client_dir },
        Some(c) if c.version != TOOLTIP_CACHE_VERSION => {
            TooltipCacheStatus::NotExtracted { client_dir }
        }
        Some(c) => TooltipCacheStatus::Ready {
            spell_count: c.spell_count,
            set_count: c.set_count,
            extracted_at: c.extracted_at,
            stale: c.source_dir != client_dir,
            source_dir: c.source_dir,
        },
    }
}

#[tauri::command]
pub async fn extract_tooltip_data(window: tauri::Window) -> Result<TooltipExtractResult, String> {
    let settings = app_settings::load();
    let client_dir = settings
        .wow_client_dir
        .ok_or_else(|| "No WoW client connected — set one on the dashboard first.".to_string())?;

    tokio::task::spawn_blocking(move || extract_tooltip_data_blocking(window, client_dir))
        .await
        .map_err(|e| format!("blocking task join: {e}"))?
}

fn extract_tooltip_data_blocking(
    window: tauri::Window,
    client_dir: String,
) -> Result<TooltipExtractResult, String> {
    let (spells, sets) = extract_spells_and_sets(&window, Path::new(&client_dir))?;
    let spell_count = spells.len() as u32;
    let set_count = sets.len() as u32;
    let extracted_at = now_iso();

    emit_progress(
        &window,
        "tooltips",
        "Writing cache…",
        Some(format!("{} spells · {} sets", spell_count, set_count)),
    );
    let cache = TooltipCache {
        version: TOOLTIP_CACHE_VERSION,
        extracted_at: extracted_at.clone(),
        source_dir: client_dir,
        spell_count,
        set_count,
        spells,
        sets,
    };
    save_tooltip_cache_file(&cache)?;
    emit_progress(
        &window,
        "tooltips",
        "Done.",
        Some(format!("{} spells · {} sets", spell_count, set_count)),
    );
    Ok(TooltipExtractResult {
        spell_count,
        set_count,
        extracted_at,
    })
}

/// Bulk-load the entire tooltip cache for the frontend. ~5-10MB JSON
/// over Tauri IPC; frontend keeps it in memory and consults by id on
/// every tooltip render. Future optimization: per-spell `get_spell(id)`
/// command if the bulk load proves too heavy.
#[tauri::command]
pub fn load_tooltip_data() -> Result<TooltipCache, String> {
    load_tooltip_cache_file()
        .ok_or_else(|| "No tooltip cache present yet — run extract first.".to_string())
}

fn extract_spells_and_sets(
    window: &tauri::Window,
    wow_dir: &Path,
) -> Result<(BTreeMap<String, SpellEntry>, BTreeMap<String, ItemSetEntry>), String> {
    emit_progress(window, "tooltips", "Opening MPQ patch chain…", None);
    let mut chain = open_patch_chain(wow_dir)?;

    // ── SpellIcon.dbc: build id → texture-filename map first so we
    //    can resolve each Spell's icon as we walk Spell.dbc.
    emit_progress(window, "tooltips", "Reading SpellIcon.dbc…", None);
    let spell_icon_bytes = chain
        .read_file(SPELL_ICON_PATH)
        .map_err(|e| format!("read {SPELL_ICON_PATH}: {e}"))?;
    let spell_icons = SpellIcon::read(&mut Cursor::new(spell_icon_bytes))
        .map_err(|e| format!("parse SpellIcon.dbc: {e:?}"))?;
    let mut icon_map: BTreeMap<i32, String> = BTreeMap::new();
    for row in &spell_icons.rows {
        // texture_filename is e.g. "Interface\\Icons\\Spell_Frost_FrostBolt02".
        // Strip the prefix + lowercase to match Wowhead's CDN naming.
        let name = row
            .texture_filename
            .rsplit_once('\\')
            .map(|(_, n)| n)
            .unwrap_or(&row.texture_filename)
            .trim()
            .to_ascii_lowercase();
        if !name.is_empty() {
            icon_map.insert(row.id.id, name);
        }
    }

    // ── Spell.dbc: the big one (~47MB, ~27k rows). Parse + project
    //    down to (name, description, icon) per row.
    emit_progress(
        window,
        "tooltips",
        "Reading Spell.dbc…",
        Some("~47MB, takes a few seconds".into()),
    );
    let spell_bytes = chain
        .read_file(SPELL_PATH)
        .map_err(|e| format!("read {SPELL_PATH}: {e}"))?;
    emit_progress(window, "tooltips", "Parsing Spell.dbc rows…", None);
    let spells_dbc = Spell::read(&mut Cursor::new(spell_bytes))
        .map_err(|e| format!("parse Spell.dbc: {e:?}"))?;
    let mut spells: BTreeMap<String, SpellEntry> = BTreeMap::new();
    for row in &spells_dbc.rows {
        let id = row.id.id;
        if id <= 0 {
            continue;
        }
        let name = loc(&row.name_lang);
        let description = loc(&row.description_lang);
        let aura_description = loc(&row.aura_description_lang);
        // Skip rows with NO useful text — they're internal placeholders
        // (~thousands of them) and bloat the cache for no rendering value.
        if name.is_empty() && description.is_empty() && aura_description.is_empty() {
            continue;
        }
        // Prefer spell_icon_id; fall back to active_icon_id which some
        // spells use as the only icon ref (notably auras).
        let icon = icon_map
            .get(&row.spell_icon_id.id)
            .cloned()
            .or_else(|| icon_map.get(&row.active_icon_id.id).cloned())
            .unwrap_or_default();
        spells.insert(
            (id as u32).to_string(),
            SpellEntry {
                name,
                description,
                aura_description,
                icon,
            },
        );
    }

    emit_progress(
        window,
        "tooltips",
        "Reading ItemSet.dbc…",
        Some(format!("{} spells kept", spells.len())),
    );
    // ── ItemSet.dbc: tiny, just unwind into our friendlier shape.
    let set_bytes = chain
        .read_file(ITEM_SET_PATH)
        .map_err(|e| format!("read {ITEM_SET_PATH}: {e}"))?;
    let sets_dbc = ItemSet::read(&mut Cursor::new(set_bytes))
        .map_err(|e| format!("parse ItemSet.dbc: {e:?}"))?;
    let mut sets: BTreeMap<String, ItemSetEntry> = BTreeMap::new();
    for row in &sets_dbc.rows {
        let id = row.id.id;
        if id <= 0 {
            continue;
        }
        let name = loc(&row.name_lang);
        let items: Vec<u32> = row.item_id.iter().filter(|&&v| v > 0).map(|&v| v as u32).collect();
        let mut bonuses: Vec<SetBonusEntry> = Vec::new();
        for i in 0..row.set_threshold.len() {
            let threshold = row.set_threshold[i];
            let spell_id = row.set_spell_id[i];
            if threshold > 0 && spell_id > 0 {
                bonuses.push(SetBonusEntry {
                    threshold: threshold as u32,
                    spell_id: spell_id as u32,
                });
            }
        }
        // Threshold ordering varies by row; keep it sorted ascending
        // so the UI can render "(2): ..." then "(4): ..." naturally.
        bonuses.sort_by_key(|b| b.threshold);
        sets.insert(
            (id as u32).to_string(),
            ItemSetEntry {
                name,
                items,
                bonuses,
            },
        );
    }

    Ok((spells, sets))
}

// ── Wipe commands ───────────────────────────────────────────────────
// Useful for testing the extract flow end-to-end (delete cache → status
// flips back to NotExtracted → user can re-extract). Idempotent: a
// missing cache file is a no-op success.

fn wipe_cache_at(path: Option<PathBuf>) -> Result<(), String> {
    let Some(p) = path else {
        return Err("Could not resolve config directory".into());
    };
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {}", p.display(), e)),
    }
}

#[tauri::command]
pub fn wipe_icon_cache() -> Result<(), String> {
    wipe_cache_at(cache_path())
}

#[tauri::command]
pub fn wipe_tooltip_cache() -> Result<(), String> {
    wipe_cache_at(tooltip_cache_path())
}
