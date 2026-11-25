//! Tiny loopback HTTP listener used for the OAuth (PKCE) redirect of the Spotify integration,
//! plus a helper that opens an https URL in the default browser.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::time::{Duration, Instant};

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Zoro Player</title><body style=\"background:#0a0a0a;color:#e8e8e8;font:16px monospace;display:grid;place-items:center;height:100vh;margin:0\"><div>$ zoro-player: connected. You can close this tab.<br>می‌تونی این تب رو ببندی.</div></body>";

fn param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        if k == key { Some(percent_decode(v)) } else { None }
    })
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                if let Some(v) = hex {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Waits (up to `timeout_s`) for `GET /callback?code=..&state=..` on 127.0.0.1:`port`.
/// Returns the authorization code; fails if `state` doesn't match or the provider reports an error.
pub fn wait_for_code(port: u16, state: &str, timeout_s: u64) -> Result<String, String> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
        .map_err(|e| format!("port {port} is busy: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let end = Instant::now() + Duration::from_secs(timeout_s);
    loop {
        if Instant::now() > end {
            return Err("timeout".into());
        }
        match listener.accept() {
            Ok((mut s, _)) => {
                let _ = s.set_nonblocking(false);
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = req.lines().next().unwrap_or("");
                let target = line.split_whitespace().nth(1).unwrap_or("");
                let (path, query) = target.split_once('?').unwrap_or((target, ""));
                if path != "/callback" {
                    let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue; // favicon etc.
                }
                let mut reply = |status: &str, body: &str| {
                    let r = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = s.write_all(r.as_bytes());
                };
                if let Some(err) = param(query, "error") {
                    reply("400 Bad Request", PAGE);
                    return Err(err);
                }
                if param(query, "state").as_deref() != Some(state) {
                    reply("400 Bad Request", "state mismatch");
                    return Err("state mismatch".into());
                }
                return match param(query, "code") {
                    Some(c) => { reply("200 OK", PAGE); Ok(c) }
                    None => { reply("400 Bad Request", "missing code"); Err("missing code".into()) }
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Opens an https URL of an allowed host in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://accounts.spotify.com/") || url.starts_with("https://developer.spotify.com/")) {
        return Err("url not allowed".into());
    }
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}
