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
const THELAB_HEADER:  &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryHeader_Capsule_920x430.png");
const THELAB_CAPSULE: &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryCapsule_VerticalCover_600x900.png");
const THELAB_HERO:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryHero_WideBanner_3840x1240.png");
const THELAB_LOGO:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_LibraryLogo_Overlay_1280x720.png");
const THELAB_ICON:    &[u8] = include_bytes!("../resources/steam-art/TheLab_Steam_ShortcupAppIcon_256x256.png");
// WoW — same five-asset pattern as The Lab.
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

    // Existing file → splice; missing → create from scratch.
    let existing = std::fs::read(&shortcuts_path).ok();

    if let Some(data) = &existing {
        let appids = parse_appids(data);
        if appids.contains(&appid) {
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
            // Empty file: build the whole tree.
            let mut buf = Vec::new();
            buf.push(0x00);
            write_cstr(&mut buf, "shortcuts");
            buf.extend_from_slice(&entry_bytes);
            buf.push(0x08); // close shortcuts
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

    let artwork_files = install_artwork(&user_dir, target, appid);
    let compat_tool = maybe_set_compat_tool(target, appid);

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
    //   <appid>_logo.<ext>    → transparent logo overlay (1280×720)
    //   <appid>_icon.<ext>    → square icon (256×256)
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
    written
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
    // pgrep is on every SteamOS install; if it isn't present we can't
    // be certain Steam is down, so assume it might be and let the user
    // confirm.
    std::process::Command::new("pgrep")
        .args(["-x", "steam"])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(true)
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

/// Insert the new entry just before the final `\x08` that closes the
/// root `shortcuts` object — Steam-friendly because we preserve every
/// byte of existing entries (including types we don't know how to
/// re-emit).
fn splice_entry(existing: &[u8], entry: &[u8]) -> Result<Vec<u8>, String> {
    if existing.is_empty() || existing[existing.len() - 1] != 0x08 {
        return Err(
            "shortcuts.vdf doesn't end with the expected object-close byte (0x08); refusing to write."
                .into(),
        );
    }
    let mut out = Vec::with_capacity(existing.len() + entry.len());
    out.extend_from_slice(&existing[..existing.len() - 1]);
    out.extend_from_slice(entry);
    out.push(0x08);
    Ok(out)
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
