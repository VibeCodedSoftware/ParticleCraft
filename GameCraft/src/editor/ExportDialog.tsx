// File › Export game: choose the platform, set how the finished game presents itself (title, icon, version, author,
// window / app options), build the zip and save it. The settings are saved with the project.
import React, { useEffect, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { HardwarePending } from '@shared/ui/HardwarePending';
import { store, useStore } from '../project/store';
import { api, assetUrl, type AndroidBuild, type AndroidStatus } from '../project/api';
import { canExport, exportGame, referencedAssets, type ExportTarget } from '../project/exportGame';
import { DEFAULT_EXPORT, type ExportSettings } from '../project/types';
import { Modal } from './ui';

/** Android permissions a game can ask for (the backend accepts only these). */
const ANDROID_PERMISSIONS: [string, string][] = [['VIBRATE', 'Vibration'], ['WAKE_LOCK', 'Keep awake'], ['ACCESS_NETWORK_STATE', 'Connection state'], ['RECORD_AUDIO', 'Microphone'], ['CAMERA', 'Camera'], ['ACCESS_COARSE_LOCATION', 'Rough location'], ['ACCESS_FINE_LOCATION', 'Precise location'], ['BLUETOOTH_CONNECT', 'Bluetooth']];

const TARGETS: { id: ExportTarget; name: string; doc: string }[] = [
  { id: 'windows', name: 'Windows', doc: 'A folder with your game as an .exe (double-click to play). Share it as a zip.' },
  { id: 'web', name: 'Web (HTML5)', doc: 'A folder for any web host. Runs in every modern browser.' },
  { id: 'android', name: 'Android', doc: 'A real .apk (debug or release, signed with your key) built with the Android SDK, or an installable web app.' },
  { id: 'quest', name: 'Meta Quest (WebXR app)', doc: 'A web build ready to host, with Meta\'s steps to wrap it as a Quest app. It runs on the Quest\'s web engine: this is not native VR, and GameCraft doesn\'t build the APK itself.' },
];
type Tab = 'general' | 'icon' | 'platform';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.project)!;
  const [target, setTarget] = useState<ExportTarget>('windows');
  const [tab, setTab] = useState<Tab>('general');
  const [ok, setOk] = useState<boolean | null>(null);
  const [prog, setProg] = useState<{ msg: string; frac: number } | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { canExport().then(setOk); }, []);
  const es: ExportSettings = { ...DEFAULT_EXPORT, ...(p.settings.export ?? {}) };
  const set = (patch: Partial<ExportSettings>, key?: string) => store.mutate('Export settings', (pp) => { pp.settings.export = { ...(pp.settings.export ?? {}), ...patch }; }, key && 'export-' + key);
  const textures = p.assets.filter((a) => a.kind === 'texture');
  const iconUrl = es.icon ? assetUrl(p.id, es.icon) : 'icon.png';
  const importIcon = async (f: File) => {
    const rel = `imported/icons/${f.name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    await api.putFile(p.id, rel, await f.arrayBuffer());
    const id = `proj:${rel}`;
    store.mutate('App icon', (pp) => {
      if (!pp.assets.some((a) => a.id === id)) pp.assets.push({ id, name: f.name.replace(/\.[^.]+$/, ''), kind: 'texture', source: 'imported' });
      pp.settings.export = { ...(pp.settings.export ?? {}), icon: id };
    });
  };
  // Android APK: toolchain status, release key passwords (this dialog only, never saved), build result.
  const apk = target === 'android' && es.androidPackage !== 'web';
  const [droid, setDroid] = useState<AndroidStatus | null>(null);
  const [pw, setPw] = useState({ store: '', key: '' });
  const [build, setBuild] = useState<AndroidBuild | null>(null);
  const [newKey, setNewKey] = useState<{ alias: string; pass: string; pass2: string; name: string; path: string } | null>(null);
  useEffect(() => { if (target === 'android') api.androidStatus(es.androidSdk).then(setDroid).catch(() => setDroid({ ready: false, sdk: null, buildTools: null, platform: null, jdk: null, outputDir: '', missing: ['the GameCraft desktop app (this browser preview cannot run the Android tools)'], guide: ['Open GameCraft.exe from the Windows folder and export from there.'] })); }, [target, es.androidSdk]);
  const buildApk = async (zip: Blob) => {
    setProg({ msg: 'Building the APK with the Android SDK… (this takes a minute)', frac: 0.98 });
    const bundle = es.androidPackage === 'bundle', release = es.androidPackage === 'release' || bundle;
    const b = await api.androidBuild({
      appId: es.appId.trim(), label: es.shortName.trim() || es.title.trim() || p.name, versionName: es.version || '1.0', versionCode: Math.max(1, Math.floor(es.versionCode || 1)),
      orientation: es.orientation, release, bundle, sdkPath: es.androidSdk,
      minSdk: es.minSdk ?? 0, targetSdk: es.targetSdk ?? 0, permissions: es.permissions ?? [],
      ...(es.splash?.enabled ? { splash: { color: es.splash.color, image: !!es.splash.image, millis: Math.round(es.splash.seconds * 1000) } } : {}),
      ...(release ? { keystore: { path: es.keystore, alias: es.keyAlias, storePass: pw.store, keyPass: pw.key || pw.store } } : {}),
    }, zip);
    setBuild(b);
    if (!b.ok) throw new Error('The APK was not built: ' + (b.log.trim().split('\n').pop() ?? 'see the build log'));
    store.log('info', `Built ${b.file} (${b.sizeMb} MB)`);
    return b;
  };
  const createKey = async () => {
    if (!newKey) return;
    if (newKey.pass !== newKey.pass2) { setError('The two passwords differ.'); return; }
    try {
      const r = await api.androidKeystore({ path: newKey.path, alias: newKey.alias || 'release', storePass: newKey.pass, dname: `CN=${newKey.name || es.author || 'GameCraft developer'}`, sdkPath: es.androidSdk });
      set({ keystore: r.path, keyAlias: r.alias }); setPw({ store: newKey.pass, key: newKey.pass }); setNewKey(null);
      setReport([`Release key created: ${r.path}. Back it up and keep the password: every update of the app must be signed with this same key.`]);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  };
  const run = async () => {
    setError(''); setReport(null); setBuild(null);
    try {
      await store.save();
      if (apk) {
        if (!droid?.ready) throw new Error('The Android SDK is not ready: see the steps below.');
        if ((es.androidPackage === 'release' || es.androidPackage === 'bundle') && (!es.keystore || !pw.store)) throw new Error(`A release ${es.androidPackage === 'bundle' ? 'App Bundle' : 'APK'} is signed with your own key: choose the keystore file and enter its password (or Create release key…).`);
        if (es.androidPackage === 'bundle' && !droid.bundletool) throw new Error('App Bundles need Google\'s bundletool .jar in the Android SDK folder (see below).');
      }
      const r = await exportGame(store.get().project!, target, (msg, frac) => setProg({ msg, frac }));
      if (apk) {
        const b = await buildApk(r.blob);
        setReport([`${es.androidPackage === 'bundle' ? 'App Bundle' : 'APK'} ready: ${b.apk} (${b.sizeMb} MB).`, ...b.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.check}`), 'Hardware verification pending: GameCraft APKs have not been run on a real phone yet — install it on yours and check it.', ...r.report.filter((l) => !l.startsWith('ⓘ'))]);
        setProg(null);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob); a.download = r.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setReport([`Saved ${r.fileName} (${r.sizeMb} MB) to your Downloads folder.`, ...r.report]);
      store.log('info', `Exported ${r.fileName} (${r.sizeMb} MB)`);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    setProg(null);
  };
  const field = (label: string, el: React.ReactNode, hint?: string) => <label className="exp-field"><span>{label}</span>{el}{hint && <em>{hint}</em>}</label>;
  const txt = (k: keyof ExportSettings, placeholder = '') => <input className="txt" value={String(es[k] ?? '')} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as any, k)} onKeyDown={(e) => e.stopPropagation()} />;
  return (
    <Modal title="Export game" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!ok || !!prog} onClick={run}>{prog ? 'Exporting…' : `Export for ${TARGETS.find((t) => t.id === target)!.name}`}</button></>}>
      <div className="exp-layout">
        <div className="exp-targets">
          {TARGETS.map((t) => (
            <button key={t.id} className={'export-target' + (target === t.id ? ' on' : '')} onClick={() => setTarget(t.id)}><b>{t.name}</b><span>{t.doc}</span></button>
          ))}
          <div className="exp-summary">
            <img src={iconUrl ?? undefined} alt="" />
            <div><b>{es.title.trim() || p.name}</b><span>{[es.version && `v${es.version}`, es.author].filter(Boolean).join(' · ') || 'No version or author yet'}</span></div>
          </div>
        </div>
        <div className="exp-settings">
          <div className="seg exp-tabs">
            {([['general', 'General'], ['icon', 'Icon & look'], ['platform', target === 'windows' ? 'Window' : 'App']] as const).map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
          </div>
          {tab === 'general' && <div className="exp-form">
            {field('Game title', txt('title', p.name), 'Window title, app name and file names. Empty = the project name.')}
            {field('Version', txt('version', '1.0.0'))}
            {field('Author / studio', txt('author', 'Your name'))}
            {field('Description', <textarea className="txt" rows={3} value={es.description} onChange={(e) => set({ description: e.target.value }, 'description')} onKeyDown={(e) => e.stopPropagation()} />, 'Shown by app stores and when the game is installed as an app.')}
          </div>}
          {tab === 'icon' && <div className="exp-form">
            <div className="exp-icon">
              <img src={iconUrl ?? undefined} alt="App icon" />
              <div>
                <div className="btn-row">
                  <label className="btn small">Import icon…<input type="file" accept=".png,.jpg,.jpeg,.webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importIcon(f); }} /></label>
                  <select className="sel small" value={es.icon} onChange={(e) => set({ icon: e.target.value })}>
                    <option value="">Default player icon</option>
                    {textures.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <p className="hint">A square image works best (512×512 or larger). It becomes the window and taskbar icon (Windows) and the app icon (web, Android); it is cropped to a square and resized.</p>
              </div>
            </div>
            {field('Background colour', <input type="color" value={es.background} onChange={(e) => set({ background: e.target.value }, 'bg')} />, 'Behind the game while it loads, and the splash colour of the installed app.')}
            {field('Theme colour', <input type="color" value={es.themeColor} onChange={(e) => set({ themeColor: e.target.value }, 'theme')} />, 'Browsers and phones tint their toolbars with it.')}
          </div>}
          {tab === 'platform' && target === 'windows' && <div className="exp-form">
            {field('Window size', <span className="pair"><input className="txt" type="number" min={320} value={es.width} onChange={(e) => set({ width: Number(e.target.value) || 1280 }, 'w')} /> × <input className="txt" type="number" min={240} value={es.height} onChange={(e) => set({ height: Number(e.target.value) || 720 }, 'h')} /></span>)}
            {field('Opens as', <select className="sel" value={es.windowMode ?? (es.fullscreen ? 'fullscreen' : 'windowed')} onChange={(e) => { const v = e.target.value as NonNullable<ExportSettings['windowMode']>; set({ windowMode: v, fullscreen: v === 'fullscreen' }); }}><option value="windowed">Window</option><option value="maximized">Maximized window</option><option value="fullscreen">Fullscreen</option><option value="borderless">Borderless window, screen-sized</option></select>, 'Fullscreen covers the screen. Borderless is a plain window the size of the screen, so other windows can still come in front of it.')}
            {field('Monitor', <input className="txt" type="number" min={0} max={16} value={es.monitor ?? 0} onChange={(e) => set({ monitor: Math.max(0, Math.round(Number(e.target.value) || 0)) }, 'mon')} />, '0 = the main monitor. 1, 2… = that monitor in the system\'s list. If it is not plugged in, the main monitor is used.')}
            {field('Player can resize the window', <input type="checkbox" checked={es.resizable} onChange={(e) => set({ resizable: e.target.checked })} />)}
            {field('Keep shape', <select className="sel" value={es.aspect ?? ''} onChange={(e) => set({ aspect: e.target.value || undefined })}><option value="">Fill the window</option>{['16:9', '16:10', '21:9', '4:3', '1:1'].map((a) => <option key={a} value={a}>{a} with black bars</option>)}</select>, 'Everyone sees the same shape of picture, whatever their screen.')}
            <p className="hint">The .exe file is named after the game title. Its file icon in Explorer stays the GameCraft player icon; the window and taskbar use your icon.</p>
          </div>}
          {tab === 'platform' && target !== 'windows' && <div className="exp-form">
            {field('Short name', txt('shortName', (es.title || p.name).slice(0, 12)), 'Up to 12 letters, under the icon on a phone home screen.')}
            {field('Orientation', <select className="sel" value={es.orientation} onChange={(e) => set({ orientation: e.target.value as ExportSettings['orientation'] })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="any">Any (follows the device)</option></select>)}
            {field('Full screen when installed', <input type="checkbox" checked={es.webFullscreen} onChange={(e) => set({ webFullscreen: e.target.checked })} />, 'Off: the app keeps the phone status bar.')}
            {field('App id', txt('appId', 'com.yourname.' + (es.title || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '')), 'A unique reverse-domain name; keep it the same across updates.')}
          </div>}
          {target === 'android' && <div className="exp-form">
            <h4>Android package</h4>
            {field('Build', <select className="sel" value={es.androidPackage} onChange={(e) => set({ androidPackage: e.target.value as ExportSettings['androidPackage'] })}>
              <option value="debug">APK — debug (test on your own phone)</option>
              <option value="release">APK — release (signed with your key, for stores)</option>
              <option value="bundle">App Bundle (.aab) — Google Play (signed with your upload key)</option>
              <option value="web">Installable web app (zip, no SDK needed)</option>
            </select>, es.androidPackage === 'web' ? 'Host the folder on HTTPS and "Add to Home screen".' : es.androidPackage === 'bundle' ? 'Google Play takes .aab files; it builds the APKs for each phone. Needs Google\'s bundletool .jar in the SDK folder.' : 'APKs install everywhere (side-loading, itch.io, other stores).')}
            <HardwarePending device="Android phone or tablet" what={apk ? 'APKs are built, signed and checked on this computer' : 'The installable web app is built and checked in a desktop browser'} />
            {apk && field('Version code', <input className="txt" type="number" min={1} step={1} value={es.versionCode} onChange={(e) => set({ versionCode: Math.max(1, Math.floor(Number(e.target.value) || 1)) }, 'vc')} />, 'Must grow with every update you publish (Version above is what players see).')}
            {apk && <div className={'android-status ' + (droid?.ready ? 'ok' : 'missing')}>
              {droid === null ? <span>Checking for the Android SDK… (APK builds need the desktop app)</span>
                : droid.ready ? <span><Icon name="check" size={12} /> Android SDK {droid.platform}, build-tools {droid.buildTools} · Java {droid.jdk}</span>
                : <>
                  <b><Icon name="alert-triangle" size={12} /> Missing: {droid.missing.join(', ')}</b>
                  <ol>{droid.guide.map((g, i) => <li key={i}>{g}</li>)}</ol>
                </>}
              {es.androidPackage === 'bundle' && droid?.ready && (droid.bundletool ? <span><Icon name="check" size={12} /> bundletool: {droid.bundletool}</span>
                : <b><Icon name="alert-triangle" size={12} /> App Bundles need Google's bundletool: download bundletool-all-&lt;version&gt;.jar from github.com/google/bundletool/releases and put it in the SDK folder.</b>)}
              {field('SDK folder', txt('androidSdk', droid?.sdk ?? '%LOCALAPPDATA%\\Android\\Sdk'), 'Only when it is not found automatically.')}
            </div>}
            {apk && <>
              <h4>Android options</h4>
              {field('Oldest Android', <select className="sel" value={es.minSdk ?? 0} onChange={(e) => set({ minSdk: Number(e.target.value) })}>
                {[[0, 'Automatic (Android 7, API 24)'], [21, 'Android 5 (API 21)'], [24, 'Android 7 (API 24)'], [26, 'Android 8 (API 26)'], [28, 'Android 9 (API 28)'], [29, 'Android 10 (API 29)'], [30, 'Android 11 (API 30)'], [31, 'Android 12 (API 31)'], [33, 'Android 13 (API 33)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>, 'Phones older than this cannot install it.')}
              {field('Target Android', <select className="sel" value={es.targetSdk ?? 0} onChange={(e) => set({ targetSdk: Number(e.target.value) })}>
                {[[0, `Newest installed${droid?.platform ? ` (${droid.platform})` : ''}`], [33, 'API 33'], [34, 'API 34'], [35, 'API 35']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>, 'Google Play asks for a recent target. Never above the SDK platform you have installed.')}
              {field('Permissions', <span className="btn-row" style={{ flexWrap: 'wrap' }}>
                {ANDROID_PERMISSIONS.map(([id, label]) => <label key={id} className="chk" title={`android.permission.${id}`}><input type="checkbox" checked={(es.permissions ?? []).includes(id)} onChange={(e) => set({ permissions: e.target.checked ? [...(es.permissions ?? []), id] : (es.permissions ?? []).filter((x) => x !== id) })} /> {label}</label>)}
              </span>, 'Internet is always on (online play). Ask only for what the game uses: stores and players check.')}
              {field('Splash screen', <input type="checkbox" checked={!!es.splash?.enabled} onChange={(e) => set({ splash: { color: '#000000', image: es.icon, seconds: 1.5, ...es.splash, enabled: e.target.checked } })} />, 'Shown while the game loads.')}
              {es.splash?.enabled && <>
                {field('Splash colour', <input type="color" value={es.splash.color} onChange={(e) => set({ splash: { ...es.splash!, color: e.target.value } }, 'splc')} />)}
                {field('Splash picture', <select className="sel" value={es.splash.image} onChange={(e) => set({ splash: { ...es.splash!, image: e.target.value } })}><option value="">None (colour only)</option>{textures.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>, 'Centred, fitted to the screen.')}
                {field('Show at least (s)', <input className="txt" type="number" min={0} max={10} step={0.5} value={es.splash.seconds} onChange={(e) => set({ splash: { ...es.splash!, seconds: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } }, 'spls')} />, 'It stays until the game has loaded, and at least this long.')}
              </>}
            </>}
            {(es.androidPackage === 'release' || es.androidPackage === 'bundle') && <>
              {field('Keystore file', txt('keystore', 'C:\\Users\\you\\keys\\mygame.keystore'), 'Your signing key. GameCraft never signs a release with the debug key.')}
              {field('Key alias', txt('keyAlias', 'release'))}
              {field('Keystore password', <input className="txt" type="password" autoComplete="off" value={pw.store} onChange={(e) => setPw({ ...pw, store: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />, 'Used for this export only; never saved.')}
              {field('Key password', <input className="txt" type="password" autoComplete="off" value={pw.key} placeholder="same as the keystore" onChange={(e) => setPw({ ...pw, key: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />)}
              {!newKey ? <button className="btn small" onClick={() => setNewKey({ alias: 'release', pass: '', pass2: '', name: es.author, path: '' })}>Create release key…</button>
                : <div className="android-newkey">
                  {field('Your name or studio', <input className="txt" value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />)}
                  {field('Save as', <input className="txt" value={newKey.path} placeholder={(droid?.outputDir ?? '').replace(/Exports[\\/]Android$/, 'Keys\\release.keystore')} onChange={(e) => setNewKey({ ...newKey, path: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />)}
                  {field('Password (6+ characters)', <input className="txt" type="password" autoComplete="new-password" value={newKey.pass} onChange={(e) => setNewKey({ ...newKey, pass: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />)}
                  {field('Repeat password', <input className="txt" type="password" autoComplete="new-password" value={newKey.pass2} onChange={(e) => setNewKey({ ...newKey, pass2: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />)}
                  <div className="btn-row"><button className="btn small primary" disabled={newKey.pass.length < 6} onClick={createKey}>Create key</button><button className="btn small" onClick={() => setNewKey(null)}>Cancel</button></div>
                </div>}
            </>}
          </div>}
        </div>
      </div>
      <p className="hint">Includes the game player, "{es.title.trim() || p.name}" with all its scenes and logic, and {referencedAssets(p).length} asset file(s). Starts at scene "{p.scenes.find((s) => s.id === p.startSceneId)?.name ?? p.scenes[0].name}".</p>
      {ok === false && <div className="warn">Exporting needs the installed GameCraft app (Windows\GameCraft\GameCraft.exe): this development preview does not have the built game player. You can still try the game as an exported player: <a href={`player.html?project=${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer">open the player preview</a>.</div>}
      {prog && <div className="export-prog"><div style={{ width: `${Math.round(prog.frac * 100)}%` }} /><span>{prog.msg}</span></div>}
      {error && <div className="warn"><Icon name="alert-triangle" size={13} /> {error}</div>}
      {report && <ul className="export-report">{report.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {build?.ok && build.file && <div className="btn-row"><a className="btn small" href={api.androidApkUrl(build.file)} download={build.file}>Download {build.file}</a></div>}
      {build && <details className="android-log" open={!build.ok}><summary>Build log</summary><pre>{build.log}</pre></details>}
    </Modal>
  );
}
