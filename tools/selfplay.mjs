#!/usr/bin/env node
import { availableParallelism } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { LEVELS, chooseMove } from '../src/ai/index.js';
import { loadCards } from '../src/engine/cards-node.js';
import { newGame } from '../src/engine/setup.js';
import { legalMoves, applyMoveWithEvents, isTerminal, winner } from '../src/engine/turn.js';
import { clampWeights, unflattenWeights } from '../src/ai/eval.js';
import { summarize, sprt } from './lib/stats.mjs';

const levels = Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
const workerCap = Math.max(1, availableParallelism() - 1);
const usage = `Usage: node tools/selfplay.mjs --a LEVEL|random --b LEVEL|random --games N
  [--weights-a FILE] [--weights-b FILE]
  [--seed N] [--max-turns N] [--workers N] [--json PATH] [--sprt ELO0 ELO1]
  --ladder runs adjacent LEVELS pairs. Workers capped at ${workerCap}.`;

function parse(args) {
  const config = { a: levels.at(-1), b: levels[0], games: 40, seed: 1, maxTurns: 400, workers: 1, ladder: false };
  const flags = { '--a': 'a', '--b': 'b', '--games': 'games', '--seed': 'seed', '--max-turns': 'maxTurns', '--workers': 'workers', '--json': 'json', '--weights-a': 'weightsAFile', '--weights-b': 'weightsBFile' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--ladder') { config.ladder = true; continue; }
    if (flag === '--sprt') {
      config.sprt = [Number(args[++i]), Number(args[++i])];
      sprt(0, 0, 0, ...config.sprt);
      continue;
    }
    if (!flags[flag] || i + 1 >= args.length) throw new Error(`Unknown or incomplete option: ${flag}`);
    const key = flags[flag];
    const value = args[++i];
    config[key] = ['json', 'weightsAFile', 'weightsBFile'].includes(key) || value === 'random' && (key === 'a' || key === 'b') ? value : Number(value);
  }
  for (const key of ['a', 'b']) {
    if (config[key] !== 'random' && !levels.includes(config[key])) throw new Error(`${key} must be random or one of ${levels.join(', ')}`);
  }
  for (const key of ['games', 'maxTurns', 'workers']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new Error('seed must be a uint32');
  config.workers = Math.min(config.workers, workerCap, config.games);
  return config;
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
function decisionSeed(seed, index, stream) {
  return (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ stream) >>> 0;
}
const cards = loadCards();

export function playGame(config, index) {
  // Pair k has setup seed base+k in both seat orders; player1 always starts.
  const seed = (config.seed + Math.floor(index / 2)) >>> 0;
  const aSeat = index % 2 === 0 ? 'player1' : 'player2';
  let state = newGame(cards, rng(seed), { firstPlayer: 1 });
  let turns = 0;
  let decisions = 0;
  const timing = {};
  while (!isTerminal(state) && turns < config.maxTurns) {
    const isA = `player${state.currentPlayer}` === aSeat;
    const kind = isA ? config.a : config.b;
    const weights = isA ? config.weightsA : config.weightsB;
    const moveRng = rng(decisionSeed(seed, decisions, 0xa17e));
    const start = performance.now();
    let move;
    if (kind === 'random') {
      const moves = legalMoves(state);
      move = moves[Math.floor(moveRng() * moves.length)];
    } else move = chooseMove(state, { level: kind, rng: moveRng, weights });
    const elapsed = performance.now() - start;
    const bucket = timing[kind] ??= { ms: 0, decisions: 0 };
    bucket.ms += elapsed;
    bucket.decisions++;
    if (!move) throw new Error(`No move in nonterminal game ${index}, decision ${decisions}`);
    const result = applyMoveWithEvents(state, move, rng(decisionSeed(seed, decisions, 0xc4a9ce)));
    state = result.state;
    decisions++;
    if (result.events.some(e => e.type === 'turn_ended' || e.type === 'game_over')) turns++;
  }
  return { index, outcome: !isTerminal(state) ? 'draw' : winner(state) === aSeat ? 'a' : 'b', turns, decisions, timing };
}

export async function runMatch(config) {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let turns = 0;
  let completed = 0;
  const timing = {};
  let sequential;
  const aggregate = result => {
    completed++;
    if (result.outcome === 'a') winsA++;
    else if (result.outcome === 'b') winsB++;
    else draws++;
    turns += result.turns;
    for (const [kind, bucket] of Object.entries(result.timing)) {
      const total = timing[kind] ??= { ms: 0, decisions: 0 };
      total.ms += bucket.ms;
      total.decisions += bucket.decisions;
    }
    if (config.sprt) sequential = sprt(winsA, draws, winsB, ...config.sprt);
  };
  if (config.workers === 1) {
    for (let index = 0; index < config.games; index++) {
      aggregate(playGame(config, index));
      if (sequential && sequential.decision !== 'continue') break;
    }
  } else {
    // Contiguous deterministic aggregation; at most one outstanding result per
    // worker. Each worker owns its strided slice; SPRT ignores speculative games.
    const workers = [];
    const pending = new Map();
    let nextIndex = 0;
    await new Promise((resolve, reject) => {
      let stopped = false;
      const finish = () => { stopped = true; resolve(); };
      for (let slot = 0; slot < config.workers; slot++) {
        const worker = new Worker(new URL(import.meta.url), { workerData: { config, slot } });
        workers.push(worker);
        worker.on('error', reject);
        worker.on('exit', code => { if (!stopped && code !== 0) reject(new Error(`Worker exited with code ${code}`)); });
        worker.on('message', result => {
          if (stopped) return;
          pending.set(result.index, { result, worker });
          while (pending.has(nextIndex)) {
            const item = pending.get(nextIndex);
            pending.delete(nextIndex++);
            aggregate(item.result);
            if (completed === config.games || sequential && sequential.decision !== 'continue') { finish(); return; }
            item.worker.postMessage('next');
          }
        });
      }
    }).finally(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  }
  const stats = summarize(winsA, draws, winsB);
  return {
    a: config.a, b: config.b, requestedGames: config.games, seed: config.seed,
    maxTurns: config.maxTurns, workers: config.workers,
    winsA, winsB, draws, ...stats, averageTurns: turns / completed,
    meanMsPerDecision: Object.fromEntries(Object.entries(timing).map(([kind, bucket]) => [kind, bucket.ms / bucket.decisions])),
    ...(sequential ? { sprt: sequential } : {})
  };
}

export async function playMatch({ weightsA, weightsB, levelA = 5, levelB = 5, games = 16, seed = 1, workers = 1, maxTurns = 400 }) {
  const config = parse(['--a', String(levelA), '--b', String(levelB), '--games', String(games), '--seed', String(seed), '--workers', String(workers), '--max-turns', String(maxTurns)]);
  return runMatch({ ...config, weightsA: weightsA && unflattenWeights(clampWeights(weightsA)), weightsB: weightsB && unflattenWeights(clampWeights(weightsB)) });
}

function label(kind) { return kind === 'random' ? 'random' : `L${kind}`; }
function summary(result) {
  return `${label(result.a)} vs ${label(result.b)}: wins A ${result.winsA} / wins B ${result.winsB} / draws ${result.draws}; score A ${result.scorePercent.toFixed(1)}%; Elo ${result.elo.toFixed(1)} [95% CI ${result.ci95.map(n => n.toFixed(1)).join(', ')}]; avg turns ${result.averageTurns.toFixed(1)}`;
}
export async function main(args = process.argv.slice(2), log = console.log) {
  const config = parse(args);
  if (config.help) { log(usage); return; }
  for (const key of ['weightsA', 'weightsB']) if (config[`${key}File`]) {
    config[key] = unflattenWeights(clampWeights(JSON.parse(await readFile(config[`${key}File`], 'utf8'))));
  }
  let output;
  if (config.ladder) {
    const matches = [];
    let cumulative = 0;
    log('Pair       W A / W B / D   Score A   Elo step (95% CI)         Cumulative Elo   Avg turns');
    for (let i = 1; i < levels.length; i++) {
      const result = await runMatch({ ...config, a: levels[i], b: levels[i - 1] });
      cumulative += result.elo;
      result.cumulativeElo = cumulative;
      matches.push(result);
      log(`${`${label(result.a)} v ${label(result.b)}`.padEnd(10)} ${`${result.winsA} / ${result.winsB} / ${result.draws}`.padEnd(15)} ${`${result.scorePercent.toFixed(1)}%`.padEnd(9)} ${`${result.elo.toFixed(1)} [${result.ci95.map(n => n.toFixed(1)).join(', ')}]`.padEnd(26)} ${cumulative.toFixed(1).padEnd(16)} ${result.averageTurns.toFixed(1)}`);
      log(`  Mean ms/decision: ${Object.entries(result.meanMsPerDecision).map(([kind, ms]) => `${label(kind)} ${ms.toFixed(2)}`).join(', ')}${result.sprt ? `; SPRT ${result.sprt.decision}, LLR ${result.sprt.llr.toFixed(3)}` : ''}`);
    }
    log(`Summary: ladder ${matches.length} pairs, ${matches.reduce((sum, result) => sum + result.games, 0)} games; cumulative Elo ${cumulative.toFixed(1)} (baseline ${label(levels[0])} = 0)`);
    output = { mode: 'ladder', baseline: levels[0], matches };
  } else {
    output = await runMatch(config);
    log(summary(output));
    log(`Mean ms/decision: ${Object.entries(output.meanMsPerDecision).map(([kind, ms]) => `${label(kind)} ${ms.toFixed(2)}`).join(', ')}`);
    if (output.sprt) log(`SPRT: ${output.sprt.decision}; LLR ${output.sprt.llr.toFixed(3)} [${output.sprt.lower.toFixed(3)}, ${output.sprt.upper.toFixed(3)}]`);
    log(`Summary: ${output.games} games; ${summary(output)}`);
  }
  if (config.json) await writeFile(config.json, `${JSON.stringify(output, null, 2)}\n`);
}

if (!isMainThread) {
  let index = workerData.slot;
  const next = () => {
    if (index >= workerData.config.games) return;
    parentPort.postMessage(playGame(workerData.config, index));
    index += workerData.config.workers;
  };
  parentPort.on('message', next);
  next();
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
