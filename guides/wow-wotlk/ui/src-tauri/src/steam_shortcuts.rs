//! Add The Lab and the WoW client to Steam as non-Steam games.
//!
//! Why this matters: Gaming Mode only sees apps that are in Steam, and
//! the Steam controller layout we ship ("The Lab: ConsolePortLK") is
//! addressed by the shortcut's `appid`. Today the user has to manually
//! "Add a non-Steam Game" for both targets; this module does it for
//! them.
//!
//! How it works:
//!   - Steam stores non-Steam shortcuts in a binary KeyValues file at
//!     `~/.steam/steam/userdata/<userID>/config/shortcuts.vdf`.
//!   - Type tags: `0x00` = object open (+ cstring key), `0x08` = end,
//!     `0x01` = string field (key + cstring value), `0x02` = uint32
//!     field. Top-level is `\x00shortcuts\x00 <entry>* \x08`.
//!   - The same 32-bit `appid` is used inside shortcuts.vdf, in
//!     `steam://controllerconfig/<appid>/<workshop>` URLs, AND as the
//!     filename prefix for artwork in `config/grid/<appid>.jpg` etc.
//!     We compute it as `crc32(exe || AppName) | 0x80000000`.
//!
//! Safety:
//!   - Steam keeps shortcuts.vdf in memory while running and rewrites
//!     it on exit — editing under a running Steam will be silently
//!     reverted. Every public entrypoint returns `SteamRunning` if a
//!     `steam` process is detected.
//!   - Every write backs up the existing file first, then writes
//!     atomically via temp-file + rename.
//!   - Duplicates are detected by `appid`; re-running is a no-op.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::app_settings;

/// Display tags used by the frontend to address what we're adding.
#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SteamTarget {
    Thelab,
    Wow,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AddOutcome {
    Added {
        appid: u32,
        artwork_files: u32,
        compat_tool: Option<String>,
    },
    AlreadyPresent {
        appid: u32,
        artwork_files: u32,
        compat_tool: Option<String>,
    },
}

// ── Bundled artwork (sized for Steam's grid/ folder) ─────────────────
//
// Steam expects these per-shortcut filenames in `config/grid/`:
//   <appid>.jpg|.png            — vertical capsule (600×900)
//   <appid>p.jpg|.png           — small vertical capsule
//   <appid>_hero.jpg|.png       — banner / hero (1920×620)
//   <appid>_logo.jpg|.png       — clear-logo overlay
//   <appid>_icon.jpg|.png       — square icon
//
// We bundle a per-target set and only copy what we have — missing slots
// simply don't land, and Steam falls back to its generic tile.
// The Lab — properly sized library art (PNG) provided by the maintainer.
// Five-asset set per target: header, vertical capsule, hero, icon, logo.
// The logo is the transparent wordmark overlay that Steam composites on
// top of the hero in the library AND uses as the main card art in the
// gamescope pause menu. We pair it with a `<appid>.json` position
// config (see install_logo_position) that pins it to BottomLeft at
// ~35% — that matches where Steam draws the auto-AppName for shortcuts
// without a logo, so the wordmark IS the title rather than covering it.
const THELAB_HEADER:  &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryHeader_Capsule_920x430.png");
const THELAB_CAPSULE: &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryCapsule_VerticalCover_600x900.png");
const THELAB_HERO:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryHero_WideBanner_3840x1240.png");
const THELAB_LOGO:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryLogo_Overlay_1280x720.png");
const THELAB_ICON:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_ShortcupAppIcon_256x256.png");
// WoW — same five-asset set.
const WOW_HEADER:  &[u8] = include_bytes!("../resources/steam-art/WOTLK_Steam_LibraryHeader_Capsule_920x430.png");
const WOW_CAPSULE: &[u8] = include_bytes!("../resources/steam-art/WOTLK_Steam_LibraryCapsule_VerticalCover_600x900.png");
const WOW_HERO:    &[u8] = include_bytes!("../resources/steam-art/WOTLK_Steam_LibraryHero_WideBanner1920x620.jpg");
const WOW_LOGO:    &[u8] = include_bytes!("../resources/steam-art/WOTLK_Steam_LibraryLogo_Overlay_1280x720.png");
const WOW_ICON:    &[u8] = include_bytes!("../resources/steam-art/WOTLK_Steam_ShortcupAppIcon_256x256.jpg");

#[derive(Serialize, Debug, Clone)]
pub struct SteamIntegrationStatus {
    pub steam_running: bool,
    pub user_id: Option<String>,
    pub thelab_present: bool,
    pub wow_present: bool,
    pub thelab_appid: Option<u32>,
    pub wow_appid: Option<u32>,
}

// ── Public commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn get_steam_integration_status() -> SteamIntegrationStatus {
    let steam_running = is_steam_running();
    let user_dir = find_steam_user_dir();
    let user_id = user_dir
        .as_ref()
        .and_then(|p| p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()));

    // Compute the planned appids — same algorithm regardless of whether
    // they're already in shortcuts.vdf, so the UI can show "Already
    // added (NN)" with the appid the user might want to apply art to.
    let (thelab_exe, thelab_name) = thelab_target();
    let thelab_appid = thelab_exe
        .as_ref()
        .map(|exe| steam_appid(exe, thelab_name));
    let (wow_exe, wow_name) = wow_target();
    let wow_appid = wow_exe.as_ref().map(|exe| steam_appid(exe, wow_name));

    let mut thelab_present = false;
    let mut wow_present = false;
    if let Some(udir) = &user_dir {
        let path = udir.join("config").join("shortcuts.vdf");
        if let Ok(data) = std::fs::read(&path) {
            let existing: std::collections::HashSet<u32> =
                parse_appids(&data).into_iter().collect();
            if let Some(a) = thelab_appid {
                thelab_present = existing.contains(&a);
            }
            if let Some(a) = wow_appid {
                wow_present = existing.contains(&a);
            }
        }
    }

    SteamIntegrationStatus {
        steam_running,
        user_id,
        thelab_present,
        wow_present,
        thelab_appid,
        wow_appid,
    }
}

#[tauri::command]
pub fn add_to_steam(target: SteamTarget) -> Result<AddOutcome, String> {
    if is_steam_running() {
        return Err(
            "Steam is running. Quit Steam completely (right-click tray icon → Exit), then click Add to Steam again."
                .into(),
        );
    }
    let user_dir = find_steam_user_dir()
        .ok_or_else(|| "Couldn't find your Steam user directory (~/.steam/steam/userdata/...).".to_string())?;
    let shortcuts_path = user_dir.join("config").join("shortcuts.vdf");

    let (exe, name) = match target {
        SteamTarget::Thelab => {
            let (e, n) = thelab_target();
            (
                e.ok_or_else(|| "Couldn't resolve The Lab's executable path.".to_string())?,
                n.to_string(),
            )
        }
        SteamTarget::Wow => {
            let (e, n) = wow_target();
            (
                e.ok_or_else(|| {
                    "No WoW client connected — set the client directory in Settings first."
                        .to_string()
                })?,
                n.to_string(),
            )
        }
    };
    let start_dir = Path::new(&exe)
        .parent()
        .map(|p| format!("{}/", p.display()))
        .unwrap_or_default();
    let appid = steam_appid(&exe, &name);

    // Read existing; recover from previously-malformed writes (orphan
    // entries floating at the file root) by treating them as empty.
    // Those broken bytes were produced by an earlier version of this
    // splice and Steam ignores them anyway — discarding is safe.
    let raw_existing = std::fs::read(&shortcuts_path).ok();
    let existing: Option<Vec<u8>> = match raw_existing {
        Some(data) if is_malformed_orphaned(&data) => {
            log::warn!(
                "shortcuts.vdf ({} B) was malformed (orphan entries at root). \
                 Resetting to the empty template before splicing — broken \
                 entries Steam already ignored are discarded.",
                data.len()
            );
            Some(EMPTY_SHORTCUTS.to_vec())
        }
        other => other,
    };

    log::info!(
        "add_to_steam target={:?} appid={} exe={:?} start_dir={:?} existing_bytes={:?}",
        target,
        appid,
        exe,
        start_dir,
        existing.as_ref().map(|d| d.len())
    );

    if let Some(data) = &existing {
        let appids = parse_appids(data);
        if appids.contains(&appid) {
            log::info!("add_to_steam: appid {} already present, refreshing art + compat", appid);
            // Refresh artwork + compat tool on duplicate add — cheap,
            // idempotent, and useful after an updated build.
            let artwork_files = install_artwork(&user_dir, target, appid);
            let compat_tool = maybe_set_compat_tool(target, appid);
            return Ok(AddOutcome::AlreadyPresent {
                appid,
                artwork_files,
                compat_tool,
            });
        }
    }

    let next_idx = existing
        .as_deref()
        .map(|d| count_entries(d))
        .unwrap_or(0);
    // Point the shortcut's `icon` field at the icon file install_artwork
    // is about to write into config/grid/. Steam reads this path at
    // library-load time, so as long as the file lands before Steam
    // re-opens, the proper icon shows in the taskbar/title bar.
    let icon_ext = match target {
        SteamTarget::Thelab => "png",
        SteamTarget::Wow => "jpg",
    };
    let icon_path = user_dir
        .join("config")
        .join("grid")
        .join(format!("{appid}_icon.{icon_ext}"))
        .to_string_lossy()
        .into_owned();
    let entry_bytes = encode_entry(
        next_idx,
        appid,
        &name,
        &quote(&exe),
        &quote(&start_dir),
        &icon_path,
        "",
    );

    let new_bytes = match existing {
        Some(data) => splice_entry(&data, &entry_bytes)?,
        None => {
            // No file at all — build the canonical tree:
            // `\x00 shortcuts \x00 <entry> \x08 (close shortcuts) \x08 (close root)`.
            let mut buf = Vec::new();
            buf.push(0x00);
            write_cstr(&mut buf, "shortcuts");
            buf.extend_from_slice(&entry_bytes);
            buf.push(0x08);
            buf.push(0x08);
            buf
        }
    };

    // Backup + atomic write.
    if shortcuts_path.exists() {
        let bak = shortcuts_path.with_extension(format!(
            "vdf.bak.{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ));
        std::fs::copy(&shortcuts_path, &bak)
            .map_err(|e| format!("backup shortcuts.vdf: {e}"))?;
    } else if let Some(parent) = shortcuts_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let tmp = shortcuts_path.with_extension("vdf.tmp");
    std::fs::write(&tmp, &new_bytes).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &shortcuts_path)
        .map_err(|e| format!("rename into place: {e}"))?;
    log::info!(
        "add_to_steam: wrote {} bytes to {} (appid {})",
        new_bytes.len(),
        shortcuts_path.display(),
        appid
    );

    let artwork_files = install_artwork(&user_dir, target, appid);
    log::info!(
        "add_to_steam: dropped {} artwork file(s) into grid/ for appid {}",
        artwork_files,
        appid
    );
    let compat_tool = maybe_set_compat_tool(target, appid);
    if let Some(t) = &compat_tool {
        log::info!("add_to_steam: compat tool set to {} for appid {}", t, appid);
    }

    Ok(AddOutcome::Added {
        appid,
        artwork_files,
        compat_tool,
    })
}

/// WoW (a Windows .exe) needs a Proton compat tool to launch from
/// Steam. The Lab is a native Linux AppImage — Steam runs it directly,
/// no compat tool. So this is a no-op for The Lab.
fn maybe_set_compat_tool(target: SteamTarget, appid: u32) -> Option<String> {
    match target {
        SteamTarget::Thelab => None,
        SteamTarget::Wow => match set_proton_compat_tool(appid) {
            Ok(tool) => tool,
            Err(e) => {
                // Don't fail the whole add-to-Steam on a compat-tool
                // hiccup — the user can fix it from Steam's Properties
                // dialog. Surface it as a log line.
                log::warn!("set_proton_compat_tool failed: {e}");
                None
            }
        },
    }
}

/// Pick the newest `GE-Proton*` we can find, falling back to Steam's
/// always-present `proton_experimental` so even fresh installs work.
///
/// Important: a directory under `compatibilitytools.d/` is only a real
/// Steam compat tool if it has `compatibilitytool.vdf` (that's the
/// manifest Steam reads to register the tool). Lutris drops Wine
/// prefixes into the same parent dir (with `drive_c/`, `system.reg`,
/// etc.) — those look right by name but Steam can't actually use them,
/// and writing one into CompatToolMapping causes Steam to silently fall
/// back to `steamlinuxruntime_sniper`. Hence the .vdf check.
fn pick_proton_tool() -> String {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return "proton_experimental".into(),
    };
    let candidate_dirs = [
        home.join(".local/share/Steam/compatibilitytools.d"),
        home.join(".steam/steam/compatibilitytools.d"),
    ];
    let mut ge: Vec<String> = Vec::new();
    for dir in &candidate_dirs {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for entry in rd.flatten() {
                if !entry.path().join("compatibilitytool.vdf").exists() {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with("GE-Proton") {
                        ge.push(name.to_string());
                    }
                }
            }
        }
    }
    ge.sort();
    ge.dedup();
    ge.into_iter()
        .last()
        .unwrap_or_else(|| "proton_experimental".into())
}

/// Add/update the appid's entry in `config.vdf`'s
/// `InstallConfigStore.Software.Valve.Steam.CompatToolMapping` so Steam
/// launches the WoW shortcut through Proton. Returns the tool name on
/// success, or `None` if config.vdf is missing. Inherits the
/// Steam-closed guard from the calling command.
fn set_proton_compat_tool(appid: u32) -> Result<Option<String>, String> {
    let home = dirs::home_dir().ok_or("no home dir")?;
    let path = home.join(".steam/steam/config/config.vdf");
    if !path.exists() {
        return Ok(None);
    }
    let tool = pick_proton_tool();
    let original = std::fs::read_to_string(&path)
        .map_err(|e| format!("read config.vdf: {e}"))?;
    let modified = inject_compat_tool(&original, appid, &tool)
        .ok_or_else(|| "couldn't locate Steam block in config.vdf".to_string())?;
    if modified == original {
        return Ok(Some(tool));
    }
    // Backup + atomic write.
    let bak = path.with_extension(format!(
        "vdf.bak.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    ));
    std::fs::copy(&path, &bak).map_err(|e| format!("backup config.vdf: {e}"))?;
    let tmp = path.with_extension("vdf.tmp");
    std::fs::write(&tmp, &modified).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename config.vdf: {e}"))?;
    Ok(Some(tool))
}

/// Pure-function edit of config.vdf text. Inserts (or replaces) the
/// CompatToolMapping entry for `appid` so it points at `tool`. If
/// CompatToolMapping doesn't exist yet, creates it inside the Steam
/// block first. Returns `None` if we can't safely locate Steam.
fn inject_compat_tool(text: &str, appid: u32, tool: &str) -> Option<String> {
    let appid_str = appid.to_string();
    let entry = format!(
        "\t\t\t\t\t\"{appid}\"\n\t\t\t\t\t{{\n\t\t\t\t\t\t\"name\"\t\t\"{tool}\"\n\t\t\t\t\t\t\"config\"\t\t\"\"\n\t\t\t\t\t\t\"priority\"\t\t\"250\"\n\t\t\t\t\t}}\n",
        appid = appid_str,
        tool = tool
    );

    let mut working = text.to_string();
    // Ensure CompatToolMapping exists; if not, inject an empty one
    // inside the Steam block first.
    if find_block_body(&working, "CompatToolMapping").is_none() {
        let (_s, steam_end) = find_block_body(&working, "Steam")?;
        let inject = "\t\t\t\t\"CompatToolMapping\"\n\t\t\t\t{\n\t\t\t\t}\n";
        working.insert_str(steam_end, inject);
    }
    let (body_start, body_end) = find_block_body(&working, "CompatToolMapping")?;
    let body = &working[body_start..body_end];

    // Remove any existing entry for this appid, then append the new one.
    let key_pat = format!("\"{}\"", appid_str);
    let stripped_body = match body.find(&key_pat) {
        Some(rel) => {
            let bytes = body.as_bytes();
            let mut i = rel + key_pat.len();
            while i < bytes.len() && bytes[i] != b'{' {
                i += 1;
            }
            if i >= bytes.len() {
                return None;
            }
            let mut depth = 1;
            i += 1;
            while i < bytes.len() && depth > 0 {
                match bytes[i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'\n' {
                i += 1;
            }
            format!("{}{}", &body[..rel], &body[i..])
        }
        None => body.to_string(),
    };

    let mut new_text = String::with_capacity(working.len() + entry.len());
    new_text.push_str(&working[..body_start]);
    new_text.push_str(&stripped_body);
    new_text.push_str(&entry);
    new_text.push_str(&working[body_end..]);
    Some(new_text)
}

/// Locate the body of a named block (`"<key>" { … }`) in text VDF and
/// return (body_start_byte, body_end_byte_at_close_brace).
fn find_block_body(text: &str, key: &str) -> Option<(usize, usize)> {
    let needle = format!("\"{}\"", key);
    let key_pos = text.find(&needle)?;
    let after_key = key_pos + needle.len();
    let brace = text[after_key..].find('{').map(|i| after_key + i)?;
    let body_start = brace + 1;
    let bytes = text.as_bytes();
    let mut depth = 1i32;
    let mut i = body_start;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((body_start, i));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Drop our bundled art files into `<userdata>/config/grid/<appid>...`.
/// Missing slots are skipped; we never fail Add-to-Steam over artwork
/// problems. Returns how many files were written.
fn install_artwork(user_dir: &Path, target: SteamTarget, appid: u32) -> u32 {
    let grid = user_dir.join("config").join("grid");
    if std::fs::create_dir_all(&grid).is_err() {
        return 0;
    }

    // (filename suffix, extension, bytes). Steam's grid/ convention:
    //   <appid>.<ext>         → wide library header capsule (920×430)
    //   <appid>p.<ext>        → vertical poster (600×900) — the grid view
    //   <appid>_hero.<ext>    → game-details banner (3840×1240 / 1920×620)
    //   <appid>_logo.<ext>    → transparent wordmark overlay (1280×720)
    //   <appid>_icon.<ext>    → square icon (256×256)
    //
    // We DO include `_logo` now — gamescope's in-game pause menu shows
    // the broken-image placeholder without it, because that card pulls
    // specifically from the logo slot rather than falling back to the
    // banner+text combo Steam's library uses. Pairing the logo with a
    // BottomLeft position config (install_logo_position) keeps it from
    // dominating the banner the way an unconfigured logo does.
    let files: &[(&str, &str, &[u8])] = match target {
        SteamTarget::Thelab => &[
            ("", "png", THELAB_HEADER),
            ("p", "png", THELAB_CAPSULE),
            ("_hero", "png", THELAB_HERO),
            ("_logo", "png", THELAB_LOGO),
            ("_icon", "png", THELAB_ICON),
        ],
        SteamTarget::Wow => &[
            ("", "png", WOW_HEADER),
            ("p", "png", WOW_CAPSULE),
            ("_hero", "jpg", WOW_HERO),
            ("_logo", "png", WOW_LOGO),
            ("_icon", "jpg", WOW_ICON),
        ],
    };

    let mut written = 0u32;
    for (suffix, ext, bytes) in files {
        let path = grid.join(format!("{appid}{suffix}.{ext}"));
        if std::fs::write(&path, *bytes).is_ok() {
            written += 1;
        }
    }

    // Logo position config — Steam reads `<appid>.json` in the same
    // grid/ dir to know where on the hero banner to render the logo
    // overlay (and at what scale). Without it Steam defaults to
    // CenterCenter at 100% size, which means the wordmark hangs in the
    // middle of the banner over whatever art is there — that's the
    // "covers the background" complaint that drove the original
    // decision to skip the logo entirely. Pinning BottomLeft at 35%
    // matches where Steam would draw the auto-AppName text for
    // shortcuts without a logo, so the wordmark functions as the title
    // (which is what it IS) instead of dominating the banner. Users
    // can right-click the hero in Steam to reposition if they want.
    if install_logo_position(&grid, appid).is_ok() {
        written += 1;
    }
    written
}

/// Write the per-shortcut logo-position config Steam reads to know
/// where to render the logo overlay on the library detail page.
/// Format reverse-engineered from Steam's own writes — visible by
/// repositioning a logo via right-click on any library entry, then
/// inspecting the resulting `<appid>.json` file.
fn install_logo_position(grid: &Path, appid: u32) -> std::io::Result<()> {
    let json = r#"{
  "nVersion": 1,
  "logoPosition": {
    "pinnedPosition": "BottomLeft",
    "nWidthPct": 35.0,
    "nHeightPct": 35.0
  }
}
"#;
    std::fs::write(grid.join(format!("{appid}.json")), json)
}

// ── Targets ──────────────────────────────────────────────────────────

fn thelab_target() -> (Option<String>, &'static str) {
    // Inside an AppImage runtime the original .AppImage path lives in
    // `$APPIMAGE`; current_exe() points at the FUSE mount and would
    // make Steam launch a path that doesn't exist after the AppImage
    // exits. Prefer $APPIMAGE.
    let exe = std::env::var("APPIMAGE")
        .ok()
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.to_str().map(|s| s.to_string()))
        });
    (exe, "The Lab")
}

fn wow_target() -> (Option<String>, &'static str) {
    let dir = app_settings::load().wow_client_dir;
    let exe = dir.map(|d| format!("{}/Wow.exe", d.trim_end_matches('/')));
    // The colon-WotLK name is intentional: if our Workshop preset
    // apply fails, the user can search this exact name in Steam's
    // community controller layouts for a "ConsolePortLK" fallback.
    (exe, "World of Warcraft: WotLK")
}

// ── Steam discovery + state ──────────────────────────────────────────

fn find_steam_user_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let userdata = home.join(".steam/steam/userdata");
    let mut entries: Vec<_> = std::fs::read_dir(&userdata).ok()?.flatten().collect();
    // Most users have a single dir; if multiple, prefer the most-recent.
    entries.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
    });
    entries.into_iter().rev().find_map(|e| {
        let p = e.path();
        if p.join("config").is_dir() {
            Some(p)
        } else {
            None
        }
    })
}

fn is_steam_running() -> bool {
    // We want to detect ANY Steam process so we don't write while
    // Steam has shortcuts.vdf in memory. `steam` is the main binary
    // (procname/comm: "steam"), `steamwebhelper` is the CEF child that
    // can outlive the main process during shutdown. pgrep -x matches
    // /proc/<pid>/comm so we hit them by exact comm name.
    for name in ["steam", "steamwebhelper"] {
        let running = std::process::Command::new("pgrep")
            .args(["-x", name])
            .output()
            .map(|o| o.status.success() && !o.stdout.is_empty())
            .unwrap_or(false);
        if running {
            log::debug!("is_steam_running: matched comm='{}'", name);
            return true;
        }
    }
    false
}

// ── appid ────────────────────────────────────────────────────────────

/// `crc32(exe || AppName) | 0x80000000`. Same value Steam stores in
/// shortcuts.vdf and uses for grid/<appid>.jpg artwork filenames and
/// for steam:// URLs that target the shortcut.
pub fn steam_appid(exe: &str, app_name: &str) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(exe.as_bytes());
    hasher.update(app_name.as_bytes());
    hasher.finalize() | 0x8000_0000
}

// ── Binary KeyValues writer (subset for shortcuts.vdf) ───────────────

fn write_cstr(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(s.as_bytes());
    buf.push(0x00);
}

fn write_str_field(buf: &mut Vec<u8>, key: &str, val: &str) {
    buf.push(0x01);
    write_cstr(buf, key);
    write_cstr(buf, val);
}

fn write_u32_field(buf: &mut Vec<u8>, key: &str, val: u32) {
    buf.push(0x02);
    write_cstr(buf, key);
    buf.extend_from_slice(&val.to_le_bytes());
}

fn encode_entry(
    idx: usize,
    appid: u32,
    app_name: &str,
    exe_quoted: &str,
    start_dir_quoted: &str,
    icon: &str,
    launch_options: &str,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(512);
    buf.push(0x00); // entry object open
    write_cstr(&mut buf, &idx.to_string());

    write_u32_field(&mut buf, "appid", appid);
    write_str_field(&mut buf, "AppName", app_name);
    write_str_field(&mut buf, "Exe", exe_quoted);
    write_str_field(&mut buf, "StartDir", start_dir_quoted);
    write_str_field(&mut buf, "icon", icon);
    write_str_field(&mut buf, "ShortcutPath", "");
    write_str_field(&mut buf, "LaunchOptions", launch_options);
    write_u32_field(&mut buf, "IsHidden", 0);
    write_u32_field(&mut buf, "AllowDesktopConfig", 1);
    write_u32_field(&mut buf, "AllowOverlay", 1);
    write_u32_field(&mut buf, "OpenVR", 0);
    write_u32_field(&mut buf, "Devkit", 0);
    write_str_field(&mut buf, "DevkitGameID", "");
    write_u32_field(&mut buf, "DevkitOverrideAppID", 0);
    write_u32_field(&mut buf, "LastPlayTime", 0);
    write_str_field(&mut buf, "FlatpakAppID", "");
    // Empty `tags` nested object: open + close.
    buf.push(0x00);
    write_cstr(&mut buf, "tags");
    buf.push(0x08);

    buf.push(0x08); // close entry
    buf
}

/// Steam's empty `shortcuts.vdf` is exactly:
///   `\x00 shortcuts \x00 \x08 \x08`
/// — i.e. an open of the `shortcuts` object followed by TWO closing
/// bytes (one for `shortcuts`, one for the implicit file/root). We
/// splice new entries between the existing children and that first
/// close-byte, which means inserting at `len - 2`, then adding `\x08\x08`
/// back. Earlier this function stripped just ONE trailing byte, leaving
/// the close-shortcuts in front of the new entry — every shortcut ended
/// up at the file root, Steam treated `shortcuts` as empty, and the
/// library stayed blank. (See git blame on this comment for the fix.)
fn splice_entry(existing: &[u8], entry: &[u8]) -> Result<Vec<u8>, String> {
    let n = existing.len();
    if n < 2 || existing[n - 1] != 0x08 || existing[n - 2] != 0x08 {
        return Err(
            "shortcuts.vdf doesn't end with the expected \\x08\\x08 terminator; refusing to write."
                .into(),
        );
    }
    let mut out = Vec::with_capacity(n + entry.len());
    out.extend_from_slice(&existing[..n - 2]);
    out.extend_from_slice(entry);
    out.push(0x08); // close shortcuts
    out.push(0x08); // close root
    Ok(out)
}

/// A pristine empty shortcuts.vdf, used to recover from broken state
/// (orphan entries at the root from the splice bug) and as the seed
/// when no file exists yet.
const EMPTY_SHORTCUTS: &[u8] = b"\x00shortcuts\x00\x08\x08";

/// True if the file looks like a broken splice-victim: longer than the
/// empty template AND the very first byte after `shortcuts\0` is the
/// close-shortcuts `\x08` — meaning every "entry" inside is actually
/// floating at the file root and Steam won't pick any of them up.
fn is_malformed_orphaned(data: &[u8]) -> bool {
    // Byte layout of a sane file: `\x00 s h o r t c u t s \x00 \x00 <entry...`.
    //                              0    1 2 3 4 5 6 7 8 9 10    11
    // Position 11 must be `\x00` (open of entry "0") for any non-empty
    // file. If it's `\x08` and we have content after, the close happened
    // too early.
    data.len() > EMPTY_SHORTCUTS.len() && data.get(11) == Some(&0x08)
}

// ── Light parser: just enough to count entries + collect appids ──────

pub fn parse_appids(data: &[u8]) -> Vec<u32> {
    walk(data, |_, _, key, val_kind| match val_kind {
        VK::U32(v) if key.eq_ignore_ascii_case("appid") => Some(v),
        _ => None,
    })
}

fn count_entries(data: &[u8]) -> usize {
    // Each entry opens at depth 2 (`shortcuts` is depth 1). Count those.
    let mut count = 0usize;
    let mut i = 0usize;
    let mut depth: i32 = 0;
    while i < data.len() {
        let t = data[i];
        i += 1;
        match t {
            0x00 => {
                let _ = read_cstr(data, &mut i);
                depth += 1;
                if depth == 2 {
                    count += 1;
                }
            }
            0x08 => {
                depth -= 1;
                if depth < 0 {
                    break;
                }
            }
            0x01 => {
                let _ = read_cstr(data, &mut i);
                let _ = read_cstr(data, &mut i);
            }
            0x02 => {
                let _ = read_cstr(data, &mut i);
                if i + 4 > data.len() {
                    break;
                }
                i += 4;
            }
            _ => break,
        }
    }
    count
}

enum VK {
    U32(u32),
}

fn walk(data: &[u8], mut on_field: impl FnMut(i32, &str, &str, VK) -> Option<u32>) -> Vec<u32> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let mut depth: i32 = 0;
    let mut last_key = String::new();
    while i < data.len() {
        let t = data[i];
        i += 1;
        match t {
            0x00 => {
                last_key = read_cstr(data, &mut i);
                depth += 1;
            }
            0x08 => {
                depth -= 1;
                if depth < 0 {
                    break;
                }
            }
            0x01 => {
                let _ = read_cstr(data, &mut i);
                let _ = read_cstr(data, &mut i);
            }
            0x02 => {
                let key = read_cstr(data, &mut i);
                if i + 4 > data.len() {
                    break;
                }
                let v = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
                i += 4;
                if let Some(found) = on_field(depth, &last_key, &key, VK::U32(v)) {
                    out.push(found);
                }
            }
            _ => break,
        }
    }
    out
}

fn read_cstr(data: &[u8], i: &mut usize) -> String {
    let start = *i;
    while *i < data.len() && data[*i] != 0 {
        *i += 1;
    }
    let s = String::from_utf8_lossy(&data[start..*i]).into_owned();
    if *i < data.len() {
        *i += 1;
    }
    s
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s)
}
