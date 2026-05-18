//! Module management commands for the Tauri UI.
//!
//! Responsibilities:
//! - Discover which user modules are installed under `~/wow-server-*/modules/`.
//! - Parse each module's active conf (`env/dist/etc/modules/<name>.conf`) into
//!   a key/value map so the Modules page can show current settings.
//! - Query the running database for character lists (used by the AH Bot
//!   character-config wizard).
//! - Write AH Bot character config (account + GUID + EnableSeller=1) and
//!   trigger a worldserver restart so the config is picked up.
//!
//! All write operations mirror the post-install patterns in
//! `manage-wow-modules.sh` — we re-implement them in Rust so the UI can drive
//! them without spawning the interactive shell tool.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Static registry mirroring `USER_MODULE_REGISTRY` in install-wow-ui.sh.
/// Used to give modules a friendly name on the Modules page and to know
/// which conf basename to look up. The `conf_basename` is the
/// `.conf.dist` name without the `.dist` suffix.
const MODULE_REGISTRY: &[(&str, &str)] = &[
    ("mod-ah-bot", "Auction House Bot"),
    ("mod-solocraft", "Solocraft"),
    ("mod-aoe-loot", "AoE Loot"),
    ("mod-learn-spells", "Learn Spells on Levelup"),
    ("mod-individual-progression", "Individual Progression"),
    ("mod-autobalance", "Auto Balance"),
    ("mod-transmog", "Transmogrification"),
    ("mod-1v1-arena", "1v1 Arena"),
];

#[derive(Serialize, Clone, Debug)]
pub struct InstalledModule {
    /// Repo key (e.g. `mod-ah-bot`).
    pub key: String,
    /// Display name (e.g. "Auction House Bot").
    pub name: String,
    /// Absolute path to the module dir on disk.
    pub module_path: String,
    /// Absolute path to the active conf file, or None if no conf is
    /// present yet (e.g. module was cloned but worldserver hasn't run).
    pub conf_path: Option<String>,
    /// Parsed `key = value` pairs from the conf. Comments and blank
    /// lines are dropped; AC's `[section]` headers are stored under the
    /// special key `__section__` (last one wins). Used by the UI to
    /// render current values.
    pub conf: HashMap<String, String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Character {
    pub guid: u64,
    pub name: String,
    pub account: u64,
    pub level: u32,
    pub race: u32,
    pub class: u32,
}

/// Find the first install dir under $HOME starting with `wow-server` that
/// contains a docker-compose.yml. Same logic the install.rs uses.
fn first_install_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let entries = std::fs::read_dir(&home).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("wow-server") {
            continue;
        }
        if path.join("docker-compose.yml").exists() {
            return Some(path);
        }
    }
    None
}

/// Parse an AC-style conf file into a key/value map. Handles:
/// - `key = value` lines (whitespace tolerant)
/// - `#` comments (line and inline — inline only if preceded by whitespace,
///   so `Foo.Path = /etc/something#weird` stays intact)
/// - `[section]` headers (stored as `__section__` so callers can see the
///   active section if they care)
/// - Quoted values: trailing `"..."` is preserved verbatim.
fn parse_conf(path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return out,
    };
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            out.insert("__section__".into(), line[1..line.len() - 1].to_string());
            continue;
        }
        let Some(eq_pos) = line.find('=') else { continue };
        let key = line[..eq_pos].trim().to_string();
        let mut value = line[eq_pos + 1..].trim().to_string();
        // Strip trailing inline comment if preceded by whitespace —
        // matches conf parsers in the AC ecosystem.
        if let Some(hash_pos) = value.find(" #") {
            value = value[..hash_pos].trim_end().to_string();
        }
        if !key.is_empty() {
            out.insert(key, value);
        }
    }
    out
}

/// Find the active conf file for a module dir. Convention from
/// install-wow-ui.sh:apply_module_overrides — we copy
/// `<module>/conf/*.conf.dist` to `<install>/env/dist/etc/modules/<basename>.conf`,
/// dropping the `.dist`. So we glob `env/dist/etc/modules/` for any `.conf`
/// (not `.conf.dist`) and try to match against the module's own conf
/// basenames.
fn find_active_conf(install_path: &Path, module_dir: &Path) -> Option<PathBuf> {
    // What conf basenames does this module ship?
    let conf_src = module_dir.join("conf");
    let conf_names: Vec<String> = walk_for_conf_dist(&conf_src)
        .into_iter()
        .filter_map(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.trim_end_matches(".dist").to_string())
        })
        .collect();
    if conf_names.is_empty() {
        return None;
    }
    let active_dir = install_path.join("env/dist/etc/modules");
    for basename in &conf_names {
        let candidate = active_dir.join(basename);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn walk_for_conf_dist(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk_for_conf_dist(&path));
        } else if path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".conf.dist")) {
            out.push(path);
        }
    }
    out
}

#[tauri::command]
pub fn list_installed_modules() -> Result<Vec<InstalledModule>, String> {
    let install_path = first_install_path()
        .ok_or_else(|| "no install detected".to_string())?;
    let modules_dir = install_path.join("modules");
    if !modules_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (key, name) in MODULE_REGISTRY {
        let module_path = modules_dir.join(key);
        if !module_path.is_dir() {
            continue;
        }
        let conf_path = find_active_conf(&install_path, &module_path);
        let conf = conf_path
            .as_ref()
            .map(|p| parse_conf(p))
            .unwrap_or_default();
        out.push(InstalledModule {
            key: key.to_string(),
            name: name.to_string(),
            module_path: module_path.to_string_lossy().into_owned(),
            conf_path: conf_path.map(|p| p.to_string_lossy().into_owned()),
            conf,
        });
    }
    Ok(out)
}

/// Query the running ac-database container for characters. We shell out
/// to `docker exec ac-database mysql ...` rather than holding a sqlx
/// connection — keeps the surface small and matches the manage-wow-
/// modules.sh pattern (configure_ahbot:1003-1014).
#[tauri::command]
pub fn list_characters() -> Result<Vec<Character>, String> {
    let container = find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())?;
    // Exclude characters owned by:
    //   - RNDBOT% accounts  — Playerbots spawns ~700 random bots and they'd
    //     swamp the dropdown; users never want to pick one of them for AH Bot
    //     (per README warning, the AHB character shouldn't be "active" elsewhere).
    //   - AHBOT             — our own bootstrap-created seller account. The
    //     wizard is for OVERRIDING the default with a user character, so
    //     showing the internal AHBOT row would just be confusing.
    let out = std::process::Command::new("docker")
        .args([
            "exec",
            &container,
            "mysql",
            "-uroot",
            "-ppassword",
            "-N",
            "-B",
            "-e",
            "SELECT c.guid, c.name, c.account, c.level, c.race, c.class \
             FROM acore_characters.characters c \
             JOIN acore_auth.account a ON a.id = c.account \
             WHERE a.username NOT LIKE 'RNDBOT%' \
               AND a.username <> 'AHBOT' \
             ORDER BY c.guid;",
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "mysql query failed (exit {:?}): {}",
            out.status.code(),
            err.trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut chars = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 6 {
            continue;
        }
        let parse_u64 = |s: &str| s.trim().parse::<u64>().ok();
        let parse_u32 = |s: &str| s.trim().parse::<u32>().ok();
        let (Some(guid), Some(account), Some(level), Some(race), Some(class)) = (
            parse_u64(parts[0]),
            parse_u64(parts[2]),
            parse_u32(parts[3]),
            parse_u32(parts[4]),
            parse_u32(parts[5]),
        ) else {
            continue;
        };
        chars.push(Character {
            guid,
            name: parts[1].trim().to_string(),
            account,
            level,
            race,
            class,
        });
    }
    Ok(chars)
}

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

/// Rewrite (or append) a `key = value` pair in a conf file in place.
/// Mirrors `conf_set` in install-wow-ui.sh. Matches the key with
/// optional leading whitespace and `=` separator.
fn conf_set_inplace(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    let mut found = false;
    let mut out_lines: Vec<String> = Vec::with_capacity(content.lines().count() + 1);
    for raw_line in content.lines() {
        let trimmed_start = raw_line.trim_start();
        // Match keys at line start (after any leading whitespace),
        // followed by `=` or whitespace then `=`. Avoid matching keys
        // that share a prefix (e.g. `AuctionHouseBot.GUIDs` vs `.GUID`).
        let candidate = trimmed_start
            .split_once('=')
            .map(|(k, _)| k.trim().to_string());
        if candidate.as_deref() == Some(key) {
            out_lines.push(format!("{key} = {value}"));
            found = true;
        } else {
            out_lines.push(raw_line.to_string());
        }
    }
    if !found {
        out_lines.push(format!("{key} = {value}"));
    }
    let mut new_content = out_lines.join("\n");
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }
    std::fs::write(path, new_content)
        .map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

/// Write AH Bot character config to the active mod_ahbot.conf and flip
/// EnableSeller on. The caller is expected to follow up with
/// `restart_server` (a frontend chain — keeps this command synchronous).
#[tauri::command]
pub fn configure_ahbot_character(account: u64, guid: u64) -> Result<(), String> {
    let install_path = first_install_path()
        .ok_or_else(|| "no install detected".to_string())?;
    let modules_dir = install_path.join("modules");
    let module_dir = modules_dir.join("mod-ah-bot");
    if !module_dir.is_dir() {
        return Err("mod-ah-bot is not installed".into());
    }
    let conf_path = find_active_conf(&install_path, &module_dir)
        .ok_or_else(|| "mod_ahbot.conf not found — has the server run at least once?".to_string())?;

    conf_set_inplace(&conf_path, "AuctionHouseBot.Account", &account.to_string())?;
    conf_set_inplace(&conf_path, "AuctionHouseBot.GUID", &guid.to_string())?;
    conf_set_inplace(&conf_path, "AuctionHouseBot.GUIDs", &format!("\"{guid}\""))?;
    conf_set_inplace(&conf_path, "AuctionHouseBot.EnableSeller", "1")?;

    Ok(())
}
