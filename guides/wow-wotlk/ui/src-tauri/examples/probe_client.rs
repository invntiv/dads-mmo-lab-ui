//! One-off probe binary — inventory the relevant files inside a WoW
//! 3.3.5a Data/ directory so we know which MPQ holds which DBC, how
//! big the texture trees are, etc. Not shipped; run manually to map
//! out future enrichment paths.
//!
//! Run: `cargo run --release --example probe_client -- /path/to/wow_install`

use std::collections::BTreeMap;
use std::env;
use std::path::{Path, PathBuf};

use wow_mpq::PatchChain;

// Same order as in src/client_assets.rs — lower priority first, later
// patches override. Locale MPQs added LAST so they override DBCs with
// localized variants where present.
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let install_dir = env::args()
        .nth(1)
        .ok_or("usage: probe_client <wow_install_dir>")?;
    let data_dir = PathBuf::from(&install_dir).join("Data");
    if !data_dir.is_dir() {
        return Err(format!("Data/ not found at {}", data_dir.display()).into());
    }

    // Per-archive listings — track which MPQ each interesting file
    // came from so we know where overrides land.
    let mut chain = PatchChain::new();
    let mut priority = 0i32;

    let mut individual: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for name in BASE_MPQS {
        let path = data_dir.join(name);
        if !path.exists() { continue; }
        try_add(&mut chain, &path, priority, name, &mut individual);
        priority += 1;
    }
    let locale_root = data_dir.join(LOCALE_DIR);
    for name in LOCALE_MPQS {
        let path = locale_root.join(name);
        if !path.exists() { continue; }
        try_add(&mut chain, &path, priority, name, &mut individual);
        priority += 1;
    }

    println!("\n========= PER-MPQ FILE-OF-INTEREST COUNTS =========");
    for (mpq, files) in &individual {
        let dbcs = files.iter().filter(|f| f.contains("DBFilesClient")).count();
        let icons = files.iter().filter(|f| f.contains("Interface\\ICONS")).count();
        let minimap = files.iter().filter(|f| f.contains("Textures\\Minimap")).count();
        let world_maps = files.iter().filter(|f| f.contains("Interface\\WorldMap")).count();
        println!(
            "{:32}  dbc={:5}  icons={:6}  minimap={:5}  worldmap={:5}",
            mpq, dbcs, icons, minimap, world_maps
        );
    }

    // Merged-chain DBC listing — which DBCs are visible after patches
    // applied. Source of truth for what `wow-dbc` can read.
    println!("\n========= MERGED CHAIN — DBFilesClient/*.dbc =========");
    let all = chain.list()?;
    let mut dbcs: Vec<String> = all
        .iter()
        .filter_map(|e| {
            if e.name.starts_with("DBFilesClient\\") && e.name.ends_with(".dbc") {
                Some(e.name.clone())
            } else {
                None
            }
        })
        .collect();
    dbcs.sort();
    dbcs.dedup();
    println!("({} unique DBCs)", dbcs.len());
    for d in &dbcs {
        println!("  {}", d);
    }

    println!("\n========= NOTABLE OTHER ASSETS =========");
    let count_prefix = |prefix: &str| {
        all.iter().filter(|e| e.name.starts_with(prefix)).count()
    };
    println!("Interface\\ICONS\\*           {:7}", count_prefix("Interface\\ICONS"));
    println!("Interface\\GLUES\\*           {:7}", count_prefix("Interface\\GLUES"));
    println!("Interface\\WorldMap\\*        {:7}", count_prefix("Interface\\WorldMap"));
    println!("Textures\\Minimap\\*          {:7}", count_prefix("Textures\\Minimap"));
    println!("Sound\\Spells\\*              {:7}", count_prefix("Sound\\Spells"));
    println!("XML files                    {:7}", all.iter().filter(|e| e.name.ends_with(".xml")).count());
    println!("LUA files                    {:7}", all.iter().filter(|e| e.name.ends_with(".lua")).count());
    println!("BLP files                    {:7}", all.iter().filter(|e| e.name.ends_with(".blp")).count());
    println!("M2  files (models)           {:7}", all.iter().filter(|e| e.name.ends_with(".m2")).count());
    println!("ADT files (terrain)          {:7}", all.iter().filter(|e| e.name.ends_with(".adt")).count());

    // Spot-check: sizes of a few key DBCs we'd extract.
    println!("\n========= SIZE OF KEY DBCs (uncompressed) =========");
    let key_dbcs = [
        "DBFilesClient\\ItemDisplayInfo.dbc",
        "DBFilesClient\\Spell.dbc",
        "DBFilesClient\\SpellIcon.dbc",
        "DBFilesClient\\ItemSet.dbc",
        "DBFilesClient\\Map.dbc",
        "DBFilesClient\\AreaTable.dbc",
        "DBFilesClient\\WorldMapArea.dbc",
        "DBFilesClient\\Achievement.dbc",
        "DBFilesClient\\Talent.dbc",
        "DBFilesClient\\Item.dbc",
        "DBFilesClient\\CreatureDisplayInfo.dbc",
    ];
    for name in key_dbcs {
        match chain.read_file(name) {
            Ok(bytes) => println!("  {:48}  {:>10} bytes", name, bytes.len()),
            Err(e) => println!("  {:48}  NOT FOUND ({})", name, e),
        }
    }

    Ok(())
}

fn try_add(
    chain: &mut PatchChain,
    path: &Path,
    priority: i32,
    name: &str,
    individual: &mut BTreeMap<String, Vec<String>>,
) {
    use wow_mpq::Archive;
    // Add to merged chain.
    if let Err(e) = chain.add_archive(path, priority) {
        eprintln!("  [skip {}] {}", name, e);
        return;
    }
    // Also list its individual contents for the per-MPQ summary.
    match Archive::open(path).and_then(|mut a| a.list()) {
        Ok(files) => {
            let names = files.into_iter().map(|e| e.name).collect();
            individual.insert(name.to_string(), names);
        }
        Err(e) => eprintln!("  [list {}] {}", name, e),
    }
}
