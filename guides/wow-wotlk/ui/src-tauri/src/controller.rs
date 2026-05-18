//! Controller support for the WoW client.
//!
//! Currently surfaces ConsolePortLK — the WotLK port of the iconic
//! controller addon. The 1.4.0 release zip is bundled directly into
//! the binary via `include_bytes!` (rather than fetched at runtime)
//! because:
//!   1. The upstream repo hasn't been updated since Feb 2025; if the
//!      author takes it down our install button suddenly breaks.
//!   2. Offline-first: a Steam Deck user setting up on couch wifi
//!      shouldn't need to hit GitHub mid-install.
//!   3. 8MB zip baked into the binary is negligible next to wow-mpq
//!      + wow_dbc + DXVK assets we already ship.
//!
//! Install = extract every top-level `ConsolePort*` folder from the
//! zip into `<wow_client>/Interface/AddOns/`. WoW addons are just
//! folders; no registration needed. ConsolePortLK ships 8 sibling
//! addons (Loader, Bar, Help, etc.) which all extract at once.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::app_settings;

const CONSOLEPORTLK_VERSION: &str = "1.4.0";
const CONSOLEPORTLK_ZIP: &[u8] =
    include_bytes!("../resources/consoleportlk-1.4.0.zip");

/// The "marker" folder we look for to decide if ConsolePortLK is
/// already installed. The Loader folder is the central piece — every
/// install has it.
const LOADER_FOLDER: &str = "ConsolePortLoader";

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ConsolePortStatus {
    /// User hasn't connected a WoW client yet; install can't run.
    NoClient,
    /// Client connected, addon not installed.
    NotInstalled { client_dir: String },
    /// Addon folders detected under Interface/AddOns/. Version is the
    /// one we bundled (we don't currently parse the installed .toc to
    /// detect older copies — if the user installs a different version
    /// out-of-band we'll just say "installed").
    Installed {
        client_dir: String,
        version: String,
    },
}

#[derive(Debug, Serialize, Clone)]
pub struct InstallResult {
    /// Number of files written from the zip.
    pub file_count: u32,
    /// Top-level folder names extracted (e.g. `["ConsolePort",
    /// "ConsolePortBar", ...]`). Surfaced so the UI can confirm
    /// which sibling addons landed.
    pub folders: Vec<String>,
    pub version: String,
}

fn addons_dir(wow_dir: &str) -> PathBuf {
    Path::new(wow_dir).join("Interface").join("AddOns")
}

#[tauri::command]
pub fn get_consoleportlk_status() -> ConsolePortStatus {
    let settings = app_settings::load();
    let client_dir = match settings.wow_client_dir {
        Some(d) => d,
        None => return ConsolePortStatus::NoClient,
    };
    let loader = addons_dir(&client_dir).join(LOADER_FOLDER);
    if loader.is_dir() {
        ConsolePortStatus::Installed {
            client_dir,
            version: CONSOLEPORTLK_VERSION.to_string(),
        }
    } else {
        ConsolePortStatus::NotInstalled { client_dir }
    }
}

#[tauri::command]
pub async fn install_consoleportlk() -> Result<InstallResult, String> {
    let settings = app_settings::load();
    let client_dir = settings
        .wow_client_dir
        .ok_or_else(|| "No WoW client connected — set one in Settings first.".to_string())?;

    // CPU-bound zip extract — hop onto the blocking pool so the
    // Tauri runtime thread stays free. Same pattern as the icon /
    // tooltip extractors in client_assets.rs.
    tokio::task::spawn_blocking(move || install_blocking(client_dir))
        .await
        .map_err(|e| format!("blocking task join: {e}"))?
}

fn install_blocking(client_dir: String) -> Result<InstallResult, String> {
    let addons = addons_dir(&client_dir);
    std::fs::create_dir_all(&addons)
        .map_err(|e| format!("create {}: {}", addons.display(), e))?;

    let reader = Cursor::new(CONSOLEPORTLK_ZIP);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("open bundled zip: {e}"))?;

    let mut file_count = 0u32;
    let mut folders: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("read zip entry {i}: {e}"))?;
        // `enclosed_name` resolves the safe in-archive path (no
        // ".." traversal, no absolute paths) — the right defense
        // even though we trust the bundled archive.
        let rel_path = match file.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };

        // Track top-level folder names for the result payload.
        if let Some(first) = rel_path.components().next() {
            folders.insert(first.as_os_str().to_string_lossy().into_owned());
        }

        let out_path = addons.join(&rel_path);
        if file.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("mkdir {}: {}", out_path.display(), e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create {}: {}", out_path.display(), e))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| format!("write {}: {}", out_path.display(), e))?;
            file_count += 1;
        }
    }

    Ok(InstallResult {
        file_count,
        folders: folders.into_iter().collect(),
        version: CONSOLEPORTLK_VERSION.to_string(),
    })
}
