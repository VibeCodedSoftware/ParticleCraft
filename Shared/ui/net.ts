// Peer-to-peer connection for online play (WebRTC data channels, no game server). Quick join: the host opens a
// room and sends one short code; friends type it and are in. Two-code mode (no relay at all): the host's invite
// code, then the joiner's reply code, sent to each other by chat, email…
// A public STUN server is asked for each player's public address so games work across the internet;
// on the same network (LAN) the players connect directly.

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const PREFIX = 'CRAFT1.';

/**
 * A game's own servers (Project settings › Multiplayer), instead of or on top of the public ones: signaling
 * trackers (wss://… WebTorrent-tracker compatible, e.g. a self-hosted bittorrent-tracker) and STUN / TURN relays
 * (TURN carries the game for players whose routers block direct connections). Nothing private is built in: TURN
 * credentials are the game maker's own, and like anything in a web game they are visible to players, so use
 * short-lived or limited ones.
 */
export interface NetConfig { trackers?: string[]; iceServers?: RTCIceServer[]; /** Keep the public trackers / STUN too (default true). */ keepPublic?: boolean }
let config: NetConfig = {};
export function setNetConfig(c: NetConfig | undefined) { config = c ?? {}; }
const ice = (): RTCConfiguration => ({ iceServers: [...(config.keepPublic === false ? [] : DEFAULT_ICE), ...(config.iceServers ?? [])] });
const trackers = () => [...(config.trackers ?? []).filter((u) => /^wss?:\/\//i.test(u)), ...(config.keepPublic === false && config.trackers?.length ? [] : TRACKERS)];

async function pack(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = bytes;
  if (typeof CompressionStream !== 'undefined') out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
  return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack<T>(code: string): Promise<T> {
  const s = code.trim();
  if (!s.startsWith(PREFIX)) throw new Error('This is not a GameCraft join code.');
  const b64 = s.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (typeof DecompressionStream !== 'undefined') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Resolves when the connection has collected its network addresses (or after a few seconds). */
function gathered(pc: RTCPeerConnection, ms = 4000) {
  return new Promise<void>((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}

interface Invite { k: 'invite'; slot: number; sdp: RTCSessionDescriptionInit }
interface Reply { k: 'reply'; slot: number; sdp: RTCSessionDescriptionInit }

// ---- Quick join. The games find each other through public WebTorrent trackers (the matchmaking servers browsers
// use to start peer-to-peer connections): the room is named after the code, the joiner sends its connection offer
// there and the host answers. The trackers only pass those two messages along; the game runs directly between players.
const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://tracker.files.fm:7073/announce'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** A new 6-character join code. */
export function roomCode() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(r, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
/** What the player typed or pasted, as a code: spaces, dashes and case ignored. */
export function normalizeCode(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/** 20 random printable characters (tracker peer and offer ids). */
function randomId() { return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => String.fromCharCode(48 + (b % 75))).join(''); }
/** The room's tracker id: 20 bytes (SHA-1) of the code. */
async function roomHash(code: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode('gamecraft-room:' + code)));
  return Array.from(h, (b) => String.fromCharCode(b)).join('');
}

interface TrackerMsg { action?: string; info_hash?: string; peer_id?: string; offer_id?: string; offer?: { sdp: string }; answer?: { sdp: string }; complete?: number; incomplete?: number; 'failure reason'?: string }

/** Connections to every tracker for one room; announces itself on each (again every 50 s, reconnecting if dropped). */
export class Room {
  readonly peerId = randomId();
  onMessage?: (m: TrackerMsg, ws: WebSocket) => void;
  private socks = new Set<WebSocket>();
  private closed = false;
  private beat = 0;
  constructor(readonly hash: string, private hello: Record<string, unknown>) {}

  /** Resolves when at least one tracker is connected. */
  open(ms = 8000) {
    const list = trackers();
    return new Promise<void>((res, rej) => {
      let failed = 0;
      const t = setTimeout(() => rej(new Error('Could not reach the multiplayer service. Check the internet connection.')), ms);
      const connect = (url: string, first: boolean) => {
        let ws: WebSocket;
        try { ws = new WebSocket(url); } catch { if (first && ++failed === list.length) { clearTimeout(t); rej(new Error('Could not reach the multiplayer service. Check the internet connection.')); } return; }
        let opened = false;
        ws.onopen = () => { opened = true; this.socks.add(ws); this.send(ws, { event: 'started', ...this.hello }); clearTimeout(t); res(); };
        ws.onmessage = (e) => { let m: TrackerMsg; try { m = JSON.parse(e.data); } catch { return; } if (m.info_hash === this.hash) this.onMessage?.(m, ws); };
        ws.onclose = () => {
          this.socks.delete(ws);
          if (!opened && first && ++failed === list.length) { clearTimeout(t); rej(new Error('Could not reach the multiplayer service. Check the internet connection.')); }
          if (opened && !this.closed) setTimeout(() => { if (!this.closed) connect(url, false); }, 5000);
        };
      };
      for (const u of list) connect(u, true);
      this.beat = setInterval(() => { for (const ws of this.socks) this.send(ws, this.hello); }, 50000) as any;
    });
  }
  send(ws: WebSocket, extra: Record<string, unknown>) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ action: 'announce', info_hash: this.hash, peer_id: this.peerId, numwant: 10, uploaded: 0, downloaded: 0, left: 1, offers: [], ...extra }));
  }
  close() {
    this.closed = true; clearInterval(this.beat);
    for (const ws of this.socks) { this.send(ws, { event: 'stopped' }); try { ws.close(); } catch { /* closed */ } }
    this.socks.clear();
  }
}

export interface NetPeer { slot: number; pc: RTCPeerConnection; ch: RTCDataChannel | null; connected: boolean }

/** The player who runs the game. Invite up to 3 others (they become players 2-4). */
export class NetHost {
  peers: NetPeer[] = [];
  onJoin?: (slot: number) => void;
  onLeave?: (slot: number) => void;
  onMessage?: (slot: number, msg: any) => void;

  freeSlot() { for (let s = 2; s <= 4; s++) if (!this.peers.some((p) => p.slot === s)) return s; return 0; }

  /** A new connection for the next free player slot. */
  private newPeer(): NetPeer {
    const slot = this.freeSlot();
    if (!slot) throw new Error('The game is full (4 players).');
    const pc = new RTCPeerConnection(ice());
    const peer: NetPeer = { slot, pc, ch: null, connected: false };
    this.peers.push(peer);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(peer); };
    // A connection that never opens frees its slot again.
    setTimeout(() => { if (!peer.connected) this.drop(peer); }, 60000);
    return peer;
  }

  private wire(peer: NetPeer, ch: RTCDataChannel) {
    peer.ch = ch;
    const open = () => { if (peer.connected) return; peer.connected = true; ch.send(JSON.stringify({ t: 'hello', slot: peer.slot })); this.onJoin?.(peer.slot); };
    ch.onopen = open;
    ch.onclose = () => this.drop(peer);
    ch.onmessage = (e) => { try { this.onMessage?.(peer.slot, JSON.parse(e.data)); } catch { /* ignore bad packets */ } };
    if (ch.readyState === 'open') open();
  }

  /** A new invite code for the next free player slot (two-code mode). */
  async invite(): Promise<{ slot: number; code: string }> {
    const peer = this.newPeer(), pc = peer.pc;
    this.wire(peer, pc.createDataChannel('game', { ordered: false, maxRetransmits: 2 }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { slot: peer.slot, code: await pack({ k: 'invite', slot: peer.slot, sdp: pc.localDescription!.toJSON() } satisfies Invite) };
  }

  /** Finish connecting with the reply code the joining player sent back. */
  async accept(code: string) {
    const r = await unpack<Reply>(code);
    if (r.k !== 'reply') throw new Error('That is an invite code - paste the reply code your friend sent back.');
    const peer = this.peers.find((p) => p.slot === r.slot && !p.connected);
    if (!peer) throw new Error(`No open invite for player ${r.slot}. Make a new invite.`);
    await peer.pc.setRemoteDescription(r.sdp);
  }

  // ---- quick join: one short code
  /** The code friends type to join (while the room is open). */
  room: string | null = null;
  private tracker: Room | null = null;
  private knocks = new Set<string>();

  /** Open a room: friends with the same game join by typing its short code. */
  async openRoom(game: string): Promise<string> {
    if (this.room && this.tracker) return this.room;
    const code = roomCode(), room = new Room(await roomHash(code), {});
    room.onMessage = (m, ws) => { if (m.offer && m.offer_id && m.peer_id) void this.knock(room, m, ws, game); };
    await room.open();
    this.tracker = room; this.room = code;
    return code;
  }

  /** A friend's game asks to join: answer with this side of the connection (or why not). */
  private async knock(room: Room, m: TrackerMsg, ws: WebSocket, game: string) {
    let k: any; try { k = JSON.parse(m.offer!.sdp); } catch { return; }
    if (k?.k !== 'knock' || !k.n || this.knocks.has(k.n)) return;
    this.knocks.add(k.n);
    const reply = (body: unknown) => room.send(ws, { to_peer_id: m.peer_id, offer_id: m.offer_id, answer: { type: 'answer', sdp: JSON.stringify(body) } });
    if (k.game !== game) return reply({ k: 'refuse', why: 'That code is for a different game. Both players need the same game.' });
    if (!this.freeSlot()) return reply({ k: 'refuse', why: 'That game is full (4 players).' });
    const peer = this.newPeer(), pc = peer.pc;
    pc.ondatachannel = (e) => this.wire(peer, e.channel);
    await pc.setRemoteDescription(k.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    reply({ k: 'welcome', sdp: pc.localDescription });
  }

  closeRoom() { this.tracker?.close(); this.tracker = null; this.room = null; }

  broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const p of this.peers) if (p.connected && p.ch?.readyState === 'open' && p.ch.bufferedAmount < 1 << 20) p.ch.send(s);
  }

  private drop(peer: NetPeer) {
    if (!this.peers.includes(peer)) return;
    this.peers = this.peers.filter((p) => p !== peer);
    try { peer.pc.close(); } catch { /* closed */ }
    if (peer.connected) this.onLeave?.(peer.slot);
  }

  close() { this.closeRoom(); for (const p of [...this.peers]) this.drop(p); }
}

/** A player who joins someone else's game. */
export class NetClient {
  pc: RTCPeerConnection | null = null;
  ch: RTCDataChannel | null = null;
  slot = 0;
  onOpen?: (slot: number) => void;
  onClose?: () => void;
  onMessage?: (msg: any) => void;

  private wire(ch: RTCDataChannel) {
    this.ch = ch;
    ch.onmessage = (m) => { let msg: any; try { msg = JSON.parse(m.data); } catch { return; } if (msg.t === 'hello') { this.slot = msg.slot; this.onOpen?.(msg.slot); } else this.onMessage?.(msg); };
    ch.onclose = () => this.onClose?.();
  }

  /** Turn the host's invite code into the reply code to send back (two-code mode). */
  async join(invite: string): Promise<string> {
    const r = await unpack<Invite>(invite);
    if (r.k !== 'invite') throw new Error('That is a reply code - paste the invite code from the host.');
    const pc = new RTCPeerConnection(ice());
    this.pc = pc; this.slot = r.slot;
    pc.ondatachannel = (e) => this.wire(e.channel);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.onClose?.(); };
    await pc.setRemoteDescription(r.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return pack({ k: 'reply', slot: r.slot, sdp: pc.localDescription!.toJSON() } satisfies Reply);
  }

  /** Join a friend's room by its short code. Resolves once connected (onOpen has fired). */
  async joinRoom(code: string, game: string, timeoutMs = 25000): Promise<void> {
    const c = normalizeCode(code);
    if (c.length !== 6) throw new Error('Type or paste the 6-character code your friend sent you.');
    const pc = new RTCPeerConnection(ice());
    this.pc = pc;
    this.wire(pc.createDataChannel('game', { ordered: false, maxRetransmits: 2 }));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.onClose?.(); };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    // The same knock under a few offer ids: each tracker hands each one to a different player in the room.
    const knock = { type: 'offer', sdp: JSON.stringify({ k: 'knock', n: randomId(), game, sdp: pc.localDescription }) };
    const ids = [randomId(), randomId(), randomId()];
    const room = new Room(await roomHash(c), { offers: ids.map((offer_id) => ({ offer_id, offer: knock })) });
    let others = 0, answered = false;
    try {
      await new Promise<void>((res, rej) => {
        const done = (e?: Error) => { clearTimeout(t); clearTimeout(empty); e ? rej(e) : res(); };
        const t = setTimeout(() => done(new Error('Could not connect. Check the code and that your friend\'s game is still open.')), timeoutMs);
        // Nobody else in the room after a few seconds: no game has that code.
        const empty = setTimeout(() => { if (!others && !answered) done(new Error(`No game is open with the code ${c}. Check the code with your friend.`)); }, 6000);
        const prev = this.onOpen;
        this.onOpen = (slot) => { this.onOpen = prev; done(); prev?.(slot); };
        room.onMessage = async (m) => {
          if (m.complete !== undefined || m.incomplete !== undefined) others = Math.max(others, (m.complete ?? 0) + (m.incomplete ?? 0) - 1);
          if (!m.answer || !ids.includes(m.offer_id ?? '') || answered) return;
          let body: any; try { body = JSON.parse(m.answer.sdp); } catch { return; }
          answered = true;
          if (body.k === 'refuse') return done(new Error(body.why));
          if (body.k === 'welcome') { try { await pc.setRemoteDescription(body.sdp); } catch (e: any) { done(e); } }
        };
        room.open().catch(done);
      });
    } catch (e) { this.close(); throw e; }
    finally { room.close(); }
  }

  send(msg: unknown) { if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(msg)); }
  close() { try { this.pc?.close(); } catch { /* closed */ } this.pc = null; this.ch = null; }
}
