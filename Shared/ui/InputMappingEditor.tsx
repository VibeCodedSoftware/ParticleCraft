// Input Mapping Editor (both apps): named actions with bindings from every device (press-to-bind capture for keys,
// mouse buttons, gamepad buttons and sticks), input contexts, on-screen touch controls with presets and a drag-and-drop
// layout editor, and a live input test.
import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_ACTIONS, InputState, PAD_BUTTONS, bindingConflicts, keyFromEvent, parseInputProfile, pollGamepad, tuneValue, type InputProfileFile } from '../src/runtime/input';
import { TOUCH_PRESETS, TouchController, portraitFrom, withTouchBindings, type TouchElement, type TouchLayout } from '../src/touchControls';
import type { ActionTuning, PlayerInput } from '../src/schema';
import { HardwarePending } from './HardwarePending';

export interface InputMapping {
  actions: Record<string, string[]>; contexts?: Record<string, string[]>; touch?: TouchLayout;
  tuning?: Record<string, ActionTuning>; profiles?: Record<string, Record<string, string[]>>;
  profileTuning?: Record<string, Record<string, ActionTuning>>; players?: Record<string, PlayerInput>;
}


/** Friendly text for a binding. */
export function bindingLabel(b: string): string {
  const pn = /^pad([1-4])?:(.+)$/.exec(b); if (pn) return `Gamepad${pn[1] && pn[1] !== '1' ? ' ' + pn[1] : ''} ${pn[2]}`;
  const ax = /^axis([1-4])?:([A-Za-z]+)([+-])$/.exec(b); if (ax) return `${ax[1] && ax[1] !== '1' ? `Gamepad ${ax[1]} s` : 'S'}tick ${ax[2]} ${ax[3] === '+' ? (/y/i.test(ax[2]) ? 'up' : 'right') : (/y/i.test(ax[2]) ? 'down' : 'left')}`;
  if (b.startsWith('mouse:')) return `Mouse ${b.slice(6)}`;
  if (b.startsWith('touchstick:')) return `Touch stick ${b.slice(11)}`;
  if (b.startsWith('touch:')) return `Touch ${b.slice(6)}`;
  if (b.startsWith('swipe:')) return `Swipe ${b.slice(6)}`;
  if (b === 'tap') return 'Tap';
  return `Key ${b}`;
}

/** Wait for the next key, mouse button, gamepad button or stick push (Esc cancels; 8 s timeout). */
function captureBinding(): Promise<string | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const pads0 = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].map((p) => p?.buttons.map((b) => b.pressed) ?? []) : [];
    let raf = 0;
    const done = (b: string | null) => { cancelAnimationFrame(raf); window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', mouse, true); resolve(b); };
    const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); done(e.key === 'Escape' ? null : keyFromEvent(e)); };
    const mouse = (e: MouseEvent) => { if ((e.target as HTMLElement)?.closest?.('.im-capture')) return; e.preventDefault(); e.stopPropagation(); done('mouse:' + (['left', 'middle', 'right'][e.button] ?? 'left')); };
    const poll = () => {
      if (performance.now() - start > 8000) return done(null);
      const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
      for (const [i, p] of pads.entries()) {
        if (!p) continue;
        const prefix = i === 0 ? 'pad:' : `pad${i + 1}:`;
        const bi = p.buttons.findIndex((b, k) => b.pressed && !pads0[i]?.[k]);
        if (bi >= 0 && PAD_BUTTONS[bi]) return done(prefix + PAD_BUTTONS[bi]);
        const ai = p.axes.findIndex((a) => Math.abs(a) > 0.7);
        if (ai >= 0 && i === 0) return done(`axis:${['LeftX', 'LeftY', 'RightX', 'RightY'][ai]}${(ai % 2 ? -p.axes[ai] : p.axes[ai]) > 0 ? '+' : '-'}`);
      }
      raf = requestAnimationFrame(poll);
    };
    window.addEventListener('keydown', key, true); window.addEventListener('mousedown', mouse, true);
    raf = requestAnimationFrame(poll);
  });
}

export function InputMappingEditor({ value, onChange }: { value: InputMapping; onChange: (v: InputMapping, label: string) => void }) {
  const [tab, setTab] = useState<'actions' | 'tuning' | 'contexts' | 'profiles' | 'players' | 'touch' | 'test'>('actions');
  const [capturing, setCapturing] = useState<string | null>(null);
  const actions = value.actions, contexts = value.contexts ?? {};
  const set = (patch: Partial<InputMapping>, label: string) => onChange({ ...value, ...patch }, label);
  const setActions = (a: Record<string, string[]>, label = 'Edit input actions') => set({ actions: a }, label);
  const bind = async (name: string) => { setCapturing(name); const b = await captureBinding(); setCapturing(null); if (b && !actions[name].includes(b)) setActions({ ...actions, [name]: [...actions[name], b] }, `Bind ${name}`); };
  const conflicts = bindingConflicts(actions, value.contexts);
  const clashOf = (name: string, b: string) => conflicts.find((c) => c.binding === b && c.actions.includes(name));
  return (
    <div className="im">
      <div className="im-tabs">{(['actions', 'tuning', 'contexts', 'profiles', 'players', 'touch', 'test'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ actions: 'Actions', tuning: 'Tuning', contexts: 'Contexts', profiles: 'Profiles', players: 'Players', touch: 'Touch controls', test: 'Test' }[t]}</button>)}</div>
      {tab === 'actions' && <>
        <p className="lx-doc">One action = every control that does it (Jump = Space, gamepad A, a touch button…). Use them with the Input action blocks. <b>+ Bind</b> waits for the next key, mouse button, gamepad button or stick push.</p>
        {conflicts.length > 0 && <p className="lx-doc im-warn">⚠ {conflicts.length === 1 ? 'One control is' : `${conflicts.length} controls are`} used by more than one action at the same time: {conflicts.slice(0, 4).map((c) => `${bindingLabel(c.binding)} (${c.actions.join(', ')})`).join('; ')}{conflicts.length > 4 ? '…' : ''}. Pressing it does both — put the actions in different contexts or rebind one.</p>}
        <div className="im-list">
          {Object.entries(actions).map(([name, binds]) => (
            <div key={name} className="im-row">
              <input className="lx-input im-name" value={name} onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_ ]/g, ''); if (!v || (v !== name && actions[v])) return; const next: Record<string, string[]> = {}; for (const [k, b] of Object.entries(actions)) next[k === name ? v : k] = b; const ctx = Object.fromEntries(Object.entries(contexts).map(([c, a]) => [c, a.map((x) => (x === name ? v : x))])); onChange({ ...value, actions: next, contexts: value.contexts && ctx }, 'Rename action'); }} onKeyDown={(e) => e.stopPropagation()} />
              <div className="im-binds">
                {binds.map((b) => <span key={b} className={'im-chip' + (clashOf(name, b) ? ' clash' : '')} title={clashOf(name, b) ? `${b} — also used by ${clashOf(name, b)!.actions.filter((a) => a !== name).join(', ')}` : b}>{bindingLabel(b)}<button onClick={() => setActions({ ...actions, [name]: binds.filter((x) => x !== b) })}>✕</button></span>)}
                <button className={'lx-btn im-capture' + (capturing === name ? ' on' : '')} onClick={() => bind(name)}>{capturing === name ? 'Press a key / button… (Esc cancels)' : '+ Bind'}</button>
                <input className="lx-input im-add" placeholder="or type: swipe:up, touch:Jump…" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v && !binds.includes(v)) setActions({ ...actions, [name]: [...binds, v] }); (e.target as HTMLInputElement).value = ''; } }} />
              </div>
              <button className="lx-btn" title="Remove action" onClick={() => { const next = { ...actions }; delete next[name]; setActions(next, 'Remove action'); }}>✕</button>
            </div>
          ))}
        </div>
        <div className="im-foot">
          <button className="lx-btn" onClick={() => { let n = 'Action'; let k = 2; while (actions[n]) n = 'Action' + k++; setActions({ ...actions, [n]: [] }, 'Add action'); }}>+ Action</button>
          <button className="lx-btn" title="Player 2 versions of the actions on gamepad 2" onClick={() => { const next = { ...actions }; for (const [k, b] of Object.entries(actions)) if (!/^P\d /.test(k)) next['P2 ' + k] = b.filter((x) => x.startsWith('pad:')).map((x) => 'pad2:' + x.slice(4)); setActions(next, 'Add player 2 actions'); }}>+ Player 2 (gamepad 2)</button>
          <button className="lx-btn" onClick={() => { if (window.confirm('Reset the actions to the defaults?')) setActions({ ...DEFAULT_ACTIONS }, 'Reset input actions'); }}>Reset to defaults</button>
        </div>
      </>}
      {tab === 'contexts' && <>
        <p className="lx-doc">Contexts switch groups of actions on and off with "Set input context" (Menu on → Gameplay actions stop). An action in no context always works. All contexts start on.</p>
        <table className="im-ctx"><thead><tr><th>Action</th>{Object.keys(contexts).map((c) => <th key={c}>{c} <button className="lx-btn" title="Remove context" onClick={() => { const n = { ...contexts }; delete n[c]; set({ contexts: n }, 'Remove context'); }}>✕</button></th>)}</tr></thead>
          <tbody>{Object.keys(actions).map((a) => <tr key={a}><td>{a}</td>{Object.entries(contexts).map(([c, list]) => <td key={c}><input type="checkbox" checked={list.includes(a)} onChange={(e) => set({ contexts: { ...contexts, [c]: e.target.checked ? [...list, a] : list.filter((x) => x !== a) } }, 'Edit context')} /></td>)}</tr>)}</tbody></table>
        <button className="lx-btn" onClick={() => { const n = window.prompt('Context name (e.g. Gameplay, Menu, Vehicle)'); if (n && !contexts[n]) set({ contexts: { ...contexts, [n]: [] } }, 'Add context'); }}>+ Context</button>
      </>}
      {tab === 'tuning' && <TuningSection value={value} set={set} />}
      {tab === 'profiles' && <ProfilesSection value={value} set={set} />}
      {tab === 'players' && <PlayersSection value={value} set={set} />}
      {tab === 'touch' && <TouchSection value={value} set={set} />}
      {tab === 'test' && <InputTest mapping={value} />}
    </div>
  );
}

/** How each action feels: deadzone, response curve, sensitivity, invert (movement / look vectors), hold or toggle. */
function TuningSection({ value, set }: { value: InputMapping; set: (p: Partial<InputMapping>, label: string) => void }) {
  const tuning = value.tuning ?? {};
  const edit = (a: string, patch: Partial<ActionTuning>) => set({ tuning: { ...tuning, [a]: { ...tuning[a], ...patch } } }, `Tune ${a}`);
  const names = [...Object.keys(value.actions), ...(value.actions.Look ? [] : ['Look'])];
  return (
    <>
      <p className="lx-doc">How each action responds. <b>Deadzone</b>: stick movement below it is ignored. <b>Curve</b>: Smooth eases in, Precise gives fine control near the centre, Aggressive reacts early. <b>Sensitivity</b> scales the value (Look sets mouse / stick look speed). <b>Invert</b> flips it in movex / movey / lookx / looky. <b>Toggle</b>: each press switches the action on or off (crouch, aim) instead of holding.</p>
      <table className="im-ctx"><thead><tr><th>Action</th><th>Deadzone</th><th>Curve</th><th>Sensitivity</th><th>Invert</th><th>Hold / toggle</th><th>At half push</th></tr></thead>
        <tbody>{names.map((a) => {
          const t = tuning[a] ?? {};
          return <tr key={a}>
            <td>{a}</td>
            <td><input type="range" min={0} max={0.6} step={0.01} value={t.deadzone ?? 0} onChange={(e) => edit(a, { deadzone: Number(e.target.value) })} /> {(t.deadzone ?? 0).toFixed(2)}</td>
            <td><select className="lx-input" value={t.curve ?? 'linear'} onChange={(e) => edit(a, { curve: e.target.value as ActionTuning['curve'] })}><option value="linear">Linear</option><option value="smooth">Smooth</option><option value="precise">Precise</option><option value="aggressive">Aggressive</option></select></td>
            <td><input className="lx-input" type="number" step={0.1} min={0} style={{ width: 60 }} value={t.sensitivity ?? 1} onChange={(e) => edit(a, { sensitivity: Math.max(0, Number(e.target.value)) })} /></td>
            <td><input type="checkbox" checked={!!t.invert} onChange={(e) => edit(a, { invert: e.target.checked })} /></td>
            <td><select className="lx-input" value={t.mode ?? 'hold'} onChange={(e) => edit(a, { mode: e.target.value as ActionTuning['mode'] })}><option value="hold">Hold</option><option value="toggle">Toggle</option></select></td>
            <td>{tuneValue(0.5, t).toFixed(2)}</td>
          </tr>;
        })}</tbody></table>
    </>
  );
}

/** Saved control layouts: save the current bindings under a name, switch to one, export / import a .json file. */
function ProfilesSection({ value, set }: { value: InputMapping; set: (p: Partial<InputMapping>, label: string) => void }) {
  const profiles = value.profiles ?? {};
  const [msg, setMsg] = useState('');
  const download = (name: string, actions: Record<string, string[]>, tuning = value.tuning) => {
    const file: InputProfileFile = { format: 'craft.input-profile', version: 1, name, actions, tuning };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    a.download = `${name.replace(/[^A-Za-z0-9_ -]/g, '') || 'controls'}.input.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <>
      <p className="lx-doc">Profiles are whole control layouts (e.g. Default, Left-handed, Arcade stick). Switch while playing with <b>Change input profile</b>, or load one here. Export a profile to share it; import one from a <code>.input.json</code> file.</p>
      <div className="im-list">
        {Object.entries(profiles).map(([name, acts]) => (
          <div key={name} className="im-row">
            <b className="im-name">{name}</b>
            <span className="dim">{Object.keys(acts).length} actions</span>
            <button className="lx-btn" title="Use these bindings now (in the editor)" onClick={() => set({ actions: { ...value.actions, ...acts } }, `Load input profile ${name}`)}>Load</button>
            <button className="lx-btn" title="Save the current bindings and tuning into this profile" onClick={() => set({ profiles: { ...profiles, [name]: { ...value.actions } }, profileTuning: { ...value.profileTuning, [name]: { ...value.tuning } } }, `Update input profile ${name}`)}>Update</button>
            <button className="lx-btn" onClick={() => download(name, acts, value.profileTuning?.[name])}>Export</button>
            <button className="lx-btn" title="Delete profile" onClick={() => { const n = { ...profiles }, t = { ...value.profileTuning }; delete n[name]; delete t[name]; set({ profiles: n, profileTuning: t }, 'Delete input profile'); }}>✕</button>
          </div>
        ))}
      </div>
      <div className="im-foot">
        <button className="lx-btn" onClick={() => { const n = window.prompt('Profile name', Object.keys(profiles).length ? 'Profile ' + (Object.keys(profiles).length + 1) : 'Default')?.trim(); if (n) set({ profiles: { ...profiles, [n]: { ...value.actions } }, profileTuning: { ...value.profileTuning, [n]: { ...value.tuning } } }, 'Save input profile'); }}>Save current as profile…</button>
        <button className="lx-btn" onClick={() => download('Current', value.actions)}>Export current…</button>
        <label className="lx-btn">Import…<input type="file" accept=".json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          const p = parseInputProfile(await f.text());
          if (typeof p === 'string') { setMsg(p); return; }
          let n = p.name, k = 2; while (profiles[n]) n = `${p.name} ${k++}`;
          set({ profiles: { ...profiles, [n]: p.actions }, profileTuning: p.tuning ? { ...value.profileTuning, [n]: p.tuning } : value.profileTuning }, 'Import input profile');
          setMsg(`Imported "${n}" (${Object.keys(p.actions).length} actions). Load it to use it.`);
        }} /></label>
      </div>
      {msg && <p className="lx-doc">{msg}</p>}
    </>
  );
}

/**
 * Local players 1-4: each player's device and own profile (bindings + tuning), so players never share settings.
 * Behaviors use them with Controls = player1-4; action blocks with their Player choice.
 */
function PlayersSection({ value, set }: { value: InputMapping; set: (p: Partial<InputMapping>, label: string) => void }) {
  const players = value.players ?? {};
  const profiles = Object.keys(value.profiles ?? {});
  const cur = (n: number): PlayerInput => players[String(n)] ?? { device: n === 1 ? 'all' : (`gamepad${n}` as PlayerInput['device']) };
  const edit = (n: number, patch: Partial<PlayerInput>) => set({ players: { ...players, [String(n)]: { ...cur(n), ...patch } } }, `Player ${n} input`);
  // Two people on one device would press each other's controls.
  const devs = [1, 2, 3, 4].map((n) => cur(n).device);
  // "Every device" covers the keyboard and gamepad 1.
  const overlap = (a: string, b: string) => a === b || (a === 'all' && (b === 'keyboard' || b === 'gamepad1')) || (b === 'all' && (a === 'keyboard' || a === 'gamepad1'));
  const shared = (n: number) => devs.some((x, k) => k !== n - 1 && overlap(x, devs[n - 1]));
  return (
    <>
      <p className="lx-doc">Local multiplayer: each player plays on their own device with their own <b>profile</b> (bindings and tuning, saved in Profiles), so one player can rebind or invert without changing anyone else. Give a character's movement behavior <b>Controls: player1-4</b>, and set the <b>Player</b> on Input action blocks. "Change input profile" can switch one player only.</p>
      <table className="im-ctx"><thead><tr><th>Player</th><th>Device</th><th>Profile</th><th /></tr></thead>
        <tbody>{[1, 2, 3, 4].map((n) => {
          const p = cur(n);
          return <tr key={n}>
            <td>Player {n}</td>
            <td><select className="lx-input" value={p.device} onChange={(e) => edit(n, { device: e.target.value as PlayerInput['device'] })}>
              <option value="all">Every device (gamepad 1 for pad buttons)</option><option value="keyboard">Keyboard and mouse</option>
              {[1, 2, 3, 4].map((g) => <option key={g} value={`gamepad${g}`}>Gamepad {g}</option>)}
            </select></td>
            <td><select className="lx-input" value={p.profile ?? ''} onChange={(e) => edit(n, { profile: e.target.value || undefined })}>
              <option value="">Project actions</option>{profiles.map((x) => <option key={x} value={x}>{x}</option>)}
            </select></td>
            <td>{shared(n) && <span className="im-warn" title="Another player uses the same device: both would move">⚠ shares a device</span>}</td>
          </tr>;
        })}</tbody></table>
      {!profiles.length && <p className="lx-doc">No profiles yet: save one in Profiles to give a player their own bindings and feel.</p>}
      <HardwarePending device="set of gamepads" what="Local players on gamepads 1-4 and the Xbox / PlayStation / Nintendo button names in prompts are tested with simulated pads" />
    </>
  );
}

function TouchSection({ value, set }: { value: InputMapping; set: (p: Partial<InputMapping>, label: string) => void }) {
  const t = value.touch;
  const [sel, setSel] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const apply = (preset: string) => set({ touch: TOUCH_PRESETS[preset].layout(), actions: withTouchBindings(value.actions, preset) }, 'Touch controls preset');
  const setT = (patch: Partial<TouchLayout>, label = 'Touch controls') => t && set({ touch: { ...t, ...patch } }, label);
  // Landscape (phone on its side) or portrait (upright) controls: each orientation has its own positions.
  const [orient, setOrient] = useState<'landscape' | 'portrait'>('landscape');
  const portrait = orient === 'portrait';
  const own = !portrait || !!t?.portrait?.length; // portrait with no set of its own shows the landscape one
  const list = (portrait && own ? t?.portrait : t?.elements) ?? [];
  const setList = (els: TouchElement[], label: string) => setT(portrait ? { portrait: els } : { elements: els }, label);
  const setEl = (id: string, patch: Partial<TouchElement>) => t && own && setList(list.map((e) => (e.id === id ? { ...e, ...patch } : e)), 'Edit touch control');
  const drag = (e: React.PointerEvent, id: string) => {
    e.preventDefault(); setSel(id);
    const f = frame.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setEl(id, { x: Math.max(0.03, Math.min(0.97, (ev.clientX - f.left) / f.width)), y: Math.max(0.05, Math.min(0.95, (ev.clientY - f.top) / f.height)) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const cur = own ? list.find((e) => e.id === sel) : undefined;
  return (
    <>
      <p className="lx-doc">On-screen controls for phones and tablets. Each button is a binding <code>touch:&lt;name&gt;</code> of the action with the same name; the joystick moves like the arrow keys. Presets set the layout and add the touch bindings to your actions.</p>
      <HardwarePending device="phone or tablet" what="Touch controls, gestures and the portrait / landscape switch are tested with simulated touches" />
      <div className="im-row">
        <select className="lx-input" value={t?.preset ?? ''} onChange={(e) => e.target.value && apply(e.target.value)}><option value="">Choose a preset…</option>{Object.entries(TOUCH_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name} — {p.doc}</option>)}</select>
        {t && <select className="lx-input" value={t.enabled} onChange={(e) => setT({ enabled: e.target.value as TouchLayout['enabled'] })}><option value="auto">Show on touch screens</option><option value="always">Always show (test with the mouse)</option><option value="off">Off</option></select>}
      </div>
      {t && <>
        <div className="im-row">
          <label className="chk"><input type="checkbox" checked={t.look} onChange={(e) => setT({ look: e.target.checked })} /> Drag to look (camera)</label>
          <label className="chk"><input type="checkbox" checked={t.swipes} onChange={(e) => setT({ swipes: e.target.checked })} /> Swipes</label>
          <label className="chk" title="Two fingers spread / pinch to zoom the game camera (pan with two fingers: panx / pany in blocks)"><input type="checkbox" checked={!!t.pinchZoom} onChange={(e) => setT({ pinchZoom: e.target.checked })} /> Pinch zoom</label>
          <label className="chk" title="Keep controls clear of notches and rounded screen corners"><input type="checkbox" checked={t.safeArea !== false} onChange={(e) => setT({ safeArea: e.target.checked })} /> Safe area</label>
        </div>
        <div className="im-row">
          <label title="How long a finger must stay still for a long press">Long press <input className="lx-input" type="number" min={150} max={2000} step={50} style={{ width: 70 }} value={t.longPressMs ?? 500} onChange={(e) => setT({ longPressMs: Math.max(150, Number(e.target.value)) }, 'Touch timing')} /> ms</label>
          <label title="The most time between the two taps of a double tap">Double tap within <input className="lx-input" type="number" min={150} max={800} step={25} style={{ width: 70 }} value={t.doubleTapMs ?? 300} onChange={(e) => setT({ doubleTapMs: Math.max(150, Number(e.target.value)) }, 'Touch timing')} /> ms</label>
          {t.pinchZoom && <label>Pinch speed <input type="range" min={0.2} max={3} step={0.1} value={t.pinchSpeed ?? 1} onChange={(e) => setT({ pinchSpeed: Number(e.target.value) }, 'Pinch speed')} /></label>}
          <label>Opacity <input type="range" min={0.15} max={1} step={0.05} value={t.opacity} onChange={(e) => setT({ opacity: Number(e.target.value) }, 'Touch opacity')} /></label>
          {own && <button className="lx-btn" onClick={() => { let n = 'Button'; let k = 2; while (list.some((e) => e.id === n)) n = 'Button' + k++; setList([...list, { id: n, kind: 'button', x: 0.7, y: portrait ? 0.8 : 0.6, size: 0.14, label: n }], 'Add touch button'); setSel(n); }}>+ Button</button>}
          {own && !list.some((e) => e.kind === 'stick') && <button className="lx-btn" onClick={() => setList([...list, { id: 'stick', kind: 'stick', x: portrait ? 0.26 : 0.16, y: portrait ? 0.8 : 0.74, size: 0.3 }], 'Add joystick')}>+ Joystick</button>}
        </div>
        <div className="im-row">
          <div className="im-tabs">{(['landscape', 'portrait'] as const).map((o) => <button key={o} className={orient === o ? 'on' : ''} onClick={() => { setOrient(o); setSel(null); }}>{o === 'landscape' ? 'Landscape (sideways)' : 'Portrait (upright)'}</button>)}</div>
          {portrait && !own && <><span className="dim">Upright phones use the landscape positions.</span><button className="lx-btn" onClick={() => setT({ portrait: portraitFrom(t.elements) }, 'Portrait touch layout')}>Make a portrait layout</button></>}
          {portrait && own && <button className="lx-btn" title="Upright phones go back to the landscape positions" onClick={() => { setT({ portrait: undefined }, 'Remove portrait touch layout'); setSel(null); }}>Use landscape positions</button>}
        </div>
        {/* Sizes are fractions of the shorter side: the frame's height in landscape (9 of 16), its width in portrait. */}
        <div className="im-phone" ref={frame} title={own ? 'Drag the controls to place them' : 'Make a portrait layout to move controls for upright phones'} style={portrait ? { aspectRatio: '9 / 16', width: 'auto', height: 360, margin: '0 auto', opacity: own ? 1 : 0.55 } : undefined}>
          {list.map((e) => <div key={e.id} className={'im-el ' + e.kind + (sel === e.id ? ' sel' : '')} style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, width: `${e.size * (portrait ? 100 : 56.25)}%`, aspectRatio: '1' }} onPointerDown={(ev) => own && drag(ev, e.id)}>{e.kind === 'button' ? e.label ?? e.id : '✥'}</div>)}
        </div>
        {cur && <div className="im-row">
          <b>{cur.kind === 'stick' ? 'Joystick' : 'Button'}</b>
          {cur.kind === 'button' && <label>Action <input className="lx-input" value={cur.id} onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_]/g, ''); if (v && !list.some((x) => x.id === v)) { setEl(cur.id, { id: v }); setSel(v); } }} onKeyDown={(e) => e.stopPropagation()} /></label>}
          {cur.kind === 'button' && <label>Label <input className="lx-input" value={cur.label ?? ''} onChange={(e) => setEl(cur.id, { label: e.target.value })} onKeyDown={(e) => e.stopPropagation()} /></label>}
          <label>Size <input type="range" min={0.08} max={0.45} step={0.01} value={cur.size} onChange={(e) => setEl(cur.id, { size: Number(e.target.value) })} /></label>
          {cur.kind === 'button' && !value.actions[cur.id]?.includes('touch:' + cur.id) && <button className="lx-btn" onClick={() => set({ actions: { ...value.actions, [cur.id]: [...(value.actions[cur.id] ?? []), 'touch:' + cur.id] } }, 'Bind touch button')}>Bind to action "{cur.id}"</button>}
          <button className="lx-btn" onClick={() => { setList(list.filter((x) => x.id !== cur.id), 'Remove touch control'); setSel(null); }}>Remove</button>
        </div>}
      </>}
    </>
  );
}

/** Live test: press keys, buttons, sticks (or the touch preview) and watch every action. */
function InputTest({ mapping }: { mapping: InputMapping }) {
  const inp = useRef(new InputState()).current;
  const [, redraw] = useState(0);
  const touchArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; inp.keyDown(keyFromEvent(e)); }, ku = (e: KeyboardEvent) => inp.keyUp(keyFromEvent(e));
    const md = (e: MouseEvent) => inp.mouseDown((['left', 'middle', 'right'][e.button] ?? 'left') as any), mu = (e: MouseEvent) => inp.mouseUp(['left', 'middle', 'right'][e.button] ?? 'left');
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('mousedown', md); window.addEventListener('mouseup', mu);
    let raf = 0;
    const loop = () => { pollGamepad(inp); inp.track(Object.values(mapping.actions).flat()); redraw((n) => n + 1); inp.endTick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('mousedown', md); window.removeEventListener('mouseup', mu); };
  }, [mapping]);
  // A small touch preview: the layout drawn in a phone frame, driving the same input.
  const ctl = useRef<TouchController | null>(null);
  useEffect(() => { if (mapping.touch && touchArea.current) { const el = touchArea.current; ctl.current = new TouchController(inp, mapping.touch, () => ({ w: el.clientWidth, h: el.clientHeight })); } }, [mapping.touch]);
  const pos = (e: React.PointerEvent) => { const b = touchArea.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
  return (
    <>
      <p className="lx-doc">Press keys, mouse buttons, gamepad buttons or sticks{mapping.touch ? ', or use the touch preview' : ''}: each action lights up with its strength. Last device: <b>{inp.device}</b>.</p>
      <div className="im-test">
        {Object.entries(mapping.actions).map(([name, binds]) => {
          const v = Math.max(0, ...binds.map((b) => inp.bindingValue(b)));
          return <div key={name} className={'im-meter' + (v >= 0.5 ? ' on' : '')}><span>{name}</span><i style={{ width: `${v * 100}%` }} /></div>;
        })}
      </div>
      {mapping.touch && mapping.touch.enabled !== 'off' && (
        <div className="im-phone" ref={touchArea} style={{ touchAction: 'none' }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); const [x, y] = pos(e); ctl.current?.down(e.pointerId, x, y, e.timeStamp); }}
          onPointerMove={(e) => { const [x, y] = pos(e); ctl.current?.move(e.pointerId, x, y); }}
          onPointerUp={(e) => { const [x, y] = pos(e); ctl.current?.up(e.pointerId, x, y, e.timeStamp); }}>
          {mapping.touch.elements.map((e) => <div key={e.id} className={'im-el ' + e.kind} style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, width: `${e.size * 56.25}%`, aspectRatio: '1', pointerEvents: 'none' }}>{e.kind === 'button' ? e.label ?? e.id : '✥'}</div>)}
        </div>
      )}
    </>
  );
}
