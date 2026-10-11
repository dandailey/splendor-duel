import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { mulberry32 } from './helpers/rng.js';
import { determinize } from '../src/ai/hidden.js';
import { evaluate } from '../src/ai/eval.js';
import { chooseMove } from '../src/ai/index.js';

const fresh = () => newGame(loadCards(), mulberry32(42), { firstPlayer: 1 });
test('determinization preserves multisets and public/private holdings without mutation', () => {
  const state = fresh();
  state.players.player1.reserves.push(state.decks.level3.shift());
  state.players.player2.reserves.push(state.decks.level2.shift());
  const before = structuredClone(state);
  const ds = determinize(state, 'player1', mulberry32(8));
  assert.deepEqual(state, before);
  assert.notDeepEqual(ds.decks, state.decks);
  for (const key of Object.keys(state.decks)) {
    const sorted = cards => cards.map(c => JSON.stringify(c)).sort();
    assert.deepEqual(sorted(ds.decks[key]), sorted(state.decks[key]));
  }
  const { decks: a, ...publicA } = state;
  const { decks: b, ...publicB } = ds;
  assert.deepEqual(publicA, publicB);
  assert.deepEqual(ds, determinize(state, 'player1', mulberry32(8)));
  ds.players.player1.reserves[0].points++;
  assert.deepEqual(state, before);
});

test('evaluation and strongest search ignore opponent reserve identities', () => {
  const state = fresh();
  const changed = structuredClone(state);
  state.players.player2.reserves = [{ ...state.decks.level1[0] }];
  changed.players.player2.reserves = [{ ...state.decks.level3[0], points: 999, crowns: 999, costs: {} }];
  assert.equal(evaluate(state, 'player1'), evaluate(changed, 'player1'));
  assert.deepEqual(chooseMove(state, { level: 5, rng: mulberry32(9) }),
    chooseMove(changed, { level: 5, rng: mulberry32(9) }));
  changed.decks.level1.reverse();
  assert.equal(evaluate(state, 'player1'), evaluate(changed, 'player1'));
});

test('hidden sampling validates player and rng', () => {
  assert.throws(() => determinize(fresh(), 'player3', mulberry32(1)), RangeError);
  assert.throws(() => determinize(fresh(), 'player1', () => 1), RangeError);
});
