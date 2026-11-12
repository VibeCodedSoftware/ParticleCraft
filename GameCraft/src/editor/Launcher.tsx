// Project launcher (home screen): create from blank or a template/demo, recent projects, open from file,
// autosave recovery. Styled like a professional creative-suite home: neutral chrome, monochrome line icons,
// the accent color only for actions.
import React, { useEffect, useMemo, useState } from 'react';
import { api, type ProjectListItem } from '../project/api';
import { migrateProject } from '../project/migrate';
import { store } from '../project/store';
import { TEMPLATES } from '../templates';
import { ImportSceneDialog } from './ImportScene';
import type { GameProject } from '../project/types';

/** Thin-stroke line icons (24×24, currentColor) for the template cards. */
const ICONS: Record<string, React.ReactNode> = {
  empty3d: <><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
  empty2d: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 9h16" /></>,
  truck: <><path d="M3 16v-3l3-1 2.5-4h6.5l3 4 3 1v3h-2" /><path d="M7 16h9" /><path d="M9.5 8.5v3.5h6.8" /><circle cx="6.5" cy="16.5" r="1.9" /><circle cx="17.5" cy="16.5" r="1.9" /></>,
  maildelivery: <><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.8" /><circle cx="17" cy="17" r="1.8" /></>,
  procedural: <><rect x="7" y="3" width="10" height="7" rx="2" /><path d="M10 6.5h.01M14 6.5h.01" /><path d="M12 10v3M6 13h12" /><path d="m6 13-2 4 2 4M18 13l2 4-2 4M10 13l-1 8M14 13l1 8" /></>,
  planets: <><circle cx="12" cy="12" r="5.5" /><path d="M6.8 13.4C4 15 2.4 16.4 2.8 17.2c.6 1.1 5-.2 9.8-2.9s8.2-5.6 7.6-6.7c-.4-.8-2.4-.5-5.3.5" /><circle cx="19" cy="4.5" r="1" /></>,
  chessboard: <><path d="M3 3h18v18H3z" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /><path d="M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z" fill="currentColor" stroke="none" opacity=".35" /></>,
  textadventure: <><path d="M12 6c-2-1.6-5-2-8.5-2v15c3.500 0 6.500.4 8.500 2 2-1.600 5-2 8.500-2V4C17 4 14 4.400 12 6Z" /><path d="M12 6v15" /><path d="M6.500 8.500c1 0 2 .2 3 .6M6.500 12c1 0 2 .2 3 .6M14.500 9.100c1-.4 2-.6 3-.6M14.500 12.600c1-.4 2-.6 3-.6" /></>,
  platformer: <><circle cx="9" cy="5" r="2" /><path d="m7 21 2-6 3 2v4M9 15l1-6 4 3 3-1M10 9l-4 3" /><path d="M14 21h7" /></>,
  sidescroller: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 16h7l2-3h4l2 3h3" /><path d="M8 9h2v2H8z" /></>,
  physics: <><circle cx="12" cy="12" r="1.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></>,
  combat: <><path d="m14.5 4 5.5 0 0 5.5L9 20.5 3.5 15z" /><path d="m4 20 3-3M7.5 13.5l3 3" /></>,
  fps: <><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1" /></>,
  digging: <><path d="M3 15h18v6H3z" /><path d="M7 15v-2M11 15v-3M15 15v-2M5 18h2M10 18h3M16 19h2" /><path d="m16 3 3 3-6 6-3-3z" /></>,
  dungeon: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M21 12v2" /></>,
  backrooms: <><path d="M3 20V6l6-2v16M9 8h6v12M15 4l6 2v14" /><path d="M3 20h18" /></>,
};
const GENRE: Record<string, string> = {
  empty3d: 'Blank', empty2d: 'Blank', truck: 'Racing', platformer: 'Platformer', sidescroller: 'Platformer', physics: 'Sandbox',
  combat: 'Action', fps: 'Shooter', digging: 'Sandbox', dungeon: 'Puzzle · Your .blend', backrooms: 'Survival · Your .blend',
  maildelivery: 'Adventure', procedural: 'Animation', planets: 'Platformer', chessboard: 'Strategy', textadventure: 'Story',
};
const Icon = ({ id, size = 28 }: { id: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[id] ?? ICONS.empty3d}</svg>
);

type Filter = 'all' | '3D' | '2D';

export function Launcher({ onOpen }: { onOpen: (p: GameProject) => void }) {
  const [list, setList] = useState<ProjectListItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const refresh = () => api.list().then(setList).catch((e) => setErr('Cannot reach the project folder: ' + e.message));
  useEffect(() => { refresh(); }, []);

  const create = async (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setBusy(true);
    try {
      const p = t.build();
      if (name.trim()) { p.name = name.trim(); p.id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36); }
      await api.save(p);
      onOpen(p);
      if (p.tutorial?.steps.length) setTimeout(() => store.set({ tutorialStep: 0 }), 600);
    } catch (e: any) { setErr('Could not create project: ' + e.message); }
    setBusy(false);
  };
  const open = async (it: ProjectListItem) => {
    try {
      let p = await api.load(it.id);
      if (it.hasNewerAutosave && window.confirm(`"${it.name}" has unsaved changes from an autosave (newer than the last save). Recover them?`)) {
        p = await api.load(it.id, true);
        store.log('info', 'Recovered autosave');
        onOpen(p); store.set({ dirty: true });
        return;
      }
      onOpen(p);
    } catch (e: any) { setErr(`Could not open "${it.name}": ${e.message}`); }
  };
  const importFile = async (f: File) => {
    try {
      const p = migrateProject(JSON.parse(await f.text()));
      if (list?.some((x) => x.id === p.id)) p.id = p.id + '-' + Date.now().toString(36);
      await api.save(p); onOpen(p);
    } catch (e: any) { setErr('Import failed: ' + e.message); }
  };
  const remove = async (it: ProjectListItem) => {
    if (!window.confirm(`Move "${it.name}" to the trash folder? You can restore it from projects/.trash.`)) return;
    await api.remove(it.id); refresh();
  };

  const blanks = TEMPLATES.filter((t) => t.id.startsWith('empty'));
  const templates = useMemo(() => TEMPLATES.filter((t) => !t.id.startsWith('empty'))
    .filter((t) => filter === 'all' || t.mode === filter)
    .filter((t) => !query || (t.name + ' ' + t.description + ' ' + (GENRE[t.id] ?? '')).toLowerCase().includes(query.toLowerCase())), [filter, query]);

  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-brand"><img src="/icon.png" alt="" /><span>GameCraft</span></div>
        <nav>
          <a className="on">Home</a>
          <a onClick={() => document.getElementById('home-templates')?.scrollIntoView({ behavior: 'smooth' })}>Templates</a>
          <a onClick={() => document.getElementById('home-recent')?.scrollIntoView({ behavior: 'smooth' })}>Recent</a>
        </nav>
        <div className="grow" />
        <label className="home-open">Open project file…<input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
        <button className="home-open" style={{ background: 'none', width: 'calc(100% - 12px)' }} onClick={() => setImporting(true)}>Import scene…</button>
        {importing && <ImportSceneDialog onOpen={onOpen} onClose={() => setImporting(false)} />}
        <div className="home-foot">Projects save automatically.<br />Your models: <code>Assets</code> folder.</div>
      </aside>

      <main className="home-main">
        <header className="home-head">
          <div>
            <h1>Create a new project</h1>
            <p>Start blank or from a template. Every template is a complete, editable project.</p>
          </div>
          <input className="txt home-name" placeholder="Project name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        </header>
        {err && <div className="warn">{err}</div>}

        <section className="home-blank">
          {blanks.map((t) => (
            <button key={t.id} className="blank-card" disabled={busy} onClick={() => create(t.id)}>
              <span className="blank-icon"><Icon id={t.id} size={26} /></span>
              <span><b>{t.name}</b><small>{t.description}</small></span>
            </button>
          ))}
        </section>

        <section id="home-templates">
          <div className="home-sec-head">
            <h2>Templates and demos</h2>
            <div className="home-tools">
              <div className="seg">{(['all', '3D', '2D'] as Filter[]).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f}</button>)}</div>
              <input className="txt" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="tpl-grid">
            {templates.map((t) => (
              <button key={t.id} className="tpl" disabled={busy} onClick={() => create(t.id)} title={t.description}>
                <div className="tpl-thumb"><Icon id={t.id} size={40} /><span className="tpl-mode">{t.mode}</span></div>
                <div className="tpl-body">
                  <div className="tpl-name">{t.name}</div>
                  <div className="tpl-genre">{GENRE[t.id] ?? 'Template'}</div>
                  <div className="tpl-desc">{t.description}</div>
                </div>
              </button>
            ))}
            {!templates.length && <div className="hint">No templates match.</div>}
          </div>
        </section>

        <section id="home-recent">
          <div className="home-sec-head"><h2>Recent</h2></div>
          {list === null && !err && <div className="hint">Loading…</div>}
          {list?.length === 0 && <div className="hint">No projects yet. Create one above.</div>}
          {!!list?.length && (
            <table className="recent-table">
              <thead><tr><th>Name</th><th>Template</th><th>Modified</th><th /></tr></thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id} onClick={() => open(it)}>
                    <td><b>{it.name}</b>{it.hasNewerAutosave && <span className="badge warn">unsaved changes</span>}</td>
                    <td className="dim">{TEMPLATES.find((t) => t.id === it.template)?.name ?? it.template ?? '—'}</td>
                    <td className="dim">{new Date(it.modified).toLocaleString()}</td>
                    <td className="act"><button className="x" title="Move to trash" onClick={(e) => { e.stopPropagation(); remove(it); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
