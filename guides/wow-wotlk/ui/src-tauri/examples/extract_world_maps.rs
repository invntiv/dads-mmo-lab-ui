//! One-off: extract every WorldMap BLP from the client into a folder
//! of PNGs for investigation. Pairs each zone with its WorldMapArea.dbc
//! metadata (map_id, bounding-box coords) so the user can decide how
//! to overlay teleport pins on top.
//!
//! Run:
//!   cargo run --release --example extract_world_maps -- \
//!     /home/veil/ChromieCraft_3.3.5a /home/veil/dev/wow-assets/world-maps
//!
//! Output layout:
//!   <out>/
//!     world-map-index.json     <- WorldMapArea rows, joined to file list
//!     <ZoneName>/
//!       <ZoneName>1.png  <ZoneName>2.png  <ZoneName>3.png  <ZoneName>4.png
//!
//! Each zone has up to 4 tiles laid out as a 2x2 grid:
//!     1 2
//!     3 4
//! Each tile is 256x256 by default (some patches override with 512).

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use serde::Serialize;
use wow_blp::convert::blp_to_image;
use wow_blp::parser::load_blp_from_buf;
use wow_dbc::DbcTable;
use wow_dbc::wrath_tables::world_map_area::WorldMapArea;
use wow_mpq::PatchChain;

// Same chain as src/client_assets.rs — keep in sync if that file evolves.
const BASE_MPQS: &[&str] = &[
    "common.MPQ",
    "common-2.MPQ",
    "expansion.MPQ",
    "lichking.MPQ",
    "patch.MPQ",
    "patch-2.MPQ",
    "patch-3.MPQ",
];
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

const WORLD_MAP_AREA_PATH: &str = "DBFilesClient\\WorldMapArea.dbc";

#[derive(Serialize)]
struct ZoneMeta {
    map_id: i32,
    area_id: i32,
    /// Internal zone name — same as the BLP folder. Used to find the
    /// BLPs under `Interface\WorldMap\<dir_name>\`.
    dir_name: String,
    /// In-game user-facing name (when set; some rows have it blank).
    area_name: String,
    /// Loc bounding box in world coords. Top-left / bottom-right
    /// corners on the map plane. Lets the frontend convert world XY
    /// to image-relative XY for pinning teleport locations.
    loc_left: f32,
    loc_right: f32,
    loc_top: f32,
    loc_bottom: f32,
    /// Resolved BLP→PNG outputs (relative to the output dir). Up to 4
    /// per zone: dir_name + 1, 2, 3, 4.
    tiles: Vec<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "usage: extract_world_maps <wow_install_dir> <output_dir>\n\
             example: cargo run --release --example extract_world_maps -- \\\n\
             \t/home/veil/ChromieCraft_3.3.5a /home/veil/dev/wow-assets/world-maps"
        );
        std::process::exit(2);
    }
    let install_dir = PathBuf::from(&args[1]);
    let out_dir = PathBuf::from(&args[2]);
    fs::create_dir_all(&out_dir)?;

    let mut chain = open_chain(&install_dir)?;

    // ── Parse WorldMapArea.dbc for canonical zone list + bounds. ──
    let dbc_bytes = chain
        .read_file(WORLD_MAP_AREA_PATH)
        .map_err(|e| format!("read {WORLD_MAP_AREA_PATH}: {e}"))?;
    let dbc = WorldMapArea::read(&mut Cursor::new(dbc_bytes))?;
    println!("WorldMapArea rows: {}", dbc.rows.len());

    let mut zones: BTreeMap<String, ZoneMeta> = BTreeMap::new();
    // De-dupe by area_name dir (some rows share the same zone art).
    let mut seen_dirs: BTreeSet<String> = BTreeSet::new();
    for row in &dbc.rows {
        if row.area_name.trim().is_empty() {
            continue;
        }
        let dir_name = row.area_name.trim().to_string();
        if !seen_dirs.insert(dir_name.clone()) {
            continue;
        }
        zones.insert(
            dir_name.clone(),
            ZoneMeta {
                map_id: row.map_id.id,
                area_id: row.area_id.id,
                dir_name: dir_name.clone(),
                // User-facing name isn't in WorldMapArea.dbc — would
                // need AreaTable.dbc[area_id].name join. v1 leaves
                // blank; user can wire later.
                area_name: String::new(),
                loc_left: row.loc_left,
                loc_right: row.loc_right,
                loc_top: row.loc_top,
                loc_bottom: row.loc_bottom,
                tiles: Vec::new(),
            },
        );
    }
    println!("unique zone dirs: {}", zones.len());

    // ── For each zone, try the 4 tile filenames + decode. Missing
    //    tiles (common for instance maps with single-tile renders) are
    //    silently skipped — wow_mpq returns NotFound.
    let mut total_tiles = 0usize;
    let mut failed: Vec<String> = Vec::new();
    for (dir_name, meta) in zones.iter_mut() {
        let zone_out = out_dir.join(dir_name);
        let mut any_written = false;
        for tile_idx in 1..=4 {
            let mpq_path = format!("Interface\\WorldMap\\{dir_name}\\{dir_name}{tile_idx}.blp");
            let bytes = match chain.read_file(&mpq_path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            if !any_written {
                fs::create_dir_all(&zone_out)?;
                any_written = true;
            }
            let png_name = format!("{dir_name}{tile_idx}.png");
            let png_path = zone_out.join(&png_name);
            match decode_blp_to_png(&bytes, &png_path) {
                Ok(()) => {
                    meta.tiles.push(format!("{dir_name}/{png_name}"));
                    total_tiles += 1;
                }
                Err(e) => failed.push(format!("{mpq_path}: {e}")),
            }
        }
        if !any_written {
            // Zone had no BLPs at any of the 4 tile slots — rare but
            // happens for instance entries that ship without map art.
            // Keep the metadata in the index so the consumer knows
            // the zone exists; just no tiles attached.
        }
    }

    // ── Persist the index. Frontend can read this to build the zone
    //    list + pin-coord transforms without re-parsing the DBC. ──
    let index_path = out_dir.join("world-map-index.json");
    let index_json = serde_json::to_string_pretty(&zones)?;
    fs::write(&index_path, index_json)?;

    println!("\ntotal PNG tiles written: {}", total_tiles);
    println!("index: {}", index_path.display());
    if !failed.is_empty() {
        println!("\n{} BLPs failed to decode:", failed.len());
        for f in failed.iter().take(20) {
            println!("  {}", f);
        }
        if failed.len() > 20 {
            println!("  ... and {} more", failed.len() - 20);
        }
    }
    Ok(())
}

fn open_chain(install_dir: &Path) -> Result<PatchChain, Box<dyn std::error::Error>> {
    let data_dir = install_dir.join("Data");
    if !data_dir.is_dir() {
        return Err(format!("Data/ not found at {}", data_dir.display()).into());
    }
    let mut chain = PatchChain::new();
    let mut priority = 0i32;
    for name in BASE_MPQS {
        let path = data_dir.join(name);
        if !path.exists() {
            continue;
        }
        chain.add_archive(&path, priority)?;
        priority += 1;
    }
    let locale_root = data_dir.join(LOCALE_DIR);
    for name in LOCALE_MPQS {
        let path = locale_root.join(name);
        if !path.exists() {
            continue;
        }
        chain.add_archive(&path, priority)?;
        priority += 1;
    }
    Ok(chain)
}

fn decode_blp_to_png(bytes: &[u8], out_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let blp = load_blp_from_buf(bytes).map_err(|e| format!("blp parse: {e:?}"))?;
    // mipmap 0 is the full-resolution image. Smaller indices are the
    // downsampled mipmaps; not useful for the zone-map use case.
    let img = blp_to_image(&blp, 0).map_err(|e| format!("blp decode: {e:?}"))?;
    img.save(out_path)?;
    Ok(())
}
