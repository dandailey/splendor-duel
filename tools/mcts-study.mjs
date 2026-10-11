#!/usr/bin/env node
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playMatch } from './selfplay.mjs';
import { summarize } from './lib/stats.mjs';
import { SEARCH_DEFAULTS, searchIterations } from '../src/ai/mcts.js';

// The control runs first so even short invocations produce a baseline.
export const DEFAULT_GRID = Object.freeze([
  { ...SEARCH_DEFAULTS },
  ...[0.5, 0.8, 1.2, 1.8, 2.6].flatMap(exploration => [0, 3, 6].map(leafDepth =>
    ({ exploration, leafDepth, maxChildren: 16 }))),
  ...[8, 24, 40].map(maxChildren => ({ ...SEARCH_DEFAULTS, maxChildren }))
].filter((cell, i, cells) => cells.findIndex(other => JSON.stringify(other) === JSON.stringify(cell)) === i)
  .map(Object.freeze));
const usage = `Usage: node tools/mcts-study.mjs --level 7 --games 24 --workers 3
  --results tools/tune/mcts-study.json --max-seconds 480 [--grid default|FILE]
  [--seed 1] [--max-turns 400]
Grid files are JSON arrays of search option objects. Games must be even.
A uses the cell parameters; B uses defaults, with paired seeds and swapped seats.
Results retain level/games/seed/maxTurns metadata; conflicting resumes are rejected.
The time limit interrupts unfinished cells, which are retried on resume.
secondsPerDecision measures A only; CI95 is the Elo interval from tools/lib/stats.mjs.`;

function canonical(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}
export function normalizeParams(params, level) {
  const iterations = searchIterations(level, params);
  const normalized = { ...SEARCH_DEFAULTS, ...params, iterations };
  for (const key of Object.keys(normalized)) if (!['exploration', 'leafDepth', 'maxChildren', 'iterations', 'rootPlayer'].includes(key)) {
    throw new RangeError(`Unknown search parameter: ${key}`);
  }
  if (!Number.isFinite(normalized.exploration) || normalized.exploration < 0) throw new RangeError('Invalid exploration');
  if (!Number.isSafeInteger(normalized.leafDepth) || normalized.leafDepth < 0) throw new RangeError('Invalid leafDepth');
  if (!Number.isSafeInteger(normalized.maxChildren) || normalized.maxChildren < 1) throw new RangeError('Invalid maxChildren');
  // A fixed root player is unsuitable for paired seat swaps.
  if ('rootPlayer' in normalized) throw new RangeError('Study cells cannot fix rootPlayer');
  return normalized;
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export function printRanking(rows, log = console.log) {
  log('Rank  Parameters                                         W / L / D   Score%    Elo [95% CI]             sec/decision');
  [...rows].sort((a, b) => b.scorePct - a.scorePct || a.secondsPerDecision - b.secondsPerDecision).forEach((row, i) => {
    log(`${String(i + 1).padEnd(6)}${canonical(row.params).padEnd(51)} ${`${row.wins}/${row.losses}/${row.draws}`.padEnd(11)} ${row.scorePct.toFixed(1).padEnd(9)} ${`${row.elo.toFixed(1)} [${row.ci95.map(n => n.toFixed(1)).join(', ')}]`.padEnd(25)} ${row.secondsPerDecision.toFixed(5)}`);
  });
  if (!rows.length) log('(No completed cells yet.)');
}
export async function runStudy({ level = 7, games = 24, workers = 3, results = 'tools/tune/mcts-study.json',
  maxSeconds = 480, seed = 1, maxTurns = 400, grid = DEFAULT_GRID } = {},
{ match = playMatch, log = console.log, now = () => performance.now() } = {}) {
  if (![6, 7, 8, 9, 10].includes(level)) throw new RangeError('level must be 6 through 10');
  for (const [name, n] of Object.entries({ games, workers, maxTurns })) if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`Invalid ${name}`);
  if (games % 2) throw new RangeError('games must be even for paired seats');
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) throw new RangeError('maxSeconds must be positive');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be uint32');
  if (!Array.isArray(grid) || !grid.length) throw new TypeError('grid must be a nonempty array');
  const cells = grid.map(params => normalizeParams(params, level));
  const config = { level, games, seed, maxTurns };
  let saved = { version: 1, config, cells: [] };
  try { saved = JSON.parse(await readFile(results, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved.version !== 1 || canonical(saved.config) !== canonical(config) || !Array.isArray(saved.cells)) {
    throw new Error('Results metadata conflicts with this study; use another results path');
  }
  const done = new Set(saved.cells.map(row => canonical(normalizeParams(row.params, level))));
  const deadline = now() + maxSeconds * 1000;
  try {
    for (const params of cells) {
      const key = canonical(params);
      if (done.has(key)) continue;
      const remaining = deadline - now();
      if (remaining <= 0) break;
      log(`Playing ${canonical(params)} vs defaults (${games} paired games)`);
      let result;
      try {
        result = await match({ levelA: level, levelB: level, games, workers, seed, maxTurns,
          searchA: params, searchB: {}, timeoutMs: Math.max(1, Math.floor(remaining)) });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        log('Time limit reached; unfinished cell will be retried on resume.');
        break;
      }
      const stats = summarize(result.winsA, result.draws, result.winsB);
      if (stats.games !== games) throw new Error('Match did not finish all paired games');
      const secondsPerDecision = result.meanMsPerDecisionBySeat?.a / 1000;
      if (!Number.isFinite(secondsPerDecision) || secondsPerDecision < 0) throw new Error('Missing A decision timing');
      saved.cells.push({ params, wins: stats.wins, losses: stats.losses, draws: stats.draws,
        scorePct: stats.scorePercent, elo: stats.elo, ci95: stats.ci95, secondsPerDecision });
      await atomicJson(results, saved);
      done.add(key);
    }
  } finally { printRanking(saved.cells, log); }
  return saved;
}
export async function main(args = process.argv.slice(2), log = console.log) {
  const config = {};
  const flags = { '--level': 'level', '--games': 'games', '--workers': 'workers', '--results': 'results',
    '--max-seconds': 'maxSeconds', '--grid': 'grid', '--seed': 'seed', '--max-turns': 'maxTurns' };
  for (let i = 0; i < args.length; i++) {
    if (['--help', '-h'].includes(args[i])) { log(usage); return; }
    const key = flags[args[i]];
    if (!key || i + 1 >= args.length) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    const value = args[++i];
    config[key] = ['results', 'grid'].includes(key) ? value : Number(value);
  }
  if (config.grid) config.grid = config.grid === 'default' ? DEFAULT_GRID : JSON.parse(await readFile(config.grid, 'utf8'));
  return runStudy(config, { log });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
