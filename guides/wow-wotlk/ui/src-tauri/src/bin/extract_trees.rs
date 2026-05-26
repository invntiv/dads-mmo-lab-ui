//! CLI for the talent-tree extractor. Same function the in-app
//! Settings panel calls — exposed here so we can run it during
//! development without spinning up the full Tauri webview.
//!
//! Usage (from src-tauri/):
//!   cargo run --bin extract_trees
//!
//! Reads `wow_client_dir` from the app settings file
//! (`~/.config/dads-mmo-lab/settings.json` on Linux) and writes
//! `<repo>/src/lib/talent-trees.json`.

fn main() {
    match tauri_native_lib::talent_trees::build_talent_trees() {
        Ok(r) => {
            println!(
                "OK — {} talents across {} classes",
                r.talent_count, r.class_count
            );
            println!("output: {}", r.output_path);
        }
        Err(e) => {
            eprintln!("ERR: {}", e);
            std::process::exit(1);
        }
    }
}
