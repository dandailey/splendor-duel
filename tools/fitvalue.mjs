#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FEATURE_NAMES } from '../src/ai/features.js';
import { seededRng } from './lib/value-rng.mjs';
export const sigmoid = z => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
export const dot = (w, x) => w.reduce((sum, v, i) => sum + v * x[i], 0);

/** Full-batch GD on mean cross entropy + lambda/2 * ||standardized w||^2.
 * RMS standardization (no centering) preserves a zero intercept exactly.
 * Export coefficients in raw coordinates, so inference needs no scaler.
 */
export function fitLogistic(rows, { lambda = 0.001, iterations = 1800 } = {}) {
  if (!rows.length || !Number.isFinite(lambda) || lambda < 0 || !Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Invalid fit input');
  const d = rows[0].x.length;
  if (!d || rows.some(r => r.x.length !== d || !Array.from(r.x).every(Number.isFinite) || !Number.isFinite(r.y) || r.y < 0 || r.y > 1)) throw new Error('Invalid fit rows');
  const scale = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) scale[j] += r.x[j] ** 2 / rows.length;
  for (let j = 0; j < d; j++) scale[j] = Math.sqrt(scale[j]) || 1;
  const xs = rows.map(r => Float64Array.from(r.x, (v, j) => v / scale[j]));
  const w = new Float64Array(d);
  const gradient = new Float64Array(d);
  const rate = 1 / (0.25 * xs.reduce((n, x) => n + dot(x, x) / rows.length, 0) + lambda);
  for (let k = 0; k < iterations; k++) {
    gradient.fill(0);
    for (let i = 0; i < rows.length; i++) {
      const error = sigmoid(dot(w, xs[i])) - rows[i].y;
      for (let j = 0; j < d; j++) gradient[j] += error * xs[i][j] / rows.length;
    }
    let norm = 0;
    for (let j = 0; j < d; j++) { const g = gradient[j] + lambda * w[j]; norm += g * g; w[j] -= rate * g; }
    if (norm < 1e-14) break;
  }
  return Array.from(w, (v, j) => v / scale[j]);
}
export function metrics(rows, w) {
  if (!rows.length) return { n: 0, logLoss: null, accuracy: null, brier: null };
  let loss = 0, correct = 0, brier = 0;
  for (const r of rows) {
    const z = dot(w, r.x), p = sigmoid(z);
    loss += Math.max(z, 0) - r.y * z + Math.log1p(Math.exp(-Math.abs(z)));
    correct += (p >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
    brier += (p - r.y) ** 2;
  }
  return { n: rows.length, logLoss: loss / rows.length, accuracy: correct / rows.length, brier: brier / rows.length };
}
export function splitGames(games, seed = 1) {
  if (games.length < 2) throw new Error('At least two games required');
  const shuffled = [...games].sort((a, b) => a.seed - b.seed), rng = seededRng(seed);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const n = Math.max(1, Math.min(games.length - 1, Math.round(games.length * 0.2)));
  return { train: shuffled.slice(n), val: shuffled.slice(0, n) };
}
function rowsFor(games, baseline = false) {
  return games.flatMap(g => g.plies.map((p, i) => ({ x: baseline ? [p.baseline] : p.features,
    y: g.winner, phase: Math.min(2, Math.floor(3 * i / g.plies.length)) })));
}
export async function main(args = process.argv.slice(2)) {
  const options = { name: 'value', seed: 1 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (args[i] === '--help') { console.log('fitvalue --in FILE --name NAME [--seed 1]'); return; }
    if (!args[i].startsWith('--') || !['in', 'name', 'seed', 'lambdas'].includes(key) || i + 1 >= args.length) throw new Error('Unknown or incomplete option');
    options[key] = key === 'seed' ? Number(args[++i]) : args[++i];
  }
  if (!options.in || !/^[a-zA-Z0-9_-]+$/.test(options.name) || !Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new Error('Invalid --in, --name or --seed');
  const games = (await readFile(options.in, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const seen = new Set();
  for (const g of games) {
    if (!Number.isSafeInteger(g.seed) || seen.has(g.seed) || ![0, 1].includes(g.winner) || !Array.isArray(g.plies) || !g.plies.length ||
      g.plies.some(p => ![1, 2].includes(p.p) || !Number.isSafeInteger(p.turn) || p.turn < 0 || !Array.isArray(p.features) || p.features.length !== FEATURE_NAMES.length ||
        !p.features.every(v => typeof v === 'number' && Number.isFinite(v)) || !Number.isFinite(p.baseline))) throw new Error('Invalid or duplicate game; baseline scores required');
    seen.add(g.seed);
  }
  const { train, val } = splitGames(games, options.seed), training = rowsFor(train), validation = rowsFor(val);
  let best;
  for (const lambda of (options.lambdas ? options.lambdas.split(',').map(Number) : [0.0001, 0.001, 0.01, 0.1, 1])) {
    const w = fitLogistic(training, { lambda }), report = metrics(validation, w);
    console.log(`lambda=${lambda} validation ${JSON.stringify(report)}`);
    if (!best || report.logLoss < best.valLoss) best = { w, lambda, valLoss: report.logLoss };
  }
  const baseline = fitLogistic(rowsFor(train, true), { lambda: 0 });
  const baseVal = rowsFor(val, true);
  console.log(`trainGames=${train.length} valGames=${val.length} baselineScale=${baseline[0]}`);
  for (const [phase, name] of ['early', 'mid', 'late'].entries()) {
    console.log(`${name} learned ${JSON.stringify(metrics(validation.filter(r => r.phase === phase), best.w))}`);
    console.log(`${name} hand ${JSON.stringify(metrics(baseVal.filter(r => r.phase === phase), baseline))}`);
  }
  const dir = new URL('./tune/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const out = new URL(`learned-${options.name}.json`, dir), temp = new URL(`learned-${options.name}.${process.pid}.tmp`, dir);
  await writeFile(temp, JSON.stringify({ featureNames: FEATURE_NAMES, w: best.w,
    meta: { lambda: best.lambda, trainGames: train.length, valLoss: best.valLoss,
      valGames: val.length, seed: options.seed, standardization: 'train RMS without centering', baselineScale: baseline[0] } }, null, 2) + '\n');
  await rename(temp, out);
  console.log(`Wrote ${out.pathname}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
