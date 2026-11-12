// Online play: Create a game (friends join with one short code) or Join a friend's. Two-code mode (no relay)
// is kept under "Other ways to connect". Characters whose Controls are online2-4 are driven by players 2-4.
// Used by the editor, exported games and the "Show multiplayer menu" block.
import React, { useEffect, useState } from 'react';
import { Icon } from '@shared/ui/icons';
import { NetClient, normalizeCode } from '@shared/ui/net';
import type { PlaySession } from '../engine/play';
import { Modal } from './ui';

/** Ask the editor / exported player to show the multiplayer menu (used by the "Show multiplayer menu" block). */
export const OPEN_MULTIPLAYER = 'gc-open-multiplayer';

type Props = { gameId: string; getSession: () => PlaySession | null; startPlay: () => void; join: (c: NetClient) => void; onClose: () => void };

export function OnlineDialog(props: Props) {
  const { gameId, getSession, startPlay, join, onClose } = props;
  const [step, setStep] = useState<'choose' | 'create' | 'join' | 'advanced'>(() => (getSession()?.netHost?.room ? 'create' : 'choose'));
  const [code, setCode] = useState(getSession()?.netHost?.room ?? '');
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  const players = getSession()?.netHost?.peers.filter((p) => p.connected) ?? [];
  const run = async (fn: () => Promise<void>) => { setBusy(true); setStatus(''); try { await fn(); } catch (e: any) { setStatus('Error: ' + (e?.message ?? e)); } setBusy(false); };
  const copy = (s: string) => { navigator.clipboard?.writeText(s).then(() => setStatus('Copied - send it to your friend.')).catch(() => setStatus('Select the code and copy it (Ctrl+C).')); };

  const create = () => run(async () => {
    setStep('create');
    let ses = getSession();
    if (!ses || ses.netClient) { startPlay(); await new Promise((r) => setTimeout(r, 50)); ses = getSession(); }
    if (!ses) throw new Error('Could not start the game.');
    setCode(await ses.host().openRoom(gameId));
  });
  const joinNow = () => run(async () => {
    const c = new NetClient();
    c.onOpen = () => { join(c); onClose(); };
    setStatus('Connecting…');
    await c.joinRoom(typed, gameId);
  });
  const done = () => { getSession()?.startedHosting(); onClose(); };

  return (
    <Modal title="Multiplayer" onClose={onClose}>
      {step === 'choose' && <>
        <div className="mp-choice">
          <button className="btn primary big" onClick={create}><Icon name="play" size={14} /> Create</button>
          <button className="btn big" onClick={() => setStep('join')}><Icon name="globe" size={14} /> Join</button>
        </div>
        <p className="hint">Up to 4 players. Everyone needs a copy of this game.</p>
      </>}
      {step === 'create' && <>
        <h4>Send this code to your friend</h4>
        <div className="mp-code">{code || (busy ? '…' : '')}</div>
        <div className="btn-row">
          <button className="btn" disabled={!code} onClick={() => copy(code)}>Copy code</button>
          <span className="dim">{players.length ? `Joined: ${players.map((p) => 'player ' + p.slot).join(', ')}` : 'Waiting for friends…'}</span>
        </div>
        <div className="btn-row right"><button className="btn primary" disabled={!code} onClick={done}>Continue</button></div>
      </>}
      {step === 'join' && <>
        <h4>Type or paste your friend's code</h4>
        <input className="txt mp-input" autoFocus maxLength={12} value={typed} placeholder="ABC123" onChange={(e) => setTyped(normalizeCode(e.target.value))}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && typed.length === 6 && !busy) joinNow(); }} />
        <div className="btn-row right">
          <button className="btn" onClick={() => { setStep('choose'); setStatus(''); }}>Back</button>
          <button className="btn primary" disabled={busy || typed.length !== 6} onClick={joinNow}>Continue</button>
        </div>
      </>}
      {step === 'advanced' && <TwoCodes {...props} />}
      {status && <div className={status.startsWith('Error') ? 'warn' : 'hint'}>{status}</div>}
      {step !== 'advanced' && <p className="hint small">The code is passed between the games by a free public matchmaking service (PeerJS); the game itself runs directly between the players. {getSession()?.rt.doc.multiplayer ? 'Each friend who joins gets their own character.' : <>Give the other players' characters Controls <b>online2</b>-<b>online4</b>.</>} <a href="#" onClick={(e) => { e.preventDefault(); setStep('advanced'); setStatus(''); }}>Other ways to connect</a></p>}
    </Modal>
  );
}

/** Connect with no matchmaking service: the host's invite code, then the joiner's reply code. */
function TwoCodes({ getSession, startPlay, join }: Props) {
  const [tab, setTab] = useState<'host' | 'join'>('host');
  const [invite, setInvite] = useState<{ slot: number; code: string } | null>(null);
  const [reply, setReply] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [myReply, setMyReply] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  const ses = getSession();
  const hosting = ses?.netHost;
  const players = hosting?.peers ?? [];
  const run = async (fn: () => Promise<void>) => { setBusy(true); setStatus(''); try { await fn(); } catch (e: any) { setStatus('Error: ' + (e?.message ?? e)); } setBusy(false); };
  const copy = (s: string) => { navigator.clipboard?.writeText(s).then(() => setStatus('Copied - send it to your friend.')).catch(() => setStatus('Select the code and copy it (Ctrl+C).')); };

  return <>
    <div className="seg wide"><button className={tab === 'host' ? 'on' : ''} onClick={() => setTab('host')}>Host a game</button><button className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>Join a game</button></div>
    <p className="hint">Two-code mode works without the matchmaking service: the host sends an invite code, the friend sends a reply code back. Connections are direct between players; a public address-lookup (STUN) server helps them find each other across the internet.</p>
    {tab === 'host' && <>
      {!ses || ses.netClient ? (
        <div className="btn-row"><button className="btn primary" onClick={() => { startPlay(); setTimeout(() => tick((n) => n + 1), 50); }}><Icon name="play" size={12} /> Start the game to host</button></div>
      ) : <>
        <div className="btn-row">
          <button className="btn primary" disabled={busy} onClick={() => run(async () => { const inv = await ses.host().invite(); setInvite(inv); setReply(''); })}>{invite ? 'New invite' : 'Create an invite'}</button>
          <span className="dim">{players.filter((p) => p.connected).length ? `Connected: ${players.filter((p) => p.connected).map((p) => 'player ' + p.slot).join(', ')}` : 'Nobody has joined yet.'}</span>
        </div>
        {invite && <>
          <h4>1. Send this invite code to player {invite.slot}</h4>
          <textarea className="txt mono code-box" readOnly value={invite.code} onFocus={(e) => e.target.select()} />
          <div className="btn-row"><button className="btn" onClick={() => copy(invite.code)}>Copy invite</button></div>
          <h4>2. Paste the reply code they send back</h4>
          <textarea className="txt mono code-box" value={reply} placeholder="CRAFT1.…" onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="btn-row"><button className="btn primary" disabled={busy || !reply.trim()} onClick={() => run(async () => { await hosting!.accept(reply); setStatus(`Connecting player ${invite.slot}…`); })}>Connect</button></div>
        </>}
      </>}
    </>}
    {tab === 'join' && <>
      <h4>1. Paste the invite code from the host</h4>
      <textarea className="txt mono code-box" value={joinCode} placeholder="CRAFT1.…" onChange={(e) => setJoinCode(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="btn-row"><button className="btn primary" disabled={busy || !joinCode.trim()} onClick={() => run(async () => {
        const c = new NetClient();
        c.onOpen = (slot) => { setStatus(`Connected as player ${slot}`); join(c); };
        setMyReply(await c.join(joinCode));
      })}>Create reply</button></div>
      {myReply && <>
        <h4>2. Send this reply code back to the host</h4>
        <textarea className="txt mono code-box" readOnly value={myReply} onFocus={(e) => e.target.select()} />
        <div className="btn-row"><button className="btn" onClick={() => copy(myReply)}>Copy reply</button><span className="dim">Waiting for the host to connect…</span></div>
      </>}
    </>}
    {status && <div className={status.startsWith('Error') ? 'warn' : 'hint'}>{status}</div>}
  </>;
}
