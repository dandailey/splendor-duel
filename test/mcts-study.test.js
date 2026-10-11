import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseMove, chooseMoveAsync } from '../src/ai/index.js';
import { createSearch } from '../src/ai/mcts.js';
import { runAiTurn, runAiTurnAsync } from '../src/ai/bridge.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove } from '../src/engine/turn.js';
import { mulberry32 } from './helpers/rng.js';
import { DEFAULT_GRID, runStudy } from '../tools/mcts-study.mjs';
import { main as selfplayMain } from '../tools/selfplay.mjs';
const cards = loadCards();
const quiet = () => {};

test('empty search preserves defaults for levels 6–8 on ten seeded positions', { timeout: 55000 }, () => {
  for (let seed = 1; seed <= 10; seed++) {
    const rng = mulberry32(seed);
    let state = newGame(cards, rng, { firstPlayer: 1 });
    for (let i = 0; i < seed; i++) {
      const moves = legalMoves(state);
      state = applyMove(state, moves[Math.floor(rng() * moves.length)], rng);
    }
    const before = structuredClone(state);
    for (const level of [6, 7, 8]) {
      assert.deepEqual(chooseMove(state, { level, rng: mulberry32(101 + seed) }),
        chooseMove(state, { level, rng: mulberry32(101 + seed), search: {} }), `seed ${seed}, level ${level}`);
    }
    assert.deepEqual(state, before);
  }
});

test('sync, async and turn APIs forward all search overrides and iteration budgets', async () => {
  const state = newGame(cards, mulberry32(13), { firstPlayer: 2 });
  const search = { iterations: 7, exploration: .8, leafDepth: 1, maxChildren: 8 };
  const expected = createSearch(state, { ...search, rng: mulberry32(42) }).step(7).best();
  const options = () => ({ level: 8, rng: mulberry32(42), search, sliceMs: .01 });
  assert.deepEqual(chooseMove(state, options()), expected);
  assert.deepEqual(await chooseMoveAsync(state, options()), expected);
  const turn = runAiTurn({ gameState: state }, options());
  assert.deepEqual(turn.moves[0], expected);
  assert.deepEqual(await runAiTurnAsync({ gameState: state }, options()), turn);
  const defaults = () => ({ level: 6, rng: mulberry32(4) });
  assert.deepEqual(await chooseMoveAsync(state, defaults()), await chooseMoveAsync(state, { ...defaults(), search: {} }));
  for (const iterations of [-1, 1.5, Infinity]) {
    assert.throws(() => chooseMove(state, { ...options(), search: { iterations } }), /iterations/);
    await assert.rejects(chooseMoveAsync(state, { ...options(), search: { iterations } }), /iterations/);
  }
});

test('study saves each cell atomically, resumes by normalized params, and rejects conflicting metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcts-study-test-'));
  try {
    const results = join(dir, 'nested', 'study.json');
    const calls = [];
    const config = { level: 7, games: 4, workers: 3, results, maxSeconds: 1, grid: [{ exploration: .5 }, {}] };
    let elapsed = 0;
    const match = async options => {
      calls.push(options);
      if (calls.length > 1) assert.equal(JSON.parse(await readFile(results, 'utf8')).cells.length, 1);
      elapsed += 1100;
      return { winsA: 2, winsB: 1, draws: 1, meanMsPerDecisionBySeat: { a: 12, b: 20 } };
    };
    const first = await runStudy(config, { match, log: quiet, now: () => elapsed });
    assert.equal(first.cells.length, 1);
    assert.equal(first.cells[0].secondsPerDecision, .012);
    assert.equal(calls[0].levelA, 7);
    assert.equal(calls[0].levelB, 7);
    assert.deepEqual(calls[0].searchB, {});
    const resumed = await runStudy({ ...config, grid: [{ maxChildren: 16, leafDepth: 0, exploration: .5 }, {}] }, { match, log: quiet, now: () => elapsed });
    assert.equal(resumed.cells.length, 2);
    const logs = [];
    await runStudy(config, { match, log: line => logs.push(line) });
    assert.equal(calls.length, 2);
    assert.ok(logs[0].startsWith('Rank'));
    assert.deepEqual(JSON.parse(await readFile(results, 'utf8')), resumed);
    await assert.rejects(runStudy({ ...config, level: 6 }, { match, log: quiet }), /conflicts/);
    assert.equal(DEFAULT_GRID.length, 18);
    assert.ok(DEFAULT_GRID.some(p => p.exploration === 1.2 && p.leafDepth === 0 && p.maxChildren === 16));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('study timeout leaves incomplete cells pending on resume', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcts-timeout-test-'));
  try {
    const results = join(dir, 'study.json');
    const config = { results, grid: [{}], games: 2 };
    const output = await runStudy(config, { log: quiet, match: async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    } });
    assert.equal(output.cells.length, 0);
    const resumed = await runStudy(config, { log: quiet, match: async () => ({ winsA: 1, winsB: 1, draws: 0, meanMsPerDecisionBySeat: { a: 1 } }) });
    assert.equal(resumed.cells.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('selfplay inline/file search options work in both seat orders and workers and appear in summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcts-options-test-'));
  try {
    const search = join(dir, 'search.json');
    await writeFile(search, '{"iterations":2,"maxChildren":8}');
    const outputs = [];
    for (const workers of [1, 2]) {
      const json = join(dir, `${workers}.json`);
      const logs = [];
      await selfplayMain(['--a', '6', '--b', '6', '--games', '2', '--max-turns', '2', '--workers', String(workers),
        '--search-a', '{"iterations":1,"exploration":0.5}', '--search-b', search, '--json', json], line => logs.push(line));
      const output = JSON.parse(await readFile(json, 'utf8'));
      assert.deepEqual(output.searchA, { iterations: 1, exploration: .5 });
      assert.deepEqual(output.searchB, { iterations: 2, maxChildren: 8 });
      assert.ok(output.meanMsPerDecisionBySeat.a >= 0 && output.meanMsPerDecisionBySeat.b >= 0);
      assert.match(logs.at(-1), /search A .*exploration.* \/ B .*maxChildren/);
      outputs.push([output.winsA, output.winsB, output.draws]);
    }
    assert.deepEqual(outputs[0], outputs[1]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
