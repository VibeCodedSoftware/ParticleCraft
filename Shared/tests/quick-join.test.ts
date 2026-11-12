// Quick multiplayer: the host opens a room and gets a short code; a friend types it and is connected (through a
// stand-in for the public trackers and fake peer connections); wrong game / unknown code give clear errors.
// The Start screen preset gets a Multiplayer button (GameCraft only, can be turned off).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetClient, NetHost, normalizeCode, roomCode } from '../ui/net';
import { PACKS, packDefaults } from '../src/packs';
import { walkEvents } from '../src/schema';

// ---- WebTorrent-style trackers: peers announce into a room (info_hash); each offer goes to one other peer in it,
// an answer goes back to the peer it is addressed to; every announce is answered with the room's size.
const swarms = new Map<string, Set<FakeWS>>();
class FakeWS {
  readyState = 0; onmessage?: (e: { data: string }) => void; onopen?: () => void; onclose?: () => void; peer = '';
  constructor(private url: string) { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 1); }
  recv(m: unknown) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), 1); }
  send(s: string) {
    const m = JSON.parse(s), key = this.url + m.info_hash;
    const sw = swarms.get(key) ?? new Set<FakeWS>(); swarms.set(key, sw);
    this.peer = m.peer_id;
    if (m.event === 'stopped') { sw.delete(this); return; }
    sw.add(this);
    const base = { action: 'announce', info_hash: m.info_hash };
    if (m.answer) return [...sw].find((w) => w.peer === m.to_peer_id)?.recv({ ...base, peer_id: m.peer_id, answer: m.answer, offer_id: m.offer_id });
    this.recv({ ...base, complete: 0, incomplete: sw.size, interval: 120 });
    const others = [...sw].filter((w) => w !== this);
    (m.offers ?? []).forEach((o: any, i: number) => others[i]?.recv({ ...base, peer_id: m.peer_id, offer: o.offer, offer_id: o.offer_id }));
  }
  close() { for (const sw of swarms.values()) sw.delete(this); this.readyState = 3; }
}

// ---- peer connections that link up when the offering side receives the answer
const answers = new Map<string, FakePC>();
let n = 0;
class FakeCh { readyState = 'connecting'; bufferedAmount = 0; other?: FakeCh; onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void;
  send(s: string) { setTimeout(() => this.other?.onmessage?.({ data: s }), 0); } }
class FakePC {
  iceGatheringState = 'complete'; connectionState = 'new'; localDescription: any = null; remoteDescription: any = null; ch?: FakeCh;
  ondatachannel?: (e: { channel: FakeCh }) => void; onconnectionstatechange?: () => void;
  addEventListener() { /* gathering is instant */ }
  createDataChannel() { return (this.ch = new FakeCh()); }
  async createOffer() { return { type: 'offer', sdp: 'o' + ++n }; }
  async createAnswer() { const sdp = this.remoteDescription.sdp + '-a'; answers.set(sdp, this); return { type: 'answer', sdp }; }
  async setLocalDescription(d: any) { this.localDescription = d; }
  async setRemoteDescription(d: any) {
    this.remoteDescription = d;
    if (d.type !== 'answer') return;
    const other = answers.get(d.sdp)!, a = this.ch!, b = new FakeCh(); a.other = b; b.other = a;
    other.ondatachannel?.({ channel: b });
    a.readyState = b.readyState = 'open'; a.onopen?.(); b.onopen?.();
  }
  close() { /* closed */ }
}

beforeEach(() => { (globalThis as any).WebSocket = FakeWS; (globalThis as any).RTCPeerConnection = FakePC; });
afterEach(() => { swarms.clear(); answers.clear(); });

describe('quick join with one code', () => {
  it('codes are 6 easy-to-read characters; typing ignores case, spaces and dashes', () => {
    for (let k = 0; k < 50; k++) expect(roomCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizeCode(' ab3-k9q ')).toBe('AB3K9Q');
  });
  it('Create gives a code; Join with it connects as player 2, then player 3', async () => {
    const host = new NetHost(); const joined: number[] = [];
    host.onJoin = (s) => joined.push(s);
    const code = await host.openRoom('game-1');
    expect(code).toHaveLength(6);
    const c = new NetClient(); let opened = 0;
    c.onOpen = (s) => { opened = s; };
    await c.joinRoom(code.toLowerCase(), 'game-1');
    expect(opened).toBe(2); expect(joined).toEqual([2]);
    // the game runs over the direct connection
    const got: any[] = []; c.onMessage = (m) => got.push(m);
    host.broadcast({ t: 'snap', s: 1 }); await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual([{ t: 'snap', s: 1 }]);
    const c2 = new NetClient(); await c2.joinRoom(code, 'game-1');
    expect(c2.slot).toBe(3); expect(joined).toEqual([2, 3]);
    host.close(); expect(host.room).toBeNull();
  });
  it('a wrong code or a different game says so', async () => {
    const host = new NetHost(); const code = await host.openRoom('game-1');
    await expect(new NetClient().joinRoom('ZZZZZZ', 'game-1')).rejects.toThrow(/No game is open with the code ZZZZZZ/);
    await expect(new NetClient().joinRoom(code, 'other-game')).rejects.toThrow(/different game/);
    await expect(new NetClient().joinRoom('AB', 'game-1')).rejects.toThrow(/6-character/);
  }, 15000);
});

describe('Start screen Multiplayer button', () => {
  const pk = PACKS.find((p) => p.id === 'menu.start')!;
  const blocks = (r: ReturnType<typeof pk.build>) => { const ids: string[] = []; walkEvents(r.events, (e) => { if (e.kind === 'event') for (const b of [...e.conditions, ...e.actions]) ids.push(b.block); }); return ids; };
  it('GameCraft: a Multiplayer button that opens the menu; hosting starts the game', () => {
    const r = pk.build(packDefaults(pk), { app: 'gamecraft', mode: '3d' });
    expect(r.objects!.some((o: any) => o.type === 'MultiplayerButton' || o.name === 'MultiplayerButton')).toBe(true);
    expect(blocks(r)).toEqual(expect.arrayContaining(['net.show_menu', 'net.on_hosting']));
  });
  it('can be turned off, and LogicCraft never gets it', () => {
    expect(blocks(pk.build({ ...packDefaults(pk), multiplayer: false }, { app: 'gamecraft', mode: '3d' }))).not.toContain('net.show_menu');
    expect(blocks(pk.build(packDefaults(pk), { app: 'logiccraft', mode: '2d' }))).not.toContain('net.show_menu');
  });
});
