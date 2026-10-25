import {Session, readLocal, saveLocal, eraseLocal, normalizeCode} from './session.js';
import {playable} from './engine.js';
const $ = s => document.querySelector(s);
const app = $('#app');
let session, current, info, status = '', armed = false, pendingCard, lastKey, toastTimer, busy = false, wakeLock;
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols = {skip:'↷',reverse:'⇄',wild:'✦','+2':'+2','+4':'+4'};
const marks = {red:'●',yellow:'◆',green:'▲',blue:'■',wild:'✦'};
function card(c, {disabled = false, decorative = false, back = false} = {}) {
  const label = back ? 'Draw a card' : `${c.color} ${c.value}`;
  const symbol = back ? 'last.' : symbols[c.value] || c.value;
  const tag = decorative ? 'div' : 'button';
  return `<${tag} class="card ${back?'back':escape(c.color)}" ${decorative?'aria-hidden="true"':`aria-label="${escape(label)}" ${disabled?'disabled':''} ${back?'data-action="draw"':`data-card="${escape(c.id)}"`}`}><span class="corner">${back?'✦':escape(symbol)}</span><span class="center">${escape(symbol)}</span><span class="corner bottom">${back?'✦':marks[c.color]}</span></${tag}>`;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(()=>$('#toast').hidden = true,7000); }
function invitation() { const url = new URL(location.href); url.hash = 'room=' + info.code; url.search = ''; return url.href; }
async function share() {
  const url = invitation(), text = `Join my Last Card game! Room code: ${info.code}. Keep the game open while we play.`;
  try { if (navigator.share) await navigator.share({title:'Your seat is waiting',text,url}); else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Invite copied. Paste it into a text message.'); } }
  catch(e) { if (e.name !== 'AbortError') toast('Could not share. Copy the room code and send it with this page’s address.'); }
}
async function copyCode() { try { await navigator.clipboard.writeText(info.code); toast('Room code copied.'); } catch { toast(`Your code is ${info.code}. Select it to copy.`); } }
function setStatus(value) { status = value; const target = $('#connection-status'); if (target) target.textContent = value; }
function home() {
  current = null; info = null; lastKey = null; busy = false;
  const saved = readLocal('session'), name = readLocal('name') || '';
  const fragment = new URLSearchParams(location.hash.slice(1)); const code = normalizeCode(fragment.get('room') || '');
  app.innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> GOOD FRIENDS. WILD CARDS.</div><h1>A little friendly<br><em>rivalry.</em></h1><p>The classic color-matching game, made for your group. Pull up a chair. Play your cards.</p><div class="hero-art"><div class="art-orbit"></div>${card({color:'red',value:'7'},{decorative:true})}${card({color:'yellow',value:'reverse'},{decorative:true})}${card({color:'green',value:'+2'},{decorative:true})}<span class="spark">✦</span><span class="art-note">One more round? Always.</span></div></div><div><section class="entry-panel"><h2>${code?'Your seat is waiting.':'Bring your people.'}</h2><p>${code?'Add your name and join the table.':'2–6 players. One room code. Zero accounts.'}</p>${saved?`<div class="resume">Your ${saved.role === 'host'?'hosted table':'seat'} is saved on this device.<br><button id="resume" class="button secondary">Return to ${escape(saved.code)} ↗</button></div>`:''}<form id="entry-form"><label for="player-name">Your name at the table</label><input id="player-name" name="name" autocomplete="nickname" maxlength="20" placeholder="What should we call you?" value="${escape(name)}" required><button id="create" type="button" class="button primary full">Create a room <span aria-hidden="true">↗</span></button><div class="divider">or join your friends</div><label for="room-input">Room code</label><div class="join-row"><input id="room-input" name="code" placeholder="8-character code" value="${escape(code)}" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="8-character room code"><button id="join" type="submit" class="button secondary">Join →</button></div></form><div class="entry-foot"><span aria-hidden="true">⌁</span> Game saves stay on your device.</div></section><button id="practice" class="text-button practice">Just looking? Try a practice round →</button></div></section><section class="bottom-strip" aria-label="Game features"><div class="feature"><b>↗</b> Text a code. Start a game.</div><div class="feature"><b>▯</b> Made for your phone.</div><div class="feature"><b>✦</b> No sign-up. Just play.</div></section><footer class="page-footer">An independent UNO-style game. Not affiliated with Mattel.<br><button id="privacy" class="text-button">Connection & privacy details</button> · <button id="erase" class="text-button">Clear this device’s game data</button></footer>`;
  $('#entry-form').onsubmit = e => { e.preventDefault(); begin('join'); };
  $('#create').onclick = () => begin('host'); $('#practice').onclick = () => begin('practice');
  $('#resume')?.addEventListener('click',()=>begin('resume'));
  $('#privacy').onclick = ()=>$('#rules').showModal();
  $('#erase').onclick = () => { if (confirm('Delete this device’s saved table, seat token, and name? You will not be able to recover them.')) { eraseLocal(); home(); toast('Game data cleared from this device.'); } };
}
async function requestWake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
async function begin(mode) {
  if (busy) return;
  let name = $('#player-name').value.trim();
  if (!name && mode !== 'practice' && mode !== 'resume') { $('#player-name').reportValidity(); return; }
  name ||= readLocal('name') || 'You'; saveLocal('name',name);
  busy = true; $('#entry-form').querySelectorAll('button').forEach(b=>b.disabled = true);
  session?.close(); lastKey = null;
  session = new Session({onView:receive, onStatus:setStatus, onError:toast});
  try {
    if (mode === 'practice') session.solo(name);
    if (mode === 'host') await session.create(name);
    if (mode === 'join') await session.join($('#room-input').value,name);
    if (mode === 'resume') {
      const saved = readLocal('session'); if (saved?.role === 'host') await session.create(name,true);
      else if (saved) await session.join(saved.code,name); else throw Error('No saved room found.');
    }
    await requestWake();
    if (!current && mode !== 'practice') { $('#create').textContent = 'Connecting…'; toast('Connecting to the host. Keep this page open.'); }
  } catch(e) { session.close(); home(); toast(e.message); }
  finally { busy = false; $('#entry-form')?.querySelectorAll('button').forEach(b=>b.disabled = false); }
}
function receive(v, meta) {
  if (!v || !Array.isArray(v.players) || !Array.isArray(v.hand)) return;
  const key = JSON.stringify(v);
  if (key === lastKey) return;
  if (!current || current.revision !== v.revision) armed = false;
  current = v; info = meta; lastKey = key; render();
}
function header() { return `<div class="room-top"><div class="room-code"><small>${info.practice?'JUST FOR FUN':'YOUR TABLE'}</small>${escape(info.code)}<div class="status"><span class="live-dot"></span><span id="connection-status">${escape(status)}</span></div></div><div class="room-controls">${!info.practice?'<button id="share-room" class="text-button">Invite ↗</button><button id="reconnect" class="text-button">Reconnect</button>':''}<button id="leave" class="text-button">Leave ×</button></div></div>`; }
function seats() { return current.players.map((p,i)=>`<div class="seat ${p.online?'':'offline'}"><span class="avatar">${escape(p.name[0]?.toUpperCase())}</span><span class="seat-name">${escape(p.name)}${p.id===info.id?' (you)':''}</span><span class="seat-meta">${p.online?(i===0?'Host':'Ready'):'Away'}</span></div>`).join(''); }
function render() {
  if (!current) return;
  const v = current, mine = v.players[v.turn]?.id === info.id, allHere = v.players.every(p=>p.online), myTurn = mine && allHere && v.phase==='playing';
  if (v.phase === 'lobby') {
    app.innerHTML = `<section class="room">${header()}<div class="lobby-layout"><div class="lobby-main"><div class="eyebrow"><span class="live-dot"></span> THE TABLE IS OPEN</div><h1>A good hand starts<br>with good company.</h1><p class="muted">Send your friends the code. Their seat is one tap away.</p><div class="invite-code">${escape(info.code)}</div><p class="hint">Keep this page open while your friends join.</p><div class="invite-buttons"><button id="invite" class="button primary">Text an invite ↗</button><button id="copy" class="button secondary">Copy code</button></div><p class="hint">Only share with your group. Anyone with the code can join before the round starts.</p></div><div class="lobby-side"><div class="eyebrow">AROUND THE TABLE · ${v.players.length}/6</div><div class="seats">${seats()}${Array.from({length:Math.max(0,2-v.players.length)},()=>'<div class="seat empty-seat"><span class="avatar">+</span><span class="seat-name">A seat for a friend</span></div>').join('')}</div>${info.host?`<button id="start" class="button primary full" ${v.players.length<2||!allHere?'disabled':''}>Deal the cards →</button><p class="hint">You’re the host. Start when everyone is here.</p>`:'<p class="muted">You’re in. Waiting for the host to deal…</p>'}<p class="hint">Keep screens awake. The game pauses if someone disconnects.</p></div></div></section>`;
    $('#invite').onclick = share; $('#copy').onclick = copyCode;
  } else {
    const waiting = v.players.filter(p=>!p.online).map(p=>p.name).join(', ');
    const engineView = {color:v.color,discard:[v.top]};
    const can = c => myTurn && playable(engineView,c,v.hand) && (v.drawn===null||v.drawn===c.id);
    app.innerHTML = `<section class="room">${header()}<div class="game-area">${!allHere?`<div class="pause" role="status">Game paused. Waiting for ${escape(waiting)} to return. Keep this page open.</div>`:''}<div class="players" aria-label="Players">${v.players.map((p,i)=>`<div class="opponent ${i===v.turn&&v.phase==='playing'?'current':''} ${p.online?'':'offline'}"><span class="avatar">${escape(p.name[0]?.toUpperCase())}</span><div><div class="who">${escape(p.name)}${p.id===info.id?' · you':''}</div><div class="count">${p.count===1?'UNO · 1 card':p.count+' cards'}${!p.online?' · away':''}</div></div></div>`).join('')}</div><div class="table"><p class="table-wordmark">a little friendly rivalry.</p><div class="piles"><div class="pile">${card({}, {back:true,disabled:!myTurn||v.drawn!==null})}<small>draw pile</small></div><div class="pile discard">${card(v.top,{decorative:true})}<small>in play</small></div></div><p class="table-message" aria-live="polite">${escape(v.phase==='finished'?'That’s a wrap.':!allHere?'Saving your seats…':myTurn?'Your move. Make it a good one.':`${v.players[v.turn].name} is thinking…`)}</p><div class="active-color"><span class="color-dot ${escape(v.color)}"></span>${escape(v.color)} ${marks[v.color]} <span aria-hidden="true">·</span> ${v.direction===1?'Clockwise ↻':'Counterclockwise ↺'}</div></div>${v.phase==='finished'?`<div class="winner"><p class="eyebrow" style="justify-content:center">ROUND COMPLETE</p><h2>${v.winner?escape(v.players.find(p=>p.id===v.winner)?.name)+' takes the table.':'This round is a draw.'}</h2>${info.host?'<button id="start" class="button primary">One more round ↗</button>':'<p class="muted">Waiting for the host to deal the next round.</p>'}</div>`:''}<div class="hand-heading"><h2>Your hand <small>${v.hand.length} cards</small></h2><span class="turn-label">${v.phase==='finished'?'Nice playing':myTurn?'Your turn':mine?'Paused':'Sit tight'}</span></div><div class="hand" aria-label="Your cards">${v.hand.map(c=>card(c,{disabled:!can(c)})).join('')}</div>${v.phase==='playing'?`<div class="hand-actions"><button class="button secondary" data-action="${v.drawn===null?'draw':'pass'}" ${!myTurn?'disabled':''}>${v.drawn===null?'Draw a card +':'Pass this turn →'}</button><button id="uno" class="button uno-button ${armed?'armed':''}" aria-pressed="${armed}" ${!myTurn||v.hand.length!==2?'disabled':''}>${armed?'UNO called ✓':'Call UNO !'}</button></div><p class="hint">${v.drawn!==null?'Play the card you just drew, or pass.':v.hand.length===2?'Call UNO before playing your second-to-last card.':'Tap a raised card to play. Match the color or symbol.'}</p>`:''}<details class="game-log"><summary>At the table · ${escape(v.log.at(-1))}</summary>${v.log.map(line=>`<p>${escape(line)}</p>`).join('')}</details></div></section>`;
    $('#uno')?.addEventListener('click',()=>{armed=!armed;render();});
    app.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>play(b.dataset.card));
    app.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>session.send({type:b.dataset.action,revision:current.revision}));
  }
  $('#start')?.addEventListener('click',()=>session.startRound());
  $('#share-room')?.addEventListener('click',share);
  $('#reconnect')?.addEventListener('click',()=>session.reconnect());
  $('#leave').onclick=()=> { $('#leave-copy').textContent = info.practice?'This practice round will end.':info.host?'Your table will pause. Return on this device to restore the room and let your friends reconnect.':'Your seat stays saved on this device. The table will wait until you reconnect.'; $('#leave-dialog').showModal(); };
}
function play(cardId) {
  const c = current.hand.find(c=>c.id===cardId);
  if (c.color === 'wild') { pendingCard = {cardId,revision:current.revision,uno:armed}; $('#color-dialog').showModal(); }
  else session.send({type:'play',cardId,uno:armed,revision:current.revision});
}
$('#rules-button').onclick=()=>$('#rules').showModal();
for (const b of document.querySelectorAll('[data-close]')) b.onclick=()=>b.closest('dialog').close();
for (const b of document.querySelectorAll('[data-color]')) b.onclick=()=> { $('#color-dialog').close(); if(pendingCard) session.send({type:'play',...pendingCard,color:b.dataset.color}); pendingCard=null; };
$('#confirm-leave').onclick=()=>{ $('#leave-dialog').close(); session?.close(); wakeLock?.release(); session=null; history.replaceState(null,'',location.pathname + location.search); home(); };
document.querySelector('.brand').onclick=e=> { if(current) {e.preventDefault();$('#leave').click();} };
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&current) requestWake(); });
window.addEventListener('online',()=> {if(current&&!info.practice)session.reconnect();});
home();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
