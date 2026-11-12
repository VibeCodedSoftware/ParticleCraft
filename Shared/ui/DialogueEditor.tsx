// Visual branching-dialogue editor. Conversations live in LogicDocument.dialogues (independent of coding style);
// the Dialogue blocks start and steer them at runtime (runtime/story.ts).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from './icons';
import { newId, type DialogueDef, type DialogueNode, type LogicDocument } from '../src/schema';
import { checkDialogue } from '../src/runtime/story';
import { guardExample, newDialogueNode } from '../src/dialogueKit';
import { edit } from './logicOps';
import { DialogueStylePanel } from './DialogueStylePanel';

const W = 250;

const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

type Drag = { kind: 'pan'; x: number; y: number; vx: number; vy: number } | { kind: 'node'; id: string; x: number; y: number; nx: number; ny: number } | { kind: 'link'; from: string; choice?: string; x: number; y: number };

export function DialogueEditor({ doc, onChange, importFile, resolve }: { doc: LogicDocument; onChange: (doc: LogicDocument, label: string) => void; importFile?: (f: File) => Promise<string>; resolve?: (ref: string) => string | null }) {
  const list = doc.dialogues ?? [];
  const [look, setLook] = useState(false);
  const [curId, setCurId] = useState<string | null>(list[0]?.id ?? null);
  const cur = list.find((d) => d.id === curId) ?? list[0];
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 40, z: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [play, setPlay] = useState<{ node: string; log: string[] } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const problems = useMemo(() => (cur ? checkDialogue(cur) : []), [cur]);

  const change = (label: string, fn: (d: DialogueDef, all: DialogueDef[]) => void) => onChange(edit(doc, (dd) => {
    dd.dialogues ??= [];
    const d = dd.dialogues.find((x) => x.id === cur?.id);
    if (d) fn(d, dd.dialogues);
  }), label);
  const addDialogue = (example: boolean) => {
    const d = example ? guardExample() : (() => { const s = newDialogueNode(60, 80, { speaker: 'Narrator', text: 'Hello there.' }); return { id: newId('dlg'), name: 'Conversation ' + (list.length + 1), start: s.id, nodes: [s] } as DialogueDef; })();
    if (example && list.some((x) => x.name === 'Guard')) d.name = 'Guard ' + (list.length + 1);
    onChange(edit(doc, (dd) => { (dd.dialogues ??= []).push(d); if (example) for (const [g, v] of [['gold', 25], ['reputation', 0]] as const) if (!dd.globals.some((x) => x.name === g)) dd.globals.push({ name: g, type: 'number', value: v }); }), 'Add dialogue');
    setCurId(d.id); setSel(null);
  };
  const toWorld = (cx: number, cy: number) => { const r = area.current!.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
  const pos = (n: DialogueNode) => (live?.id === n.id ? live : n);
  const nodeH = (n: DialogueNode) => 64 + Math.min(3, Math.ceil(n.text.length / 34)) * 16 + n.choices.length * 24 + (n.set || n.event || n.scene ? 16 : 0);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.x, y: drag.vy + e.clientY - drag.y }));
      else if (drag.kind === 'node') setLive({ id: drag.id, x: drag.nx + (e.clientX - drag.x) / view.z, y: drag.ny + (e.clientY - drag.y) / view.z });
      else setCursor(toWorld(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (drag.kind === 'node' && live) { const l = live; change('Move line', (d) => { const n = d.nodes.find((x) => x.id === l.id); if (n) { n.x = Math.round(l.x / 10) * 10; n.y = Math.round(l.y / 10) * 10; } }); }
      if (drag.kind === 'link') {
        const target = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.('[data-dnode]')?.getAttribute('data-dnode')).find(Boolean);
        const w = toWorld(e.clientX, e.clientY);
        change('Link line', (d) => {
          const from = d.nodes.find((x) => x.id === drag.from); if (!from) return;
          let to = target ? d.nodes.find((x) => x.id === target) : undefined;
          if (!to) { to = newDialogueNode(w.x, w.y - 20, { speaker: from.speaker === 'Narrator' ? 'Narrator' : from.speaker }); d.nodes.push(to); setSel(to.id); }
          if (to.id === from.id) return;
          if (drag.choice) { const ch = from.choices.find((c) => c.id === drag.choice); if (ch) ch.to = to.id; } else { from.next = to.id; from.end = undefined; }
        });
      }
      setDrag(null); setLive(null); setCursor(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, live, view.z]);

  if (!cur) {
    return (
      <div className="dl-root"><div className="dl-empty">
        <h3>Branching dialogue</h3>
        <p>Write conversations where characters speak, players pick responses, and each choice leads somewhere different. Start them with the <b>Start dialogue</b> block in any coding style.</p>
        <div className="dl-row"><button className="lx-btn primary" onClick={() => addDialogue(false)}>+ New conversation</button><button className="lx-btn" onClick={() => addDialogue(true)}>Add the guard example</button></div>
      </div></div>
    );
  }
  const node = cur.nodes.find((n) => n.id === sel);
  const byId = new Map(cur.nodes.map((n) => [n.id, n]));
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
  const outY = (n: DialogueNode, i: number) => pos(n).y + 64 + Math.min(3, Math.ceil(n.text.length / 34)) * 16 + i * 24 + 10;
  const setNode = (label: string, fn: (n: DialogueNode, d: DialogueDef) => void) => change(label, (d) => { const n = d.nodes.find((x) => x.id === sel); if (n) fn(n, d); });
  const playNode = play ? byId.get(play.node) : undefined;

  return (
    <div className="dl-root">
      <div className="dl-list">
        <div className="dl-list-head">Conversations</div>
        {list.map((d) => (
          <button key={d.id} className={'dl-item' + (d.id === cur.id ? ' on' : '')} onClick={() => { setCurId(d.id); setSel(null); setPlay(null); }}>
            {d.name}<span>{d.nodes.length}</span>
          </button>
        ))}
        <button className="lx-btn" onClick={() => addDialogue(false)}>+ New</button>
        <button className="lx-btn" onClick={() => addDialogue(true)}>+ Guard example</button>
        <button className="lx-btn" title="How the dialogue box looks in the game: presets, colours, font, your own box picture, speaker portraits" onClick={() => setLook(true)}>🎨 Look…</button>
        {look && <DialogueStylePanel doc={doc} onChange={onChange} importFile={importFile} resolve={resolve} onClose={() => setLook(false)} />}
        <div className="dl-list-help">Start a conversation with the <b>Start dialogue</b> block. React with <b>On dialogue event</b>, <b>On dialogue choice</b> and <b>On dialogue end</b>.</div>
      </div>
      <div className="dl-canvas" ref={area}
        onWheel={(e) => { const r = area.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const z = Math.min(1.8, Math.max(0.3, view.z * (e.deltaY < 0 ? 1.1 : 0.9))); setView({ z, x: mx - ((mx - view.x) / view.z) * z, y: my - ((my - view.y) / view.z) * z }); }}
        onPointerDown={(e) => { setSel(null); setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }); }}
        onDoubleClick={(e) => { const w = toWorld(e.clientX, e.clientY); change('Add line', (d) => { const n = newDialogueNode(w.x, w.y); d.nodes.push(n); setSel(n.id); }); }}>
        <div className="dl-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="dl-wires" width="1" height="1">
            <defs><marker id="dl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b9a6c9" /></marker></defs>
            {cur.nodes.flatMap((n) => {
              const out: React.ReactNode[] = [];
              n.choices.forEach((c, i) => { const t = c.to && byId.get(c.to); if (t) out.push(<path key={c.id} className={'dl-wire' + (c.condition ? ' cond' : '')} d={curve({ x: pos(n).x + W, y: outY(n, i) }, { x: pos(t).x, y: pos(t).y + 18 })} markerEnd="url(#dl-arrow)" />); });
              const t = n.next && byId.get(n.next);
              if (t) out.push(<path key={n.id + 'n'} className="dl-wire next" d={curve({ x: pos(n).x + W, y: pos(n).y + nodeH(n) - 12 }, { x: pos(t).x, y: pos(t).y + 18 })} markerEnd="url(#dl-arrow)" />);
              return out;
            })}
            {drag?.kind === 'link' && cursor && (() => { const n = byId.get(drag.from)!; const i = n.choices.findIndex((c) => c.id === drag.choice); return <path className="dl-wire temp" d={curve({ x: pos(n).x + W, y: i >= 0 ? outY(n, i) : pos(n).y + nodeH(n) - 12 }, cursor)} />; })()}
          </svg>
          {cur.nodes.map((n) => {
            const p = pos(n);
            const h = hue(n.speaker);
            return (
              <div key={n.id} data-dnode={n.id} className={'dl-node' + (sel === n.id ? ' sel' : '') + (cur.start === n.id ? ' start' : '') + (n.end ? ' end' : '') + (playNode?.id === n.id ? ' playing' : '')}
                style={{ left: p.x, top: p.y, width: W, ['--h' as any]: h }}
                onPointerDown={(e) => { e.stopPropagation(); setSel(n.id); setDrag({ kind: 'node', id: n.id, x: e.clientX, y: e.clientY, nx: n.x, ny: n.y }); }}
                onDoubleClick={(e) => e.stopPropagation()}>
                <span className="dl-in" />
                <div className="dl-head">{cur.start === n.id && <span className="dl-flag">START</span>}<b>{n.speaker || '—'}</b>{n.end && <span className="dl-flag end">END{n.ending ? ': ' + n.ending : ''}</span>}</div>
                <div className="dl-text">{n.text || <i>(no text: passes straight through)</i>}</div>
                {(n.set || n.event || n.scene) && <div className="dl-fx">{n.set && <span><Glyph e="⚙" i="settings" size={11} /> {n.set} </span>}{n.event && <span><Glyph e="⚡" i="zap" size={11} /> {n.event} </span>}{n.scene && <span><Glyph e="🎬" i="video" size={11} /> {n.scene}</span>}</div>}
                {n.choices.map((c) => (
                  <div key={c.id} className={'dl-choice' + (c.to ? '' : ' open')} title={c.condition ? 'Only shown when: ' + c.condition : undefined}>
                    {c.condition && <span className="dl-if">if</span>}{c.text || <i>(empty choice)</i>}
                    <span className="dl-out" title="Drag to the line this choice leads to (or empty space for a new line)" onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: 'link', from: n.id, choice: c.id, x: e.clientX, y: e.clientY }); setCursor(toWorld(e.clientX, e.clientY)); }} />
                  </div>
                ))}
                {!n.choices.length && !n.end && <div className="dl-next">continue<span className="dl-out" title="Drag to the next line" onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: 'link', from: n.id, x: e.clientX, y: e.clientY }); setCursor(toWorld(e.clientX, e.clientY)); }} /></div>}
              </div>
            );
          })}
        </div>
        <div className="dl-tools">
          <button onClick={() => setPlay({ node: cur.start, log: [] })}><Glyph e="▶" i="play" size={12} /> Play through</button>
          <span>Double-click: new line · drag a ● to link · wheel: zoom</span>
        </div>
        {problems.length > 0 && <div className="dl-problems">{problems.slice(0, 4).map((p, i) => <div key={i}><Glyph e="⚠" i="alert-triangle" size={12} /> {p}</div>)}</div>}
        {play && (
          <div className="dl-play">
            <div className="dl-play-head">Preview <button onClick={() => setPlay(null)}>✕</button></div>
            {playNode ? (
              <>
                <div className="dl-play-line"><b>{playNode.speaker}</b>{playNode.text}</div>
                {(playNode.set || playNode.event) && <div className="dl-play-fx">{playNode.set && `sets ${playNode.set}`} {playNode.event && `fires "${playNode.event}"`}</div>}
                {playNode.choices.length ? playNode.choices.map((c, i) => (
                  <button key={c.id} className="dl-play-choice" onClick={() => setPlay({ node: c.to ?? '', log: [...play.log, c.text] })}>{i + 1}. {c.text}{c.condition && <em> (if {c.condition})</em>}</button>
                )) : <button className="dl-play-choice" onClick={() => setPlay({ node: playNode.end ? '' : playNode.next ?? '', log: play.log })}>{playNode.end || !playNode.next ? 'End' : 'Continue ▸'}</button>}
              </>
            ) : <div className="dl-play-line">Conversation ended. <button className="lx-btn" onClick={() => setPlay({ node: cur.start, log: [] })}>Again</button></div>}
          </div>
        )}
      </div>
      <div className="dl-side">
        <div className="lx-insp">
          <div className="lx-insp-head"><b>Conversation</b></div>
          <div className="lx-form">
            <label><span>Name</span><input className="lx-input" value={cur.name} onChange={(e) => change('Rename dialogue', (d) => { d.name = e.target.value; })} /></label>
          </div>
          <button className="lx-btn danger" onClick={() => { if (window.confirm(`Delete the conversation "${cur.name}"?`)) { onChange(edit(doc, (dd) => { dd.dialogues = (dd.dialogues ?? []).filter((x) => x.id !== cur.id); }), 'Delete dialogue'); setCurId(null); } }}>Delete conversation</button>
        </div>
        {node ? (
          <div className="lx-insp">
            <div className="lx-insp-head"><b>Line</b>{cur.start !== node.id && <button className="lx-btn" onClick={() => change('Set start', (d) => { d.start = node.id; })}>Make start</button>}</div>
            <div className="lx-form">
              <label><span>Speaker</span><input className="lx-input" value={node.speaker} onChange={(e) => setNode('Speaker', (n) => { n.speaker = e.target.value; })} /></label>
              <label><span>Text</span><textarea className="lx-input dl-ta" value={node.text} placeholder="What is said. {gold} shows a variable." onChange={(e) => setNode('Text', (n) => { n.text = e.target.value; })} /></label>
              <label title='Assignments run when this line appears, e.g. "trust = trust + 1; met_guard = 1"'><span>Set variables</span><input className="lx-input mono" value={node.set ?? ''} onChange={(e) => setNode('Effects', (n) => { n.set = e.target.value || undefined; })} /></label>
              <label title='Fires "On dialogue event" with this name: open doors, give items, start quests, play animations'><span>Event</span><input className="lx-input" value={node.event ?? ''} onChange={(e) => setNode('Event', (n) => { n.event = e.target.value || undefined; })} /></label>
              <label><span>Sound</span><input className="lx-input" value={node.sound ?? ''} onChange={(e) => setNode('Sound', (n) => { n.sound = e.target.value || undefined; })} /></label>
              <label title="Switch to this scene when the line is reached (ends the conversation)"><span>Go to scene</span><input className="lx-input" value={node.scene ?? ''} onChange={(e) => setNode('Scene', (n) => { n.scene = e.target.value || undefined; })} /></label>
              <label><span>Ends here</span><input type="checkbox" checked={!!node.end} onChange={(e) => setNode('End', (n) => { n.end = e.target.checked || undefined; if (n.end) n.next = undefined; })} /></label>
              {node.end && <label title="Named ending for On dialogue end"><span>Ending name</span><input className="lx-input" value={node.ending ?? ''} onChange={(e) => setNode('Ending', (n) => { n.ending = e.target.value || undefined; })} /></label>}
              {!node.choices.length && !node.end && (
                <label><span>Continues to</span>
                  <select className="lx-input" value={node.next ?? ''} onChange={(e) => setNode('Next', (n) => { n.next = e.target.value || undefined; })}>
                    <option value="">(end of conversation)</option>
                    {cur.nodes.filter((x) => x.id !== node.id).map((x) => <option key={x.id} value={x.id}>{x.speaker}: {x.text.slice(0, 40)}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="dl-choices-head">Choices <button className="lx-btn" onClick={() => setNode('Add choice', (n) => { n.choices.push({ id: newId('ch'), text: 'New choice' }); n.next = undefined; })}>+ Choice</button></div>
            {node.choices.map((c, i) => (
              <div key={c.id} className="dl-choice-edit">
                <div className="dl-row"><b>{i + 1}.</b><input className="lx-input" value={c.text} onChange={(e) => setNode('Choice text', (n) => { n.choices[i].text = e.target.value; })} />
                  <button className="lx-btn" title="Move up" disabled={!i} onClick={() => setNode('Reorder', (n) => { const [x] = n.choices.splice(i, 1); n.choices.splice(i - 1, 0, x); })}>↑</button>
                  <button className="lx-btn danger" onClick={() => setNode('Delete choice', (n) => { n.choices.splice(i, 1); })}>✕</button></div>
                <label><span>Leads to</span><select className="lx-input" value={c.to ?? ''} onChange={(e) => setNode('Choice target', (n) => { n.choices[i].to = e.target.value || undefined; })}>
                  <option value="">(ends the conversation)</option>
                  {cur.nodes.filter((x) => x.id !== node.id).map((x) => <option key={x.id} value={x.id}>{x.speaker}: {x.text.slice(0, 40)}</option>)}
                </select></label>
                <label title='Only shown when this expression is true, e.g. "gold >= 10"'><span>Only if</span><input className="lx-input mono" value={c.condition ?? ''} onChange={(e) => setNode('Choice condition', (n) => { n.choices[i].condition = e.target.value || undefined; })} /></label>
                <label><span>Set variables</span><input className="lx-input mono" value={c.set ?? ''} onChange={(e) => setNode('Choice effects', (n) => { n.choices[i].set = e.target.value || undefined; })} /></label>
                <label><span>Event</span><input className="lx-input" value={c.event ?? ''} onChange={(e) => setNode('Choice event', (n) => { n.choices[i].event = e.target.value || undefined; })} /></label>
              </div>
            ))}
            <button className="lx-btn danger" disabled={cur.start === node.id} onClick={() => { change('Delete line', (d) => { d.nodes = d.nodes.filter((x) => x.id !== node.id); for (const x of d.nodes) { if (x.next === node.id) x.next = undefined; for (const c of x.choices) if (c.to === node.id) c.to = undefined; } }); setSel(null); }}>Delete line</button>
          </div>
        ) : <div className="lx-insp"><p className="lx-doc">Select a line to edit its speaker, text, choices and effects. Lines can share a target, so branches rejoin.</p></div>}
      </div>
    </div>
  );
}
