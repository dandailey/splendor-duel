import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { WEIGHTS, PARAM_SPECS, evaluate, flattenWeights, unflattenWeights, clampWeights } from '../src/ai/eval.js';
import { chooseMove, chooseMoveAsync } from '../src/ai/index.js';
import { createSearch } from '../src/ai/mcts.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { seededRng, perturbWeights, runTuning } from '../tools/spsa.mjs';
import { mulberry32 } from './helpers/rng.js';

const cards = loadCards();
const quiet = () => {};
const fakeMatch = async ({ weightsA, weightsB, seed }) => ({ scorePercent:
  50 + 20 * Math.tanh(Object.keys(weightsA).reduce((sum, key) =>
    sum + (weightsA[key] - weightsB[key]) / PARAM_SPECS[key].scale, 0) / 10) + (seed % 7 - 3) });

test('weights round trip with stable names, nested leaves, and bounds', () => {
  assert.deepEqual(unflattenWeights(flattenWeights(WEIGHTS)), WEIGHTS);
  const nested = { tokens: { pearl: 1.2, gem: 0.8 }, points: 3 };
  assert.deepEqual(Object.keys(flattenWeights(nested)), ['points', 'tokens.gem', 'tokens.pearl']);
  assert.deepEqual(unflattenWeights(flattenWeights(nested)), nested);
  const flat = flattenWeights(WEIGHTS);
  const before = structuredClone(flat);
  assert.deepEqual(clampWeights(flat), flat);
  for (const [name, spec] of Object.entries(PARAM_SPECS)) {
    assert.equal(clampWeights({ ...flat, [name]: spec.min - 1 })[name], spec.min);
    assert.equal(clampWeights({ ...flat, [name]: spec.max + 1 })[name], spec.max);
    assert.equal(spec.scale, Math.max(0.05, Math.abs(WEIGHTS[name]) * 0.15));
  }
  assert.deepEqual(flat, before);
  assert.throws(() => clampWeights({ ...flat, points: NaN }));
  assert.throws(() => clampWeights({ points: 1 }));
});

test('Bernoulli perturbations are seeded, bounded, and preserve theta', () => {
  const theta = flattenWeights(WEIGHTS), before = structuredClone(theta);
  const run = seed => {
    const rng = seededRng(seed);
    return perturbWeights(theta, 1, () => rng.next());
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42).delta, run(43).delta);
  const result = run(42);
  for (const [name, delta] of Object.entries(result.delta)) {
    assert.ok(delta === -1 || delta === 1);
    assert.equal(result.plus[name], theta[name] + delta * PARAM_SPECS[name].scale);
    assert.equal(result.minus[name], theta[name] - delta * PARAM_SPECS[name].scale);
  }
  assert.deepEqual(theta, before);
  const edge = { ...theta, points: 0 };
  const rng = seededRng(1);
  const bounded = perturbWeights(edge, 1000, () => rng.next());
  assert.deepEqual(clampWeights(bounded.plus), bounded.plus);
  assert.deepEqual(clampWeights(bounded.minus), bounded.minus);
});

test('resume after two iterations and an interrupted match equals four uninterrupted iterations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spsa-test-'));
  try {
    const stateFile = join(dir, 'resume.json'), fullFile = join(dir, 'full.json');
    const config = { seed: 73, games: 2, workers: 1 };
    // The child commits two iterations, then waits in its third fake match.
    // SIGKILL bypasses handlers and tests the on-disk recovery boundary.
    const script = `
      import { runTuning } from ${JSON.stringify(new URL('../tools/spsa.mjs', import.meta.url).href)};
      import { PARAM_SPECS } from ${JSON.stringify(new URL('../src/ai/eval.js', import.meta.url).href)};
      import { writeFile } from 'node:fs/promises';
      const fakeMatch = ${fakeMatch.toString()};
      let matches = 0;
      await runTuning({ stateFile: ${JSON.stringify(stateFile)}, config: ${JSON.stringify(config)}, iterations: 4,
        match: async args => {
          if (++matches === 3) {
            await writeFile(${JSON.stringify(join(dir, 'ready'))}, 'ready');
            await new Promise(() => { setInterval(() => {}, 1000); });
          }
          return fakeMatch(args);
        } });`;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' });
      let ready = false;
      const cleanup = () => { clearTimeout(timer); clearInterval(poll); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); cleanup(); reject(Error('Kill test timed out')); }, 10000);
      // File readiness also works on hosts where subprocess pipes are restricted.
      const poll = setInterval(async () => {
        try {
          await readFile(join(dir, 'ready'));
          ready = true;
          child.kill('SIGKILL');
        } catch (error) { if (error.code !== 'ENOENT') { cleanup(); child.kill('SIGKILL'); reject(error); } }
      }, 10);
      child.on('error', error => { cleanup(); reject(error); });
      child.on('exit', (code, signal) => {
        cleanup();
        if (signal === 'SIGKILL' && ready) resolve();
        else reject(Error(`Child exited ${code}/${signal}`));
      });
    });
    const first = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(first.k, 2);
    await assert.rejects(runTuning({ stateFile, iterations: 1, match: async () => { throw new Error('killed'); }, log: quiet }), /killed/);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), first);
    const resumed = await runTuning({ stateFile, iterations: 2, match: fakeMatch, log: quiet, exportFile: join(dir, 'weights.json') });
    const full = await runTuning({ stateFile: fullFile, iterations: 4, config, match: fakeMatch, log: quiet });
    assert.deepEqual(resumed, full);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'weights.json'), 'utf8')), unflattenWeights(full.theta));
    assert.equal(full.history.length, 4);
    assert.equal(full.k, 4);
    await assert.rejects(runTuning({ stateFile, config: { seed: 74 }, iterations: 0, log: quiet }), /mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('time and stop guards leave a valid resumable iteration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spsa-guard-'));
  try {
    let stop = false;
    const stateFile = join(dir, 'state.json');
    const saved = await runTuning({ stateFile, iterations: 4, match: async args => {
      stop = true;
      return fakeMatch(args);
    }, shouldStop: () => stop, log: quiet });
    assert.equal(saved.k, 1);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), saved);
    const expired = await runTuning({ stateFile, iterations: 4, maxSeconds: Number.MIN_VALUE, log: quiet, match: () => { throw Error('unexpected game'); } });
    assert.deepEqual(expired, saved);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('explicit baseline weights choose identical moves on twenty seeded positions at L3, L5, L7', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const state = newGame(cards, mulberry32(seed));
    const before = structuredClone(state);
    for (const level of [3, 5, 7]) {
      assert.deepEqual(chooseMove(state, { level, rng: mulberry32(seed + 100) }),
        chooseMove(state, { level, rng: mulberry32(seed + 100), weights: WEIGHTS }));
    }
    assert.deepEqual(state, before);
  }
});

test('custom evaluation weights reach async choices and search leaves and priors', async () => {
  const state = newGame(cards, mulberry32(9));
  const weights = { ...WEIGHTS, gem: 4, pearl: 4, reserve: 4 };
  state.players.player1.tokens.blue = 1;
  const before = structuredClone(weights);
  assert.notEqual(evaluate(state, 'player1'), evaluate(state, 'player1', { weights }));
  const move = chooseMove(state, { level: 6, rng: mulberry32(99), weights });
  assert.deepEqual(await chooseMoveAsync(state, { level: 6, rng: mulberry32(99), weights, sliceMs: 1 }), move);
  const search = w => createSearch(state, { rng: mulberry32(9), weights: w, leafDepth: 1 }).step(3).stats();
  assert.notDeepEqual(search(WEIGHTS), search(weights));
  assert.deepEqual(weights, before);
});
