import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearch, chooseMoveSearch, SEARCH_LEVELS } from '../src/ai/mcts.js';
import { chooseMove, chooseMoveAsync } from '../src/ai/index.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove, isTerminal } from '../src/engine/turn.js';
import { serializeSnapshot, parseSnapshot } from '../src/ai/vs-computer-save.js';
import { gameFromEngineState } from '../src/ai/bridge.js';
import { createVsComputerState, enableComputer, disableComputer, scheduleComputerTurn } from '../src/ai/vs-computer.js';
import { mulberry32 } from './helpers/rng.js';
const cards = loadCards();
const initial = seed => newGame(cards, mulberry32(seed), { firstPlayer: 1 });
const key = JSON.stringify;
function positions(count, seed = 104) {
  const rng = mulberry32(seed), states = [];
  let state = initial(seed);
  for (let i = 0; i < count; i++) {
    if (isTerminal(state)) state = initial(seed + i);
    states.push(state);
    const moves = legalMoves(state);
    state = applyMove(state, moves[Math.floor(rng() * moves.length)], rng);
  }
  return states;
}

test('ISMCTS determinism, resumable iteration budgets, JSON stats and immutable inputs', () => {
  const state = initial(4), before = structuredClone(state);
  const one = createSearch(state, { rng: mulberry32(23) }).step(150);
  const sliced = createSearch(state, { rng: mulberry32(23) });
  sliced.step(13).step(0).step(37).step(100);
  assert.equal(sliced.iterations, 150);
  assert.deepEqual(sliced.stats(), one.stats());
  assert.deepEqual(sliced.best(), one.best());
  assert.deepEqual(chooseMoveSearch(state, { level: 6, rng: mulberry32(23) }), one.best());
  assert.deepEqual(state, before);
  assert.deepEqual(JSON.parse(JSON.stringify(one.stats())), one.stats());
  assert.ok(one.stats().children.every(c => c.availability >= c.visits));
  assert.ok(createSearch(state, { rng: mulberry32(3) }).best());
});

test('ISMCTS returns a legal non-null decision over 100 random positions', () => {
  positions(100).forEach((state, i) => {
    const move = createSearch(state, { rng: mulberry32(i), leafDepth: i % 20 === 0 ? 1 : 0 }).step(12).best();
    assert.ok(move);
    assert.ok(legalMoves(state).some(m => key(m) === key(move)), `position ${i}`);
  });
});

test('search wins immediately, including forced resolutions, and handles terminal states', () => {
  for (const ability of [null, 'token']) {
    const state = initial(8);
    Object.assign(state.pyramid.level3[0], { points: 20, costs: {}, ability, color: 'red', crowns: 0, isDouble: false });
    const move = chooseMoveSearch(state, { level: 6, rng: mulberry32(9) });
    assert.equal(move.type, 'buy');
    assert.equal(move.level, 3);
    assert.equal(move.index, 0);
    const terminal = structuredClone(state);
    terminal.gameOver.winnerId = 'player1';
    assert.equal(createSearch(terminal, { rng: mulberry32(9) }).step(30).best(), null);
  }
});

test('search denies an immediate opponent winning buy when a safe reservation exists', () => {
  const state = initial(2);
  // The opponent can win by buying this free card. Reserving it removes the
  // threat without handing control to a winning opponent response.
  Object.assign(state.pyramid.level3[0], { points: 1, costs: {}, ability: null, color: 'red', crowns: 0, isDouble: false });
  state.players.player2.cards.push({ id: 'near-win', level: 3, points: 19, costs: {}, ability: null, color: 'none', crowns: 0, isDouble: false });
  // Buying the same card is also safe; all takes leave a forced opponent win.
  const move = createSearch(state, { rng: mulberry32(87) }).step(600).best();
  assert.ok(['buy', 'reserve'].includes(move.type), key(move));
  assert.equal(move.source, 'pyramid');
  assert.equal(move.level, 3);
  assert.equal(move.index, 0);
});

test('opponent reserve identities never influence the search', () => {
  const a = initial(99), b = structuredClone(a);
  a.players.player2.reserves.push({ ...a.pyramid.level1[0], points: 99, costs: {} });
  b.players.player2.reserves.push({ ...b.pyramid.level3[0], points: 0, costs: { red: 99 } });
  const first = createSearch(a, { rng: mulberry32(3) }).step(100);
  const second = createSearch(b, { rng: mulberry32(3) }).step(100);
  assert.deepEqual(first.stats(), second.stats());
});

test('async 600-iteration search yields, preserves deterministic budget and aborts', async () => {
  const state = initial(15), timer = globalThis.setTimeout;
  let slices = 0;
  try {
    globalThis.setTimeout = (callback, delay) => {
      assert.equal(delay, 0);
      slices++;
      queueMicrotask(callback);
    };
    const move = await chooseMoveAsync(state, { level: 8, rng: mulberry32(7), sliceMs: .001 });
    assert.ok(slices >= 599);
    assert.deepEqual(move, chooseMove(state, { level: 8, rng: mulberry32(7) }));
    assert.deepEqual(await chooseMoveAsync(state, { level: 3, rng: mulberry32(7) }),
      chooseMove(state, { level: 3, rng: mulberry32(7) }));
    const controller = new AbortController();
    const promise = chooseMoveAsync(state, { level: 8, rng: mulberry32(7), sliceMs: .001, signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
  } finally { globalThis.setTimeout = timer; }
});

test('async UI turn guards double starts, paints, and cancels an in-flight new game', async () => {
  const live = gameFromEngineState(newGame(cards, mulberry32(1), { firstPlayer: 2 }));
  const ui = createVsComputerState();
  enableComputer(8, ui);
  let queued, applied = 0, paints = 0;
  const options = { getGame: () => live, applyGame() { applied++; }, refresh() { paints++; },
    rng: mulberry32(7), schedule(callback) { queued = callback; } };
  assert.equal(scheduleComputerTurn(options, ui), true);
  assert.equal(scheduleComputerTurn(options, ui), false);
  assert.equal(paints, 1);
  queued();
  assert.equal(ui.busy, true);
  disableComputer(ui);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(applied, 0);
  assert.equal(ui.busy, false);
  assert.equal(ui.error, null);
});

test('search levels round-trip through the live snapshot codec', () => {
  const state = gameFromEngineState(initial(42));
  state.turnDisplayState = { activePlayerId: 'player1', opponentPlayerId: 'player2' };
  state.turnHistory = { turns: [], pendingTurn: null, nextTurnId: 1 };
  for (const level of [6, 7, 8, 9, 10]) {
    assert.equal(parseSnapshot(serializeSnapshot(state, { level, savedAt: 123 })).level, level);
  }
});

test('search timing across 20 random positions stays within decision budgets', () => {
  const states = positions(80).filter((_, i) => i % 4 === 0);
  for (const level of [6, 10]) {
    const timings = states.map((state, i) => {
      const start = performance.now();
      chooseMoveSearch(state, { level, rng: mulberry32(1000 + i) });
      return performance.now() - start;
    });
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length, max = Math.max(...timings);
    console.log(`L${level} timing: mean ${mean.toFixed(2)} ms, max ${max.toFixed(2)} ms, n=20; budget=${SEARCH_LEVELS[level].iterations}`);
    // Wall time varies when the full suite runs tests in parallel.
    assert.ok(mean < (level === 6 ? 800 : 8000), `L${level} mean ${mean}`);
  }
});

test('paired strength smoke L6/L5 and L8/L6 (small suite sample)', { timeout: 149000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'splendor-mcts-'));
  try {
    for (const [high, low] of [[6, 5], [8, 6]]) {
      const file = join(dir, `${high}-${low}.json`);
      const result = await promisify(execFile)(process.execPath, ['tools/selfplay.mjs', '--a', String(high), '--b', String(low),
        '--games', '2', '--seed', '600', '--max-turns', '90', '--workers', '3', '--json', file], { timeout: 70000 });
      console.log(result.stdout.trim());
      const stats = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(stats.games, 2);
      assert.ok(stats.winsA + stats.draws >= 1, `L${high} lost both paired games`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
