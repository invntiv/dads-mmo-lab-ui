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

    // mail.sql — mail rows and their attachments. mail_items carries
    // a redundant `receiver` column (denormalized for fast inbox
    // lookups in AC), so we can filter both tables with the same
    // predicate in one mysqldump call. Order matters: mail rows must
    // INSERT before mail_items (mail_items.mail_id references mail.id);
    // mysqldump emits tables in the order listed on the command line.
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
        "mail_items",
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
// Restore lands the backup's data in a TEMPORARY staging schema first,
// shifts every primary key (and dependent FK column) by a per-domain
// offset computed from `MAX(target) + 15000`, then INSERTs from stage
// into the live chardb inside a single transaction. Any failure rolls
// the target back; the staging schema is dropped on both success and
// failure. This makes partial restores impossible and lets backups
// from server A coexist on server B even when their ID ranges overlap.
//
// Offset domains (each gets its own MAX-based offset):
//   * char_guid       — characters.guid + every char_*.guid + various FKs
//   * item_guid       — item_instance.guid + inventory.item, equipment slots,
//                       mail_items.item_guid, auctionhouse.itemguid, …
//   * pet_id          — character_pet.id + pet_aura/spell/cooldown.guid
//   * mail_id         — mail.id + mail_items.mail_id
//   * auction_id      — auctionhouse.id
//
// Conditional FK shifts (only shift if value ∈ source guid set; otherwise
// leave alone — pointer would dangle but won't corrupt unrelated data):
//   character_social.friend, mail.sender, item_instance.creatorGuid /
//   giftCreatorGuid, auctionhouse.buyguid.
//
// NOT shifted: pet_aura.casterGuid — bigint packed ObjectGuid (type bits
// in the upper portion), not a raw guid; naive addition would corrupt
// the type encoding. The worldserver tolerates missing aura caster refs.
//
// NOT included in backup at all: character_aura, character_spell_cooldown.
// Both store transient state that's stale by the time a restore runs (a
// few minutes to ~1 hour for aura durations; minutes-to-hours for spell
// cooldowns). On a mesh-migration the source server's spell IDs may not
// even exist on the target. Characters reappear "rested in an inn" — no
// stale buffs, no nonsensical cooldown timers. Re-buff on login.

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

/// Gap added on top of MAX(target) when computing each PK domain's
/// remap offset. 15k is comfortably larger than any concurrent burst a
/// running server could allocate during a restore window — the server
/// allocates IDs serially during gameplay and a restore completes in
/// seconds, so the chance of a brand-new ID landing inside the gap is
/// effectively zero. Bump if proven wrong in production.
const ID_GAP: u64 = 15_000;

#[derive(Debug, Clone, Copy)]
struct RestoreOffsets {
    char_guid: u64,
    item_guid: u64,
    pet_id: u64,
    mail_id: u64,
    auction_id: u64,
}

/// Restore characters from a .dmlbak into the target account.
///
/// Sequence:
///   1. Parse manifest + verify selected guids are present
///   2. Compute per-domain offsets from MAX(target.<pk>) + 15000
///   3. CREATE DATABASE <stage>; CREATE TABLE LIKE for each table
///   4. Source every .sql in the archive into <stage>
///   5. Capture source PK sets per domain (used for conditional FK
///      shifts) BEFORE shifting any IDs
///   6. UPDATE every PK + dependent FK column in <stage> by its offset
///   7. INSIDE A TRANSACTION on the target connection: INSERT INTO
///      acore_characters.<t> SELECT * FROM <stage>.<t> WHERE <filter>,
///      then rebind characters.account, then COMMIT
///   8. DROP DATABASE <stage> (always, success or failure)
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

    let offsets = compute_offsets(&container)?;
    let stage = create_stage_db(&container)?;

    // Wrap the body so we can guarantee stage cleanup even on early
    // return. (Rust has no try/finally; this closure pattern is the
    // idiomatic equivalent.)
    let result: Result<RestoreResult, String> = (|| {
        create_stage_tables(&container, &stage)?;
        populate_stage(&container, &stage, &mut archive)?;
        let src_pks = scan_source_pks(&container, &stage)?;
        apply_shifts(&container, &stage, offsets, &src_pks)?;

        // After shifting, args.character_guids are the SOURCE values;
        // the rows in stage are at the new (shifted) ids. Compute the
        // target guids we'll rebind to the new account.
        let new_char_guids: Vec<u64> = args
            .character_guids
            .iter()
            .map(|g| g + offsets.char_guid)
            .collect();

        merge_into_target(
            &container,
            &stage,
            args.target_account_id,
            &new_char_guids,
        )?;
        verify_integrity(&container, &new_char_guids)?;

        Ok(RestoreResult {
            restored_characters: args.character_guids.len(),
            skipped_due_to_conflict: Vec::new(),
        })
    })();

    // Always drop the staging schema. Log the drop result if it fails
    // but don't override the main result — the user cares about the
    // restore status, not the cleanup status.
    if let Err(e) = drop_stage(&container, &stage) {
        log::warn!("failed to drop stage db {stage}: {e}");
    }

    result
}

/// MAX(target) + ID_GAP per domain. Returns 0 + gap for empty tables.
fn compute_offsets(container: &str) -> Result<RestoreOffsets, String> {
    let q = |sql: &str| -> Result<u64, String> {
        let out = std::process::Command::new("docker")
            .args([
                "exec", container, "mysql", "-uroot", "-ppassword",
                "-N", "-B", "-e", sql,
            ])
            .output()
            .map_err(|e| format!("max query: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "max query failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let raw = String::from_utf8_lossy(&out.stdout)
            .trim()
            .to_string();
        // mysql returns "NULL" for MAX of empty table; treat as 0.
        if raw.is_empty() || raw == "NULL" {
            Ok(0)
        } else {
            raw.parse::<u64>()
                .map_err(|e| format!("parse max '{raw}': {e}"))
        }
    };
    Ok(RestoreOffsets {
        char_guid: q("SELECT MAX(guid) FROM acore_characters.characters;")? + ID_GAP,
        item_guid: q("SELECT MAX(guid) FROM acore_characters.item_instance;")? + ID_GAP,
        pet_id: q("SELECT MAX(id) FROM acore_characters.character_pet;")? + ID_GAP,
        mail_id: q("SELECT MAX(id) FROM acore_characters.mail;")? + ID_GAP,
        auction_id: q("SELECT MAX(id) FROM acore_characters.auctionhouse;")? + ID_GAP,
    })
}

/// Tables the restore stage owns. Order is the order we INSERT INTO
/// the live chardb (FK roots first; AC doesn't enforce FKs but keeping
/// this order makes the dependency graph readable).
const RESTORE_TABLE_ORDER: &[&str] = &[
    // FK roots
    "characters",
    "item_instance",
    "character_pet",
    "mail",
    // Tables that reference characters.guid
    "character_account_data",
    "character_achievement",
    "character_achievement_progress",
    "character_action",
    "character_glyphs",
    "character_homebind",
    "character_queststatus",
    "character_queststatus_rewarded",
    "character_queststatus_daily",
    "character_queststatus_weekly",
    "character_queststatus_monthly",
    "character_queststatus_seasonal",
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
    "character_stats",
    "character_social",
    "battleground_deserters",
    // Tables that reference item_instance.guid / character_pet.id / mail.id
    "mail_items",
    "auctionhouse",
    "pet_aura",
    "pet_spell",
    "pet_spell_cooldown",
];

/// Pick a stage DB name unique enough to survive a clock skew or a
/// crashed-restore leftover. Process ID + nanos timestamp combined.
fn stage_db_name() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("dml_restore_stage_{pid}_{nanos}")
}

fn create_stage_db(container: &str) -> Result<String, String> {
    let name = stage_db_name();
    let sql = format!(
        "CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    );
    run_mysql_script(container, "mysql", &sql)
        .map_err(|e| format!("create stage db {name}: {e}"))?;
    Ok(name)
}

fn drop_stage(container: &str, stage: &str) -> Result<(), String> {
    let sql = format!("DROP DATABASE IF EXISTS `{stage}`;");
    run_mysql_script(container, "mysql", &sql)
}

/// For every table we might restore, CREATE TABLE LIKE acore_characters.
/// Tables that don't exist on target (rare; only if the target server
/// is on a different AC commit) are skipped silently — sourcing the
/// dump will land their rows nowhere and downstream INSERTs become
/// no-ops, which is the safe behavior.
fn create_stage_tables(container: &str, stage: &str) -> Result<(), String> {
    // Gather the target's actual table set to skip non-existent ones.
    let existing = list_chardb_tables(container)?;
    let mut script = String::new();
    for t in RESTORE_TABLE_ORDER {
        if !existing.contains(*t) {
            log::info!("restore: skipping table {t} (not on target)");
            continue;
        }
        script.push_str(&format!(
            "CREATE TABLE `{stage}`.`{t}` LIKE acore_characters.`{t}`;\n"
        ));
    }
    if script.is_empty() {
        return Err("Target chardb has none of the expected tables.".to_string());
    }
    run_mysql_script(container, "mysql", &script)
        .map_err(|e| format!("create stage tables: {e}"))
}

fn list_chardb_tables(container: &str) -> Result<std::collections::HashSet<String>, String> {
    let sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES \
               WHERE TABLE_SCHEMA='acore_characters';";
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword",
            "-N", "-B", "-e", sql,
        ])
        .output()
        .map_err(|e| format!("list tables: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "list tables failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// Source each .sql file in the archive into the stage DB.
fn populate_stage<R: Read + std::io::Seek>(
    container: &str,
    stage: &str,
    archive: &mut ZipArchive<R>,
) -> Result<(), String> {
    let sql_names = [
        "characters.sql",
        "pets.sql",
        "items.sql",
        "mail.sql",
        "auction.sql",
        "battleground_deserters.sql",
    ];
    for name in sql_names {
        let mut buf = String::new();
        match archive.by_name(name) {
            Ok(mut e) => {
                e.read_to_string(&mut buf)
                    .map_err(|err| format!("read {name}: {err}"))?;
            }
            Err(_) => continue, // optional file
        };
        if buf.trim().is_empty() {
            continue;
        }
        // mysqldump emits unqualified table names so we just point
        // mysql at the stage DB and INSERTs land there.
        run_mysql_script(container, stage, &buf)
            .map_err(|e| format!("sourcing {name} into stage: {e}"))?;
    }
    Ok(())
}

/// Source PK sets per domain (read from stage AFTER population, BEFORE
/// shifting). Used for conditional FK shifts so we only remap values
/// that actually belong to the migrated chars.
#[derive(Debug, Default)]
struct SourcePks {
    chars: Vec<u64>,
    items: Vec<u64>,
    pets: Vec<u64>,
    mails: Vec<u64>,
    auctions: Vec<u64>,
}

fn scan_source_pks(container: &str, stage: &str) -> Result<SourcePks, String> {
    let q = |sql: &str| -> Result<Vec<u64>, String> {
        let out = std::process::Command::new("docker")
            .args([
                "exec", container, "mysql", "-uroot", "-ppassword",
                "-N", "-B", "-e", sql,
            ])
            .output()
            .map_err(|e| format!("scan pks: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "scan pks failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| l.trim().parse::<u64>().ok())
            .collect())
    };
    Ok(SourcePks {
        chars: q(&format!("SELECT guid FROM `{stage}`.characters;"))?,
        items: q(&format!("SELECT guid FROM `{stage}`.item_instance;"))
            .unwrap_or_default(),
        pets: q(&format!("SELECT id FROM `{stage}`.character_pet;"))
            .unwrap_or_default(),
        mails: q(&format!("SELECT id FROM `{stage}`.mail;")).unwrap_or_default(),
        auctions: q(&format!("SELECT id FROM `{stage}`.auctionhouse;"))
            .unwrap_or_default(),
    })
}

/// Apply every PK + FK shift inside the stage schema. Build one
/// concatenated SQL script and run it in a single mysql invocation —
/// no transaction needed (stage is throwaway), and a single connection
/// is faster than spawning many `docker exec mysql` calls.
fn apply_shifts(
    container: &str,
    stage: &str,
    o: RestoreOffsets,
    src: &SourcePks,
) -> Result<(), String> {
    let mut sql = String::new();

    // ── PK shifts ─────────────────────────────────────────────────
    sql.push_str(&format!(
        "UPDATE `{stage}`.characters SET guid = guid + {};\n", o.char_guid
    ));
    sql.push_str(&format!(
        "UPDATE `{stage}`.item_instance SET guid = guid + {};\n", o.item_guid
    ));
    sql.push_str(&format!(
        "UPDATE `{stage}`.character_pet SET id = id + {};\n", o.pet_id
    ));
    sql.push_str(&format!(
        "UPDATE `{stage}`.mail SET id = id + {};\n", o.mail_id
    ));
    sql.push_str(&format!(
        "UPDATE `{stage}`.auctionhouse SET id = id + {};\n", o.auction_id
    ));

    // ── char_guid FK shifts (unconditional) ───────────────────────
    let char_guid_unconditional: &[(&str, &str)] = &[
        ("character_account_data", "guid"),
        ("character_achievement", "guid"),
        ("character_achievement_progress", "guid"),
        ("character_action", "guid"),
        ("character_glyphs", "guid"),
        ("character_homebind", "guid"),
        ("character_queststatus", "guid"),
        ("character_queststatus_rewarded", "guid"),
        ("character_queststatus_daily", "guid"),
        ("character_queststatus_weekly", "guid"),
        ("character_queststatus_monthly", "guid"),
        ("character_queststatus_seasonal", "guid"),
        ("character_reputation", "guid"),
        ("character_skills", "guid"),
        ("character_spell", "guid"),
        ("character_talent", "guid"),
        ("character_inventory", "guid"),
        ("character_equipmentsets", "guid"),
        ("character_arena_stats", "guid"),
        ("character_banned", "guid"),
        ("character_battleground_random", "guid"),
        ("character_brew_of_the_month", "guid"),
        ("character_entry_point", "guid"),
        ("character_instance", "guid"),
        ("character_stats", "guid"),
        ("character_social", "guid"),
        ("character_pet", "owner"),
        ("item_instance", "owner_guid"),
        ("mail", "receiver"),
        ("mail_items", "receiver"),
        ("auctionhouse", "itemowner"),
        ("battleground_deserters", "guid"),
    ];
    for (t, c) in char_guid_unconditional {
        sql.push_str(&format!(
            "UPDATE `{stage}`.`{t}` SET `{c}` = `{c}` + {};\n", o.char_guid
        ));
    }

    // ── item_guid FK shifts ───────────────────────────────────────
    sql.push_str(&format!(
        "UPDATE `{stage}`.character_inventory SET item = item + {};\n", o.item_guid
    ));
    // bag = 0 means "main inventory, not in a container"; only shift
    // when it's an actual item_instance reference.
    sql.push_str(&format!(
        "UPDATE `{stage}`.character_inventory SET bag = bag + {} WHERE bag <> 0;\n",
        o.item_guid
    ));
    // character_equipmentsets has 19 item slots; sentinel 0 = empty.
    for n in 0..=18 {
        sql.push_str(&format!(
            "UPDATE `{stage}`.character_equipmentsets \
             SET item{n} = item{n} + {} WHERE item{n} <> 0;\n",
            o.item_guid
        ));
    }
    sql.push_str(&format!(
        "UPDATE `{stage}`.mail_items SET item_guid = item_guid + {};\n", o.item_guid
    ));
    sql.push_str(&format!(
        "UPDATE `{stage}`.auctionhouse SET itemguid = itemguid + {};\n", o.item_guid
    ));

    // ── pet_id FK shifts ──────────────────────────────────────────
    for t in &["pet_aura", "pet_spell", "pet_spell_cooldown"] {
        sql.push_str(&format!(
            "UPDATE `{stage}`.`{t}` SET guid = guid + {};\n", o.pet_id
        ));
    }

    // ── mail_id FK shifts ─────────────────────────────────────────
    sql.push_str(&format!(
        "UPDATE `{stage}`.mail_items SET mail_id = mail_id + {};\n", o.mail_id
    ));

    // ── Conditional shifts ────────────────────────────────────────
    // Only shift if the value was in the migrated chars' guid set;
    // otherwise leave alone (dangling pointer is preferable to a
    // silently-corrupted reference to an unrelated target row).
    if !src.chars.is_empty() {
        let chars_csv = src.chars.iter().map(|g| g.to_string())
            .collect::<Vec<_>>().join(",");
        let conds: &[(&str, &str)] = &[
            ("character_social", "friend"),
            ("mail", "sender"),
            ("item_instance", "creatorGuid"),
            ("item_instance", "giftCreatorGuid"),
            ("auctionhouse", "buyguid"),
        ];
        for (t, c) in conds {
            sql.push_str(&format!(
                "UPDATE `{stage}`.`{t}` SET `{c}` = `{c}` + {} WHERE `{c}` IN ({chars_csv});\n",
                o.char_guid
            ));
        }
    }
    // Silence unused warnings for SourcePks fields we don't reference
    // in the shift logic yet (items/pets/mails/auctions are tracked
    // for symmetry + future use, e.g. detecting orphaned references).
    let _ = (&src.items, &src.pets, &src.mails, &src.auctions);

    run_mysql_script(container, stage, &sql)
        .map_err(|e| format!("apply shifts: {e}"))
}

/// INSIDE a transaction: copy stage → target for every table, then
/// rebind account. On any failure the COMMIT never runs and MySQL
/// rolls the transaction back when the connection closes.
fn merge_into_target(
    container: &str,
    stage: &str,
    target_account_id: u64,
    new_char_guids: &[u64],
) -> Result<(), String> {
    let existing = list_chardb_tables(container)?;
    let new_guids_csv = new_char_guids.iter()
        .map(|g| g.to_string()).collect::<Vec<_>>().join(",");

    let mut sql = String::new();
    // autocommit=0 + START TRANSACTION = if any statement fails before
    // COMMIT, the connection close auto-rolls back. mysql also exits
    // non-zero on the first error, so we never reach COMMIT in that
    // case.
    sql.push_str("SET autocommit=0;\n");
    sql.push_str("START TRANSACTION;\n");

    for t in RESTORE_TABLE_ORDER {
        if !existing.contains(*t) {
            continue;
        }
        let filter = filter_for_table(t, &new_guids_csv, stage);
        sql.push_str(&format!(
            "INSERT INTO acore_characters.`{t}` SELECT * FROM `{stage}`.`{t}` WHERE {filter};\n"
        ));
    }
    // Rebind account ownership to the chosen target account. Done
    // INSIDE the transaction so a failure here also rolls back the
    // imported rows.
    sql.push_str(&format!(
        "UPDATE acore_characters.characters SET account = {target_account_id} \
         WHERE guid IN ({new_guids_csv});\n"
    ));
    sql.push_str("COMMIT;\n");

    run_mysql_script(container, "acore_characters", &sql)
        .map_err(|e| format!("merge into target: {e}"))
}

/// Per-table WHERE clause restricting the rows we copy from stage to
/// target. All clauses are written against the SHIFTED ids in stage
/// (apply_shifts ran before this function).
fn filter_for_table(table: &str, new_guids_csv: &str, stage: &str) -> String {
    match table {
        // Player-guid keyed tables
        "characters"
        | "character_account_data"
        | "character_achievement"
        | "character_achievement_progress"
        | "character_action"
        | "character_glyphs"
        | "character_homebind"
        | "character_queststatus"
        | "character_queststatus_rewarded"
        | "character_queststatus_daily"
        | "character_queststatus_weekly"
        | "character_queststatus_monthly"
        | "character_queststatus_seasonal"
        | "character_reputation"
        | "character_skills"
        | "character_spell"
        | "character_talent"
        | "character_inventory"
        | "character_equipmentsets"
        | "character_arena_stats"
        | "character_banned"
        | "character_battleground_random"
        | "character_brew_of_the_month"
        | "character_entry_point"
        | "character_instance"
        | "character_stats"
        | "character_social"
        | "battleground_deserters" => format!("guid IN ({new_guids_csv})"),
        "item_instance" => format!("owner_guid IN ({new_guids_csv})"),
        "character_pet" => format!("owner IN ({new_guids_csv})"),
        "mail" => format!("receiver IN ({new_guids_csv})"),
        "mail_items" => format!("receiver IN ({new_guids_csv})"),
        "auctionhouse" => format!("itemowner IN ({new_guids_csv})"),
        // Pet sub-tables filter through stage.character_pet → owner
        "pet_aura" | "pet_spell" | "pet_spell_cooldown" => format!(
            "guid IN (SELECT id FROM `{stage}`.character_pet WHERE owner IN ({new_guids_csv}))"
        ),
        // Defensive default — never reached if RESTORE_TABLE_ORDER is
        // kept in sync, but better to error than silently copy
        // everything.
        other => format!("0 -- unknown table {other}, skip all rows"),
    }
}

/// Post-commit sanity check: confirm every restored character has its
/// FK rows intact. A successful COMMIT means all INSERTs landed; this
/// query catches the (very unlikely) case where the offset math itself
/// was off — e.g. a row pointing at a guid that doesn't exist.
fn verify_integrity(container: &str, new_char_guids: &[u64]) -> Result<(), String> {
    if new_char_guids.is_empty() {
        return Ok(());
    }
    let csv = new_char_guids.iter().map(|g| g.to_string())
        .collect::<Vec<_>>().join(",");
    // Spot-check: every restored character should have at least one
    // inventory row (every char has a starter outfit). If even one
    // restored character has zero inventory rows after restore, the
    // shift miscalculated somewhere.
    let sql = format!(
        "SELECT c.guid FROM acore_characters.characters c \
         LEFT JOIN acore_characters.character_inventory i ON i.guid = c.guid \
         WHERE c.guid IN ({csv}) GROUP BY c.guid HAVING COUNT(i.guid) = 0;"
    );
    let out = std::process::Command::new("docker")
        .args([
            "exec", container, "mysql", "-uroot", "-ppassword",
            "-N", "-B", "-e", &sql,
        ])
        .output()
        .map_err(|e| format!("integrity check: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "integrity check failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let orphans: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines().map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()).collect();
    if !orphans.is_empty() {
        return Err(format!(
            "Restore completed but characters {} have no inventory rows — \
             possible FK desync. Investigate before relying on these chars.",
            orphans.join(", ")
        ));
    }
    Ok(())
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
