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
use wow_dbc::wrath_tables::talent::Talent;
use wow_dbc::wrath_tables::talent_tab::TalentTab;
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

/// Known 3.3.5a locale codes in preference order. If the user has more
/// than one locale dir present (rare — multi-locale installs do exist),
/// we pick the first one in this list that has a `base-<locale>.MPQ`
/// inside it. English variants come first because that's our default
/// fallback for `loc()`; non-English locales follow.
const KNOWN_LOCALES: &[&str] = &[
    "enUS", "enGB", "frFR", "deDE", "esES", "esMX",
    "ruRU", "koKR", "zhCN", "zhTW", "ptBR", "itIT",
];

/// Scan `<wow_dir>/Data/<locale>/` and return the first locale code
/// that exists AND contains a `base-<locale>.MPQ`. Returns None if no
/// recognizable locale dir is present — the patch chain will still
/// open the base MPQs (DBCs without localized strings work fine), but
/// extracted names/descriptions will be blank.
fn detect_locale(data_dir: &Path) -> Option<&'static str> {
    for &loc in KNOWN_LOCALES {
        let candidate = data_dir.join(loc).join(format!("base-{loc}.MPQ"));
        if candidate.exists() {
            return Some(loc);
        }
    }
    None
}

/// Build the locale-specific MPQ file list for a given locale code.
/// Locale MPQs are added at HIGHEST priority so localized DBC rows
/// (Spell.dbc text, Item.dbc names, etc.) shadow placeholders in the
/// base MPQs.
fn locale_mpq_names(locale: &str) -> Vec<String> {
    vec![
        format!("base-{locale}.MPQ"),
        format!("locale-{locale}.MPQ"),
        format!("expansion-locale-{locale}.MPQ"),
        format!("lichking-locale-{locale}.MPQ"),
        format!("patch-{locale}.MPQ"),
        format!("patch-{locale}-2.MPQ"),
        format!("patch-{locale}-3.MPQ"),
    ]
}

/// DBC paths inside the MPQ. Note the backslash separator — MPQ
/// archive names use Windows-style paths and `wow_mpq` doesn't
/// normalize.
const ITEM_DISPLAY_INFO_PATH: &str = "DBFilesClient\\ItemDisplayInfo.dbc";
pub(crate) const SPELL_PATH: &str = "DBFilesClient\\Spell.dbc";
pub(crate) const SPELL_ICON_PATH: &str = "DBFilesClient\\SpellIcon.dbc";
const ITEM_SET_PATH: &str = "DBFilesClient\\ItemSet.dbc";
pub(crate) const TALENT_PATH: &str = "DBFilesClient\\Talent.dbc";
pub(crate) const TALENT_TAB_PATH: &str = "DBFilesClient\\TalentTab.dbc";

/// Open the standard 3.3.5a patch-chain. Skips MPQs that aren't
/// present (some clients ship without certain patches). Returns an
/// error if NO base MPQs are present, since that means the user
/// pointed us at the wrong directory.
///
/// If `window` + `kind` are supplied we emit a progress event before
/// opening each archive, so the UI can show "Opening lichking.MPQ
/// (4/14)…" instead of a single static "Opening MPQ patch chain…"
/// spinner that sits for 90% of the extraction's wall-clock.
pub(crate) fn open_patch_chain(
    wow_dir: &Path,
    window: Option<(&tauri::Window, &str)>,
) -> Result<PatchChain, String> {
    let data_dir = wow_dir.join("Data");
    if !data_dir.is_dir() {
        return Err(format!(
            "WoW Data directory not found at {} — is this the right install dir?",
            data_dir.display()
        ));
    }

    // Pre-scan so we know the total count for "n/N" progress strings.
    // Cheap — just exists() calls.
    let base_paths: Vec<PathBuf> = BASE_MPQS
        .iter()
        .map(|n| data_dir.join(n))
        .filter(|p| p.exists())
        .collect();
    // Autodetect the client's locale instead of assuming enUS. Without
    // this, non-English clients (frFR, deDE, etc.) silently fail to
    // open their locale MPQs — which is where the localized DBC rows
    // AND some patched files (often ItemDisplayInfo on French/German
    // clients) actually live.
    let (locale_paths, detected_locale): (Vec<PathBuf>, Option<&'static str>) =
        match detect_locale(&data_dir) {
            Some(loc) => {
                let root = data_dir.join(loc);
                let paths: Vec<PathBuf> = locale_mpq_names(loc)
                    .into_iter()
                    .map(|n| root.join(n))
                    .filter(|p| p.exists())
                    .collect();
                (paths, Some(loc))
            }
            None => (Vec::new(), None),
        };
    if let Some(loc) = detected_locale {
        log::info!("client locale detected: {loc} ({} MPQs)", locale_paths.len());
    } else {
        log::warn!(
            "no recognized locale dir under {} — localized DBC strings will be blank",
            data_dir.display()
        );
    }
    let total = base_paths.len() + locale_paths.len();
    if base_paths.is_empty() {
        return Err(format!(
            "No MPQ archives found in {}. Make sure this is your WoW install root (one level above Data/).",
            data_dir.display()
        ));
    }

    let mut chain = PatchChain::new();
    let mut priority = 0i32;
    let mut opened = 0;
    for path in base_paths.iter().chain(locale_paths.iter()) {
        opened += 1;
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("?")
            .to_string();
        if let Some((win, kind)) = window {
            emit_progress(
                win,
                kind,
                "Opening MPQ patch chain…",
                Some(format!("{} ({}/{})", file_name, opened, total)),
            );
        }
        chain
            .add_archive(path, priority)
            .map_err(|e| format!("open {}: {}", path.display(), e))?;
        priority += 1;
    }
    Ok(chain)
}

/// Pick the best non-empty locale string out of an ExtendedLocalizedString.
/// 3.3.5a clients write English to `en_gb`; some forks use `en_us`. Fall
/// back across both.
pub(crate) fn loc(s: &wow_dbc::ExtendedLocalizedString) -> String {
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
    // open_patch_chain emits per-archive progress itself when given a
    // window — no need for our own pre-open emit.
    let mut chain = open_patch_chain(Path::new(&client_dir), Some((&window, "icons")))?;

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
    let mut chain = open_patch_chain(wow_dir, Some((window, "tooltips")))?;

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

// ── Talent.dbc + TalentTab.dbc extraction ────────────────────────────
//
// Why this exists separately from the tooltip/icon extractors: the
// playerbots "My Party" flow needs to (a) identify which talent a given
// `character_talent.spell` row represents — so we can infer a bot's
// spec — and (b) apply custom talent builds via direct DB INSERT.
//
// Both directions need the same metadata: which tree (0/1/2 within the
// class) a spell belongs to, the talent's tier+column coords, and its
// rank index (a single talent has up to ~5 spell_rank entries, each a
// different spell id).
//
// The cache is small (~2400 entries × ~100 bytes ≈ 250KB). Both the
// harvest tool (Phase 2b) and the apply path (Phase 2e) load it.

const TALENT_CACHE_VERSION: u32 = 1;

/// One talent rank's metadata, keyed by spell_id in the cache. Capturing
/// rank is critical because each `Talent` row owns up to 9 spell ids
/// (one per rank) and `character_talent.spell` stores the FINAL ranked
/// spell — so e.g. a "Improved Heal r3" row will show one of the r3
/// spell ids, and we need to know it's r3 to compute total points.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TalentInfo {
    /// Talent.dbc primary key — included for cross-referencing.
    pub talent_id: i32,
    /// TalentTab.dbc primary key — included for cross-referencing.
    pub tab_id: i32,
    /// Which tree (0=first, 1=second, 2=third) within the class. The
    /// "Holy/Prot/Ret" axis for Paladin, etc. Derived from
    /// `TalentTab.order_index`.
    pub tab_index: u8,
    /// Class id (1..=11). Derived from `TalentTab.class_mask` —
    /// trailing_zeros + 1.
    pub class_id: u8,
    /// Tier (0-indexed row in the tree).
    pub tier: u8,
    /// Column (0-indexed within the row).
    pub column: u8,
    /// Rank (0-indexed: r1 = 0). Counts how many points are spent.
    pub rank: u8,
    /// TalentTab display name (e.g. "Holy", "Protection"). enUS-only.
    pub tab_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TalentDataCache {
    pub version: u32,
    pub extracted_at: String,
    pub source_dir: String,
    pub talent_count: u32,
    pub tab_count: u32,
    /// spell_id → TalentInfo. Keyed as String so the JSON cache is
    /// language-portable and BTreeMap-friendly (same shape as the icon
    /// cache's displayid map).
    pub spell_to_talent: BTreeMap<String, TalentInfo>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TalentCacheStatus {
    NoClient,
    NotExtracted {
        client_dir: String,
    },
    Ready {
        talent_count: u32,
        tab_count: u32,
        extracted_at: String,
        source_dir: String,
        stale: bool,
    },
}

#[derive(Serialize, Debug, Clone)]
pub struct TalentExtractResult {
    pub talent_count: u32,
    pub tab_count: u32,
    pub extracted_at: String,
}

fn talent_cache_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("dads-mmo-lab").join("talent-data.json"))
}

fn load_talent_cache_file() -> Option<TalentDataCache> {
    let path = talent_cache_path()?;
    let contents = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn save_talent_cache_file(cache: &TalentDataCache) -> Result<(), String> {
    let path = talent_cache_path()
        .ok_or_else(|| "Could not resolve config directory".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string(cache)
        .map_err(|e| format!("serialize talent cache: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn get_talent_cache_status() -> TalentCacheStatus {
    let settings = app_settings::load();
    let client_dir = match settings.wow_client_dir {
        Some(d) => d,
        None => return TalentCacheStatus::NoClient,
    };
    match load_talent_cache_file() {
        None => TalentCacheStatus::NotExtracted { client_dir },
        Some(c) if c.version != TALENT_CACHE_VERSION => {
            TalentCacheStatus::NotExtracted { client_dir }
        }
        Some(c) => TalentCacheStatus::Ready {
            talent_count: c.talent_count,
            tab_count: c.tab_count,
            extracted_at: c.extracted_at,
            stale: c.source_dir != client_dir,
            source_dir: c.source_dir,
        },
    }
}

#[tauri::command]
pub async fn extract_talent_data(
    window: tauri::Window,
) -> Result<TalentExtractResult, String> {
    let settings = app_settings::load();
    let client_dir = settings
        .wow_client_dir
        .ok_or_else(|| "No WoW client connected — set one on the dashboard first.".to_string())?;

    tokio::task::spawn_blocking(move || extract_talent_data_blocking(window, client_dir))
        .await
        .map_err(|e| format!("blocking task join: {e}"))?
}

fn extract_talent_data_blocking(
    window: tauri::Window,
    client_dir: String,
) -> Result<TalentExtractResult, String> {
    let (spell_to_talent, tab_count) =
        extract_talent_metadata(&window, Path::new(&client_dir))?;
    let talent_count = spell_to_talent.len() as u32;
    let extracted_at = now_iso();

    emit_progress(
        &window,
        "talents",
        "Writing cache…",
        Some(format!(
            "{} talent ranks · {} tabs",
            talent_count, tab_count
        )),
    );
    let cache = TalentDataCache {
        version: TALENT_CACHE_VERSION,
        extracted_at: extracted_at.clone(),
        source_dir: client_dir,
        talent_count,
        tab_count,
        spell_to_talent,
    };
    save_talent_cache_file(&cache)?;
    emit_progress(&window, "talents", "Done.", None);
    Ok(TalentExtractResult {
        talent_count,
        tab_count,
        extracted_at,
    })
}

#[tauri::command]
pub fn load_talent_data() -> Result<TalentDataCache, String> {
    load_talent_cache_file()
        .ok_or_else(|| "No talent cache present yet — run extract first.".to_string())
}

#[tauri::command]
pub fn wipe_talent_cache() -> Result<(), String> {
    wipe_cache_at(talent_cache_path())
}

/// Worker — opens the patch chain, walks both DBCs, builds the spell→
/// talent reverse map keyed for cache storage.
fn extract_talent_metadata(
    window: &tauri::Window,
    wow_dir: &Path,
) -> Result<(BTreeMap<String, TalentInfo>, u32), String> {
    let mut chain = open_patch_chain(wow_dir, Some((window, "talents")))?;

    // 1. TalentTab.dbc — build tab_id → (class_id, tab_index, name).
    //    class_id is computed from class_mask via trailing_zeros + 1,
    //    which gives the canonical AC class id (1=Warrior … 11=Druid,
    //    skipping 10 per the WotLK class table).
    emit_progress(window, "talents", "Reading TalentTab.dbc…", None);
    let tab_bytes = chain
        .read_file(TALENT_TAB_PATH)
        .map_err(|e| format!("read {TALENT_TAB_PATH}: {e}"))?;
    let tabs = TalentTab::read(&mut Cursor::new(tab_bytes))
        .map_err(|e| format!("parse TalentTab.dbc: {e:?}"))?;

    #[derive(Clone)]
    struct TabMeta {
        class_id: u8,
        tab_index: u8,
        name: String,
    }
    let mut tab_meta: BTreeMap<i32, TabMeta> = BTreeMap::new();
    for row in &tabs.rows {
        // class_mask is a bitfield with exactly one bit set per
        // class-specific tab. Generic tabs (mask=0) get skipped — none
        // are reachable from `character_talent.spell` anyway.
        if row.class_mask == 0 {
            continue;
        }
        let class_id = (row.class_mask as u32).trailing_zeros() as u8 + 1;
        // Use the shared `loc` helper — 3.3.5a writes English to en_gb
        // with en_us occasionally populated as a fallback. Bail to the
        // tab id stringified if every locale row is blank.
        let raw = loc(&row.name_lang);
        let name = if raw.is_empty() {
            format!("Tab #{}", row.id.id)
        } else {
            raw
        };
        tab_meta.insert(
            row.id.id,
            TabMeta {
                class_id,
                tab_index: row.order_index as u8,
                name,
            },
        );
    }
    let tab_count = tab_meta.len() as u32;

    // 2. Talent.dbc — for every (talent, rank) emit a spell→TalentInfo
    //    entry. Rank 0 (==spell_rank[0]) is the first point spent;
    //    character_talent.spell stores the spell id of the LATEST rank
    //    learned, so we need every rank populated to correctly classify
    //    rows.
    emit_progress(window, "talents", "Reading Talent.dbc…", None);
    let talent_bytes = chain
        .read_file(TALENT_PATH)
        .map_err(|e| format!("read {TALENT_PATH}: {e}"))?;
    let talents = Talent::read(&mut Cursor::new(talent_bytes))
        .map_err(|e| format!("parse Talent.dbc: {e:?}"))?;

    emit_progress(window, "talents", "Indexing talent ranks…", None);
    let mut spell_to_talent: BTreeMap<String, TalentInfo> = BTreeMap::new();
    for talent in &talents.rows {
        let Some(meta) = tab_meta.get(&talent.tab_id) else {
            continue; // class-less tab — skip
        };
        for (rank_idx, &spell_id) in talent.spell_rank.iter().enumerate() {
            if spell_id == 0 {
                continue;
            }
            spell_to_talent.insert(
                spell_id.to_string(),
                TalentInfo {
                    talent_id: talent.id.id,
                    tab_id: talent.tab_id,
                    tab_index: meta.tab_index,
                    class_id: meta.class_id,
                    tier: talent.tier_id as u8,
                    column: talent.column_index as u8,
                    rank: rank_idx as u8,
                    tab_name: meta.name.clone(),
                },
            );
        }
    }

    Ok((spell_to_talent, tab_count))
}
