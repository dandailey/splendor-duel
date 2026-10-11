import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneState } from '../src/engine/clone.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove, applyMoveWithEvents, isTerminal } from '../src/engine/turn.js';
import { mulberry32 } from './helpers/rng.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function freezeCards(state) {
  for (const levels of [state.decks, state.pyramid]) {
    for (const cards of Object.values(levels)) cards.forEach(freeze);
  }
  for (const player of Object.values(state.players)) {
    player.cards.forEach(freeze);
    player.reserves.forEach(freeze);
  }
  state.royalCards.forEach(freeze);
}

test('specialized clone shares immutable cards and detaches every mutable state container', () => {
  const state = newGame(loadCards(), mulberry32(1));
  state.pending = { type: 'ability', choice: { cell: [1, 2] } };
  state.gameOver = { winnerId: 'player1', conditions: [{ key: 'example' }],
    winnerStats: { totalPoints: 20, colorPoints: { blue: 10 } } };
  state.players.player1.cards.push(state.decks.level1.pop());
  state.players.player2.reserves.push(state.decks.level2.pop());
  const before = structuredClone(state);
  const next = cloneState(freeze(state));
  assert.deepEqual(next, state);
  for (const group of ['decks', 'pyramid']) for (const level of Object.keys(state[group])) {
    assert.notEqual(next[group][level], state[group][level]);
    next[group][level].forEach((card, i) => assert.equal(card, state[group][level][i]));
    next[group][level].pop();
  }
  for (const id of ['player1', 'player2']) {
    assert.notEqual(next.players[id], state.players[id]);
    for (const field of ['cards', 'reserves']) {
      assert.notEqual(next.players[id][field], state.players[id][field]);
      next.players[id][field].forEach((card, i) => assert.equal(card, state.players[id][field][i]));
      next.players[id][field].pop();
    }
    next.players[id].tokens.blue++;
    next.players[id].privileges++;
  }
  next.bag.blue++;
  next.board[0][0] = null;
  next.royalCards[0].taken = true;
  next.turnState.boardRefilled = true;
  next.pending.choice.cell[0] = 4;
  next.gameOver.conditions[0].key = 'changed';
  next.gameOver.winnerStats.colorPoints.blue++;
  next.previousCrownCounts.player1++;
  next.syncAssignments.player1Id = 'changed';
  next.initialDeckSizes.level1++;
  assert.deepEqual(state, before);
});

test('fifty random games with deeply frozen cards and frozen states finish without mutation', () => {
  const cards = loadCards();
  let wildBuys = 0;
  let royalClaims = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const rng = mulberry32(seed);
    let state = newGame(cards, rng);
    freezeCards(state);
    let decisions = 0;
    while (!isTerminal(state) && decisions < 4000) {
      const moves = legalMoves(freeze(state));
      const move = freeze(moves[Math.floor(rng() * moves.length)]);
      const { state: next, events } = applyMoveWithEvents(state, move, rng);
      wildBuys += Number(move.type === 'buy' && Object.hasOwn(move, 'wildColor'));
      royalClaims += Number(move.type === 'royal');
      // Event card snapshots must also be detached from the shared records.
      for (const event of events) if (event.card) {
        const bought = next.players[`player${state.currentPlayer}`].cards.at(-1);
        assert.notEqual(event.card, bought);
        assert.notEqual(event.card.costs, bought.costs);
      }
      state = next;
      freezeCards(state);
      decisions++;
    }
    assert.ok(isTerminal(state), `Seed ${seed} failed to finish`);
  }
  assert.ok(wildBuys > 0, 'Frozen-card games must exercise wild placement');
  assert.ok(royalClaims > 0, 'Frozen-card games must exercise Royal supply mutation');
});

test('move-specific validation rejects extra fields, reversed takes, and stale fixture payments', () => {
  const state = newGame(loadCards(), mulberry32(1));
  const moves = legalMoves(state);
  const take = moves.find(move => move.type === 'take' && move.cells.length > 1);
  assert.throws(() => applyMove(state, { ...take, cells: [...take.cells].reverse() }), /Illegal move/);
  for (const move of moves) {
    assert.throws(() => applyMove(state, { ...move, extra: true }), /Illegal move/);
  }
  const before = structuredClone(state);
  for (const move of moves) applyMove(state, move, mulberry32(2));
  assert.deepEqual(state, before);
  // External fixture edits must take effect immediately: there is no stale
  // state-identity cache of move lists or affordability.
  state.pyramid.level3[0] = { ...state.pyramid.level3[0], costs: {} };
  const buy = legalMoves(state).find(move => move.type === 'buy' && move.level === 3 && move.index === 0);
  assert.ok(buy);
  state.pyramid.level3[0] = { ...state.pyramid.level3[0], costs: { pearl: 100 } };
  assert.throws(() => applyMove(state, buy, mulberry32(2)), /Illegal move/);
});
