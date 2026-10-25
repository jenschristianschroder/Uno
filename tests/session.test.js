import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Session,roomCode,normalizeCode,validCode,saveLocal,readLocal} from '../session.js';
import {playable} from '../engine.js';
const memory = new Map();
globalThis.localStorage = {getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
class Link extends EventEmitter {
  constructor(){super();this.open=false;}
  send(data){if(!this.open)throw Error('closed');const copy=structuredClone(data);queueMicrotask(()=>{if(this.other.open)this.other.emit('data',copy);});}
  close(){if(!this.open)return;this.open=false;this.other.open=false;this.emit('close');this.other.emit('close');}
}
class FakePeer extends EventEmitter {
  static peers = new Map();
  constructor(id=crypto.randomUUID()){super();this.id=id;this.links=[];this.destroyed=false;queueMicrotask(()=>{if(FakePeer.peers.has(id)){this.emit('error',{type:'unavailable-id'});return;}FakePeer.peers.set(id,this);this.emit('open',id);});}
  connect(id){const link=new Link(), other=new Link();link.other=other;other.other=link;this.links.push(link);queueMicrotask(()=>{const host=FakePeer.peers.get(id);if(!host){this.emit('error',{type:'peer-unavailable'});return;}host.links.push(other);host.emit('connection',other);link.open=other.open=true;other.emit('open');link.emit('open');});return link;}
  destroy(){this.destroyed=true;this.links.forEach(l=>l.close());if(FakePeer.peers.get(this.id)===this)FakePeer.peers.delete(this.id);}
  reconnect(){this.disconnected=false;this.emit('open',this.id);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function make(token=crypto.randomUUID()){
  saveLocal('profile',{token});const updates=[],errors=[];
  const session=new Session({PeerClass:FakePeer,onView:(v,i)=>updates.push({v,i}),onStatus:()=>{},onError:e=>errors.push(e)});
  return {session,updates,errors};
}
test('room codes are valid, normalize shared text, and use all 8 characters',()=>{const codes=new Set();for(let i=0;i<1000;i++){const c=roomCode();assert.equal(c.length,8);assert.ok(validCode(c));codes.add(c);}assert.equal(codes.size,1000);assert.equal(normalizeCode('abcd-2345'),'ABCD2345');assert.ok(!validCode('IIII0000'));});
test('host and five guests join, private views sync, illegal actions reject, disconnect pauses and tokens restore seats',async t=>{
  memory.clear();const host=make();const guests=[];
  t.after(()=>{host.session.close();guests.forEach(g=>g.session.close());});
  await host.session.create('Host');
  for(let i=0;i<5;i++){const g=make();guests.push(g);await g.session.join(host.session.code,'Guest '+i);await tick();}
  assert.equal(host.session.state.players.length,6);
  assert.equal(guests[0].updates.at(-1).v.players.length,6);
  host.session.startRound();await tick();
  for(const g of guests){const v=g.updates.at(-1).v;assert.equal(v.phase,'playing');assert.equal(v.hand.length,7);assert.equal(v.deck,undefined);assert.ok(v.players.every(p=>!('hand' in p)));}
  const revision=host.session.state.revision;
  guests[0].session.send({type:'draw',revision});await tick();
  assert.equal(host.session.state.revision,revision);assert.match(guests[0].errors.at(-1),/turn/);
  const s=host.session.state,p=s.players[0];
  const c=p.hand.find(c=>playable(s,c,p.hand));
  host.session.send(c?{type:'play',cardId:c.id,color:'blue',uno:true,revision}:{type:'draw',revision});await tick();
  assert.equal(guests[0].updates.at(-1).v.revision,revision+1);
  const oldId=guests[0].session.id, token=guests[0].session.profile.token, code=host.session.code;
  guests[0].session.close();await tick();assert.equal(host.session.allHere(),false);
  assert.throws(()=>host.session.dispatch(host.session.state.players[host.session.state.turn].id,{type:'draw',revision:host.session.state.revision}),/reconnect/);
  const reconnect=make(token);guests.push(reconnect);await reconnect.session.join(code,'New nickname');await tick();
  assert.equal(reconnect.session.id,oldId);assert.equal(host.session.state.players.length,6);assert.equal(host.session.allHere(),true);
  assert.equal(reconnect.updates.at(-1).v.hand.length,host.session.state.players.find(p=>p.id===oldId).hand.length);
  const outsider=make();guests.push(outsider);await outsider.session.join(code,'Unexpected');await tick();
  assert.equal(host.session.state.players.length,6);assert.match(outsider.errors.at(-1),/started/);
});
test('host resumes exact saved deck and credentials; guest rejoins without duplication',async t=>{
  memory.clear();const h=make(),g=make();let resumed,returned;
  t.after(()=>{h.session.close();g.session.close();resumed?.session.close();returned?.session.close();});
  await h.session.create('Host');await g.session.join(h.session.code,'Friend');await tick();h.session.startRound();await tick();
  const saved=structuredClone(readLocal('host')),guestId=g.session.id,token=g.session.profile.token;
  h.session.close();g.session.close();
  resumed=make();await resumed.session.create('Host',true);assert.deepEqual(resumed.session.state,saved.state);
  returned=make(token);await returned.session.join(saved.code,'Friend');await tick();
  assert.equal(returned.session.id,guestId);assert.equal(resumed.session.state.players.length,2);assert.equal(resumed.session.allHere(),true);
  assert.deepEqual(returned.updates.at(-1).v.hand,saved.state.players.find(p=>p.id===guestId).hand);
});
