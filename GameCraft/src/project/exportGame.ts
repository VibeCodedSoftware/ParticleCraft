// "Export game": the built game player + the project (game.json) + every asset file it uses, as one zip.
//   web     - upload the folder to any web host (HTML5), or run it with a local web server
//   windows - the same files in game/ next to CraftPlayer.exe (renamed to the game), double-click to play
//   android - the web build as an installable app (PWA): host it on HTTPS and "Add to Home screen",
//             or wrap it into an APK with Bubblewrap / PWABuilder (needs the Android SDK, not included)
// Title, icon, version, author, window and app options come from the project's export settings.
import { ZipWriter } from '@shared/src/zip';
import { api, assetUrl, exportedAssetPath } from './api';
import { BULLET_HOLE } from '@shared/src/runtime/blockImpl';
import { DEFAULT_EXPORT, type ExportSettings, type GameProject } from './types';

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

/** An image as a square PNG of `size` px (centred, cropped to fill), for app icons. */
async function squarePng(url: string, size: number): Promise<Uint8Array> {
  const img = new Image(); img.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('not an image')); img.src = url; });
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** A picture as PNG with its own shape, at most `max` pixels on its longer side (the Android splash). */
async function fittedPng(url: string, max: number): Promise<Uint8Array> {
  const img = new Image(); img.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('not an image')); img.src = url; });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export type ExportTarget = 'web' | 'windows' | 'android' | 'quest';

/** What to do with a Meta Quest export (from Meta's "Package a PWA for Meta Quest", checked 2026-11-03). */
export function questReadme(about: string, appId: string, vrOn: boolean): string {
  const pkg = appId || 'com.yourname.yourgame';
  return [
    `${about} - Meta Quest (WebXR app)`, '',
    'What this is: your game as a web app, ready to wrap as a Quest app. It runs on the Quest\'s web engine (WebXR). It is not a native OpenXR app.',
    'GameCraft has not tested this on a headset. Check it on yours before you publish it.', '',
    ...(vrOn ? [] : ['WARNING: VR is off in this project (Project settings > WebXR Browser Preview). Turn it on and give the player the VR Player behavior, then export again.', '']),
    'You need: a web host with HTTPS, Node.js 18 or later, a Meta developer account, and a Quest in Developer Mode with Android Platform Tools.', '',
    '1. Upload this folder to your HTTPS host, and open player.html in the Quest browser to check that Enter VR works.',
    '2. Install Meta\'s packaging tool:',
    '     npm install --global @meta-quest/bubblewrap-cli',
    '3. In a new empty folder, start the project with your manifest\'s real address:',
    '     bubblewrap init --manifest=https://YOUR-SITE/manifest.webmanifest --metaquest',
    `   Choose the app mode (immersive starts directly in VR; 2D is a window with the Enter VR button). Android package id, for example: ${pkg}`,
    '   Keep the signing key and its passwords safe: every update needs the same key.',
    '4. Get the key\'s SHA-256 fingerprint and add it:',
    '     keytool -list -v -keystore android.keystore -alias android',
    '     bubblewrap fingerprint add YOUR-SHA256-FINGERPRINT',
    '5. Upload the assetlinks.json this creates, so that it is at https://YOUR-SITE/.well-known/assetlinks.json',
    '   An immersive app does not launch at all if this check fails.',
    '6. In the project\'s app/build.gradle set targetSdk = 32 (Quest runs Android API 32 or lower), and replace jcenter() with mavenCentral() if it is listed.',
    '7. Build it, then install the app-release-signed.apk it makes:',
    '     bubblewrap build',
    '     adb install app-release-signed.apk',
    '8. On the headset, open it from Unknown Sources in the app library.', '',
    'Meta\'s guide: https://developers.meta.com/vr/documentation/web/pwa-packaging/', '',
  ].join('\r\n');
}
export interface ExportResult { blob: Blob; fileName: string; report: string[]; sizeMb: number }

const safe = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'Game';

/** Is this editor a built app (the player files exist), not the development server? */
export async function canExport(): Promise<boolean> {
  try { const r = await fetch('export-files.json', { cache: 'no-store' }); return r.ok && Array.isArray(await r.json()); } catch { return false; }
}

/** Asset ids the game actually uses (scenes, logic, prefabs, particles) plus their companions (.mtl files). */
export function referencedAssets(p: GameProject): string[] {
  const ids = new Set<string>();
  const re = /"((?:lib|proj):[^"#]+)/g;
  const json = JSON.stringify({ scenes: p.scenes, logic: p.logic, prefabs: p.prefabs, particlePresets: p.particlePresets });
  for (let m = re.exec(json); m; m = re.exec(json)) ids.add(m[1]);
  if (json.includes('"combat.hitscan"')) ids.add(BULLET_HOLE); // Fire hitscan's built-in bullet holes
  for (const id of [...ids]) {
    const ref = p.assets.find((a) => a.id === id);
    for (const x of ref?.extra ?? []) ids.add(x);
    if (id.toLowerCase().endsWith('.obj')) ids.add(id.replace(/\.obj$/i, '.mtl'));
  }
  return [...ids];
}

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function exportGame(p: GameProject, target: ExportTarget, progress: (msg: string, frac: number) => void): Promise<ExportResult> {
  const es: ExportSettings = { ...DEFAULT_EXPORT, ...(p.settings.export ?? {}) };
  const title = es.title.trim() || p.name;
  const name = safe(title);
  const root = name + '/';
  const gameDir = target === 'windows' ? root + 'game/' : root;
  const zip = new ZipWriter();
  const report: string[] = [];

  // 1. The player (built with the editor; the list is written at build time).
  progress('Player files…', 0.02);
  const files: string[] = await (await fetch('export-files.json', { cache: 'no-store' })).json();
  // HTML pages are written after the file list is made: add the player page itself.
  for (const f of [...new Set(['player.html', ...files])]) {
    if (f === 'export-files.json') continue;
    zip.add(gameDir + f, await bytes(f));
  }
  // Branding: the chosen icon (resized to app-icon sizes) or the player's own.
  progress('Icon…', 0.03);
  const iconUrl = es.icon ? assetUrl(p.id, es.icon) : null;
  let customIcon = false;
  if (iconUrl) {
    try { zip.add(gameDir + 'icon.png', await squarePng(iconUrl, 512)); zip.add(gameDir + 'icon-192.png', await squarePng(iconUrl, 192)); customIcon = true; }
    catch (e: any) { report.push(`Warning: the app icon could not be read (${e?.message ?? e}); the default icon is used.`); }
  }
  if (!customIcon) { try { const b = await bytes('icon.png'); zip.add(gameDir + 'icon.png', b); zip.add(gameDir + 'icon-192.png', b); } catch { /* optional */ } }
  // Android splash picture (the app shows it while the game loads).
  if (target === 'android' && es.splash?.enabled && es.splash.image) {
    const u = assetUrl(p.id, es.splash.image);
    try { if (u) zip.add(gameDir + 'splash.png', await fittedPng(u, 1024)); }
    catch (e: any) { report.push(`Warning: the splash picture could not be read (${e?.message ?? e}); the splash shows its colour only.`); }
  }
  zip.add(gameDir + 'index.html', `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=player.html"><title>${esc(title)}</title><a href="player.html">Play</a>`);

  // 2. The game itself, its details, and how the Windows player opens its window.
  zip.add(gameDir + 'game.json', JSON.stringify(p));
  zip.add(gameDir + 'title.txt', title);
  zip.add(gameDir + 'about.json', JSON.stringify({ title, version: es.version, author: es.author, description: es.description, id: es.appId || undefined, madeWith: 'GameCraft' }, null, 1));
  zip.add(gameDir + 'window.json', JSON.stringify({ title, width: es.width, height: es.height, fullscreen: es.fullscreen, resizable: es.resizable, windowMode: es.windowMode ?? (es.fullscreen ? 'fullscreen' : 'windowed'), monitor: Math.max(0, Math.round(es.monitor ?? 0)), background: es.background }, null, 1));

  // 3. Every asset it uses.
  const ids = referencedAssets(p);
  let done = 0, missing = 0;
  for (const id of ids) {
    done++;
    progress(`Assets ${done}/${ids.length}…`, 0.05 + 0.85 * (done / Math.max(1, ids.length)));    const rel = exportedAssetPath(id); const url = assetUrl(p.id, id);
    if (!rel || !url) continue;
    const path = gameDir + 'data/' + rel;
    if (zip.has(path)) continue;
    try { zip.add(path, await bytes(url.split('#')[0])); } catch (e: any) {
      // A guessed .mtl that does not exist is fine (the model just has no material file).
      if (id.toLowerCase().endsWith('.mtl')) continue;
      missing++; report.push(`Warning: missing asset ${id} (${e?.message ?? e})`);
    }
  }
  report.unshift(`${ids.length - missing} asset file(s) included${missing ? `, ${missing} missing` : ''}.`);

  // 4. Installable web app (PWA): manifest + offline cache. Used by web and Android exports.
  zip.add(gameDir + 'manifest.webmanifest', JSON.stringify({
    ...(es.appId ? { id: es.appId } : {}), name: title, short_name: (es.shortName.trim() || title).slice(0, 12), description: es.description || undefined,
    start_url: 'player.html', display: es.webFullscreen ? 'fullscreen' : 'standalone', orientation: es.orientation,
    background_color: es.background, theme_color: es.themeColor,
    icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  }, null, 1));
  zip.add(gameDir + 'sw.js', `// Offline cache: the first visit downloads the game; later visits start without the network.
const CACHE = 'craft-${name}-${Date.now()}';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
});
`);

  // 5. Target specifics.
  const about = [title + (es.version ? ` ${es.version}` : ''), es.author && `by ${es.author}`, es.description].filter(Boolean).join('\r\n');
  if (target === 'windows') {
    progress('Windows player…', 0.93);
    try { zip.add(root + name + '.exe', await bytes(api.libraryUrl('runtime', 'CraftPlayer.exe'))); }
    catch { throw new Error('CraftPlayer.exe was not found next to GameCraft (runtime folder). Rebuild with build-windows.ps1, or use the Web export.'); }
    zip.add(root + 'README.txt', `${about}\r\n\r\nDouble-click ${name}.exe to play. Keep the game folder next to it.\r\nRequires Windows 10/11 (uses the built-in WebView2 runtime).\r\nMade with GameCraft.\r\n`);
  } else if (target === 'quest') {
    zip.add(root + 'README.txt', questReadme(about, es.appId ?? '', !!p.settings.vr?.enabled));
    report.push('ⓘ Quest: a web build plus the steps to wrap it as a Quest app (README.txt). It is not native VR and has not been run on a headset by GameCraft.');
    if (!p.settings.vr?.enabled) report.push('Warning: VR is off in this project, so it would open as a flat game on the Quest.');
  } else if (target === 'web') {
    zip.add(root + 'README.txt', `${about} - web build\r\n\r\nUpload this folder to any web host; index.html is the start page.\r\nTo try it on your computer, serve the folder with a local web server, e.g.  npx serve .  - browsers do not\r\nlet a page opened straight from disk load its files.\r\n`);
  } else {
    zip.add(root + 'README.txt', `${about} - Android (installable web app)\r\n\r\n1. Upload this folder to an HTTPS web host (GitHub Pages, Netlify, your own site...).\r\n2. Open player.html in Chrome on the phone and choose "Add to Home screen" / "Install app":\r\n   it runs full-screen, landscape, and works offline after the first start.\r\n3. For a Google Play APK, wrap the hosted URL with PWABuilder (pwabuilder.com) or Bubblewrap;\r\n   that step needs the Android SDK and a signing key, which GameCraft does not include.\r\nTouch: games that need a keyboard need on-screen controls (Logic: Input action blocks + buttons).\r\n`);
    report.push('ⓘ Android builds are installable web apps; an APK needs PWABuilder/Bubblewrap and the Android SDK (see README.txt).');
  }
  progress('Packing…', 0.97);
  const blob = zip.finish();
  return { blob, fileName: `${name}-${target}.zip`, report, sizeMb: Math.round((blob.size / 1048576) * 10) / 10 };
}
