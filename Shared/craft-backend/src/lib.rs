//! Local file API for the desktop builds of GameCraft and LogicCraft.
//!
//! A Rust port of `Shared/devserver/projectApi.ts` (the Vite dev-server plugin), with the same routes and
//! JSON shapes, so the web front-ends work unchanged. The apps serve it on a private `craft://` URI scheme
//! (no network port). All names are validated and every path is confined to its configured root.
//!
//! Routes (paths after `/api/`):
//! * `projects` GET list · `projects/{id}[/autosave]` GET/PUT/DELETE · `projects/{id}/files/{rel..}` GET/PUT/DELETE
//! * `exchange` GET list · `exchange/{name}` GET/PUT
//! * `library` GET list · `library/{lib}/{rel..}` GET (read-only)
//! * `extensions` GET (declarative JSON manifests, never executed)
//! * `android/status` GET/POST · `android/build` POST · `android/keystore` POST · `android/apk/{file}` GET (see android.rs)
//! * `blender/status` GET (always unavailable here: .blend files are read natively by the apps)

pub mod android;

use http::{Method, Request, Response, StatusCode};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct Library {
    pub id: String,
    pub dir: PathBuf,
    pub label: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub projects_dir: PathBuf,
    pub exchange_dir: PathBuf,
    pub libraries: Vec<Library>,
    pub extensions_dir: Option<PathBuf>,
}

impl Config {
    /// Create the writable folders.
    pub fn ensure_dirs(&self) {
        let _ = fs::create_dir_all(&self.projects_dir);
        let _ = fs::create_dir_all(&self.exchange_dir);
    }
}

type Res = Response<Vec<u8>>;

fn respond(code: StatusCode, body: Vec<u8>, mime: &str) -> Res {
    Response::builder()
        .status(code)
        .header("Content-Type", mime)
        // The page (http://tauri.localhost) and this API (http://craft.localhost) are different origins;
        // textures must be CORS-clean for WebGL.
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "no-cache")
        .body(body)
        .unwrap()
}
fn json_res(code: StatusCode, v: Value) -> Res {
    respond(code, serde_json::to_vec(&v).unwrap_or_default(), "application/json")
}
fn err(code: StatusCode, msg: impl Into<String>) -> Res {
    json_res(code, json!({ "error": msg.into() }))
}
fn ok() -> Res {
    json_res(StatusCode::OK, json!({ "ok": true }))
}

fn mime_of(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("obj") | Some("mtl") | Some("txt") => "text/plain",
        Some("gltf") => "model/gltf+json",
        Some("glb") => "model/gltf-binary",
        Some("json") => "application/json",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// Same rule as the TypeScript `safeName`: letters, digits, `_ - . space`, no `..`.
fn safe_name(n: &str) -> Result<&str, String> {
    let okc = |c: char| c.is_ascii_alphanumeric() || "_-. ".contains(c);
    if n.is_empty() || n.len() > 120 || !n.chars().all(okc) || n.contains("..") {
        return Err("Invalid name".into());
    }
    Ok(n)
}

/// Join a relative path onto `root`, rejecting anything that could leave it (`..`, absolute, drive prefixes).
fn within(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    for part in rel.split('/').filter(|s| !s.is_empty()) {
        let p = Path::new(part);
        let mut comps = p.components();
        match (comps.next(), comps.next()) {
            (Some(Component::Normal(c)), None) => out.push(c),
            _ => return Err("Path escapes its root".into()),
        }
    }
    Ok(out)
}

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn list_files(dir: &Path) -> Vec<Value> {
    fn walk(dir: &Path, base: &Path, out: &mut Vec<Value>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let full = e.path();
            if full.is_dir() {
                walk(&full, base, out);
            } else if let Ok(m) = e.metadata() {
                let rel = full.strip_prefix(base).unwrap_or(&full).to_string_lossy().replace('\\', "/");
                out.push(json!({ "path": rel, "size": m.len(), "modified": mtime_ms(&full) }));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out
}

/// Write via a temp file + rename so a crash never leaves a half-written project.
fn write_atomic(target: &Path, body: &[u8]) -> std::io::Result<()> {
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, body)?;
    fs::rename(&tmp, target)
}

/// Handle one request to the `craft` scheme. Never panics on bad input; errors are JSON `{ error }`.
pub fn handle(cfg: &Config, req: &Request<Vec<u8>>) -> Res {
    if req.method() == Method::OPTIONS {
        return respond(StatusCode::NO_CONTENT, Vec::new(), "text/plain");
    }
    let path = req.uri().path();
    let Some(rest) = path.strip_prefix("/api/").or_else(|| if path == "/api" { Some("") } else { None }) else {
        return err(StatusCode::NOT_FOUND, "Unknown API route");
    };
    let parts: Vec<String> = rest
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| percent_decode_str(s).decode_utf8_lossy().to_string())
        .collect();
    match route(cfg, req.method(), &parts, req.body()) {
        Ok(r) => r,
        Err(e) => err(StatusCode::BAD_REQUEST, e),
    }
}

fn route(cfg: &Config, method: &Method, parts: &[String], body: &[u8]) -> Result<Res, String> {
    let p0 = parts.first().map(String::as_str).unwrap_or("");
    match p0 {
        "projects" => projects(cfg, method, parts, body),
        "exchange" => {
            if parts.len() == 1 {
                let list: Vec<Value> = list_files(&cfg.exchange_dir)
                    .into_iter()
                    .filter(|f| f["path"].as_str().is_some_and(|p| p.ends_with(".json")))
                    .collect();
                return Ok(json_res(StatusCode::OK, Value::Array(list)));
            }
            let name = safe_name(&parts[1])?;
            let p = within(&cfg.exchange_dir, name)?;
            if *method == Method::GET {
                return Ok(match fs::read(&p) {
                    Ok(b) => respond(StatusCode::OK, b, "application/json"),
                    Err(_) => err(StatusCode::NOT_FOUND, "Not found"),
                });
            }
            if *method == Method::PUT {
                serde_json::from_slice::<Value>(body).map_err(|e| format!("Invalid JSON: {e}"))?;
                fs::write(&p, body).map_err(|e| e.to_string())?;
                return Ok(json_res(StatusCode::OK, json!({ "ok": true, "path": p.to_string_lossy() })));
            }
            Ok(err(StatusCode::NOT_FOUND, "Unknown API route"))
        }
        "library" => {
            if parts.len() == 1 {
                let libs: Vec<Value> = cfg
                    .libraries
                    .iter()
                    .map(|l| json!({ "id": l.id, "label": l.label, "files": list_files(&l.dir) }))
                    .collect();
                return Ok(json_res(StatusCode::OK, Value::Array(libs)));
            }
            let Some(lib) = cfg.libraries.iter().find(|l| l.id == parts[1]) else {
                return Ok(err(StatusCode::NOT_FOUND, "Unknown library"));
            };
            let p = within(&lib.dir, &parts[2..].join("/"))?;
            Ok(match fs::read(&p) {
                Ok(b) => respond(StatusCode::OK, b, mime_of(&p)),
                Err(_) => err(StatusCode::NOT_FOUND, "Not found"),
            })
        }
        "extensions" => {
            let Some(dir) = &cfg.extensions_dir else { return Ok(json_res(StatusCode::OK, json!([]))) };
            let mut out = Vec::new();
            if let Ok(rd) = fs::read_dir(dir) {
                let mut names: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".json")).collect();
                names.sort();
                for f in names {
                    match fs::read(dir.join(&f)).map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|e| e.to_string())) {
                        Ok(m) => out.push(json!({ "file": f, "manifest": m })),
                        Err(e) => out.push(json!({ "file": f, "error": e })),
                    }
                }
            }
            Ok(json_res(StatusCode::OK, Value::Array(out)))
        }
        "android" => android_route(cfg, method, parts, body),
        "blender" => Ok(if parts.get(1).map(String::as_str) == Some("status") {
            json_res(StatusCode::OK, json!({ "available": false, "path": null }))
        } else {
            err(StatusCode::BAD_REQUEST, ".blend files are imported natively; no Blender conversion is needed.")
        }),
        _ => Ok(err(StatusCode::NOT_FOUND, "Unknown API route")),
    }
}

/// Shared app data folder (…/CraftApps), next to the projects.
fn data_root(cfg: &Config) -> PathBuf {
    cfg.projects_dir.parent().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_else(|| cfg.projects_dir.clone())
}

/// `android/status` (GET, or POST `{ sdkPath }`) · `android/build` POST (u32 LE JSON length, JSON, game zip) ·
/// `android/keystore` POST JSON · `android/apk/{file}` GET (a built APK).
fn android_route(cfg: &Config, method: &Method, parts: &[String], body: &[u8]) -> Result<Res, String> {
    let out_dir = data_root(cfg).join("Exports").join("Android");
    let hint = |v: &Value| v["sdkPath"].as_str().map(str::to_string);
    match parts.get(1).map(String::as_str).unwrap_or("") {
        "status" => {
            let v: Value = if body.is_empty() { json!({}) } else { serde_json::from_slice(body).unwrap_or(json!({})) };
            let mut s = android::status(hint(&v).as_deref());
            s["outputDir"] = json!(out_dir.to_string_lossy());
            Ok(json_res(StatusCode::OK, s))
        }
        "build" if *method == Method::POST => {
            let n = body.get(..4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).ok_or("Empty request")?;
            let v: Value = serde_json::from_slice(body.get(4..4 + n).ok_or("Bad request")?).map_err(|e| format!("Invalid JSON: {e}"))?;
            let zip = &body[4 + n..];
            let spec = android::AppSpec {
                app_id: v["appId"].as_str().unwrap_or("").trim().to_string(),
                label: v["label"].as_str().unwrap_or("Game").to_string(),
                version_name: v["versionName"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("1.0").to_string(),
                version_code: v["versionCode"].as_u64().unwrap_or(1).clamp(1, 2_100_000_000) as u32,
                orientation: v["orientation"].as_str().unwrap_or("landscape").to_string(),
                release: v["release"].as_bool().unwrap_or(false),
                min_sdk: v["minSdk"].as_u64().unwrap_or(0).min(100) as u32,
                target_sdk: v["targetSdk"].as_u64().unwrap_or(0).min(100) as u32,
                permissions: v["permissions"].as_array().map(|a| a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect()).unwrap_or_default(),
                splash: v.get("splash").filter(|s| s.is_object()).map(|s| android::Splash {
                    color: s["color"].as_str().unwrap_or("#000000").to_string(),
                    image: s["image"].as_bool().unwrap_or(false),
                    millis: s["millis"].as_u64().unwrap_or(1500).min(10_000) as u32,
                }),
                bundle: v["bundle"].as_bool().unwrap_or(false),
            };
            let signing = v.get("keystore").filter(|k| k.is_object()).map(|k| android::Signing {
                keystore: PathBuf::from(k["path"].as_str().unwrap_or("")),
                alias: k["alias"].as_str().unwrap_or("").to_string(),
                store_pass: k["storePass"].as_str().unwrap_or("").to_string(),
                key_pass: k["keyPass"].as_str().or(k["storePass"].as_str()).unwrap_or("").to_string(),
            });
            if let Some(s) = &signing {
                if !s.keystore.is_file() { return Ok(err(StatusCode::BAD_REQUEST, format!("Keystore not found: {}", s.keystore.display()))); }
            }
            let t = android::detect(hint(&v).as_deref());
            let root = data_root(cfg);
            let r = android::build(&t, &spec, zip, signing, &root.join("android-build").join("work"), &out_dir, &root.join("android"));
            let checks: Vec<Value> = r.checks.iter().map(|(c, ok)| json!({ "check": c, "ok": ok })).collect();
            let size = r.apk.as_ref().and_then(|p| fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
            Ok(json_res(StatusCode::OK, json!({
                "ok": r.ok, "log": r.log, "checks": checks,
                "apk": r.apk.as_ref().map(|p| p.to_string_lossy()), "file": r.apk.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy()),
                "sizeMb": (size as f64 / 104857.6).round() / 10.0,
            })))
        }
        "keystore" if *method == Method::POST => {
            let v: Value = serde_json::from_slice(body).map_err(|e| format!("Invalid JSON: {e}"))?;
            let t = android::detect(hint(&v).as_deref());
            let default = data_root(cfg).join("Keys").join("release.keystore");
            let path = v["path"].as_str().filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or(default);
            let alias = v["alias"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("release");
            let dname = v["dname"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("CN=GameCraft developer");
            Ok(match android::create_keystore(&t, &path, alias, v["storePass"].as_str().unwrap_or(""), v["keyPass"].as_str().or(v["storePass"].as_str()).unwrap_or(""), dname) {
                Ok(log) => json_res(StatusCode::OK, json!({ "ok": true, "path": path.to_string_lossy(), "alias": alias, "log": log })),
                Err(e) => err(StatusCode::BAD_REQUEST, e),
            })
        }
        "apk" => {
            let name = safe_name(parts.get(2).map(String::as_str).unwrap_or(""))?;
            let p = within(&out_dir, name)?;
            Ok(match fs::read(&p) { Ok(b) => respond(StatusCode::OK, b, "application/vnd.android.package-archive"), Err(_) => err(StatusCode::NOT_FOUND, "Not found") })
        }
        _ => Ok(err(StatusCode::NOT_FOUND, "Unknown API route")),
    }
}

fn projects(cfg: &Config, method: &Method, parts: &[String], body: &[u8]) -> Result<Res, String> {
    let root = &cfg.projects_dir;
    if parts.len() == 1 {
        if *method != Method::GET {
            return Ok(err(StatusCode::NOT_FOUND, "Unknown API route"));
        }
        let mut list = Vec::new();
        if let Ok(rd) = fs::read_dir(root) {
            for d in rd.flatten() {
                let name = d.file_name().to_string_lossy().to_string();
                if !d.path().is_dir() || name.starts_with('.') {
                    continue;
                }
                let f = d.path().join("project.json");
                if !f.exists() {
                    continue;
                }
                let auto = d.path().join("autosave.json");
                match fs::read(&f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                    Some(j) => list.push(json!({
                        "id": name, "name": j.get("name").cloned().unwrap_or(Value::Null),
                        "template": j.get("template").cloned().unwrap_or(Value::Null),
                        "modified": mtime_ms(&f),
                        "hasNewerAutosave": auto.exists() && mtime_ms(&auto) > mtime_ms(&f),
                    })),
                    None => list.push(json!({ "id": name, "name": format!("{name} (unreadable)"), "error": true, "modified": 0 })),
                }
            }
        }
        list.sort_by(|a, b| b["modified"].as_f64().unwrap_or(0.0).total_cmp(&a["modified"].as_f64().unwrap_or(0.0)));
        return Ok(json_res(StatusCode::OK, Value::Array(list)));
    }
    let id = safe_name(&parts[1])?;
    let dir = within(root, id)?;
    let sub = parts.get(2).map(String::as_str);

    if sub == Some("files") {
        // Project-local asset files (imported models, textures).
        let p = within(&dir.join("assets"), &parts[3..].join("/"))?;
        return Ok(match *method {
            Method::GET => match fs::read(&p) {
                Ok(b) => respond(StatusCode::OK, b, mime_of(&p)),
                Err(_) => err(StatusCode::NOT_FOUND, "Not found"),
            },
            Method::PUT => {
                if let Some(parent) = p.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::write(&p, body).map_err(|e| e.to_string())?;
                ok()
            }
            Method::DELETE => {
                if p.is_file() {
                    fs::remove_file(&p).map_err(|e| e.to_string())?;
                }
                ok()
            }
            _ => err(StatusCode::NOT_FOUND, "Unknown API route"),
        });
    }

    let file = if sub == Some("autosave") { "autosave.json" } else { "project.json" };
    match *method {
        Method::GET => Ok(match fs::read(dir.join(file)) {
            Ok(b) => respond(StatusCode::OK, b, "application/json"),
            Err(_) => err(StatusCode::NOT_FOUND, "Project not found"),
        }),
        Method::PUT => {
            serde_json::from_slice::<Value>(body).map_err(|e| format!("Invalid JSON: {e}"))?; // validate before writing
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let target = dir.join(file);
            // Keep one backup of the previous save.
            if file == "project.json" && target.exists() {
                let _ = fs::copy(&target, dir.join("project.backup.json"));
            }
            write_atomic(&target, body).map_err(|e| e.to_string())?;
            if file == "project.json" {
                let _ = fs::remove_file(dir.join("autosave.json"));
            }
            Ok(ok())
        }
        Method::DELETE => {
            if sub == Some("autosave") {
                let _ = fs::remove_file(dir.join("autosave.json"));
                return Ok(ok());
            }
            // Projects are moved to a recoverable trash folder, never hard-deleted.
            let trash = root.join(".trash");
            fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            fs::rename(&dir, trash.join(format!("{id}-{stamp}"))).map_err(|e| e.to_string())?;
            Ok(ok())
        }
        _ => Ok(err(StatusCode::NOT_FOUND, "Unknown API route")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(name: &str) -> (Config, PathBuf) {
        let base = std::env::temp_dir().join(format!("craft-backend-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let lib = base.join("lib");
        fs::create_dir_all(lib.join("sub")).unwrap();
        fs::write(lib.join("sub").join("a.png"), b"png").unwrap();
        let c = Config { projects_dir: base.join("projects"), exchange_dir: base.join("exchange"), libraries: vec![Library { id: "library".into(), dir: lib, label: "Lib".into() }], extensions_dir: None };
        c.ensure_dirs();
        (c, base)
    }
    fn call(c: &Config, m: Method, uri: &str, body: &[u8]) -> Res {
        handle(c, &Request::builder().method(m).uri(uri).body(body.to_vec()).unwrap())
    }
    fn body_json(r: &Res) -> Value {
        serde_json::from_slice(r.body()).unwrap()
    }

    #[test]
    fn project_save_load_list_autosave_trash() {
        let (c, base) = cfg("projects");
        assert_eq!(call(&c, Method::PUT, "http://craft.localhost/api/projects/my-game", br#"{"name":"My game","template":"empty"}"#).status(), 200);
        assert_eq!(call(&c, Method::PUT, "http://craft.localhost/api/projects/my-game", br#"{"name":"My game 2"}"#).status(), 200);
        assert!(c.projects_dir.join("my-game/project.backup.json").exists());
        let r = call(&c, Method::GET, "http://craft.localhost/api/projects/my-game", b"");
        assert_eq!(body_json(&r)["name"], "My game 2");
        call(&c, Method::PUT, "http://craft.localhost/api/projects/my-game/autosave", br#"{"name":"auto"}"#);
        let list = body_json(&call(&c, Method::GET, "http://craft.localhost/api/projects", b""));
        assert_eq!(list[0]["id"], "my-game");
        assert_eq!(list[0]["name"], "My game 2");
        // Invalid JSON is refused and the saved file is untouched.
        assert_eq!(call(&c, Method::PUT, "http://craft.localhost/api/projects/my-game", b"{nope").status(), 400);
        assert_eq!(body_json(&call(&c, Method::GET, "http://craft.localhost/api/projects/my-game", b""))["name"], "My game 2");
        // Delete moves to trash.
        assert_eq!(call(&c, Method::DELETE, "http://craft.localhost/api/projects/my-game", b"").status(), 200);
        assert!(!c.projects_dir.join("my-game").exists());
        assert_eq!(fs::read_dir(c.projects_dir.join(".trash")).unwrap().count(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn files_library_and_path_safety() {
        let (c, base) = cfg("files");
        call(&c, Method::PUT, "http://craft.localhost/api/projects/p/files/imported/hero/hero%20v2.glb", b"GLB");
        let r = call(&c, Method::GET, "http://craft.localhost/api/projects/p/files/imported/hero/hero%20v2.glb", b"");
        assert_eq!(r.body(), b"GLB");
        assert_eq!(r.headers()["Access-Control-Allow-Origin"], "*");
        let r = call(&c, Method::GET, "http://craft.localhost/api/library/library/sub/a.png", b"");
        assert_eq!((r.status().as_u16(), r.headers()["Content-Type"].to_str().unwrap()), (200, "image/png"));
        let libs = body_json(&call(&c, Method::GET, "http://craft.localhost/api/library", b""));
        assert_eq!(libs[0]["files"][0]["path"], "sub/a.png");
        // Escapes are refused.
        for bad in ["/api/library/library/..%2F..%2Fsecret", "/api/projects/..%2Fx", "/api/projects/p/files/..%2F..%2Fproject.json", "/api/exchange/..%5Cx.json"] {
            let r = call(&c, Method::GET, &format!("http://craft.localhost{bad}"), b"");
            assert!(r.status() == 400 || r.status() == 404, "{bad} -> {}", r.status());
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn exchange_and_preflight() {
        let (c, base) = cfg("exchange");
        assert_eq!(call(&c, Method::OPTIONS, "http://craft.localhost/api/exchange/x.json", b"").status(), 204);
        assert_eq!(call(&c, Method::PUT, "http://craft.localhost/api/exchange/shared.json", br#"{"a":1}"#).status(), 200);
        let list = body_json(&call(&c, Method::GET, "http://craft.localhost/api/exchange", b""));
        assert_eq!(list[0]["path"], "shared.json");
        let _ = fs::remove_dir_all(base);
    }
}
