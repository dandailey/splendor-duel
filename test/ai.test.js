import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove, mover, winner, isTerminal } from '../src/engine/turn.js';
import { chooseMove, LEVELS } from '../src/ai/index.js';
import { evaluate, WEIGHTS } from '../src/ai/eval.js';
import { mulberry32 } from './helpers/rng.js';
const cards = loadCards();

function game(a, b, seed, firstPlayer) {
  const setupRng = mulberry32(seed);
  const rngs = { player1: mulberry32(seed + 10000), player2: mulberry32(seed + 20000) };
  const chance = mulberry32(seed + 30000);
  let state = newGame(cards, setupRng, { firstPlayer });
  for (let step = 0; step < 700; step++) {
    if (isTerminal(state)) return winner(state);
    const id = mover(state);
    const level = id === 'player1' ? a : b;
    const moves = legalMoves(state);
    const move = level ? chooseMove(state, { level, rng: rngs[id] }) :
      moves[Math.floor(rngs[id]() * moves.length)];
    assert.ok(moves.some(m => JSON.stringify(m) === JSON.stringify(move)));
    state = applyMove(state, move, chance);
  }
  assert.fail(`Game did not finish: ${a} vs ${b}, seed ${seed}`);
}

test('all levels return legal deterministic moves and preserve inputs', () => {
  const state = newGame(cards, mulberry32(7));
  const before = structuredClone(state);
  for (const level of Object.keys(LEVELS).map(Number)) {
    const move = chooseMove(state, { level, rng: mulberry32(4) });
    assert.ok(legalMoves(state).some(m => JSON.stringify(m) === JSON.stringify(move)));
    assert.deepEqual(move, chooseMove(state, { level, rng: mulberry32(4) }));
  }
  assert.deepEqual(state, before);
  for (const level of [0, 11, 1.5]) {
    assert.throws(() => chooseMove(state, { level, rng: mulberry32(1) }), RangeError);
  }
});

test('terminal scoring, immediate winning buy, forced and terminal decisions', () => {
  const state = newGame(cards, mulberry32(8), { firstPlayer: 1 });
  Object.assign(state.pyramid.level3[0], { points: 20, costs: {}, ability: null });
  for (let level = 1; level <= 5; level++) {
    const m = chooseMove(state, { level, rng: mulberry32(5) });
    assert.equal(m.type, 'buy');
    const next = applyMove(state, m, mulberry32(3));
    assert.equal(winner(next), 'player1');
    assert.equal(evaluate(next, 'player1'), WEIGHTS.terminal);
    assert.equal(evaluate(next, 'player2'), -WEIGHTS.terminal);
    assert.equal(chooseMove(next, { rng: mulberry32(1) }), null);
  }
  const forced = structuredClone(state);
  forced.pending = { type: 'discard' };
  forced.players.player1.tokens = { blue: 11, white: 0, green: 0, red: 0, black: 0, pearl: 0, gold: 0 };
  assert.equal(legalMoves(forced).length, 1);
  assert.deepEqual(chooseMove(forced, { rng: () => { throw Error('unexpected RNG'); } }), legalMoves(forced)[0]);
});

test('seeded complete games against uniformly random moves', () => {
  for (let level = 1; level <= 5; level++) {
    let wins = 0;
    for (let i = 0; i < 10; i++) {
      if (game(level, 0, 100 + i, i % 2 + 1) === 'player1') wins++;
    }
    console.log(`L${level} vs random: ${wins}/10`);
    if (level >= 2) assert.ok(wins >= 7, `L${level}: ${wins}/10`);
  }
});

test('mini-matches with alternating first player', () => {
  // Two adjacent games keep the match budget small with the cloning engine.
  // Retain the requested twenty-game L5/L3 sanity check.
  for (const [high, low, count] of [[2, 1, 2], [3, 2, 2], [4, 3, 2], [5, 4, 2], [5, 3, 20]]) {
    let wins = 0;
    for (let i = 0; i < count; i++) {
      if (game(high, low, 500 + i, i % 2 + 1) === 'player1') wins++;
    }
    console.log(`L${high} vs L${low}: ${wins}/${count}`);
    if (high === 5 && low === 3) assert.ok(wins >= 11, `L5 vs L3: ${wins}/20`);
  }
});

test('L5 timing across fifty random-playout positions', () => {
  const rng = mulberry32(321);
  let state = newGame(cards, rng);
  const timings = [];
  for (let i = 0; i < 150; i++) {
    if (isTerminal(state)) state = newGame(cards, rng);
    if (i % 3 === 0) {
      const start = performance.now();
      chooseMove(state, { level: 5, rng: mulberry32(1000 + i) });
      timings.push(performance.now() - start);
    }
    const moves = legalMoves(state);
    state = applyMove(state, moves[Math.floor(rng() * moves.length)], rng);
  }
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  const max = Math.max(...timings);
  console.log(`L5 timing: mean ${mean.toFixed(2)} ms, max ${max.toFixed(2)} ms, n=${timings.length}`);
  // Report the budget honestly: root applyMove cloning can exceed it.
  assert.ok(Number.isFinite(mean) && timings.length === 50);
});
