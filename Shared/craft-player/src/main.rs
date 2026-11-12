// CraftPlayer: runs a game exported from GameCraft. The exported web build sits in the `game` folder next to
// this .exe and is served on the private `game://` scheme (no network port, no browser); the window opens
// the game's player page. Nothing is downloaded or installed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Component, Path, PathBuf};
use tauri::http::{Response, StatusCode};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn mime_of(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") | Some("webmanifest") => "application/json",
        Some("wasm") => "application/wasm",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("gltf") => "model/gltf+json",
        Some("glb") => "model/gltf-binary",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("woff2") => "font/woff2",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        Some("obj") | Some("mtl") | Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

/// A file under `root` for a URL path; anything that could leave the folder is refused.
fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded: String = url_path.split('/').map(|s| percent_decode(s)).collect::<Vec<_>>().join("/");
    let mut out = root.to_path_buf();
    for part in decoded.split('/').filter(|s| !s.is_empty()) {
        let p = Path::new(part);
        if p.components().any(|c| !matches!(c, Component::Normal(_))) { return None; }
        out.push(p);
    }
    if out.is_dir() { out.push("player.html"); }
    Some(out)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn serve(root: &Path, url_path: &str) -> Response<Vec<u8>> {
    let file = resolve(root, url_path);
    match file.as_ref().map(|f| (f, std::fs::read(f))) {
        Some((f, Ok(body))) => Response::builder().status(StatusCode::OK).header("Content-Type", mime_of(f)).header("Cache-Control", "no-cache").body(body).unwrap(),
        _ => Response::builder().status(StatusCode::NOT_FOUND).header("Content-Type", "text/plain").body(b"Not found".to_vec()).unwrap(),
    }
}

/// A value from the flat `window.json` the exporter writes ({"width": 1280, "fullscreen": false, ...}).
fn json_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let at = json.find(&format!("\"{}\"", key))?;
    let rest = json[at + key.len() + 2..].trim_start().strip_prefix(':')?.trim_start();
    let end = rest.find(|c| c == ',' || c == '}' || c == '\n').unwrap_or(rest.len());
    Some(rest[..end].trim())
}

fn main() {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)).unwrap_or_default();
    let root = exe_dir.join("game");
    let title = std::fs::read_to_string(root.join("title.txt")).map(|s| s.trim().to_string()).unwrap_or_else(|_| "Game".into());
    // Window options chosen in GameCraft's export settings (defaults when the file is missing).
    let win = std::fs::read_to_string(root.join("window.json")).unwrap_or_default();
    let num = |k: &str, d: f64| json_field(&win, k).and_then(|v| v.parse::<f64>().ok()).filter(|v| *v >= 200.0).unwrap_or(d);
    let flag = |k: &str, d: bool| json_field(&win, k).map(|v| v == "true").unwrap_or(d);
    let (width, height) = (num("width", 1280.0), num("height", 720.0));
    let (fullscreen, resizable) = (flag("fullscreen", false), flag("resizable", true));
    // Games exported before window modes only have `fullscreen`.
    let mode = json_field(&win, "windowMode").map(|v| v.trim_matches('"').to_string()).unwrap_or_else(|| if fullscreen { "fullscreen".into() } else { "windowed".into() });
    let monitor = json_field(&win, "monitor").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    let icon = std::fs::read(root.join("icon.png")).ok();
    let serve_root = root.clone();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("game", move |ctx, request, responder| {
            let root = serve_root.clone();
            let path = request.uri().path().to_string();
            // The game's "Quit game" block: the page asks for /__quit and the player closes.
            if path == "/__quit" {
                responder.respond(Response::builder().status(StatusCode::OK).body(Vec::new()).unwrap());
                ctx.app_handle().exit(0);
                return;
            }
            std::thread::spawn(move || responder.respond(serve(&root, &path)));
        })
        .setup(move |app| {
            if !root.join("player.html").exists() {
                eprintln!("CraftPlayer: no game folder next to the .exe");
            }
            let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::External("http://game.localhost/player.html".parse().unwrap()))
                .title(&title)
                .inner_size(width, height)
                .min_inner_size(640.0_f64.min(width), 360.0_f64.min(height))
                // Borderless has no frame at all: a resizable or shadowed window keeps an invisible one around it.
                .resizable(resizable && mode != "borderless")
                .decorations(mode != "borderless")
                .shadow(mode != "borderless")
                .visible(false); // shown once it is on the right monitor, in the right mode
            // The game's own icon in the title bar and taskbar.
            if let Some(img) = icon.as_deref().and_then(|bytes| tauri::image::Image::from_bytes(bytes).ok()) {
                b = b.icon(img)?;
            }
            let window = b.build()?;
            // Monitor N in the system's list; 0, or one that is not plugged in, stays on the main monitor.
            let chosen = if monitor > 0 { window.available_monitors().ok().and_then(|m| m.into_iter().nth(monitor - 1)) } else { None };
            if let Some(m) = &chosen { let _ = window.set_position(*m.position()); }
            match mode.as_str() {
                "fullscreen" => { let _ = window.set_fullscreen(true); }
                "maximized" => { let _ = window.maximize(); }
                "borderless" => {
                    let target = chosen.or_else(|| window.current_monitor().ok().flatten());
                    if let Some(m) = target { let _ = window.set_position(*m.position()); let _ = window.set_size(*m.size()); }
                }
                _ => {}
            }
            let _ = window.show();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("CraftPlayer failed to start");
}
