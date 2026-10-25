export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const VALUES = ['0','1','2','3','4','5','6','7','8','9','skip','reverse','+2'];
export const VERSION = 1;
export function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    // Rejection sampling avoids modulo bias.
    const bound = Math.floor(4294967296 / (i + 1)) * (i + 1);
    let x; do { x = crypto.getRandomValues(new Uint32Array(1))[0]; } while (x >= bound);
    const j = x % (i + 1); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function deck() {
  const cards = []; let n = 0;
  const add = (color, value) => cards.push({id: String(++n), color, value});
  for (const color of COLORS) for (const value of VALUES) {
    add(color, value); if (value !== '0') add(color, value);
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild'); add('wild', '+4'); }
  return shuffle(cards);
}
export function lobby(id, name) {
  return {version: VERSION, revision: 0, phase: 'lobby', players: [{id, name, hand: []}], deck: [], discard: [], turn: 0, direction: 1, color: null, drawn: null, winner: null, log: ['The table is open.']};
}
export function addPlayer(state, id, name) {
  if (state.players.some(p => p.id === id)) return state;
  if (state.phase !== 'lobby') throw Error('This round has already started.');
  if (state.players.length >= 6) throw Error('This table is full (6 players).');
  const next = structuredClone(state);
  next.players.push({id, name, hand: []}); next.revision++; return next;
}
export function start(state) {
  if (!['lobby','finished'].includes(state.phase)) throw Error('A round is already in progress.');
  if (state.players.length < 2) throw Error('Invite at least one friend first.');
  const next = structuredClone(state); next.deck = deck(); next.discard = [];
  next.players.forEach(p => { p.hand = next.deck.splice(0, 7); });
  // Start on a number card so the first turn has no implicit penalties.
  const first = next.deck.findIndex(c => /^\d$/.test(c.value));
  next.discard.push(next.deck.splice(first, 1)[0]);
  Object.assign(next, {phase:'playing', turn:0, direction:1, color:next.discard[0].color, drawn:null, winner:null, passes:0, log:['Cards dealt. Let’s play.'], revision:next.revision + 1});
  return next;
}
export function playable(state, card, hand) {
  if (card.value === '+4') return !hand.some(c => c.color === state.color);
  const top = state.discard.at(-1);
  return card.color === 'wild' || card.color === state.color || card.value === top?.value;
}
function draw(state, player, count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    if (!state.deck.length && state.discard.length > 1) {
      const top = state.discard.pop(); state.deck = shuffle(state.discard); state.discard = [top];
    }
    const card = state.deck.pop(); if (!card) break;
    player.hand.push(card); result.push(card);
  }
  return result;
}
function advance(s, steps = 1) { s.turn = (s.turn + s.direction * steps + s.players.length * 2) % s.players.length; s.drawn = null; }
export function act(state, id, action) {
  if (!action || typeof action !== 'object') throw Error('Invalid move.');
  if (state.phase !== 'playing') throw Error('The round is not in progress.');
  if (action.revision !== state.revision) throw Error('The table changed. Try your move again.');
  if (state.players[state.turn]?.id !== id) throw Error('Wait for your turn.');
  const s = structuredClone(state), p = s.players[s.turn]; let message;
  if (action.type === 'draw') {
    if (s.drawn !== null) throw Error('Play your drawn card or pass.');
    const cards = draw(s, p, 1); s.drawn = cards[0]?.id || 'empty';
    message = `${p.name} drew a card.`;
    // Only the drawn card may be played. An unplayable draw ends the turn.
    if (!cards.length || !playable(s, cards[0], p.hand)) {
      s.passes = cards.length ? 0 : (s.passes || 0) + 1; advance(s);
      if (s.passes >= s.players.length) { s.phase = 'finished'; message = 'No moves remain. This round is a draw.'; }
    }
  } else if (action.type === 'pass') {
    if (s.drawn === null) throw Error('Draw a card before passing.');
    advance(s); message = `${p.name} passed.`;
  } else if (action.type === 'play') {
    const i = p.hand.findIndex(c => c.id === action.cardId), card = p.hand[i];
    if (!card || !playable(s, card, p.hand)) throw Error('Match the color or symbol, or play a wild.');
    if (s.drawn !== null && s.drawn !== card.id) throw Error('You can only play the card you just drew.');
    if (card.color === 'wild' && !COLORS.includes(action.color)) throw Error('Choose a color.');
    p.hand.splice(i, 1); s.discard.push(card); s.color = card.color === 'wild' ? action.color : card.color; s.passes = 0;
    message = `${p.name} played ${card.color === 'wild' ? '' : card.color + ' '}${card.value}.`;
    if (p.hand.length === 1 && action.uno !== true) { draw(s, p, 2); message += ' Forgot UNO: +2 cards.'; }
    else if (p.hand.length === 1) message += ' UNO!';
    let steps = 1;
    if (card.value === 'reverse') { s.direction *= -1; if (s.players.length === 2) steps = 2; }
    if (card.value === 'skip') steps = 2;
    if (card.value === '+2' || card.value === '+4') {
      const victim = s.players[(s.turn + s.direction + s.players.length) % s.players.length];
      draw(s, victim, card.value === '+2' ? 2 : 4); steps = 2;
    }
    if (p.hand.length === 0) { s.phase = 'finished'; s.winner = p.id; message = `${p.name} wins the round!`; }
    advance(s, steps);
  } else throw Error('Unknown move.');
  s.revision++; s.log = [...s.log, message].slice(-8); return s;
}
export function view(state, id, online = []) {
  return {version:state.version, revision:state.revision, phase:state.phase, players:state.players.map(p => ({id:p.id, name:p.name, count:p.hand.length, online:online.includes(p.id)})), hand:state.players.find(p => p.id === id)?.hand || [], top:state.discard.at(-1) || null, turn:state.turn, direction:state.direction, color:state.color, drawn:state.players[state.turn]?.id === id ? state.drawn : null, winner:state.winner, deckCount:state.deck.length, log:state.log};
}
