//! Native SFX playback.
//!
//! WebKitGTK on SteamOS is missing the GStreamer audio sink elements
//! (`appsink` / `autoaudiosink`), so HTML5 `<audio>` in the WebView can't
//! reach a speaker at all — no media format helps. Instead we shell out
//! to the Deck's own PipeWire player (`pw-play`, with `paplay` / `ffplay`
//! fallbacks). All three ship with the base OS, so this adds no runtime
//! dependency and touches nothing on the immutable rootfs.
//!
//! The cues are embedded in the binary (`include_bytes!`) and written to
//! a temp file on first use, so playback is fully self-contained/offline.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

struct Cue {
    name: &'static str,
    /// Extension as written to the temp file. pw-play/libsndfile use it
    /// for format sniffing, so .wav cues must stay .wav, etc.
    ext: &'static str,
    bytes: &'static [u8],
}

const CUES: &[Cue] = &[
    Cue {
        name: "questActivate",
        ext: "ogg",
        bytes: include_bytes!("../../src/assets/audio/sfx/QuestActivate.ogg"),
    },
    Cue {
        name: "questComplete",
        ext: "ogg",
        bytes: include_bytes!("../../src/assets/audio/sfx/QuestComplete.ogg"),
    },
    Cue {
        name: "levelUp",
        ext: "ogg",
        bytes: include_bytes!("../../src/assets/audio/sfx/LevelUp.ogg"),
    },
    Cue {
        name: "stealth",
        ext: "ogg",
        bytes: include_bytes!("../../src/assets/audio/sfx/Stealth.ogg"),
    },
    Cue {
        name: "splash",
        ext: "wav",
        bytes: include_bytes!(
            "../../src/assets/audio/sfx/KMRBI_FDK_fx_impact_startup_A.wav"
        ),
    },
];

/// Write the embedded cue to `$TMPDIR/dml-sfx/<name>.<ext>` once.
/// Players need a file path; the bytes are baked into the binary so
/// there's no resource-dir/FUSE path to resolve.
fn materialize(cue: &Cue) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("dml-sfx");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir sfx tmp: {e}"))?;
    let path = dir.join(format!("{}.{}", cue.name, cue.ext));
    if !path.exists() {
        let mut f =
            std::fs::File::create(&path).map_err(|e| format!("write sfx: {e}"))?;
        f.write_all(cue.bytes)
            .map_err(|e| format!("write sfx: {e}"))?;
    }
    Ok(path)
}

/// Try each player in preference order; first one that spawns wins. The
/// child is reaped on a background thread so it doesn't zombie, and it
/// runs independently of the WebView.
fn spawn_player(path: &Path, volume: f32) -> bool {
    let v = volume.clamp(0.0, 1.0);
    let p = path.to_string_lossy().to_string();
    let attempts: Vec<(&str, Vec<String>)> = vec![
        ("pw-play", vec!["--volume".into(), format!("{:.3}", v), p.clone()]),
        // paplay's --volume is linear 0..65536 (65536 == 100%).
        ("paplay", vec![format!("--volume={}", (v * 65536.0) as u32), p.clone()]),
        (
            "ffplay",
            vec![
                "-nodisp".into(),
                "-autoexit".into(),
                "-loglevel".into(),
                "quiet".into(),
                "-volume".into(),
                format!("{}", (v * 100.0) as u32),
                p.clone(),
            ],
        ),
    ];
    for (prog, args) in attempts {
        if let Ok(mut child) = Command::new(prog)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn play_sfx(name: String, volume: f32) -> Result<(), String> {
    let cue = CUES
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| format!("unknown sfx: {name}"))?;
    let path = materialize(cue)?;
    if !spawn_player(&path, volume) {
        return Err("no audio player available (pw-play/paplay/ffplay)".into());
    }
    Ok(())
}
