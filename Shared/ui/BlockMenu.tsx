// Searchable "add block" popup used by the node graph and logic-brick editors.
import React, { useEffect, useRef, useState } from 'react';
import { BLOCK_LIST, CATEGORIES, type BlockDef } from '../src/blocks/definitions';
import type { AppId } from '../src/schema';

export function BlockMenu({ x, y, app, title, filter, onPick, onClose }: {
  x: number; y: number; app: AppId; title: string;
  filter: (d: BlockDef) => boolean; onPick: (d: BlockDef) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', out, true); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const ql = q.trim().toLowerCase();
  const fits = BLOCK_LIST.filter((d) => d.apps.includes(app) && filter(d) && (!ql || (d.name + ' ' + d.doc + ' ' + d.id).toLowerCase().includes(ql)));
  const groups = CATEGORIES.map((c) => ({ c, list: fits.filter((d) => d.category === c.id) })).filter((g) => g.list.length);
  return (
    <div className="bc-att" ref={ref} style={{ left: Math.min(x, window.innerWidth - 330), top: Math.min(y, window.innerHeight - 420) }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bc-att-head">{title}</div>
      <input className="lx-input search" autoFocus placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && fits[0]) onPick(fits[0]); }} />
      <div className="bc-att-list">
        {groups.map((g) => (
          <React.Fragment key={g.c.id}>
            <div className="bc-att-cat"><span style={{ background: g.c.color }} />{g.c.name}</div>
            {g.list.map((d) => (
              <button key={d.id} className="bc-att-item" title={d.doc} onClick={() => onPick(d)}>
                <span className={'bc-att-chip ' + (d.kind === 'condition' ? 'cond' : 'act')} style={{ background: g.c.color }} />
                <span className="bc-att-name">{d.trigger ? 'When ' : ''}{d.name}</span>
              </button>
            ))}
          </React.Fragment>
        ))}
        {!fits.length && <div className="bc-att-none">Nothing matches "{q}".</div>}
      </div>
    </div>
  );
}
