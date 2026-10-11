import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newGame, TOKEN_SUPPLY } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { tokenTotal } from '../src/engine/rules-misc.js';
import { legalMoves, applyMove, applyMoveWithEvents, isTerminal, winner, mover } from '../src/engine/turn.js';
import { mulberry32 } from './helpers/rng.js';

const cards = loadCards();
const fresh = () => newGame(cards, mulberry32(9), { firstPlayer: 1 });
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture(holdings = {}, placements = [[0, 0, 'green']]) {
  const state = fresh();
  state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
  state.bag = { ...TOKEN_SUPPLY };
  for (const [id, tokens] of Object.entries(holdings)) {
    Object.assign(state.players[id].tokens, tokens);
    for (const [color, count] of Object.entries(tokens)) state.bag[color] -= count;
  }
  for (const [r, c, color] of placements) {
    state.board[r][c] = color;
    state.bag[color] -= 1;
  }
  return state;
}
function owned(state, changes) {
  const card = state.decks.level3.shift();
  Object.assign(card, { color: 'blue', points: 0, crowns: 0, ability: '', costs: {} }, changes);
  state.players.player1.cards.push(card);
  return card;
}
function purchase(state, changes = {}) {
  Object.assign(state.pyramid.level3[0], { color: 'white', points: 0, crowns: 0, ability: '', costs: {} }, changes);
  return legalMoves(state).find(move => move.type === 'buy' && move.source === 'pyramid' && move.level === 3 && move.index === 0);
}
function step(state, move, options) {
  const snapshot = structuredClone(state);
  const moveSnapshot = structuredClone(move);
  freeze(state);
  freeze(move);
  const result = applyMoveWithEvents(state, move, mulberry32(2), options);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(move, moveSnapshot);
  assert.deepEqual(checkInvariants(result.state), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  return result;
}

test('Royal claim and its steal precede a single discard of the combined excess', () => {
  const state = fixture({ player1: { blue: 4, white: 4, pearl: 2 }, player2: { black: 1, red: 1 } });
  owned(state, { crowns: 2 });
  const buy = purchase(state, { crowns: 1, color: 'green', ability: 'token' });
  let next = step(state, buy).state;
  assert.equal(tokenTotal(next, 'player1'), 11);
  assert.equal(next.pending.type, 'royal');
  assert.equal(next.turnState.mandatoryDone, true);
  assert.ok(legalMoves(next).every(move => move.type === 'royal'));
  next = step(next, { type: 'royal', royalId: 'royal-2' }).state;
  assert.equal(next.pending.type, 'ability');
  assert.deepEqual(legalMoves(next), [{ type: 'abilityChoice', choice: 'red' }, { type: 'abilityChoice', choice: 'black' }]);
  next = step(next, { type: 'abilityChoice', choice: 'black' }).state;
  assert.equal(tokenTotal(next, 'player1'), 12);
  assert.equal(next.pending.type, 'discard');
  assert.ok(legalMoves(next).every(move => Object.values(move.discard).reduce((a, b) => a + b, 0) === 2));
  next = step(next, legalMoves(next)[0]).state;
  assert.equal(tokenTotal(next, 'player1'), 10);
  assert.equal(next.pending, null);
  assert.equal(mover(next), 'player2');
  assert.equal(next.previousCrownCounts.player1, 3);
});

test('both crossed Royal thresholds resolve, with abilities between claims', () => {
  const state = fixture();
  owned(state, { crowns: 2 });
  let next = step(state, purchase(state, { crowns: 4 })).state;
  assert.equal(next.pending.royalsRemaining, 2);
  next = step(next, { type: 'royal', royalId: 'royal-1' }).state;
  assert.equal(next.players.player1.privileges, 1);
  assert.equal(next.pending.royalsRemaining, 1);
  assert.equal(legalMoves(next).length, 3);
  next = step(next, { type: 'royal', royalId: 'royal-3' }).state;
  assert.equal(mover(next), 'player2');
  assert.equal(next.previousCrownCounts.player1, 6);
});

test('again starts a fresh turn for the same player and consumes stacked extra turns', () => {
  let state = fixture();
  state.turnState.boardRefilled = true;
  owned(state, { crowns: 2 });
  state = step(state, purchase(state, { crowns: 1, ability: 'again' })).state;
  state = step(state, { type: 'royal', royalId: 'royal-4' }).state;
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.turnState.boardRefilled, false);
  assert.equal(state.turnState.mandatoryDone, false);
  assert.equal(state.turnState.actionCompleted, false);
  assert.equal(state.turnState.isExtraTurn, true);
  assert.equal(state.turnState.extraTurnsPending, 1);
  assert.equal(state.turnState.crownsAtTurnStart, 3);
  state = step(state, { type: 'take', cells: [[0, 0]] }).state;
  assert.equal(mover(state), 'player1');
  assert.equal(state.turnState.extraTurnsPending, 0);
  state = step(state, { type: 'refill' }).state;
  state = step(state, legalMoves(state).find(move => move.type === 'take')).state;
  assert.equal(mover(state), 'player2');
  assert.equal(state.turnState.isExtraTurn, false);
});

test('Privilege use is optional and repeatable, blocked after refill and during resolutions', () => {
  const state = fixture();
  state.players.player1.privileges = 2;
  state.scrollPool = 0;
  let next = step(state, { type: 'usePrivilege', cell: [0, 0] }).state;
  assert.equal(next.turnState.mandatoryDone, false);
  next = step(next, { type: 'refill' }).state;
  assert.equal(next.players.player1.privileges, 1);
  assert.equal(legalMoves(next).some(move => move.type === 'usePrivilege' || move.type === 'refill'), false);
  assert.throws(() => applyMove(next, { type: 'usePrivilege', cell: [2, 2] }), /Illegal move/);
});

test('take and reserve above ten force discard; reserved abilities do not execute', () => {
  for (const type of ['take', 'reserve']) {
    const state = fixture({ player1: { blue: 4, white: 4, pearl: 2 } }, [[0, 0, 'red'], [1, 1, 'gold']]);
    const move = legalMoves(state).find(move => move.type === type);
    let next = step(state, move).state;
    assert.equal(next.pending.type, 'discard');
    assert.equal(next.currentPlayer, 1);
    assert.equal(next.turnState.extraTurnsPending, 0);
    assert.throws(() => applyMove(next, { type: 'refill' }, mulberry32(2)), /Illegal move/);
    next = step(next, legalMoves(next)[0]).state;
    assert.equal(tokenTotal(next, 'player1'), 10);
    assert.equal(next.currentPlayer, 2);
  }
});

test('pass exists only without mandatory moves and skips discard and victory as specified', () => {
  const state = fixture({ player1: { blue: 4, white: 4, pearl: 2, gold: 1 } }, []);
  for (const level of [1, 2, 3]) {
    state.pyramid[`level${level}`].forEach(card => { card.costs = { black: 100 }; });
  }
  owned(state, { points: 20 });
  // Official rule: with no mandatory action the board must be replenished first; pass only if that is impossible.
  assert.deepEqual(legalMoves(state), [{ type: 'refill' }]);
  const stuck = structuredClone(state);
  for (const color of Object.keys(stuck.bag)) {
    // Keep token conservation: park the bag's tokens with the opponent.
    stuck.players.player2.tokens[color] = (stuck.players.player2.tokens[color] || 0) + stuck.bag[color];
    stuck.bag[color] = 0;
  }
  assert.deepEqual(legalMoves(stuck), [{ type: 'pass' }]);
  const next = step(stuck, { type: 'pass' }).state;
  assert.equal(next.currentPlayer, 2);
  assert.equal(next.pending, null);
  assert.equal(winner(next), null);
  assert.equal(tokenTotal(next, 'player1'), 11);
  assert.equal(legalMoves(fresh()).some(move => move.type === 'pass'), false);
  const refilled = step(state, { type: 'refill' }).state;
  assert.equal(legalMoves(refilled).some(move => move.type === 'pass'), false);
});

test('each victory condition ends immediately for the mover, before a queued extra turn', () => {
  for (const [baseline, acquisition, condition] of [
    [{ points: 19 }, { points: 1 }, 'points_20'],
    [{ crowns: 9 }, { crowns: 1 }, 'crowns_10'],
    [{ points: 9, color: 'red' }, { points: 1, color: 'red' }, 'color_points_10']
  ]) {
    const state = fixture();
    owned(state, baseline);
    const { state: next, events } = step(state, purchase(state, { ...acquisition, ability: 'again' }));
    assert.equal(winner(next), 'player1');
    assert.equal(next.currentPlayer, 1);
    assert.equal(mover(next), null);
    assert.equal(isTerminal(next), true);
    assert.equal(next.pending, null);
    assert.ok(next.gameOver.conditions.some(entry => entry.key === condition));
    assert.equal(next.turnState.extraTurnsPending, 1);
    assert.equal(events.at(-1).type, 'game_over');
    assert.deepEqual(legalMoves(next), []);
    assert.throws(() => applyMove(next, { type: 'pass' }), /Illegal move/);
  }
});

test('choice abilities resolve automatically with one option, skip none, and expose multiple options', () => {
  for (const placements of [[], [[0, 0, 'red']], [[0, 0, 'red'], [1, 1, 'red']]]) {
    const state = fixture({}, placements);
    let next = step(state, purchase(state, { color: 'red', ability: 'token' })).state;
    if (placements.length === 2) {
      assert.deepEqual(legalMoves(next), [
        { type: 'abilityChoice', choice: [0, 0] }, { type: 'abilityChoice', choice: [1, 1] }
      ]);
      assert.throws(() => applyMove(next, { type: 'abilityChoice', choice: [2, 2] }), /Illegal move/);
      next = step(next, legalMoves(next)[0]).state;
    }
    assert.equal(next.players.player1.tokens.red, placements.length ? 1 : 0);
    assert.equal(next.currentPlayer, 2);
  }
  for (const holdings of [{}, { player2: { pearl: 1 } }]) {
    const state = fixture(holdings);
    const next = step(state, purchase(state, { ability: 'steal' })).state;
    assert.equal(next.players.player1.tokens.pearl, holdings.player2 ? 1 : 0);
    assert.equal(next.currentPlayer, 2);
  }
});

test('wild buys enumerate valid stacks, payment/discard caps are configurable, deep equality ignores key order', () => {
  const state = fixture({ player1: { blue: 2, gold: 3 } });
  owned(state, { color: 'red' });
  owned(state, { color: 'green' });
  purchase(state, { color: 'wild', costs: { blue: 2, white: 1 } });
  const buys = legalMoves(state).filter(move => move.type === 'buy' && move.level === 3 && move.index === 0);
  assert.equal(buys.length, 6);
  assert.deepEqual(buys.map(move => move.wildColor), ['green', 'red', 'green', 'red', 'green', 'red']);
  assert.deepEqual(buys.map(move => move.payment.spend.gold), [1, 1, 2, 2, 3, 3]);
  assert.equal(legalMoves(state, { paymentLimit: 1 }).filter(move => move.type === 'buy' && move.level === 3 && move.index === 0).length, 2);
  for (const move of buys) {
    const next = step(state, Object.fromEntries(Object.entries(move).reverse())).state;
    assert.equal(next.players.player1.cards.at(-1).wildColorStack, move.wildColor);
  }
  const excess = fixture({ player1: { blue: 4, white: 4, pearl: 2, gold: 2 } });
  excess.pending = { type: 'discard' };
  excess.turnState.mandatoryDone = true;
  assert.equal(legalMoves(excess).length, 10);
  assert.equal(legalMoves(excess, { discardLimit: 2 }).length, 2);
  assert.throws(() => applyMove(excess, legalMoves(excess)[2], undefined, { discardLimit: 2 }), /Illegal move/);
  step(excess, legalMoves(excess, { discardLimit: 2 })[0], { discardLimit: 2 });
  assert.throws(() => legalMoves(state, { paymentLimit: 0 }), /positive integers/);
});

function playout(seed, { auditAll = false, trace = false } = {}) {
  const rng = mulberry32(seed);
  let state = newGame(cards, rng);
  let turns = 0;
  let decisions = 0;
  const history = [];
  assert.deepEqual(checkInvariants(state), []);
  while (!isTerminal(state) && turns < 600) {
    const moves = legalMoves(state);
    assert.ok(moves.length, `No moves, seed ${seed}, decision ${decisions}`);
    if (auditAll) {
      for (const move of moves) {
        const alternative = applyMove(state, move, mulberry32(decisions));
        assert.deepEqual(checkInvariants(alternative), [], `Alternative ${JSON.stringify(move)}, seed ${seed}`);
      }
    }
    const move = moves[Math.floor(rng() * moves.length)];
    const result = applyMoveWithEvents(state, move, rng);
    state = result.state;
    decisions += 1;
    turns += result.events.filter(event => event.type === 'turn_ended' || event.type === 'game_over').length;
    assert.deepEqual(checkInvariants(state), [], `Seed ${seed}, decision ${decisions}`);
    if (trace) history.push({ move, state });
    assert.ok(decisions < 5000, `Too many decisions, seed ${seed}`);
  }
  assert.ok(isTerminal(state), `Did not terminate within 600 turns: seed ${seed}, decisions ${decisions}`);
  assert.deepEqual(legalMoves(state), []);
  return { state, decisions, turns, history };
}

test('400 uniformly random seeded games terminate within 600 turns with legal decisions and invariants', () => {
  const start = performance.now();
  let decisions = 0;
  let turns = 0;
  let terminated = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    // Audit every returned alternative throughout several complete playouts;
    // every selected legal decision is applied and checked in all 400 games.
    const game = playout(seed, { auditAll: seed <= 3 });
    decisions += game.decisions;
    turns += game.turns;
    terminated += Number(isTerminal(game.state));
  }
  const seconds = (performance.now() - start) / 1000;
  console.log(`Turn playouts: ${terminated}/400 terminated (${terminated / 4}%); average ${(decisions / 400).toFixed(2)} decisions, ${(turns / 400).toFixed(2)} turns/game; ${(decisions / seconds).toFixed(0)} decisions/sec (including invariant checks and alternative audits).`);
});

test('same seed reproduces every decision and state, including refill chance', () => {
  assert.deepEqual(playout(12345, { trace: true }), playout(12345, { trace: true }));
});
