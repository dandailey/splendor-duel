#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { WEIGHTS, PARAM_SPECS, flattenWeights, unflattenWeights, clampWeights } from '../src/ai/eval.js';
import { playMatch } from './selfplay.mjs';

export const DEFAULT_CONFIG = Object.freeze({ games: 16, level: 5, workers: 3, seed: 1,
  a: 1, A: 10, alpha: 0.602, c: 1, gamma: 0.101, maxChange: 0.05 });
const usage = `Usage: node tools/spsa.mjs --state FILE [--iterations 40] [--games 16]
  [--level 5] [--workers 3] [--seed 1] [--init weights.json] [--export out.json]
  [--max-seconds 480] [--a 1] [--A 10] [--alpha 0.602] [--c 1]
  [--gamma 0.101] [--max-change 0.05]
Iterations are additional iterations per invocation. Resume uses the saved config;
explicit conflicting options are rejected. Games must be even (paired seats).
Gains: a_k=a/(k+A)^alpha, c_k=c/k^gamma (k starts at 1).
Perturbations use PARAM_SPECS.scale (15% of baseline, floor 0.05).
The step is clipped per parameter to max-change * max(|theta|, scale).
The wall-clock limit and SIGINT/SIGTERM finish the current iteration first.`;

// Mulberry32 with an explicit, serializable state.
export function seededRng(seed) {
  let state = seed >>> 0;
  return { next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, 1 | state);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  }, get state() { return state; } };
}
export const checksum = theta => createHash('sha256').update(JSON.stringify(flattenWeights(theta))).digest('hex').slice(0, 16);
export function perturbWeights(theta, c, rng) {
  const delta = {}, plus = {}, minus = {};
  for (const [name, value] of Object.entries(clampWeights(theta))) {
    delta[name] = rng() < 0.5 ? -1 : 1;
    const shift = c * PARAM_SPECS[name].scale * delta[name];
    plus[name] = value + shift;
    minus[name] = value - shift;
  }
  return { delta, plus: clampWeights(plus), minus: clampWeights(minus) };
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}
function validateConfig(config) {
  for (const name of ['games', 'level', 'workers']) if (!Number.isSafeInteger(config[name]) || config[name] < 1) throw new RangeError(`Invalid ${name}`);
  if (config.games % 2 || config.level > 10) throw new RangeError('games must be even and level must be 1 through 10');
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new RangeError('seed must be uint32');
  for (const name of ['a', 'alpha', 'c', 'gamma', 'maxChange']) if (!Number.isFinite(config[name]) || config[name] <= 0) throw new RangeError(`Invalid ${name}`);
  if (!Number.isFinite(config.A) || config.A < 0 || config.maxChange > 1) throw new RangeError('Invalid A or maxChange');
}

/** Fake match injection supports fast reproducibility tests without game IO. */
export async function runTuning({ stateFile, iterations = 40, maxSeconds = 480,
  init, exportFile, config: overrides = {}, match = playMatch, log = console.log,
  shouldStop = () => false } = {}) {
  if (!stateFile) throw new Error('--state is required');
  if (!Number.isSafeInteger(iterations) || iterations < 0) throw new RangeError('iterations must be non-negative');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new RangeError('max-seconds must be positive');
  for (const key of Object.keys(overrides)) if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown config: ${key}`);
  const start = performance.now();
  let saved;
  try { saved = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved) {
    if (init) throw new Error('--init cannot be used with an existing state');
    if (saved.version !== 1 || !Number.isSafeInteger(saved.k) || saved.k < 0 ||
      !Number.isSafeInteger(saved.rngState) || saved.rngState < 0 || saved.rngState > 0xffffffff ||
      !Array.isArray(saved.history) || saved.history.length !== saved.k ||
      JSON.stringify(saved.paramSpecs) !== JSON.stringify(PARAM_SPECS)) throw new Error('Invalid or incompatible tuning state');
    for (const [key, value] of Object.entries(overrides)) if (saved.config[key] !== value) throw new Error(`Resume config mismatch: ${key}`);
    if (JSON.stringify(clampWeights(saved.theta)) !== JSON.stringify(saved.theta)) throw new Error('Invalid saved theta');
  } else {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    validateConfig(config);
    saved = { version: 1, theta: clampWeights(init ?? WEIGHTS), k: 0, history: [],
      rngState: config.seed, config, paramSpecs: PARAM_SPECS };
    await atomicJson(stateFile, saved);
  }
  validateConfig(saved.config);
  const config = saved.config;
  let completed = 0;
  for (; completed < iterations && !shouldStop() && (performance.now() - start) / 1000 < maxSeconds; completed++) {
    const rng = seededRng(saved.rngState), k = saved.k + 1;
    const ak = config.a / (k + config.A) ** config.alpha;
    const ck = config.c / k ** config.gamma;
    const { plus, minus } = perturbWeights(saved.theta, ck, () => rng.next());
    const seed = Math.floor(rng.next() * 4294967296);
    const result = await match({ weightsA: unflattenWeights(plus), weightsB: unflattenWeights(minus),
      levelA: config.level, levelB: config.level, games: config.games, workers: config.workers, seed });
    if (!Number.isFinite(result.scorePercent) || result.scorePercent < 0 || result.scorePercent > 100) throw new Error('Match returned an invalid scorePercent');
    // y+ is A's score; y- is B's complementary score, both in [0,1].
    const difference = 2 * result.scorePercent / 100 - 1;
    const next = {};
    for (const [name, value] of Object.entries(saved.theta)) {
      // At bounds use the actual separation in scaled coordinates. A fully
      // collapsed perturbation contributes no gradient.
      const separation = (plus[name] - minus[name]) / PARAM_SPECS[name].scale;
      const gradient = separation === 0 ? 0 : difference / separation;
      const rawStep = ak * gradient * PARAM_SPECS[name].scale;
      const limit = config.maxChange * Math.max(Math.abs(value), PARAM_SPECS[name].scale);
      next[name] = value + Math.max(-limit, Math.min(limit, rawStep));
    }
    const theta = clampWeights(next);
    const stepNorm = Math.sqrt(Object.keys(theta).reduce((sum, name) =>
      sum + ((theta[name] - saved.theta[name]) / PARAM_SPECS[name].scale) ** 2, 0));
    const thetaChecksum = checksum(theta);
    saved = { ...saved, theta, k, rngState: rng.state,
      history: [...saved.history, { iteration: k, score: result.scorePercent, thetaChecksum }] };
    await atomicJson(stateFile, saved);
    log(`k=${k} score+=${result.scorePercent.toFixed(2)}% step norm=${stepNorm.toFixed(6)} theta=${thetaChecksum}`);
  }
  if (exportFile) await atomicJson(exportFile, unflattenWeights(saved.theta));
  log(`Summary: ${completed} iterations completed; k=${saved.k}; theta=${checksum(saved.theta)}; state=${stateFile}`);
  return saved;
}
export async function main(args = process.argv.slice(2), log = console.log) {
  const options = { config: {} };
  const flags = { '--state': 'stateFile', '--iterations': 'iterations', '--max-seconds': 'maxSeconds', '--init': 'initFile', '--export': 'exportFile' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') { log(usage); return; }
    const key = flags[flag] ?? (flag === '--max-change' ? 'maxChange' : flag.slice(2));
    if ((!flags[flag] && !(key in DEFAULT_CONFIG)) || !flag.startsWith('--') || i + 1 >= args.length) throw new Error(`Unknown or incomplete option: ${flag}`);
    const value = args[++i];
    if (flags[flag]) options[key] = ['stateFile', 'initFile', 'exportFile'].includes(key) ? value : Number(value);
    else options.config[key] = Number(value);
  }
  if (options.initFile) options.init = JSON.parse(await readFile(options.initFile, 'utf8'));
  let stop = false;
  const onSignal = () => { stop = true; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try { return await runTuning({ ...options, log, shouldStop: () => stop }); }
  finally { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
