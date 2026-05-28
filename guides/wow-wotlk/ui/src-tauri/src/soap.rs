//! SOAP client for the AzerothCore worldserver console.
//!
//! The worldserver exposes its console commands over SOAP on port 7878
//! (enabled by AC_SOAP_ENABLED=1 in the playerbots compose override).
//! Any `.dot` command available at the worldserver console can be sent
//! via `execute_command()` — `additem`, `teleport`, `account create`,
//! `npcbot spawn`, etc.
//!
//! All GM commands in the UI flow through here. The bootstrap is the
//! only exception (it predates the admin account existing, so it can't
//! authenticate to SOAP — it uses direct SQL + SRP6 instead). After
//! bootstrap, this is the universal channel.
//!
//! Auth: HTTP Basic with the admin account install-wow-ui.sh creates.
//! Credentials come from `~/.config/dads-mmo-lab/settings.json`
//! (`admin_user` / `admin_pass`), captured by install.rs after a
//! successful install and chmod'd 0600 on save. Falls back to the
//! script's own defaults (ADMIN/admin) if either field is missing —
//! covers older installs that ran before this code landed.

use std::time::Duration;

use serde::Deserialize;

use crate::app_settings;

/// Fallback credentials matching install-wow-ui.sh's own defaults when
/// DML_ADMIN_USER / DML_ADMIN_PASS are unset. Only reached when
/// settings.json doesn't have admin_user / admin_pass yet (e.g.
/// adopted installs, or installs done by an older app version).
const DEFAULT_USER: &str = "ADMIN";
const DEFAULT_PASS: &str = "admin";
const SOAP_URL: &str = "http://127.0.0.1:7878/";

/// Resolve the admin credentials for the current install. Reads
/// settings.json on every call — that file is small (<1KB) and SOAP
/// commands aren't a hot path (one per user GM action), so the I/O is
/// negligible against the SOAP round-trip itself. Reading fresh each
/// time also means a reinstall with new credentials picks up the new
/// account automatically without an app restart.
fn admin_credentials() -> (String, String) {
    let s = app_settings::load();
    let user = s.admin_user.filter(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_USER.to_string());
    let pass = s.admin_pass.filter(|p| !p.is_empty())
        .unwrap_or_else(|| DEFAULT_PASS.to_string());
    (user, pass)
}

#[derive(Debug, Deserialize)]
pub struct SoapCommandResult {
    /// Raw response text from the worldserver — stripped of XML
    /// envelope and entity-decoded. May contain ANSI color codes
    /// (frontends should strip them if displaying inline).
    pub output: String,
}

/// Send any worldserver console command and return its text output.
///
/// Network + auth errors come back as Err(message). A "the command ran
/// but returned an error string" still comes back as Ok with that
/// string — the worldserver doesn't always use non-200 HTTP statuses
/// for command-level failures, so the caller is responsible for
/// scanning the output for things like "syntax error" if it matters.
pub async fn execute_command(command: &str) -> Result<SoapCommandResult, String> {
    // Single-line envelope — raw strings don't process `\` line continuations
    // and AC's SOAP parser is finicky about whitespace inside opening tags.
    let envelope = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns1="urn:AC"><SOAP-ENV:Body><ns1:executeCommand><command>{}</command></ns1:executeCommand></SOAP-ENV:Body></SOAP-ENV:Envelope>"#,
        xml_escape(command)
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("build http client: {e}"))?;

    let (user, pass) = admin_credentials();
    let response = client
        .post(SOAP_URL)
        .basic_auth(&user, Some(&pass))
        .header("Content-Type", "application/xml")
        .header("SOAPAction", "")
        .body(envelope)
        .send()
        .await
        .map_err(|e| format!("SOAP request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("read SOAP response: {e}"))?;

    // AC returns 200 on auth-or-command failure too — we have to look
    // inside the envelope. SOAP-style fault: <faultstring>...</faultstring>.
    if let Some(fault) = extract_between(&body, "<faultstring>", "</faultstring>") {
        return Err(format!("worldserver SOAP fault: {}", decode_xml(&fault)));
    }
    if !status.is_success() {
        // Genuinely-broken HTTP response (auth failure usually).
        return Err(format!(
            "SOAP returned HTTP {} — body: {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    let Some(result) = extract_between(&body, "<result>", "</result>") else {
        return Err(format!(
            "SOAP response missing <result> — body: {}",
            body.chars().take(200).collect::<String>()
        ));
    };
    Ok(SoapCommandResult { output: decode_xml(&result) })
}

/// Minimal XML escape for the command body — covers what worldserver
/// commands actually use (item names with apostrophes etc.).
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

/// Decode the AC SOAP response entities we actually see: `&#xD;` for
/// `\r`, `&amp;` etc. Doesn't try to be a full XML parser.
fn decode_xml(s: &str) -> String {
    s.replace("&#xD;", "\r")
        .replace("&#xA;", "\n")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn extract_between(haystack: &str, start: &str, end: &str) -> Option<String> {
    let start_pos = haystack.find(start)? + start.len();
    let rest = &haystack[start_pos..];
    let end_pos = rest.find(end)?;
    Some(rest[..end_pos].to_string())
}
