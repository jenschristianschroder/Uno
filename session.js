import {lobby, addPlayer, start, act, view, playable} from './engine.js';
import {PEER_OPTIONS} from './config.js';
export const PREFIX = 'lastcard-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode() { return Array.from(crypto.getRandomValues(new Uint8Array(8)), n => ALPHABET[n % 32]).join(''); }
export function normalizeCode(value) { return String(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
export function validCode(value) { return /^[A-HJ-NP-Z2-9]{8}$/.test(value); }
const cleanName = value => String(value || 'Player').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,20) || 'Player';
const STORE = 'lastcard-v1';
export function readLocal(key) { try { return JSON.parse(localStorage.getItem(`${STORE}:${key}`)); } catch { return null; } }
export function saveLocal(key, value) { try { localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value)); return true; } catch { return false; } }
export function eraseLocal() { for (const key of Object.keys(localStorage)) if (key.startsWith(STORE + ':')) localStorage.removeItem(key); }
export class Session {
  constructor({onView, onStatus, onError, PeerClass = globalThis.Peer}) {
    Object.assign(this, {onView, onStatus, onError, PeerClass});
    this.links = new Map(); this.seen = new Map(); this.disposed = false;
    this.profile = readLocal('profile') || {token:crypto.randomUUID()};
    if (!saveLocal('profile', this.profile)) onError('Device storage is unavailable. Rejoining after a refresh may not work.');
  }
  persist() {
    if (this.practice) return;
    const ok = saveLocal('session', {code:this.code, role:this.host?'host':'guest', id:this.id});
    if (this.host && !saveLocal('host', {code:this.code, state:this.state, credentials:this.credentials, hostId:this.id})) this.onError('This phone could not save the round. Keep this tab open.');
    else if (!ok) this.onError('This phone could not save your seat.');
  }
  async openPeer(id) {
    if (!this.PeerClass) throw Error('Connection library failed to load. Reload the page.');
    this.onStatus('Connecting…');
    const peer = this.peer = new this.PeerClass(id, PEER_OPTIONS);
    peer.on('connection', conn => {
      if (!this.host) { conn.close(); return; }
      this.accept(conn);
    });
    peer.on('disconnected', () => {
      if (this.disposed) return;
      this.onStatus('Reconnecting to room service…');
      if (!peer.destroyed) { try { peer.reconnect(); } catch {} }
    });
    return new Promise((resolve,reject) => {
      let opened = false;
      const timer = setTimeout(() => { if (!opened) { peer.destroy(); reject(Error('Connection timed out. Check your internet and try again.')); } },15000);
      peer.on('open', () => { opened = true; clearTimeout(timer); resolve(); });
      peer.on('error', error => {
        const messages = {'unavailable-id':'This room is already open on another tab. Close that tab before restoring it.', 'peer-unavailable':'Host not found. Ask them to reopen the room, then reconnect.', 'network':'Could not reach the connection service. Check your internet.'};
        const e = Error(messages[error.type] || 'Connection interrupted. Try reconnecting; this network may need a TURN relay.');
        if (!opened) { clearTimeout(timer); reject(e); } else this.onError(e.message);
      });
    });
  }
  async create(name, resume = false) {
    this.host = true;
    const saved = resume && readLocal('host');
    if (saved?.state?.version === 1) {
      Object.assign(this,{code:saved.code, state:saved.state, credentials:saved.credentials, id:saved.hostId});
    } else {
      this.code = roomCode(); this.id = crypto.randomUUID(); this.state = lobby(this.id,cleanName(name)); this.credentials = {};
    }
    await this.openPeer(PREFIX + this.code);
    this.persist(); this.onStatus('Room open'); this.broadcast(); this.heartbeat();
  }
  async join(code, name) {
    this.code = normalizeCode(code); this.name = cleanName(name); this.host = false;
    if (!validCode(this.code)) throw Error('Enter the 8-character room code.');
    await this.openPeer(); this.connectHost(); this.heartbeat();
  }
  connectHost() {
    if (this.disposed || this.conn?.open || this.connecting) return;
    this.connecting = true; this.onStatus('Finding your table…');
    const conn = this.conn = this.peer.connect(PREFIX + this.code, {reliable:true, serialization:'json'});
    const timeout = setTimeout(() => {
      if (!conn.open) { this.connecting = false; conn.close(); this.onStatus('Connection failed'); this.onError('Could not connect. Keep both phones on this page and try again. Some mobile networks require a TURN relay.'); }
    },15000);
    conn.on('open', () => { clearTimeout(timeout); this.connecting = false; this.lastHost = Date.now(); conn.send({type:'hello', token:this.profile.token, name:this.name}); });
    conn.on('data', data => {
      this.lastHost = Date.now();
      if (data?.type === 'view') { this.id = data.id; this.persist(); this.onStatus('Connected'); this.onView(data.view, this.info()); }
      if (data?.type === 'error') this.onError(data.message);
      if (data?.type === 'pong') this.onStatus('Connected');
    });
    conn.on('close', () => { clearTimeout(timeout); this.connecting = false; if (!this.disposed && this.conn === conn) this.onStatus('Disconnected — tap Reconnect'); });
    conn.on('error', () => { this.connecting = false; if (!this.disposed) this.onStatus('Disconnected — tap Reconnect'); });
  }
  accept(conn) {
    let id = null, count = 0, period = Date.now();
    const helloTimeout = setTimeout(() => { if (!id) conn.close(); },10000);
    conn.on('data', data => {
      if (Date.now() - period > 1000) { count = 0; period = Date.now(); }
      if (++count > 30 || !data || typeof data !== 'object') { conn.close(); return; }
      try {
        if (data.type === 'hello') {
          if (id) return;
          if (typeof data.token !== 'string' || !/^[\da-f-]{36}$/i.test(data.token)) throw Error('Invalid seat token.');
          id = this.credentials[data.token];
          if (!id) {
            id = crypto.randomUUID(); this.state = addPlayer(this.state,id,cleanName(data.name)); this.credentials[data.token] = id;
          }
          const old = this.links.get(id); this.links.set(id,conn); old?.close(); clearTimeout(helloTimeout);
          this.seen.set(id,Date.now()); this.persist(); this.broadcast();
        } else if (id && this.links.get(id) === conn) {
          this.seen.set(id,Date.now());
          if (data.type === 'ping') { conn.send({type:'pong'}); this.broadcast(); }
          if (data.type === 'action') this.dispatch(id,data.action);
        }
      } catch (e) { if (conn.open) conn.send({type:'error',message:e.message}); }
    });
    conn.on('close', () => { clearTimeout(helloTimeout); if (id && this.links.get(id) === conn) { this.links.delete(id); this.broadcast(); } });
    conn.on('error', () => { if (id && this.links.get(id) === conn) { this.links.delete(id); this.broadcast(); } });
  }
  online() { return [this.id, ...[...this.links].filter(([id,c]) => c.open && Date.now() - this.seen.get(id) < 12000).map(([id])=>id)]; }
  allHere() { return this.practice || this.state.players.every(p => this.online().includes(p.id)); }
  info() { return {id:this.id, code:this.code, host:this.host, practice:this.practice}; }
  broadcast() {
    if (!this.host || this.disposed) return;
    const online = this.practice ? this.state.players.map(p=>p.id) : this.online();
    this.onView(view(this.state,this.id,online),this.info());
    for (const [id,conn] of this.links) if (conn.open) {
      try { conn.send({type:'view',id,view:view(this.state,id,online)}); } catch {}
    }
  }
  dispatch(id, action) {
    if (!this.allHere()) throw Error('Waiting for everyone to reconnect.');
    this.state = act(this.state,id,action); this.persist(); this.broadcast(); this.botMove();
  }
  send(action) {
    try {
      if (this.host) this.dispatch(this.id,action);
      else if (this.conn?.open) this.conn.send({type:'action',action});
      else throw Error('Reconnect to the host before playing.');
    } catch (e) { this.onError(e.message); }
  }
  startRound() {
    try {
      if (!this.host) throw Error('Only the host can deal.');
      if (!this.allHere()) throw Error('Wait for every player to reconnect.');
      this.state = start(this.state); this.persist(); this.broadcast(); this.botMove();
    } catch (e) { this.onError(e.message); }
  }
  solo(name) {
    this.host = true; this.practice = true; this.id = 'you'; this.code = 'PRACTICE';
    this.state = addPlayer(addPlayer(lobby('you',cleanName(name)),'bot-1','Cleo'),'bot-2','Jules');
    this.onStatus('Practice · offline'); this.startRound();
  }
  botMove() {
    clearTimeout(this.botTimer);
    if (!this.practice || this.state.phase !== 'playing') return;
    const p = this.state.players[this.state.turn]; if (p.id === this.id) return;
    this.botTimer = setTimeout(() => {
      const s = this.state;
      const card = p.hand.find(c => playable(s,c,p.hand) && (s.drawn === null || s.drawn === c.id));
      const action = card ? {type:'play',cardId:card.id,color:['red','yellow','green','blue'].sort((a,b)=>p.hand.filter(c=>c.color===b).length-p.hand.filter(c=>c.color===a).length)[0],uno:true} : {type:s.drawn === null?'draw':'pass'};
      this.dispatch(p.id,{...action,revision:s.revision});
    },850);
  }
  heartbeat() {
    this.interval = setInterval(() => {
      if (this.host) this.broadcast();
      else if (this.conn?.open) {
        try { this.conn.send({type:'ping'}); } catch {}
        if (Date.now() - this.lastHost > 12000) this.onStatus('Host is away — waiting…');
      }
    },3000);
  }
  reconnect() {
    if (this.host) { if (this.peer?.disconnected) this.peer.reconnect(); this.broadcast(); }
    else { this.conn?.close(); this.connecting = false; this.connectHost(); }
  }
  close() { this.disposed = true; clearInterval(this.interval); clearTimeout(this.botTimer); this.peer?.destroy(); }
}
