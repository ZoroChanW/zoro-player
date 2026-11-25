//! Formats the WebView cannot play natively (ALAC, AIFF, WMA, APE, WavPack ...).
//! They are decoded to 16-bit PCM WAV bytes: first with Symphonia (pure Rust: ALAC, AIFF, CAF, MKV ...),
//! then, for formats Symphonia lacks (WMA, APE, WavPack), with an `ffmpeg` executable if one is available
//! (next to the app, in the app data folder or on PATH).
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_ALAC, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const FFMPEG_MISSING: &str = "FFMPEG_MISSING";

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Extensions that are never playable by the WebView and always need decoding.
pub fn always_decode(p: &Path) -> bool {
    matches!(ext_of(p).as_str(), "wma" | "ape" | "wv" | "aif" | "aiff" | "aifc" | "caf" | "mka" | "dsf" | "dff" | "mpc" | "tta")
}

fn open_probe(path: &Path) -> Result<symphonia::core::probe::ProbeResult, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    let e = ext_of(path);
    if !e.is_empty() {
        hint.with_extension(&e);
    }
    symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| e.to_string())
}

/// True when the file is an MP4/M4A container carrying ALAC (Chromium cannot play it).
pub fn is_alac(path: &Path) -> bool {
    if !matches!(ext_of(path).as_str(), "m4a" | "mp4" | "m4b") {
        return false;
    }
    match open_probe(path) {
        Ok(p) => p.format.tracks().iter().any(|t| t.codec_params.codec == CODEC_TYPE_ALAC),
        Err(_) => false,
    }
}

fn wav_header(data_len: u32, channels: u16, rate: u32) -> Vec<u8> {
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data_len).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&channels.to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
    h.extend_from_slice(&(channels * 2).to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data_len.to_le_bytes());
    h
}

fn decode_symphonia(path: &Path) -> Result<Vec<u8>, String> {
    let mut probed = open_probe(path)?;
    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no audio track")?;
    let id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut pcm: Vec<u8> = Vec::new();
    let (mut channels, mut rate) = (0u16, 0u32);
    let mut buf: Option<SampleBuffer<i16>> = None;
    loop {
        let packet = match probed.format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                channels = spec.channels.count() as u16;
                rate = spec.rate;
                if buf.as_ref().map(|b| b.capacity() < decoded.capacity() * channels as usize).unwrap_or(true) {
                    buf = Some(SampleBuffer::<i16>::new(decoded.capacity() as u64, spec));
                }
                let b = buf.as_mut().unwrap();
                b.copy_interleaved_ref(decoded);
                for s in b.samples() {
                    pcm.extend_from_slice(&s.to_le_bytes());
                }
            }
            Err(SymError::DecodeError(_)) => continue, // skip a corrupt packet
            Err(e) => return Err(e.to_string()),
        }
    }
    if pcm.is_empty() || channels == 0 {
        return Err("empty audio".into());
    }
    let mut out = wav_header(pcm.len() as u32, channels, rate);
    out.extend_from_slice(&pcm);
    Ok(out)
}

fn ffmpeg_path() -> PathBuf {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            cands.push(d.join(name));
            cands.push(d.join("ffmpeg").join(name));
        }
    }
    if let Ok(extra) = std::env::var("ZORO_FFMPEG") {
        cands.insert(0, PathBuf::from(extra));
    }
    cands.into_iter().find(|p| p.is_file()).unwrap_or_else(|| PathBuf::from(name))
}

/// Extra places to look for ffmpeg (e.g. the app data folder), set once at start-up.
static EXTRA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
pub fn set_extra_dir(d: PathBuf) {
    let _ = EXTRA_DIR.set(d);
}

fn decode_ffmpeg(path: &Path) -> Result<Vec<u8>, String> {
    let mut exe = ffmpeg_path();
    if !exe.is_file() {
        if let Some(d) = EXTRA_DIR.get() {
            let c = d.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if c.is_file() {
                exe = c;
            }
        }
    }
    let mut cmd = Command::new(&exe);
    cmd.args(["-v", "error", "-nostdin", "-i"])
        .arg(path)
        .args(["-vn", "-map", "0:a:0", "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { FFMPEG_MISSING.to_string() } else { e.to_string() }
    })?;
    if !out.status.success() || out.stdout.len() < 64 {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    // ffmpeg writes a streaming header (size 0xFFFFFFFF) when piping: patch the real sizes
    let mut wav = out.stdout;
    if wav.len() > 44 && &wav[0..4] == b"RIFF" {
        let total = (wav.len() - 8) as u32;
        wav[4..8].copy_from_slice(&total.to_le_bytes());
        if let Some(pos) = wav.windows(4).position(|w| w == b"data") {
            let dl = (wav.len() - (pos + 8)) as u32;
            wav[pos + 4..pos + 8].copy_from_slice(&dl.to_le_bytes());
        }
    }
    Ok(wav)
}

/// Decodes any supported audio file to WAV bytes.
pub fn decode_to_wav(path: &Path) -> Result<Vec<u8>, String> {
    match decode_symphonia(path) {
        Ok(v) => Ok(v),
        Err(sym_err) => match decode_ffmpeg(path) {
            Ok(v) => Ok(v),
            Err(e) if e == FFMPEG_MISSING => Err(FFMPEG_MISSING.to_string()),
            Err(e) => Err(format!("{sym_err}; ffmpeg: {e}")),
        },
    }
}
