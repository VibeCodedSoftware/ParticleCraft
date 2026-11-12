//! Android APK export: wraps an exported web build of a game in a small native app (a full-screen WebView that
//! serves the game from the APK's assets over a private https origin) and builds a real, signed `.apk` with the
//! user's Android SDK and JDK:
//!
//!   javac → d8 (classes.dex) → aapt2 compile/link (manifest, icon, assets) → jar (add dex) → zipalign → apksigner
//!
//! then validates the result (signature verifies, package/version as asked, dex + game files inside) and returns a
//! build log. Never claims success without a validated file. Release builds are signed only with the user's own
//! key: a release without one is refused, never silently signed with the debug key. Android App Bundles (.aab, for
//! Google Play): resources linked in protobuf form, the `base` module assembled, then Google's bundletool (a .jar the
//! user puts in the SDK folder) and jarsigner. Options: min / target SDK, extra permissions from a fixed list, a
//! splash screen (colour + the game's splash.png) shown while the game loads.
//!
//! Routes (after `/api/android/`): `status` GET · `build` POST · `keystore` POST.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the SDK pieces live (None = missing).
#[derive(Debug, Clone, Default)]
pub struct Toolchain {
    pub sdk: Option<PathBuf>,
    pub build_tools: Option<PathBuf>,
    pub platform_jar: Option<PathBuf>,
    pub platform_api: u32,
    pub jdk_bin: Option<PathBuf>,
    /// Google's bundletool .jar (Android App Bundles only): BUNDLETOOL, or a bundletool*.jar in the SDK folder.
    pub bundletool: Option<PathBuf>,
}

impl Toolchain {
    pub fn missing(&self) -> Vec<&'static str> {
        let mut m = Vec::new();
        if self.sdk.is_none() { m.push("Android SDK"); }
        if self.sdk.is_some() && self.build_tools.is_none() { m.push("Android SDK Build-Tools (aapt2, d8, zipalign, apksigner)"); }
        if self.sdk.is_some() && self.platform_jar.is_none() { m.push("an Android SDK Platform (android-24 or newer)"); }
        if self.jdk_bin.is_none() { m.push("a Java JDK 17 or newer (javac, jar, keytool)"); }
        m
    }
    fn tool(&self, name: &str) -> PathBuf {
        let bt = self.build_tools.clone().unwrap_or_default();
        for ext in ["", ".exe", ".bat"] {
            let p = bt.join(format!("{name}{ext}"));
            if p.is_file() { return p; }
        }
        bt.join(name)
    }
    fn java(&self, name: &str) -> PathBuf {
        let bin = self.jdk_bin.clone().unwrap_or_default();
        let p = bin.join(format!("{name}.exe"));
        if p.is_file() { p } else { bin.join(name) }
    }
}

/// Steps a user follows to install what is missing.
pub fn guide() -> Vec<&'static str> {
    vec![
        "Install Android Studio (developer.android.com/studio), or only the \"Command line tools\" from the same page.",
        "In Android Studio: More Actions › SDK Manager. Tick an Android SDK Platform (API 34 or newer) and, under SDK Tools, Android SDK Build-Tools. Apply.",
        "The SDK is usually installed in %LOCALAPPDATA%\\Android\\Sdk, which GameCraft finds by itself. Elsewhere: set the ANDROID_HOME environment variable, or enter the folder in the export dialog.",
        "Java: Android Studio includes one (jbr folder); or install a JDK 17+ (adoptium.net) and set JAVA_HOME.",
        "Then export again. Debug APKs install on your own phone (Settings › Security › Install unknown apps). Release APKs need your own signing key: Create release key… makes one; keep it and its passwords safe, every update must be signed with the same key.",
    ]
}

fn highest_dir(dir: &Path, filter: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut best: Option<(Vec<u32>, PathBuf)> = None;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if !p.is_dir() || !filter(&p) { continue; }
        let name = e.file_name().to_string_lossy().to_string();
        let ver: Vec<u32> = name.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).filter_map(|s| s.parse().ok()).collect();
        if best.as_ref().is_none_or(|(b, _)| ver > *b) { best = Some((ver, p)); }
    }
    best.map(|(_, p)| p)
}

/// Find the SDK and JDK: an explicit folder first, then ANDROID_HOME / ANDROID_SDK_ROOT, then the usual places.
pub fn detect(sdk_hint: Option<&str>) -> Toolchain {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Some(h) = sdk_hint.filter(|h| !h.trim().is_empty()) { cands.push(PathBuf::from(h.trim())); }
    for v in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] { if let Ok(p) = std::env::var(v) { cands.push(PathBuf::from(p)); } }
    if let Ok(l) = std::env::var("LOCALAPPDATA") { cands.push(Path::new(&l).join("Android").join("Sdk")); }
    if let Ok(h) = std::env::var("HOME") { cands.push(Path::new(&h).join("Android").join("Sdk")); cands.push(Path::new(&h).join("Library/Android/sdk")); }
    let mut t = Toolchain::default();
    if let Some(sdk) = cands.into_iter().find(|p| p.join("build-tools").is_dir() || p.join("platforms").is_dir() || p.join("cmdline-tools").is_dir()) {
        t.build_tools = highest_dir(&sdk.join("build-tools"), |p| ["aapt2", "aapt2.exe"].iter().any(|n| p.join(n).is_file()));
        if let Some(pl) = highest_dir(&sdk.join("platforms"), |p| p.join("android.jar").is_file()) {
            t.platform_api = pl.file_name().map(|n| n.to_string_lossy().chars().filter(|c| c.is_ascii_digit()).collect::<String>()).and_then(|s| s.parse().ok()).unwrap_or(0);
            if t.platform_api >= 24 { t.platform_jar = Some(pl.join("android.jar")); }
        }
        let jar_in = |d: &Path| fs::read_dir(d).ok().and_then(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.file_name().is_some_and(|n| { let n = n.to_string_lossy().to_lowercase(); n.starts_with("bundletool") && n.ends_with(".jar") })).max());
        t.bundletool = std::env::var("BUNDLETOOL").ok().map(PathBuf::from).filter(|p| p.is_file()).or_else(|| jar_in(&sdk)).or_else(|| jar_in(&sdk.join("bundletool")));
        t.sdk = Some(sdk);
    }
    // JDK: JAVA_HOME, Android Studio's bundled one, then PATH.
    let mut jdks: Vec<PathBuf> = Vec::new();
    if let Ok(j) = std::env::var("JAVA_HOME") { jdks.push(Path::new(&j).join("bin")); }
    for pf in ["ProgramFiles", "ProgramW6432"] {
        if let Ok(p) = std::env::var(pf) {
            jdks.push(Path::new(&p).join("Android").join("Android Studio").join("jbr").join("bin"));
            for vendor in ["Java", "Eclipse Adoptium", "Microsoft"] { if let Some(d) = highest_dir(&Path::new(&p).join(vendor), |d| d.join("bin").join("javac.exe").is_file()) { jdks.push(d.join("bin")); } }
        }
    }
    if let Ok(path) = std::env::var("PATH") { for d in std::env::split_paths(&path) { jdks.push(d); } }
    t.jdk_bin = jdks.into_iter().find(|d| ["javac", "javac.exe"].iter().any(|n| d.join(n).is_file()) && ["keytool", "keytool.exe"].iter().any(|n| d.join(n).is_file()));
    t
}

pub fn status(sdk_hint: Option<&str>) -> Value {
    let t = detect(sdk_hint);
    let missing = t.missing();
    json!({
        "ready": missing.is_empty(),
        "sdk": t.sdk.as_ref().map(|p| p.to_string_lossy()),
        "buildTools": t.build_tools.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy()),
        "platform": if t.platform_api > 0 { Some(format!("android-{}", t.platform_api)) } else { None },
        "jdk": t.jdk_bin.as_ref().map(|p| p.to_string_lossy()),
        "bundletool": t.bundletool.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy()),
        "missing": missing,
        "guide": if missing.is_empty() { Vec::new() } else { guide() },
    })
}

// ------------------------------------------------------------------ the stored (uncompressed) game zip
/// Entries of a stored zip (the export writer never compresses). Rejects anything else rather than guessing.
pub fn read_stored_zip(z: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let u16_at = |o: usize| -> Result<usize, String> { z.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or("Truncated zip".to_string()) };
    let u32_at = |o: usize| -> Result<usize, String> { z.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).ok_or("Truncated zip".to_string()) };
    while i + 30 <= z.len() && u32_at(i)? == 0x0403_4b50 {
        let method = u16_at(i + 8)?;
        let size = u32_at(i + 18)?;
        let (nlen, xlen) = (u16_at(i + 26)?, u16_at(i + 28)?);
        if method != 0 { return Err("The game archive is compressed; expected the exporter's stored zip".into()); }
        let name = String::from_utf8_lossy(z.get(i + 30..i + 30 + nlen).ok_or("Truncated zip")?).to_string();
        let start = i + 30 + nlen + xlen;
        let data = z.get(start..start + size).ok_or("Truncated zip")?.to_vec();
        if name.contains("..") || name.starts_with('/') || name.contains(':') { return Err(format!("Unsafe path in archive: {name}")); }
        out.push((name, data));
        i = start + size;
    }
    if out.is_empty() { return Err("The game archive is empty or not a zip".into()); }
    Ok(out)
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (n, t) in table.iter_mut().enumerate() { let mut c = n as u32; for _ in 0..8 { c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 }; } *t = c; }
    let mut c = 0xffff_ffffu32;
    for &b in data { c = table[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8); }
    c ^ 0xffff_ffff
}

/// A new archive: every entry of `base` copied byte for byte (compression kept: resources.arsc must stay stored for
/// Android 11+), then `extra` entries stored, with `/` paths. (aapt2 -A on Windows wrote `assets/game\data\…`
/// names Android cannot find, and `jar -u` would re-pack resources.arsc.)
pub fn rezip(base: &[u8], extra: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> { rezip_renamed(base, |n| n.to_string(), extra) }

/// `rezip` with every copied entry renamed (`AndroidManifest.xml` → `manifest/AndroidManifest.xml` for a bundle
/// module), still byte for byte: entries aapt2 compressed stay compressed, no inflating needed.
pub fn rezip_renamed(base: &[u8], rename: impl Fn(&str) -> String, extra: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let rd16 = |o: usize| base.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or("Bad APK");
    let rd32 = |o: usize| base.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or("Bad APK");
    let eocd = (0..base.len().saturating_sub(21)).rev().find(|&i| base[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]).ok_or("Bad APK: no end record")?;
    let (count, mut p) = (rd16(eocd + 10)?, rd32(eocd + 16)? as usize);
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    let mut entries = 0u16;
    let mut put = |out: &mut Vec<u8>, central: &mut Vec<u8>, name: &[u8], method: u16, crc: u32, csize: u32, usize_: u32, data: &[u8]| {
        let off = out.len() as u32;
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes()); out.extend_from_slice(&20u16.to_le_bytes()); out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes()); out.extend_from_slice(&[0, 0, 0x21, 0]); // time / date (1980-01-01)
        out.extend_from_slice(&crc.to_le_bytes()); out.extend_from_slice(&csize.to_le_bytes()); out.extend_from_slice(&usize_.to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes()); out.extend_from_slice(&0u16.to_le_bytes()); out.extend_from_slice(name); out.extend_from_slice(data);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes()); central.extend_from_slice(&20u16.to_le_bytes()); central.extend_from_slice(&20u16.to_le_bytes()); central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&method.to_le_bytes()); central.extend_from_slice(&[0, 0, 0x21, 0]);
        central.extend_from_slice(&crc.to_le_bytes()); central.extend_from_slice(&csize.to_le_bytes()); central.extend_from_slice(&usize_.to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes()); central.extend_from_slice(&[0; 12]); central.extend_from_slice(&off.to_le_bytes()); central.extend_from_slice(name);
    };
    for _ in 0..count {
        if rd32(p)? != 0x0201_4b50 { return Err("Bad APK: central directory".into()); }
        let (method, crc, csize, usize_) = (rd16(p + 10)? as u16, rd32(p + 16)?, rd32(p + 20)?, rd32(p + 24)?);
        let (n, x, c, lo) = (rd16(p + 28)?, rd16(p + 30)?, rd16(p + 32)?, rd32(p + 42)? as usize);
        let name = rename(&String::from_utf8_lossy(base.get(p + 46..p + 46 + n).ok_or("Bad APK")?)).into_bytes();
        let start = lo + 30 + rd16(lo + 26)? + rd16(lo + 28)?;
        let data = base.get(start..start + csize as usize).ok_or("Bad APK: entry data")?;
        put(&mut out, &mut central, &name, method, crc, csize, usize_, data);
        entries += 1;
        p += 46 + n + x + c;
    }
    for (name, data) in extra {
        let name = name.replace('\\', "/");
        put(&mut out, &mut central, name.as_bytes(), 0, crc32(data), data.len() as u32, data.len() as u32, data);
        entries += 1;
    }
    let (cd_off, cd_len) = (out.len() as u32, central.len() as u32);
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes()); out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&entries.to_le_bytes()); out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&cd_len.to_le_bytes()); out.extend_from_slice(&cd_off.to_le_bytes()); out.extend_from_slice(&[0; 2]);
    Ok(out)
}

/// Compression method of one entry (0 = stored), from the central directory.
pub fn entry_method(z: &[u8], want: &str) -> Option<u16> {
    let eocd = (0..z.len().saturating_sub(21)).rev().find(|&i| z[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])?;
    let rd16 = |o: usize| z.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).unwrap_or(0);
    let rd32 = |o: usize| z.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).unwrap_or(0);
    let mut p = rd32(eocd + 16);
    for _ in 0..rd16(eocd + 10) {
        let (n, x, c) = (rd16(p + 28), rd16(p + 30), rd16(p + 32));
        if z.get(p + 46..p + 46 + n) == Some(want.as_bytes()) { return Some(rd16(p + 10) as u16); }
        p += 46 + n + x + c;
    }
    None
}

/// File names in any zip (APK), read from its central directory.
pub fn zip_names(z: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let Some(eocd) = (0..z.len().saturating_sub(21)).rev().find(|&i| z[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]) else { return names };
    let rd16 = |o: usize| z.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).unwrap_or(0);
    let rd32 = |o: usize| z.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).unwrap_or(0);
    let (count, mut p) = (rd16(eocd + 10), rd32(eocd + 16));
    for _ in 0..count {
        if rd32(p) != 0x0201_4b50 { break; }
        let (n, x, c) = (rd16(p + 28), rd16(p + 30), rd16(p + 32));
        names.push(String::from_utf8_lossy(z.get(p + 46..p + 46 + n).unwrap_or(&[])).to_string());
        p += 46 + n + x + c;
    }
    names
}

// ------------------------------------------------------------------ the generated app
#[derive(Debug, Clone, Default)]
pub struct AppSpec {
    pub app_id: String,
    pub label: String,
    pub version_name: String,
    pub version_code: u32,
    pub orientation: String,
    pub release: bool,
    /// Oldest Android the app installs on (API level; 0 = 24, Android 7). Newest it targets (0 = the SDK platform's).
    pub min_sdk: u32,
    pub target_sdk: u32,
    /// Extra permissions by short name (only those in PERMISSIONS; INTERNET is always there).
    pub permissions: Vec<String>,
    /// A screen shown while the game loads.
    pub splash: Option<Splash>,
    /// Build an Android App Bundle (.aab, for Google Play) instead of an APK.
    pub bundle: bool,
}

/// Splash screen: background colour (#rrggbb), the game's `splash.png` centred on it when `image`, shown at least
/// `millis` and until the game's page has loaded.
#[derive(Debug, Clone)]
pub struct Splash { pub color: String, pub image: bool, pub millis: u32 }

/// Permissions a game may ask for (anything else is ignored), with what each is for.
pub const PERMISSIONS: [(&str, &str); 8] = [
    ("VIBRATE", "vibration"), ("WAKE_LOCK", "keep the device awake"), ("ACCESS_NETWORK_STATE", "check the connection"),
    ("RECORD_AUDIO", "microphone"), ("CAMERA", "camera"), ("ACCESS_COARSE_LOCATION", "rough location"),
    ("ACCESS_FINE_LOCATION", "precise location"), ("BLUETOOTH_CONNECT", "Bluetooth controllers"),
];

/// The API levels the manifest uses: (min, target), each kept in a range Android and the SDK accept.
pub fn sdk_levels(s: &AppSpec, platform_api: u32) -> (u32, u32) {
    let target = if s.target_sdk > 0 { s.target_sdk.min(platform_api).max(24) } else { platform_api };
    let min = if s.min_sdk > 0 { s.min_sdk.clamp(21, target) } else { 24.min(target) };
    (min, target)
}

/// "#rrggbb" or a safe default (the colour goes into generated Java).
fn hex_color(c: &str) -> String {
    let c = c.trim();
    if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) { c.to_string() } else { "#000000".into() }
}

pub fn valid_app_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() >= 2 && parts.iter().all(|p| !p.is_empty() && p.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
}

fn xml(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "\\'") }

pub fn manifest(s: &AppSpec, platform_api: u32) -> String {
    let orient = match s.orientation.as_str() { "portrait" => "sensorPortrait", "any" | "natural" => "unspecified", _ => "sensorLandscape" };
    let (min, api) = sdk_levels(s, platform_api);
    let perms: String = PERMISSIONS.iter().filter(|(p, _)| s.permissions.iter().any(|x| x == p))
        .map(|(p, _)| format!("  <uses-permission android:name=\"android.permission.{p}\" />\n")).collect();
    format!(r#"<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{id}" android:versionCode="{vc}" android:versionName="{vn}">
  <uses-sdk android:minSdkVersion="{min}" android:targetSdkVersion="{api}" />
  <uses-permission android:name="android.permission.INTERNET" />
{perms}  <uses-feature android:glEsVersion="0x00020000" android:required="true" />
  <application android:label="{label}" android:icon="@mipmap/ic_launcher" android:hardwareAccelerated="true" android:debuggable="{dbg}" android:allowBackup="true" android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen">
    <activity android:name=".MainActivity" android:exported="true" android:screenOrientation="{orient}" android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|keyboard|navigation|uiMode" android:launchMode="singleTask">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
"#, id = s.app_id, vc = s.version_code, vn = xml(&s.version_name), min = min, api = api, perms = perms, label = xml(&s.label), dbg = !s.release, orient = orient)
}

/// The app: a full-screen WebView serving `assets/game/` at https://appassets.androidplatform.net/ (a real https
/// origin, so modules, workers and storage behave as on the web), immersive, screen kept on, Back goes back.
pub fn main_activity(app_id: &str, splash: Option<&Splash>) -> String {
    // Splash: a colour (and the game's splash.png) over the WebView until the page has loaded and at least `millis`
    // have passed (8 s at most if the page never reports in), then a short fade.
    let (sp_color, sp_image, sp_ms) = splash.map(|s| (hex_color(&s.color), s.image, s.millis.min(10_000))).unwrap_or(("#000000".into(), false, 0));
    let has_splash = splash.is_some();
    format!(r#"package {app_id};

import android.app.Activity;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.util.HashMap;

public class MainActivity extends Activity {{
    private static final String HOST = "appassets.androidplatform.net";
    private static final boolean SPLASH = {has_splash};
    private static final long SPLASH_MS = {sp_ms};
    private WebView web;
    private FrameLayout root;
    private View splash;
    private final long started = SystemClock.uptimeMillis();
    private final Handler main = new Handler(Looper.getMainLooper());

    private void showSplash() {{
        FrameLayout s = new FrameLayout(this);
        s.setBackgroundColor(Color.parseColor("{sp_color}"));
        if ({sp_image}) {{
            try {{
                ImageView iv = new ImageView(this);
                iv.setImageBitmap(BitmapFactory.decodeStream(getAssets().open("game/splash.png")));
                iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                int pad = (int) (getResources().getDisplayMetrics().density * 32);
                iv.setPadding(pad, pad, pad, pad);
                s.addView(iv, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            }} catch (Exception e) {{ /* no picture: the colour alone */ }}
        }}
        s.setClickable(true);
        splash = s;
        root.addView(s, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        main.postDelayed(this::hideSplash, Math.max(SPLASH_MS, 8000));
    }}
    private void hideSplash() {{
        final View s = splash;
        if (s == null) return;
        splash = null;
        long wait = Math.max(0, SPLASH_MS - (SystemClock.uptimeMillis() - started));
        main.postDelayed(() -> s.animate().alpha(0f).setDuration(300).withEndAction(() -> root.removeView(s)).start(), wait);
    }}

    @Override protected void onCreate(Bundle state) {{
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {{
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {{
                if (!HOST.equals(r.getUrl().getHost())) return null;
                String path = r.getUrl().getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                try {{
                    InputStream in = getAssets().open("game" + path);
                    HashMap<String, String> h = new HashMap<String, String>();
                    h.put("Access-Control-Allow-Origin", "*");
                    h.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") || path.endsWith(".json") ? "utf-8" : null, 200, "OK", h, in);
                }} catch (Exception e) {{
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
                }}
            }}
            @Override public void onPageFinished(WebView v, String url) {{ hideSplash(); }}
        }});
        setContentView(root);
        if (SPLASH && state == null) showSplash();
        immersive();
        if (state != null) web.restoreState(state); else web.loadUrl("https://" + HOST + "/player.html");
    }}

    private static String mime(String p) {{
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json") || l.endsWith(".webmanifest")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".gif")) return "image/gif";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".wasm")) return "application/wasm";
        if (l.endsWith(".glb")) return "model/gltf-binary";
        if (l.endsWith(".gltf")) return "model/gltf+json";
        if (l.endsWith(".mp3")) return "audio/mpeg";
        if (l.endsWith(".ogg")) return "audio/ogg";
        if (l.endsWith(".wav")) return "audio/wav";
        if (l.endsWith(".mp4")) return "video/mp4";
        if (l.endsWith(".webm")) return "video/webm";
        if (l.endsWith(".ttf")) return "font/ttf";
        if (l.endsWith(".otf")) return "font/otf";
        if (l.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }}

    private void immersive() {{
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }}
    @Override public void onWindowFocusChanged(boolean f) {{ super.onWindowFocusChanged(f); if (f) immersive(); }}
    @Override protected void onSaveInstanceState(Bundle out) {{ super.onSaveInstanceState(out); web.saveState(out); }}
    @Override protected void onPause() {{ super.onPause(); web.onPause(); }}
    @Override protected void onResume() {{ super.onResume(); web.onResume(); }}
    @Override public void onBackPressed() {{ if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }}
    @Override protected void onDestroy() {{ web.destroy(); super.onDestroy(); }}
}}
"#, has_splash = has_splash, sp_ms = sp_ms, sp_color = sp_color, sp_image = sp_image)
}

// ------------------------------------------------------------------ build
pub struct Signing { pub keystore: PathBuf, pub alias: String, pub store_pass: String, pub key_pass: String }

pub struct BuildResult { pub ok: bool, pub apk: Option<PathBuf>, pub log: String, pub checks: Vec<(String, bool)> }

/// Build log; passwords are masked in every line.
pub struct Log { text: String, secrets: Vec<String> }
impl Log {
    fn line(&mut self, s: impl AsRef<str>) { let mut s = s.as_ref().to_string(); for x in &self.secrets { if !x.is_empty() { s = s.replace(x, "••••"); } } self.text.push_str(&s); self.text.push('\n'); }
    /// Run a tool, log its command line and output; Err with the tool's message on failure.
    fn run(&mut self, cmd: &mut Command, what: &str) -> Result<String, String> {
        self.line(format!("$ {:?}", cmd).replace('"', ""));
        let out = cmd.output().map_err(|e| { let m = format!("{what}: could not start ({e})"); self.line(&m); m })?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if !text.trim().is_empty() { self.line(text.trim_end()); }
        if !out.status.success() { let m = format!("{what} failed (exit {})", out.status.code().unwrap_or(-1)); self.line(&m); return Err(m); }
        Ok(text)
    }
}

/// Batch files (.bat) must run through cmd on Windows.
fn cmd(p: &Path) -> Command {
    if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("bat")) { let mut c = Command::new("cmd"); c.arg("/C").arg(p); c } else { Command::new(p) }
}

fn files_under_all(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = fs::read_dir(dir) { for e in rd.flatten() { let p = e.path(); if p.is_dir() { files_under_all(&p, out); } else { out.push(p); } } }
}

fn files_under(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = fs::read_dir(dir) { for e in rd.flatten() { let p = e.path(); if p.is_dir() { files_under(&p, ext, out); } else if p.extension().is_some_and(|x| x == ext) { out.push(p); } } }
}

/// Debug key (created on first use, like Android Studio's): only ever used for debug builds.
pub fn debug_keystore(t: &Toolchain, dir: &Path, log: &mut Log) -> Result<Signing, String> {
    let ks = dir.join("debug.keystore");
    if !ks.is_file() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        log.run(Command::new(t.java("keytool")).args(["-genkeypair", "-keystore"]).arg(&ks).args(["-storepass", "android", "-keypass", "android", "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=Android Debug,O=Android,C=US", "-noprompt"]), "Creating the debug key")?;
    }
    Ok(Signing { keystore: ks, alias: "androiddebugkey".into(), store_pass: "android".into(), key_pass: "android".into() })
}

/// Build and validate an APK from an exported web build (stored zip with one top folder holding player.html).
pub fn build(t: &Toolchain, spec: &AppSpec, game_zip: &[u8], signing: Option<Signing>, work: &Path, out_dir: &Path, debug_key_dir: &Path) -> BuildResult {
    let mut log = Log { text: String::new(), secrets: signing.as_ref().map(|s| vec![s.store_pass.clone(), s.key_pass.clone()]).unwrap_or_default() };
    let mut checks: Vec<(String, bool)> = Vec::new();
    let res = (|| -> Result<PathBuf, String> {
        let missing = t.missing();
        if !missing.is_empty() { return Err(format!("Missing: {}. See the steps in the export dialog.", missing.join(", "))); }
        if !valid_app_id(&spec.app_id) { return Err(format!("\"{}\" is not a valid app id: use reverse-domain form like com.mystudio.mygame (letters, digits, _; each part starts with a letter).", spec.app_id)); }
        if spec.release && signing.is_none() { return Err("A release APK must be signed with your own key. Choose your keystore (or Create release key…) in the export dialog; GameCraft never signs a release with the debug key.".into()); }
        if spec.bundle && (!spec.release || signing.is_none()) { return Err("An App Bundle (.aab) is for Google Play: build it as a release, signed with your own key (your Play upload key).".into()); }
        if spec.bundle && t.bundletool.is_none() { return Err(BUNDLETOOL_MISSING.into()); }
        let jar = t.platform_jar.clone().unwrap();
        let _ = fs::remove_dir_all(work);
        for d in ["src", "classes", "dex", "res/mipmap", "assets/game"] { fs::create_dir_all(work.join(d)).map_err(|e| e.to_string())?; }
        log.line(format!("GameCraft APK build · {} {} ({}) · {} · build-tools {} · android-{}", spec.app_id, spec.version_name, spec.version_code, if spec.release { "release" } else { "debug" }, t.build_tools.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), t.platform_api));
        // 1. The game files → assets/game (the zip's single top folder is dropped).
        let entries = read_stored_zip(game_zip)?;
        let top = entries[0].0.split('/').next().unwrap_or("").to_string() + "/";
        let mut count = 0;
        for (name, data) in &entries {
            let rel = name.strip_prefix(&top).unwrap_or(name);
            if rel.is_empty() || name.ends_with('/') { continue; }
            let p = work.join("assets/game").join(rel);
            fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::write(&p, data).map_err(|e| e.to_string())?;
            count += 1;
        }
        if !work.join("assets/game/player.html").is_file() { return Err("The exported game has no player.html".into()); }
        log.line(format!("{count} game file(s) packed as assets"));
        // 2. Icon, manifest, activity.
        let icon = work.join("assets/game/icon.png");
        if icon.is_file() { fs::copy(&icon, work.join("res/mipmap/ic_launcher.png")).map_err(|e| e.to_string())?; } else { return Err("The exported game has no icon.png".into()); }
        fs::write(work.join("AndroidManifest.xml"), manifest(spec, t.platform_api)).map_err(|e| e.to_string())?;
        let pkg_dir = work.join("src").join(spec.app_id.replace('.', "/"));
        fs::create_dir_all(&pkg_dir).map_err(|e| e.to_string())?;
        fs::write(pkg_dir.join("MainActivity.java"), main_activity(&spec.app_id, spec.splash.as_ref())).map_err(|e| e.to_string())?;
        if spec.splash.as_ref().is_some_and(|s| s.image) && !work.join("assets/game/splash.png").is_file() { log.line("Splash picture: the export has no splash.png, the splash shows its colour only"); }
        // 3. Java → classes → dex.
        log.run(Command::new(t.java("javac")).args(["--release", "11", "-encoding", "UTF-8", "-nowarn", "-classpath"]).arg(&jar).arg("-d").arg(work.join("classes")).arg(pkg_dir.join("MainActivity.java")), "Compiling the app (javac)")?;
        let mut classes = Vec::new(); files_under(&work.join("classes"), "class", &mut classes);
        let mut d8 = cmd(&t.tool("d8"));
        let min_api = sdk_levels(spec, t.platform_api).0.to_string();
        d8.args([if spec.release { "--release" } else { "--debug" }, "--min-api", &min_api, "--lib"]).arg(&jar).arg("--output").arg(work.join("dex")).args(&classes);
        log.run(&mut d8, "Converting to Android bytecode (d8)")?;
        if !work.join("dex/classes.dex").is_file() { return Err("d8 produced no classes.dex".into()); }
        // 4. Resources + manifest + assets → APK.
        log.run(cmd(&t.tool("aapt2")).args(["compile", "--dir"]).arg(work.join("res")).arg("-o").arg(work.join("res.zip")), "Compiling resources (aapt2)")?;
        if spec.bundle { return build_bundle(t, spec, signing.as_ref().unwrap(), work, out_dir, &jar, &mut log, &mut checks); }
        log.run(cmd(&t.tool("aapt2")).arg("link").arg("-o").arg(work.join("linked.apk")).arg("-I").arg(&jar).arg("--manifest").arg(work.join("AndroidManifest.xml")).arg(work.join("res.zip")).arg("--auto-add-overlay"), "Linking the APK (aapt2)")?;
        // Code and game files are added here, with portable `/` paths.
        let mut extra: Vec<(String, Vec<u8>)> = vec![("classes.dex".into(), fs::read(work.join("dex/classes.dex")).map_err(|e| e.to_string())?)];
        let mut files = Vec::new(); files_under_all(&work.join("assets"), &mut files);
        files.sort();
        for f in files {
            let rel = f.strip_prefix(work).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            extra.push((rel, fs::read(&f).map_err(|e| e.to_string())?));
        }
        let packed = rezip(&fs::read(work.join("linked.apk")).map_err(|e| e.to_string())?, &extra)?;
        fs::write(work.join("unsigned.apk"), packed).map_err(|e| e.to_string())?;
        log.line(format!("Packed classes.dex and {} game file(s) into the APK", extra.len() - 1));
        // 5. Align and sign.
        log.run(cmd(&t.tool("zipalign")).args(["-p", "-f", "4"]).arg(work.join("unsigned.apk")).arg(work.join("aligned.apk")), "Aligning (zipalign)")?;
        // (The debug key's password is the public "android"; only the user's own passwords are masked.)
        let sign = match signing { Some(s) => s, None => debug_keystore(t, debug_key_dir, &mut log)? };
        fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
        let safe: String = spec.label.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        let apk = out_dir.join(format!("{}-{}-{}.apk", if safe.is_empty() { "Game" } else { &safe }, spec.version_name, if spec.release { "release" } else { "debug" }));
        let mut signer = cmd(&t.tool("apksigner"));
        signer.env("CRAFT_KS_PASS", &sign.store_pass).env("CRAFT_KEY_PASS", &sign.key_pass)
            .args(["sign", "--ks"]).arg(&sign.keystore).args(["--ks-key-alias", &sign.alias, "--ks-pass", "env:CRAFT_KS_PASS", "--key-pass", "env:CRAFT_KEY_PASS", "--out"]).arg(&apk).arg(work.join("aligned.apk"));
        log.run(&mut signer, "Signing (apksigner)")?;
        // 6. Validate: never report success for a file that is not a working, signed APK.
        let verify = log.run(cmd(&t.tool("apksigner")).args(["verify", "--verbose", "--print-certs"]).arg(&apk), "Verifying the signature (apksigner)");
        checks.push(("Signature verifies".into(), verify.is_ok()));
        let signer = verify.as_deref().unwrap_or("").lines().find(|l| l.contains("certificate DN:")).unwrap_or("").to_string();
        if spec.release { checks.push(("Release signed with your key, not the debug key".into(), !signer.is_empty() && !signer.contains("Android Debug"))); }
        let badging = log.run(cmd(&t.tool("aapt2")).args(["dump", "badging"]).arg(&apk), "Reading the package (aapt2 dump badging)").unwrap_or_default();
        checks.push((format!("Package {} version {} ({})", spec.app_id, spec.version_name, spec.version_code), badging.contains(&format!("name='{}'", spec.app_id)) && badging.contains(&format!("versionCode='{}'", spec.version_code))));
        let bytes = fs::read(&apk).map_err(|e| e.to_string())?;
        let names = zip_names(&bytes);
        checks.push(("Contains the app code (classes.dex)".into(), names.iter().any(|n| n == "classes.dex")));
        checks.push(("Contains the game (assets/game/player.html, game.json)".into(), names.iter().any(|n| n == "assets/game/player.html") && names.iter().any(|n| n == "assets/game/game.json")));
        checks.push(("Has a launcher icon".into(), names.iter().any(|n| n.starts_with("res/") && n.ends_with(".png"))));
        checks.push(("Paths use / (no Windows backslashes)".into(), names.iter().all(|n| !n.contains('\\'))));
        checks.push(("resources.arsc stored uncompressed (Android 11+)".into(), entry_method(&bytes, "resources.arsc") == Some(0)));
        for (c, ok) in &checks { log.line(format!("{} {c}", if *ok { "✓" } else { "✗" })); }
        if checks.iter().any(|(_, ok)| !ok) { let _ = fs::remove_file(&apk); return Err("The APK failed validation (see the checks above); no file was kept.".into()); }
        log.line(format!("APK ready: {} ({:.1} MB)", apk.display(), bytes.len() as f64 / 1048576.0));
        Ok(apk)
    })();
    match res {
        Ok(apk) => { let _ = fs::write(apk.with_extension("build.log"), &log.text); BuildResult { ok: true, apk: Some(apk), log: log.text, checks } }
        Err(e) => { log.line(format!("BUILD FAILED: {e}")); BuildResult { ok: false, apk: None, log: log.text, checks } }
    }
}

pub const BUNDLETOOL_MISSING: &str = "Android App Bundles need Google's bundletool (Apache 2.0): download bundletool-all-<version>.jar from github.com/google/bundletool/releases and put it in your Android SDK folder (or set BUNDLETOOL to its path), then export again. APKs don't need it.";

/// The App Bundle: resources linked in protobuf form, laid out as the `base` module (manifest/, dex/, res/,
/// assets/, resources.pb), built with bundletool, signed with the user's key (jarsigner) and validated.
fn build_bundle(t: &Toolchain, spec: &AppSpec, sign: &Signing, work: &Path, out_dir: &Path, jar: &Path, log: &mut Log, checks: &mut Vec<(String, bool)>) -> Result<PathBuf, String> {
    let bt = t.bundletool.clone().ok_or(BUNDLETOOL_MISSING)?;
    log.run(cmd(&t.tool("aapt2")).arg("link").arg("--proto-format").arg("-o").arg(work.join("proto.apk")).arg("-I").arg(jar).arg("--manifest").arg(work.join("AndroidManifest.xml")).arg(work.join("res.zip")).arg("--auto-add-overlay"), "Linking for the bundle (aapt2 --proto-format)")?;
    // aapt2's entries copied as they are (the manifest moves to manifest/), then the code and the game.
    let mut extra: Vec<(String, Vec<u8>)> = vec![("dex/classes.dex".into(), fs::read(work.join("dex/classes.dex")).map_err(|e| e.to_string())?)];
    let mut files = Vec::new(); files_under_all(&work.join("assets"), &mut files);
    files.sort();
    for f in files { extra.push((f.strip_prefix(work).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/"), fs::read(&f).map_err(|e| e.to_string())?)); }
    let proto = fs::read(work.join("proto.apk")).map_err(|e| e.to_string())?;
    let base = rezip_renamed(&proto, |n| if n == "AndroidManifest.xml" { "manifest/AndroidManifest.xml".into() } else { n.to_string() }, &extra)?;
    fs::write(work.join("base.zip"), &base).map_err(|e| e.to_string())?;
    log.line(format!("Base module: {} entries (manifest, dex, resources, game assets)", zip_names(&base).len()));
    let unsigned = work.join("unsigned.aab");
    let _ = fs::remove_file(&unsigned);
    log.run(Command::new(t.java("java")).arg("-jar").arg(&bt).arg("build-bundle").arg(format!("--modules={}", work.join("base.zip").display())).arg(format!("--output={}", unsigned.display())), "Building the bundle (bundletool build-bundle)")?;
    fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let safe: String = spec.label.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let aab = out_dir.join(format!("{}-{}-release.aab", if safe.is_empty() { "Game" } else { &safe }, spec.version_name));
    let mut js = Command::new(t.java("jarsigner"));
    js.env("CRAFT_KS_PASS", &sign.store_pass).env("CRAFT_KEY_PASS", &sign.key_pass)
        .arg("-keystore").arg(&sign.keystore).args(["-storepass:env", "CRAFT_KS_PASS", "-keypass:env", "CRAFT_KEY_PASS", "-sigalg", "SHA256withRSA", "-digestalg", "SHA-256", "-signedjar"]).arg(&aab).arg(&unsigned).arg(&sign.alias);
    log.run(&mut js, "Signing the bundle (jarsigner)")?;
    // Validate: never report success for a file that is not a signed, well-formed bundle.
    let verify = log.run(Command::new(t.java("jarsigner")).arg("-verify").arg(&aab), "Verifying the signature (jarsigner -verify)");
    checks.push(("Signature verifies".into(), verify.as_deref().is_ok_and(|s| s.contains("jar verified"))));
    let valid = log.run(Command::new(t.java("java")).arg("-jar").arg(&bt).arg("validate").arg(format!("--bundle={}", aab.display())), "Checking the bundle (bundletool validate)");
    checks.push(("bundletool accepts the bundle".into(), valid.is_ok()));
    let bytes = fs::read(&aab).map_err(|e| e.to_string())?;
    let names = zip_names(&bytes);
    checks.push(("Base module: manifest, code and game".into(), ["base/manifest/AndroidManifest.xml", "base/dex/classes.dex", "base/assets/game/player.html"].iter().all(|w| names.iter().any(|n| n == w))));
    checks.push(("Paths use / (no Windows backslashes)".into(), names.iter().all(|n| !n.contains('\\'))));
    for (c, ok) in checks.iter() { log.line(format!("{} {c}", if *ok { "✓" } else { "✗" })); }
    if checks.iter().any(|(_, ok)| !ok) { let _ = fs::remove_file(&aab); return Err("The bundle failed validation (see the checks above); no file was kept.".into()); }
    log.line(format!("AAB ready: {} ({:.1} MB) — upload it to Google Play Console", aab.display(), bytes.len() as f64 / 1048576.0));
    Ok(aab)
}

/// Create a release keystore with keytool (the user chooses the passwords; they are never stored by GameCraft).
pub fn create_keystore(t: &Toolchain, path: &Path, alias: &str, store_pass: &str, key_pass: &str, dname: &str) -> Result<String, String> {
    if t.jdk_bin.is_none() { return Err("A Java JDK is needed to create a key (see the steps).".into()); }
    if path.exists() { return Err(format!("{} already exists; choose another file name (never overwrite a signing key).", path.display())); }
    if store_pass.len() < 6 || key_pass.len() < 6 { return Err("Passwords must be at least 6 characters.".into()); }
    if let Some(d) = path.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let mut log = Log { text: String::new(), secrets: vec![store_pass.into(), key_pass.into()] };
    let mut c = Command::new(t.java("keytool"));
    c.env("CRAFT_KS_PASS", store_pass).env("CRAFT_KEY_PASS", key_pass)
        .args(["-genkeypair", "-keystore"]).arg(path).args(["-storetype", "PKCS12", "-storepass:env", "CRAFT_KS_PASS", "-keypass:env", "CRAFT_KEY_PASS", "-alias", alias, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-dname", dname, "-noprompt"]);
    log.run(&mut c, "Creating the release key (keytool)")?;
    Ok(log.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = Vec::new();
        for (n, d) in files {
            z.extend_from_slice(&0x0403_4b50u32.to_le_bytes()); z.extend_from_slice(&[20, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            z.extend_from_slice(&(d.len() as u32).to_le_bytes()); z.extend_from_slice(&(d.len() as u32).to_le_bytes());
            z.extend_from_slice(&(n.len() as u16).to_le_bytes()); z.extend_from_slice(&0u16.to_le_bytes());
            z.extend_from_slice(n.as_bytes()); z.extend_from_slice(d);
        }
        z
    }

    #[test]
    fn reads_the_exported_stored_zip_and_rejects_unsafe_paths() {
        let z = stored_zip(&[("Game/player.html", b"<html>"), ("Game/data/a.png", b"png")]);
        let e = read_stored_zip(&z).unwrap();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].0, "Game/player.html");
        assert_eq!(e[1].1, b"png");
        assert!(read_stored_zip(&stored_zip(&[("../evil", b"x")])).is_err());
        assert!(read_stored_zip(b"not a zip").is_err());
    }

    #[test]
    fn app_ids_are_validated() {
        assert!(valid_app_id("com.mystudio.mygame"));
        assert!(valid_app_id("com.my_studio.game2"));
        for bad in ["game", "com..game", "com.1game", "com.my-game", ""] { assert!(!valid_app_id(bad), "{bad}"); }
    }

    #[test]
    fn manifest_and_activity_carry_the_settings() {
        let s = AppSpec { app_id: "com.a.b".into(), label: "My <Game>".into(), version_name: "1.2".into(), version_code: 7, orientation: "portrait".into(), release: true, ..Default::default() };
        let m = manifest(&s, 34);
        assert!(m.contains(r#"package="com.a.b""#) && m.contains(r#"android:versionCode="7""#) && m.contains("My &lt;Game&gt;"));
        assert!(m.contains("sensorPortrait") && m.contains(r#"android:debuggable="false""#) && m.contains(r#"android:targetSdkVersion="34""#));
        assert!(main_activity("com.a.b", None).starts_with("package com.a.b;"));
    }

    #[test]
    fn sdk_levels_permissions_and_splash() {
        let s = AppSpec { app_id: "com.a.b".into(), label: "G".into(), min_sdk: 26, target_sdk: 33, permissions: vec!["VIBRATE".into(), "CAMERA".into(), "READ_CONTACTS".into()], ..Default::default() };
        let m = manifest(&s, 35);
        assert!(m.contains(r#"android:minSdkVersion="26""#) && m.contains(r#"android:targetSdkVersion="33""#));
        assert!(m.contains("android.permission.VIBRATE") && m.contains("android.permission.CAMERA") && m.contains("android.permission.INTERNET"));
        assert!(!m.contains("READ_CONTACTS"), "only listed permissions");
        // Target above the installed platform: the platform's; min above target: the target.
        assert_eq!(sdk_levels(&AppSpec { min_sdk: 40, target_sdk: 99, ..Default::default() }, 35), (35, 35));
        assert_eq!(sdk_levels(&AppSpec::default(), 34), (24, 34));
        let a = main_activity("com.a.b", Some(&Splash { color: "#12ab9f".into(), image: true, millis: 2000 }));
        assert!(a.contains("SPLASH = true") && a.contains("SPLASH_MS = 2000") && a.contains("#12ab9f") && a.contains("game/splash.png"));
        // A colour is never pasted into Java unchecked.
        assert!(main_activity("com.a.b", Some(&Splash { color: "\");evil(\"".into(), image: false, millis: 0 })).contains("#000000"));
    }

    #[test]
    fn bundles_are_release_only_and_need_bundletool() {
        let t = Toolchain { sdk: Some("x".into()), build_tools: Some("x".into()), platform_jar: Some("x".into()), platform_api: 34, jdk_bin: Some("x".into()), bundletool: None };
        let dir = std::env::temp_dir().join("craft-aab-test");
        let key = || Some(Signing { keystore: "k".into(), alias: "a".into(), store_pass: "p".into(), key_pass: "p".into() });
        let debug = AppSpec { app_id: "com.a.b".into(), label: "G".into(), bundle: true, ..Default::default() };
        let r = build(&t, &debug, &stored_zip(&[("G/player.html", b"x")]), None, &dir.join("w"), &dir.join("out"), &dir.join("k"));
        assert!(!r.ok && r.log.contains("build it as a release"));
        let rel = AppSpec { release: true, ..debug };
        let r = build(&t, &rel, &stored_zip(&[("G/player.html", b"x")]), key(), &dir.join("w"), &dir.join("out"), &dir.join("k"));
        assert!(!r.ok && r.log.contains("bundletool"));
    }

    #[test]
    fn missing_sdk_is_reported_with_a_guide_and_nothing_is_built() {
        let t = Toolchain::default();
        assert!(t.missing().contains(&"Android SDK"));
        let dir = std::env::temp_dir().join("craft-apk-test-missing");
        let s = AppSpec { app_id: "com.a.b".into(), label: "G".into(), version_name: "1".into(), version_code: 1, orientation: "landscape".into(), release: false, ..Default::default() };
        let r = build(&t, &s, &stored_zip(&[("G/player.html", b"x")]), None, &dir.join("w"), &dir.join("out"), &dir.join("k"));
        assert!(!r.ok && r.apk.is_none());
        assert!(r.log.contains("Missing: Android SDK"));
        assert!(!guide().is_empty());
    }

    #[test]
    fn release_without_a_key_is_refused_never_debug_signed() {
        // A complete-looking toolchain on paper: the refusal must come before any tool runs.
        let t = Toolchain { sdk: Some("x".into()), build_tools: Some("x".into()), platform_jar: Some("x".into()), platform_api: 34, jdk_bin: Some("x".into()), bundletool: None };
        let dir = std::env::temp_dir().join("craft-apk-test-release");
        let s = AppSpec { app_id: "com.a.b".into(), label: "G".into(), version_name: "1".into(), version_code: 1, orientation: "landscape".into(), release: true, ..Default::default() };
        let r = build(&t, &s, &stored_zip(&[("G/player.html", b"x")]), None, &dir.join("w"), &dir.join("out"), &dir.join("k"));
        assert!(!r.ok);
        assert!(r.log.contains("must be signed with your own key"));
        assert!(!dir.join("k").join("debug.keystore").exists());
    }

    #[test]
    fn detects_an_sdk_folder_layout() {
        let sdk = std::env::temp_dir().join("craft-apk-test-sdk");
        let _ = fs::remove_dir_all(&sdk);
        fs::create_dir_all(sdk.join("build-tools/33.0.1")).unwrap(); fs::write(sdk.join("build-tools/33.0.1/aapt2.exe"), b"").unwrap();
        fs::create_dir_all(sdk.join("build-tools/35.0.0")).unwrap(); fs::write(sdk.join("build-tools/35.0.0/aapt2.exe"), b"").unwrap();
        fs::create_dir_all(sdk.join("platforms/android-34")).unwrap(); fs::write(sdk.join("platforms/android-34/android.jar"), b"").unwrap();
        fs::create_dir_all(sdk.join("platforms/android-21")).unwrap(); fs::write(sdk.join("platforms/android-21/android.jar"), b"").unwrap();
        let t = detect(Some(sdk.to_str().unwrap()));
        assert_eq!(t.sdk.as_deref(), Some(sdk.as_path()));
        assert!(t.build_tools.unwrap().ends_with("35.0.0"));
        assert_eq!(t.platform_api, 34);
    }

    /// `cargo test -- --ignored`: writes the generated activity to %TEMP%\craft-apk-java for a compile check.
    #[test]
    #[ignore]
    fn write_activity_for_check() {
        let d = std::env::temp_dir().join("craft-apk-java/com/a/b");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("MainActivity.java"), main_activity("com.a.b", Some(&Splash { color: "#203040".into(), image: true, millis: 1500 }))).unwrap();
    }

    /// End to end with the real SDK: `CRAFT_E2E_ZIP=<web export zip> CRAFT_E2E_OUT=<folder> cargo test -- --ignored e2e`.
    #[test]
    #[ignore]
    fn e2e_build_real_apk() {
        let zip = fs::read(std::env::var("CRAFT_E2E_ZIP").expect("CRAFT_E2E_ZIP")).unwrap();
        let out = PathBuf::from(std::env::var("CRAFT_E2E_OUT").expect("CRAFT_E2E_OUT"));
        let t = detect(None);
        assert!(t.missing().is_empty(), "missing: {:?}", t.missing());
        let s = AppSpec { app_id: "com.craftapps.truckcoins".into(), label: "Truck Coins".into(), version_name: "1.0.0".into(), version_code: 3, orientation: "landscape".into(), release: false, ..Default::default() };
        let r = build(&t, &s, &zip, None, &out.join("work"), &out.join("apk"), &out.join("keys"));
        println!("{}", r.log);
        assert!(r.ok, "build failed");
        assert!(r.apk.unwrap().is_file());
        // Release: refused without a key, then signed with a freshly created (throwaway, test-only) key.
        let rel = AppSpec { release: true, ..s };
        let no_key = build(&t, &rel, &zip, None, &out.join("work"), &out.join("apk"), &out.join("keys"));
        assert!(!no_key.ok && no_key.log.contains("must be signed with your own key"));
        let ks = out.join("test-release.keystore");
        let _ = fs::remove_file(&ks);
        create_keystore(&t, &ks, "release", "e2e-test-only", "e2e-test-only", "CN=E2E Test").unwrap();
        let r2 = build(&t, &rel, &zip, Some(Signing { keystore: ks, alias: "release".into(), store_pass: "e2e-test-only".into(), key_pass: "e2e-test-only".into() }), &out.join("work"), &out.join("apk"), &out.join("keys"));
        println!("{}", r2.log);
        assert!(r2.ok, "release build failed");
        assert!(!r2.log.contains("e2e-test-only"), "password leaked into the log");
        assert!(r2.log.contains("CN=E2E Test"), "not signed with the release key");
        assert!(!r2.log.contains("application-debuggable"), "release must not be debuggable");
    }

    /// Real SDK: splash, permissions and SDK levels in a built APK (`CRAFT_E2E_ZIP`, `CRAFT_E2E_OUT`, `--ignored e2e_options`).
    #[test]
    #[ignore]
    fn e2e_options_real_apk() {
        let zip = fs::read(std::env::var("CRAFT_E2E_ZIP").expect("CRAFT_E2E_ZIP")).unwrap();
        let out = PathBuf::from(std::env::var("CRAFT_E2E_OUT").expect("CRAFT_E2E_OUT"));
        let t = detect(None);
        assert!(t.missing().is_empty(), "missing: {:?}", t.missing());
        let s = AppSpec { app_id: "com.craftapps.optionstest".into(), label: "Options Test".into(), version_name: "1.0".into(), version_code: 2, orientation: "any".into(),
            min_sdk: 26, permissions: vec!["VIBRATE".into(), "WAKE_LOCK".into()], splash: Some(Splash { color: "#1d2433".into(), image: true, millis: 1200 }), ..Default::default() };
        let r = build(&t, &s, &zip, None, &out.join("work"), &out.join("apk"), &out.join("keys"));
        println!("{}", r.log);
        assert!(r.ok, "build failed");
        let badging = Command::new(t.tool("aapt2")).args(["dump", "badging"]).arg(r.apk.as_ref().unwrap()).output().unwrap();
        let b = String::from_utf8_lossy(&badging.stdout);
        assert!(b.contains("minSdkVersion:'26'"), "min sdk");
        assert!(b.contains("android.permission.VIBRATE") && b.contains("android.permission.WAKE_LOCK"), "permissions");
    }

    /// Real SDK + bundletool: a signed App Bundle (`CRAFT_E2E_ZIP`, `CRAFT_E2E_OUT`, `--ignored e2e_bundle`).
    #[test]
    #[ignore]
    fn e2e_bundle_real_aab() {
        let zip = fs::read(std::env::var("CRAFT_E2E_ZIP").expect("CRAFT_E2E_ZIP")).unwrap();
        let out = PathBuf::from(std::env::var("CRAFT_E2E_OUT").expect("CRAFT_E2E_OUT"));
        let t = detect(None);
        assert!(t.missing().is_empty() && t.bundletool.is_some(), "missing: {:?} bundletool {:?}", t.missing(), t.bundletool);
        let ks = out.join("test-upload.keystore");
        let _ = fs::remove_file(&ks);
        fs::create_dir_all(&out).unwrap();
        create_keystore(&t, &ks, "upload", "e2e-test-only", "e2e-test-only", "CN=E2E Upload Test").unwrap();
        let s = AppSpec { app_id: "com.craftapps.bundletest".into(), label: "Bundle Test".into(), version_name: "1.0".into(), version_code: 4, orientation: "landscape".into(),
            release: true, bundle: true, min_sdk: 24, permissions: vec!["VIBRATE".into()], splash: Some(Splash { color: "#101820".into(), image: false, millis: 1000 }), ..Default::default() };
        let r = build(&t, &s, &zip, Some(Signing { keystore: ks, alias: "upload".into(), store_pass: "e2e-test-only".into(), key_pass: "e2e-test-only".into() }), &out.join("work"), &out.join("aab"), &out.join("keys"));
        println!("{}", r.log);
        assert!(r.ok, "bundle build failed");
        let aab = r.apk.unwrap();
        assert!(aab.extension().is_some_and(|e| e == "aab") && aab.is_file());
        assert!(!r.log.contains("e2e-test-only"), "password leaked into the log");
        // bundletool can turn it into installable APKs (what Google Play does for each phone).
        let apks = out.join("from-bundle.apks");
        let _ = fs::remove_file(&apks);
        let st = Command::new(t.java("java")).arg("-jar").arg(t.bundletool.as_ref().unwrap()).arg("build-apks").arg(format!("--bundle={}", aab.display())).arg(format!("--output={}", apks.display())).arg("--mode=universal").status().unwrap();
        assert!(st.success() && apks.is_file(), "bundletool build-apks failed");
    }

    #[test]
    fn secrets_never_reach_the_log() {
        let mut l = Log { text: String::new(), secrets: vec!["hunter22".into()] };
        l.line("--ks-pass pass:hunter22");
        assert!(!l.text.contains("hunter22"));
    }
}
