import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTurnRecap, runAiTurn } from '../src/ai/bridge.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMoveWithEvents } from '../src/engine/turn.js';
import { mulberry32 } from './helpers/rng.js';

const cards = loadCards();
const fresh = () => newGame(cards, mulberry32(41), { firstPlayer: 2 });
const metadata = { id: 'turn-7', turnNumber: 7, startedAt: 100, endedAt: 200 };
function recap(state, moves, options = {}) {
  const before = structuredClone(state), decisions = structuredClone(moves);
  const result = aiTurnRecap(state, moves, { ...metadata, ...options });
  assert.deepEqual(state, before);
  assert.deepEqual(moves, decisions);
  assert.equal(result.id, 'turn-7');
  assert.equal(result.playerId, 'player2');
  assert.equal(result.turnNumber, 7);
  assert.equal(result.startedAt, 100);
  assert.equal(result.endedAt, 200);
  result.events.forEach((event, i) => {
    assert.equal(event.id, `turn-7-event-${i + 1}`);
    assert.equal(event.timestamp, 200);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  return result;
}
const payload = event => {
  const { id, timestamp, ...rest } = event;
  return rest;
};
function buyFixture({ ability = null, color = 'blue', crowns = 0 } = {}) {
  const state = fresh();
  Object.assign(state.pyramid.level3[0], { costs: {}, points: 0, crowns, ability, color });
  return state;
}
const buy = state => legalMoves(state).find(m => m.type === 'buy' && m.source === 'pyramid' && m.level === 3 && m.index === 0);

test('recap takes use pre-move colors and page token/Privilege fields', () => {
  const state = fresh();
  state.board[0] = ['pearl', 'pearl', 'blue', null, null];
  const turn = recap(state, [{ type: 'take', cells: [[0, 0], [0, 1], [0, 2]] }]);
  assert.deepEqual(payload(turn.events[0]), { type: 'tokens_taken',
    tokens: [{ color: 'pearl', count: 2 }, { color: 'blue', count: 1 }],
    scrollReasons: ['two_pearls'], scrollAwardedTo: 'player1', bonusColor: null });
  assert.equal(turn.status, 'completed');
});

test('buy recap includes exact gem, pearl and gold payment, reserve source and wild preview', () => {
  const state = buyFixture({ color: 'wild' });
  const base = structuredClone(state.pyramid.level3[1]);
  Object.assign(base, { color: 'red', crowns: 0, points: 0, ability: null });
  state.players.player2.cards.push(base);
  const card = state.pyramid.level3.shift();
  card.costs = { blue: 2, pearl: 1 };
  state.players.player2.reserves.push(card);
  Object.assign(state.players.player2.tokens, { blue: 1, pearl: 1, gold: 1 });
  const move = legalMoves(state).find(m => m.type === 'buy' && m.source === 'reserve' && m.wildColor === 'red');
  assert.ok(move);
  const event = recap(state, [move]).events[0];
  assert.equal(event.type, 'card_purchased');
  assert.equal(event.fromReserve, true);
  assert.equal(event.card.id, card.id);
  assert.equal(event.card.color, 'wild');
  assert.equal(event.card.wildColorStack, undefined); // same summarizeCard projection as live purchases
  assert.deepEqual(event.tokensSpent, Object.entries(move.payment.spend).filter(([, n]) => n > 0).map(([color, count]) => ({ color, count })));
  assert.equal(event.tokensSpent.reduce((n, t) => n + t.count, 0), 3);
  assert.equal(event.ability, null);
});

test('blind reservation records source/level and gold without any hidden identity', () => {
  const state = fresh();
  state.board[0][0] = 'gold';
  const hidden = state.decks.level2[0];
  const turn = recap(state, [{ type: 'reserve', source: 'deck', level: 2 }], { chanceSamples: [0] });
  assert.deepEqual(payload(turn.events[0]), { type: 'card_reserved', card: null, goldAwarded: true, source: 'deck', level: 2 });
  assert.ok(!JSON.stringify(turn).includes(hidden.id));
  const visible = recap(state, [{ type: 'reserve', source: 'pyramid', level: 2, index: 0 }], { chanceSamples: [0] });
  assert.equal(visible.events[0].card.id, state.pyramid.level2[0].id);
  assert.equal(visible.events[0].source, 'pyramid');
});

test('Privilege events use scroll_token and the color before removal', () => {
  const state = fresh();
  state.players.player2.privileges = 1;
  state.board[0][0] = 'pearl';
  state.board[0][1] = 'black';
  const turn = recap(state, [{ type: 'usePrivilege', cell: [0, 0] }, { type: 'take', cells: [[0, 1]] }]);
  assert.deepEqual(payload(turn.events[0]), { type: 'scroll_token', token: 'pearl' });
  assert.deepEqual(turn.events[1].tokens, [{ color: 'black', count: 1 }]);
});

test('refill replay uses recorded randomness, counts placed colors and follows new board colors', () => {
  const state = fresh();
  state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
  for (const color of Object.keys(state.bag)) state.bag[color] = 0;
  Object.assign(state.bag, { blue: 1, pearl: 1, gold: 1 });
  const samples = [0.7, 0.2];
  let i = 0;
  const refilled = applyMoveWithEvents(state, { type: 'refill' }, () => samples[i++]).state;
  const take = legalMoves(refilled).find(m => m.type === 'take');
  const turn = recap(state, [{ type: 'refill' }, take], { chanceSamples: samples });
  const event = turn.events[0];
  assert.equal(event.type, 'board_refilled');
  assert.equal(event.tokensPlaced, 3);
  assert.equal(event.scrollAwardedTo, 'player1');
  assert.deepEqual(Object.fromEntries(event.tokens.map(t => [t.color, t.count])), { gold: 1, blue: 1, pearl: 1 });
  assert.equal(turn.events[1].tokens[0].color, refilled.board[take.cells[0][0]][take.cells[0][1]]);
  assert.throws(() => recap(state, [{ type: 'refill' }]), /recorded chance samples/);
});

test('Royal preview and scroll ability are in order with their source card', () => {
  const state = buyFixture({ crowns: 3 });
  const royal = state.royalCards.find(c => c.ability === 'scroll');
  const turn = recap(state, [buy(state), { type: 'royal', royalId: royal.id }]);
  assert.deepEqual(turn.events.map(e => e.type), ['card_purchased', 'royal_acquired', 'scroll_gained']);
  assert.equal(turn.events[1].card.id, royal.id);
  assert.equal(turn.events[2].card.id, royal.id);
});

test('discard maps are converted to the page token count array', () => {
  const state = fresh();
  state.pending = { type: 'discard' };
  state.turnState.mandatoryDone = true;
  state.players.player2.tokens.blue = 10;
  state.players.player2.tokens.pearl = 1;
  const move = legalMoves(state).find(m => m.type === 'discard' && m.discard.pearl === 1);
  const turn = recap(state, [move]);
  assert.deepEqual(payload(turn.events[0]), { type: 'tokens_discarded', tokens: [{ color: 'pearl', count: 1 }] });
});

test('automatic and chosen bonus/steal effects reuse page ability events', () => {
  for (const ability of ['token', 'steal']) {
    const state = buyFixture({ ability });
    state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
    state.board[0][0] = 'blue';
    state.board[0][1] = 'blue';
    state.players.player1.tokens.red = 1;
    state.players.player1.tokens.pearl = 1;
    const purchase = buy(state);
    const next = applyMoveWithEvents(state, purchase).state;
    const choice = legalMoves(next)[0];
    const turn = recap(state, [purchase, choice]);
    const event = turn.events[1];
    if (ability === 'token') assert.deepEqual(payload(event), { type: 'bonus_token_collected', tokens: [{ color: 'blue', count: 1 }], scrollAwardedTo: null, scrollReasons: [], bonusColor: 'blue' });
    else assert.deepEqual(payload(event), { type: 'token_stolen', color: choice.choice });
  }
});

test('extra turns stay in ordered recap, and victory status matches history', () => {
  const state = buyFixture({ ability: 'again' });
  const first = buy(state);
  const next = applyMoveWithEvents(state, first).state;
  const take = legalMoves(next).find(m => m.type === 'take');
  const turn = recap(state, [first, take]);
  assert.deepEqual(turn.events.map(e => e.type), ['card_purchased', 'repeat_turn_awarded', 'tokens_taken']);
  assert.equal(turn.events[1].card.id, state.pyramid.level3[0].id);
  const won = buyFixture();
  won.pyramid.level3[0].points = 20;
  assert.equal(recap(won, [buy(won)]).status, 'victory');
});

test('runAiTurn chance samples support deterministic replay without further RNG calls', () => {
  const state = fresh();
  const result = runAiTurn({ gameState: state }, { level: 3, rng: mulberry32(20) });
  const turn = recap(state, result.moves, { chanceSamples: result.chanceSamples });
  assert.ok(turn.events.length);
});
