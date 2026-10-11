import { performance } from 'node:perf_hooks';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove, isTerminal } from '../src/engine/turn.js';
import { mulberry32 } from '../test/helpers/rng.js';

const cards = loadCards();
function batch() {
  let decisions = 0;
  const start = performance.now();
  for (let game = 0; game < 60; game++) {
    const rng = mulberry32(game + 1);
    let state = newGame(cards, rng);
    let steps = 0;
    while (!isTerminal(state) && steps < 4000) {
      const moves = legalMoves(state);
      state = applyMove(state, moves[Math.floor(rng() * moves.length)], rng);
      decisions++;
      steps++;
    }
  }
  const seconds = (performance.now() - start) / 1000;
  return { games: 60, decisions, seconds, decisionsPerSec: Math.round(decisions / seconds) };
}

// Retain the original cold 60-game measurement. Then report sustained search
// throughput separately: the same workload, after two additional warmup batches.
const cold = batch();
batch();
batch();
const sustained = batch();
console.log(JSON.stringify({ ...cold, sustained }));
