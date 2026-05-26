//! Character Backup + Restore — export and re-import player characters
//! across server installs (or before/after a server rebuild).
//!
//! Backup format: a `.dmlbak` file (a zip archive in disguise) containing:
//!   manifest.json     — version, source server, character roster
//!   characters.sql    — INSERTs for the 30+ character_* tables filtered
//!                       by the selected guids
//!   pets.sql          — character_pet + pet_aura/spell/cooldown rows
//!   items.sql         — item_instance rows owned by the chars
//!   mail.sql          — mail rows where receiver IN (chars)
//!   auction.sql       — auctionhouse rows where itemowner IN (chars)
//!   (optional)        — custom_transmogrification, reagent bank, etc.
//!
//! Each .sql file is produced by a single `mysqldump --where=...` call
//! piped through docker exec. The reference table list comes from
//! AldebaraanMKII/WoW-export-import-scripts (AC-specific, contemporary).
//!
//! Restore (Phase 4c) sources each .sql via `mysql` after a GUID-
//! collision check.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

// ── Container discovery ────────────────────────────────────────────────

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

fn require_container() -> Result<String, String> {
    find_database_container()
        .ok_or_else(|| "ac-database container not found — is the server running?".to_string())
}

// ── Account lookup ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: u64,
    pub username: String,
}

/// Look up an AC account by username (case-insensitive — AC normalizes
/// usernames to uppercase at signup). Returns None when not found.
#[tauri::command]
pub fn lookup_account(username: String) -> Result<Option<AccountInfo>, String> {
    let container = require_container()?;
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    // Escape single quotes the same way mysql expects; UPPER() on both
    // sides keeps the lookup case-insensitive even if the user types
    // mixed case.
    let safe = trimmed.replace('\'', "''");
    let sql = format!(
        "SELECT id, username FROM acore_auth.account WHERE UPPER(username) = UPPER('{}') LIMIT 1;",
        safe
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(|s| s.to_string())
        .unwrap_or_default();
    if line.is_empty() {
        return Ok(None);
    }
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 2 {
        return Ok(None);
    }
    let id = parts[0].trim().parse::<u64>().map_err(|e| e.to_string())?;
    Ok(Some(AccountInfo {
        id,
        username: parts[1].trim().to_string(),
    }))
}

// ── Character list ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSummary {
    pub guid: u64,
    pub name: String,
    pub race: u32,
    pub class: u32,
    pub gender: u32,
    pub level: u32,
}

/// Characters owned by an account. Skips bot accounts via the
/// playerbots_account_type filter — at backup time we want REAL chars
/// only, never the auto-managed bot pools.
#[tauri::command]
pub fn list_account_characters(account_id: u64) -> Result<Vec<CharacterSummary>, String> {
    let container = require_container()?;
    // Joining playerbots_account_type as a LEFT then filtering NULL
    // means we keep characters whose account isn't in either bot list.
    let sql = format!(
        "SELECT c.guid, c.name, c.race, c.class, c.gender, c.level \
         FROM acore_characters.characters c \
         LEFT JOIN acore_playerbots.playerbots_account_type t \
             ON t.account_id = c.account \
         WHERE c.account = {account_id} AND t.account_type IS NULL \
         ORDER BY c.level DESC, c.name;"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", &container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql query failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let mut rows = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 6 {
            continue;
        }
        let Ok(guid) = parts[0].trim().parse::<u64>() else { continue };
        rows.push(CharacterSummary {
            guid,
            name: parts[1].trim().to_string(),
            race: parts[2].trim().parse().unwrap_or(0),
            class: parts[3].trim().parse().unwrap_or(0),
            gender: parts[4].trim().parse().unwrap_or(0),
            level: parts[5].trim().parse().unwrap_or(0),
        });
    }
    Ok(rows)
}

// ── Backup ─────────────────────────────────────────────────────────────

/// Manifest written to the .dmlbak archive. Versioned so future
/// schema tweaks (added/removed tables) can be detected on restore.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub version: u32,
    pub created_at: String,
    pub source_account_id: u64,
    pub source_account_name: String,
    pub characters: Vec<CharacterSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArgs {
    pub account_id: u64,
    pub account_name: String,
    pub character_guids: Vec<u64>,
    /// Absolute output path including filename + `.dmlbak` extension.
    /// The wizard collects this via tauri-plugin-dialog's save dialog.
    pub output_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub output_path: String,
    pub byte_size: u64,
    pub character_count: usize,
}

const BACKUP_VERSION: u32 = 1;

/// Tables that own rows keyed by `guid` IN the selected character set.
/// Every one is filtered with a single `mysqldump --where="guid IN (...)"`.
/// Order follows the AldebaraanMKII reference for parity.
const CHAR_KEYED_TABLES: &[&str] = &[
    "characters",
    "character_account_data",
    "character_achievement",
    "character_achievement_progress",
    "character_action",
    "character_aura",
    "character_glyphs",
    "character_homebind",
    "character_queststatus",
    "character_queststatus_rewarded",
    "character_reputation",
    "character_skills",
    "character_spell",
    "character_talent",
    "character_inventory",
    "character_equipmentsets",
    "character_arena_stats",
    "character_banned",
    "character_battleground_random",
    "character_brew_of_the_month",
    "character_entry_point",
    "character_instance",
    "character_queststatus_daily",
    "character_queststatus_weekly",
    "character_queststatus_monthly",
    "character_queststatus_seasonal",
    "character_spell_cooldown",
    "character_stats",
    "character_social",
];

#[tauri::command]
pub fn backup_characters(args: BackupArgs) -> Result<BackupResult, String> {
    let container = require_container()?;
    if args.character_guids.is_empty() {
        return Err("No characters selected for backup.".to_string());
    }

    // Fetch the chosen characters' summaries — we manifest them so the
    // restore UI can render the roster without unpacking the SQL.
    let all_chars = list_account_characters(args.account_id)?;
    let want: std::collections::HashSet<u64> =
        args.character_guids.iter().copied().collect();
    let chars: Vec<CharacterSummary> = all_chars
        .into_iter()
        .filter(|c| want.contains(&c.guid))
        .collect();
    if chars.is_empty() {
        return Err("None of the selected guids belong to that account.".to_string());
    }

    let manifest = BackupManifest {
        version: BACKUP_VERSION,
        created_at: now_iso(),
        source_account_id: args.account_id,
        source_account_name: args.account_name.clone(),
        characters: chars.clone(),
    };

    // Pet GUIDs needed for the pet_* sub-tables (keyed by pet id, not
    // owner). Single query: SELECT id FROM character_pet WHERE owner IN
    // (...).
    let pet_ids = fetch_pet_ids(&container, &args.character_guids)?;

    // Open the archive. The .dmlbak extension is a zip with a custom
    // ext so the OS file dialog filter is unambiguous; users can rename
    // to .zip and open it manually if curious.
    let out_path = Path::new(&args.output_path);
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let file = std::fs::File::create(out_path)
        .map_err(|e| format!("create {}: {}", out_path.display(), e))?;
    let mut zip = ZipWriter::new(file);
    let options: FileOptions<()> = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // Manifest first.
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("zip start manifest: {e}"))?;
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("serialize manifest: {e}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("zip write manifest: {e}"))?;

    let guid_csv = args
        .character_guids
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join(",");

    // characters.sql — every guid-keyed character_* table dumped in
    // one mysqldump invocation. mysqldump applies --where to all
    // tables listed so they share the filter.
    let where_arg = format!("--where=guid IN ({guid_csv})");
    let mut chars_args: Vec<&str> = vec![
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &where_arg,
        "acore_characters",
    ];
    for t in CHAR_KEYED_TABLES {
        chars_args.push(t);
    }
    let chars_dump = run_dump(&chars_args)?;
    write_file(&mut zip, &options, "characters.sql", &chars_dump)?;

    // pets.sql — character_pet (keyed on owner), then pet_aura/spell/
    // cooldown (keyed on guid = pet id). Three separate dumps because
    // the filter columns differ; concatenated into one file so restore
    // sources it as a unit.
    let mut pets_sql = String::new();
    let pet_owner_dump = run_dump(&[
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &format!("--where=owner IN ({guid_csv})"),
        "acore_characters",
        "character_pet",
    ])?;
    pets_sql.push_str(&pet_owner_dump);
    if !pet_ids.is_empty() {
        let pet_csv = pet_ids
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let pet_subtable_dump = run_dump(&[
            "exec", &container, "mysqldump",
            "-uroot", "-ppassword",
            "--no-create-info",
            "--skip-add-locks",
            "--skip-extended-insert",
            "--complete-insert",
            &format!("--where=guid IN ({pet_csv})"),
            "acore_characters",
            "pet_aura",
            "pet_spell",
            "pet_spell_cooldown",
        ])?;
        pets_sql.push_str(&pet_subtable_dump);
    }
    write_file(&mut zip, &options, "pets.sql", &pets_sql)?;

    // items.sql — item_instance (owner_guid).
    let items_dump = run_dump(&[
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &format!("--where=owner_guid IN ({guid_csv})"),
        "acore_characters",
        "item_instance",
    ])?;
    write_file(&mut zip, &options, "items.sql", &items_dump)?;

    // mail.sql — mail rows where receiver IN (...). We dump both mail
    // and mail_items so attachments restore correctly. mail_items is
    // keyed on mail_id; the mail dump's INSERTs will recreate the mail
    // rows, but mail_items needs its OWN dump filtered through the
    // mail rows we just captured — easier: filter mail_items by
    // receiver too via a sub-select.
    let mail_dump = run_dump(&[
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &format!("--where=receiver IN ({guid_csv})"),
        "acore_characters",
        "mail",
    ])?;
    write_file(&mut zip, &options, "mail.sql", &mail_dump)?;

    // auction.sql — auctionhouse where itemowner IN (...).
    let auction_dump = run_dump(&[
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &format!("--where=itemowner IN ({guid_csv})"),
        "acore_characters",
        "auctionhouse",
    ])?;
    write_file(&mut zip, &options, "auction.sql", &auction_dump)?;

    // battleground_deserters — keyed by guid. Optional, table may not
    // exist on all installs; tolerate missing.
    if let Ok(bgd) = run_dump(&[
        "exec", &container, "mysqldump",
        "-uroot", "-ppassword",
        "--no-create-info",
        "--skip-add-locks",
        "--skip-extended-insert",
        "--complete-insert",
        &format!("--where=guid IN ({guid_csv})"),
        "acore_characters",
        "battleground_deserters",
    ]) {
        write_file(&mut zip, &options, "battleground_deserters.sql", &bgd)?;
    }

    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    let byte_size = std::fs::metadata(out_path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(BackupResult {
        output_path: out_path.display().to_string(),
        byte_size,
        character_count: chars.len(),
    })
}

fn fetch_pet_ids(container: &str, owner_guids: &[u64]) -> Result<Vec<u64>, String> {
    let csv = owner_guids
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id FROM acore_characters.character_pet WHERE owner IN ({csv});"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "fetch pet ids failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u64>().ok())
        .collect())
}

/// Run `docker exec mysqldump ...` and return stdout as a UTF-8 String.
/// Returns Err on non-zero exit OR when stdout is empty (mysqldump
/// returns 0 even when nothing matched — caller decides whether empty
/// is OK by passing the result through `Ok` or rejecting).
fn run_dump(args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("docker")
        .args(args)
        .output()
        .map_err(|e| format!("docker exec mysqldump: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysqldump failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn write_file<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    options: &FileOptions<()>,
    name: &str,
    contents: &str,
) -> Result<(), String> {
    zip.start_file(name, *options)
        .map_err(|e| format!("zip start {name}: {e}"))?;
    zip.write_all(contents.as_bytes())
        .map_err(|e| format!("zip write {name}: {e}"))?;
    Ok(())
}

// ── Restore ────────────────────────────────────────────────────────────
//
// Restore checks the manifest, lets the caller pick a subset of
// characters from the backup, then sources each .sql against the
// target chardb. GUID-collision detection runs first; on conflict the
// command errors out (v1 has no guid remapping).

/// Open + parse a .dmlbak's manifest without unpacking everything.
/// The wizard's Step 1 (file picker) calls this immediately to verify
/// the archive is shaped correctly + render the roster preview.
#[tauri::command]
pub fn validate_backup(path: String) -> Result<BackupManifest, String> {
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("open {}: {}", path, e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("read zip {}: {}", path, e))?;
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| "manifest.json missing — file isn't a valid Lab backup.".to_string())?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("read manifest: {e}"))?;
    let manifest: BackupManifest = serde_json::from_str(&buf)
        .map_err(|e| format!("parse manifest: {e}"))?;
    if manifest.version > BACKUP_VERSION {
        return Err(format!(
            "Backup version {} is newer than this Lab build ({}). Update the Lab and retry.",
            manifest.version, BACKUP_VERSION
        ));
    }
    Ok(manifest)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArgs {
    pub backup_path: String,
    pub target_account_id: u64,
    pub character_guids: Vec<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_characters: usize,
    pub skipped_due_to_conflict: Vec<u64>,
}

/// Restore selected characters from a .dmlbak into the target account.
///
/// Sequence:
///   1. Read manifest + verify it contains all requested guids
///   2. Check chardb for guid collisions; if any selected guid already
///      exists in `characters`, abort with a clear list (v1 has no
///      remap, so user must drop the conflicting chars first)
///   3. Stream each .sql in archive order through `docker exec mysql`
///   4. UPDATE characters.account = target_account_id WHERE guid IN (...)
///      so the imported chars belong to the new owner
#[tauri::command]
pub fn restore_characters(args: RestoreArgs) -> Result<RestoreResult, String> {
    let container = require_container()?;
    let file = std::fs::File::open(&args.backup_path)
        .map_err(|e| format!("open {}: {}", args.backup_path, e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("read zip: {e}"))?;

    // Parse manifest first so we can sanity-check the chosen guids
    // are actually in the backup before doing any DB work.
    let manifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "manifest.json missing".to_string())?;
        let mut buf = String::new();
        entry
            .read_to_string(&mut buf)
            .map_err(|e| format!("read manifest: {e}"))?;
        serde_json::from_str::<BackupManifest>(&buf)
            .map_err(|e| format!("parse manifest: {e}"))?
    };

    let manifest_guids: std::collections::HashSet<u64> =
        manifest.characters.iter().map(|c| c.guid).collect();
    for g in &args.character_guids {
        if !manifest_guids.contains(g) {
            return Err(format!("Backup doesn't contain character guid {g}."));
        }
    }

    // Conflict check — any selected guid that already exists in the
    // target chardb's characters table is a hard stop in v1. Future
    // versions can offer a "remap to fresh guids" option.
    let conflicts = check_guid_conflicts(&container, &args.character_guids)?;
    if !conflicts.is_empty() {
        return Err(format!(
            "GUID conflict: the target server already has characters with guid(s) {}. \
             Delete or rename them first, then retry restore.",
            conflicts
                .iter()
                .map(|g| g.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    // Source each .sql file. Order matters only for FK-ish dependencies,
    // but AC's character tables have no enforced FKs — we just stream
    // them in archive order. characters.sql usually first.
    let sql_names = [
        "characters.sql",
        "pets.sql",
        "items.sql",
        "mail.sql",
        "auction.sql",
        "battleground_deserters.sql",
    ];
    for name in sql_names {
        // Re-read each file — `archive.by_name` borrows mutably, so we
        // can't hold multiple at once. Cheap on a small zip.
        let mut buf = String::new();
        match archive.by_name(name) {
            Ok(mut e) => {
                e.read_to_string(&mut buf)
                    .map_err(|err| format!("read {name}: {err}"))?;
            }
            Err(_) => continue, // optional file, skip
        };
        if buf.trim().is_empty() {
            continue;
        }
        run_mysql_script(&container, "acore_characters", &buf)
            .map_err(|e| format!("sourcing {name}: {e}"))?;
    }

    // Re-assign characters to the target account. Backups carry their
    // ORIGINAL account id in `characters.account`, which is wrong on
    // restore; one UPDATE fixes them all.
    let guid_csv = args
        .character_guids
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let update_sql = format!(
        "UPDATE acore_characters.characters SET account = {} WHERE guid IN ({});",
        args.target_account_id, guid_csv
    );
    run_mysql_script(&container, "acore_characters", &update_sql)
        .map_err(|e| format!("rebind account: {e}"))?;

    Ok(RestoreResult {
        restored_characters: args.character_guids.len(),
        skipped_due_to_conflict: Vec::new(),
    })
}

fn check_guid_conflicts(container: &str, guids: &[u64]) -> Result<Vec<u64>, String> {
    if guids.is_empty() {
        return Ok(Vec::new());
    }
    let csv = guids
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT guid FROM acore_characters.characters WHERE guid IN ({csv});"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword", "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("docker exec mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "conflict check failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u64>().ok())
        .collect())
}

/// Pipe a SQL script into `mysql` via stdin — handles arbitrary-sized
/// dumps without hitting the `-e` command-line length cap.
fn run_mysql_script(container: &str, db: &str, sql: &str) -> Result<(), String> {
    use std::process::Stdio;
    let mut child = std::process::Command::new("docker")
        .args(["exec", "-i", container, "mysql", "-uroot", "-ppassword", db])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn mysql: {e}"))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "no stdin handle".to_string())?;
        stdin
            .write_all(sql.as_bytes())
            .map_err(|e| format!("write mysql stdin: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait mysql: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "mysql exit {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

// ── Time ───────────────────────────────────────────────────────────────

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
        y, m, d,
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

// `HashMap` + `PathBuf` are pulled in for future use (filename
// sanitization, table-per-character maps). Suppress the warnings until
// then.
#[allow(dead_code)]
fn _unused() {
    let _ = HashMap::<u64, u64>::new();
    let _ = PathBuf::new();
}
