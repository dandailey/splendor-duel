#!/usr/bin/env node
import { open, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { chooseMove, LEVELS } from '../src/ai/index.js';
import { extractFeatures } from '../src/ai/features.js';
import { evaluate } from '../src/ai/eval.js';
import { loadCards } from '../src/engine/cards-node.js';
import { newGame } from '../src/engine/setup.js';
import { legalMoves, applyMoveWithEvents, mover, isTerminal, winner } from '../src/engine/turn.js';
import { seededRng } from './lib/value-rng.mjs';
const cards = loadCards();
const stream = seed => { const r = seededRng(seed); return () => r.next(); };
export function generateGame({ level = 5, epsilon = 0.08 }, seed) {
  let state = newGame(cards, stream(seed), { firstPlayer: 1 });
  const plies = [];
  let turn = 0;
  for (let decision = 0; !isTerminal(state); decision++) {
    if (decision >= 3000) throw new Error(`Game ${seed} exceeded decision limit; no result written`);
    // p is the mover seat; every feature vector and baseline is player1's view.
    plies.push({ p: mover(state) === 'player1' ? 1 : 2,
      features: Array.from(extractFeatures(state, 'player1')), turn,
      baseline: evaluate(state, 'player1') });
    const rng = stream((seed ^ Math.imul(decision + 1, 0x9e3779b1) ^ 0xa17e) >>> 0);
    let move;
    if (rng() < epsilon) {
      const moves = legalMoves(state);
      move = moves[Math.floor(rng() * moves.length)];
    } else move = chooseMove(state, { level, rng });
    if (!move) throw new Error(`No move in game ${seed}`);
    const result = applyMoveWithEvents(state, move,
      stream((seed ^ Math.imul(decision + 1, 0x9e3779b1) ^ 0xc4a9ce) >>> 0));
    state = result.state;
    if (result.events.some(e => e.type === 'turn_ended' || e.type === 'game_over')) turn++;
  }
  return { seed, winner: winner(state) === 'player1' ? 1 : 0, plies };
}
export async function main(args = process.argv.slice(2)) {
  const config = { level: 5, games: 40, seed: 1, workers: 1, epsilon: 0.08 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (args[i] === '--help') { console.log('valuedata --level 5 --games N --seed N --workers N --epsilon 0.08 --out FILE'); return; }
    if (!args[i].startsWith('--') || !['level', 'games', 'seed', 'workers', 'epsilon', 'out'].includes(key) || i + 1 >= args.length) throw new Error('Unknown or incomplete option');
    config[key] = key === 'out' ? args[++i] : Number(args[++i]);
  }
  if (!LEVELS[config.level] || !config.out) throw new Error('Valid --level and --out required');
  for (const key of ['games', 'workers']) if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`);
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff || config.seed + config.games - 1 > 0xffffffff) throw new Error('Invalid seed range');
  if (!Number.isFinite(config.epsilon) || config.epsilon < 0 || config.epsilon > 1) throw new Error('Invalid epsilon');
  await mkdir(dirname(config.out), { recursive: true });
  const file = await open(config.out, 'a+');
  const workers = [];
  try {
    let data = await readFile(config.out, 'utf8');
    // A crash during an append may leave one partial trailing record. Recover
    // only that tail; malformed complete lines remain errors rather than skips.
    if (data && !data.endsWith('\n')) {
      const cut = data.lastIndexOf('\n') + 1;
      await file.truncate(Buffer.byteLength(data.slice(0, cut)));
      data = data.slice(0, cut);
    }
    const present = new Set(data.split('\n').filter(Boolean).map(line => JSON.parse(line).seed));
    const seeds = Array.from({ length: config.games }, (_, i) => config.seed + i).filter(seed => !present.has(seed));
    let completed = 0;
    const append = async result => {
      // Only the parent writes; each complete game is a single append syscall,
      // fsynced before another game is dispatched. Never interleave workers.
      const record = Buffer.from(JSON.stringify(result) + '\n');
      const { bytesWritten } = await file.write(record);
      if (bytesWritten !== record.length) throw new Error('Incomplete game append');
      await file.sync();
      console.log(`seed=${result.seed} winner=${result.winner} plies=${result.plies.length}`);
      completed++;
    };
    const count = Math.min(config.workers, availableParallelism(), seeds.length);
    if (count <= 1) {
      for (const seed of seeds) await append(generateGame(config, seed));
    } else {
      let cursor = 0;
      // Each worker computes one outstanding game; serialize durable appends.
      let writing = Promise.resolve();
      await new Promise((resolve, reject) => {
        for (let i = 0; i < count; i++) {
          const worker = new Worker(new URL(import.meta.url), { workerData: { config } });
          workers.push(worker);
          worker.on('error', reject);
          worker.on('exit', code => { if (completed < seeds.length) reject(new Error(`Worker exited early (${code})`)); });
          worker.on('message', result => {
            writing = writing.then(() => append(result)).then(() => {
              if (completed === seeds.length) resolve();
              else if (cursor < seeds.length) worker.postMessage(seeds[cursor++]);
            });
            writing.catch(reject);
          });
          worker.postMessage(seeds[cursor++]);
        }
      });
    }
    console.log(`Wrote ${completed}; skipped ${config.games - seeds.length} existing games`);
  } finally {
    await Promise.all(workers.map(w => w.terminate()));
    await file.close();
  }
}
if (!isMainThread) parentPort.on('message', seed => parentPort.postMessage(generateGame(workerData.config, seed)));
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exitCode = 1; });
