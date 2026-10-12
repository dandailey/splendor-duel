#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { LEVELS } from '../src/ai/index.js';
import { engineStateFromGame, gameFromEngineState, runAiTurn, aiTurnRecap } from '../src/ai/bridge.js';
import { validateSnapshot } from '../src/ai/vs-computer-save.js';
import { toSyncBlob, fromSyncBlob } from '../src/engine/blob.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { loadCards } from '../src/engine/cards-node.js';
import { newGame, TOKEN_SUPPLY } from '../src/engine/setup.js';
import { applyMoveWithEvents, isTerminal, winner } from '../src/engine/turn.js';

const cards = loadCards();
const failureCategories = ['setup', 'blob', 'bridge', 'invariants', 'tokens', 'alternation', 'progress', 'recap', 'max-turns'];
const defaultReproDir = new URL('./tune/', import.meta.url);
const usage = 'Usage: node tools/bridge-soak.mjs [--games 60] [--seed 1] [--levels 1,3,5,7] [--workers 2] [--max-turns 400]';

export function parseArgs(args) {
  const config = { games: 60, seed: 1, levels: [1, 3, 5, 7], workers: 2, maxTurns: 400 };
  const flags = { '--games': 'games', '--seed': 'seed', '--levels': 'levels', '--workers': 'workers', '--max-turns': 'maxTurns' };
  for (let i = 0; i < args.length; i++) {
    if (['--help', '-h'].includes(args[i])) return { help: true };
    const key = flags[args[i]];
    if (!key || i + 1 === args.length) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    const value = args[++i];
    config[key] = key === 'levels' ? value.split(',').map(Number) : Number(value);
  }
  for (const key of ['games', 'workers', 'maxTurns']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new Error('seed must be a uint32');
  if (!config.levels.length || config.levels.some(level => !Number.isInteger(level) || !Object.hasOwn(LEVELS, level))) throw new Error('levels must be a comma-separated list of available AI levels');
  config.workers = Math.min(config.workers, 2, config.games);
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
const turnSeed = (seed, index) => (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ 0xa17e) >>> 0;
const roundTrip = value => JSON.parse(JSON.stringify(value));

function assertTokens(state) {
  for (const [color, supply] of Object.entries(TOKEN_SUPPLY)) {
    const board = state.board.flat().filter(token => token === color).length;
    assert.equal(board + state.bag[color] + state.players.player1.tokens[color] + state.players.player2.tokens[color], supply, `Token conservation: ${color}`);
  }
}
function assertBlob(blob, level) {
  // The page keeps the display perspective fixed to the local player, even
  // while currentPlayer changes. validateSnapshot checks the complete envelope.
  assert.ok(validateSnapshot({ v: 1, savedAt: 0, level, aiPlayerId: 'player2', lastSeenTurnId: null, state: blob }), 'Live blob failed snapshot validation');
  const { state, extras } = fromSyncBlob(JSON.stringify(blob));
  assert.deepEqual(JSON.parse(toSyncBlob(state, extras)), blob, 'Sync codec must preserve the blob');
  assert.ok(!Object.hasOwn(blob.gameState, 'pending'));
  assert.ok(!Object.hasOwn(blob.gameState.turnState, 'mandatoryDone'));
}

/** Each seed is unique; ordered level pairs cycle through the full matrix.
 * Decision RNG resets per bridge call, so a failure blob + rngSeed is replayable.
 */
export function playBridgeGame(config, index) {
  const seed = (config.seed + index) >>> 0;
  const levels = [config.levels[index % config.levels.length], config.levels[Math.floor(index / config.levels.length) % config.levels.length]];
  let blob = null, beforeBlob = null, turnIndex = 0, turns = 0, category = 'setup';
  const timing = {};
  try {
    const initial = newGame(cards, rng(seed), { firstPlayer: index % 2 + 1 });
    const live = gameFromEngineState(initial);
    blob = roundTrip({ ...JSON.parse(toSyncBlob(initial, {
      turnDisplayState: { activePlayerId: 'player1', opponentPlayerId: 'player2' }
    })), ...live });
    beforeBlob = structuredClone(blob);
    category = 'blob'; assertBlob(blob, levels[0]);
    category = 'invariants'; assert.deepEqual(checkInvariants(engineStateFromGame(blob)), []);
    while (!blob.gameState.gameOver.winnerId) {
      beforeBlob = structuredClone(blob);
      category = 'max-turns'; assert.ok(turns < config.maxTurns, `No winner within ${config.maxTurns} turns`);
      category = 'bridge';
      const before = engineStateFromGame(blob);
      const seat = before.currentPlayer, level = levels[seat - 1];
      const startedAt = performance.now();
      let result;
      try {
        result = runAiTurn({ gameState: before, previousCrownCounts: blob.previousCrownCounts }, {
          level, rng: rng(turnSeed(seed, turnIndex)), aiPlayerId: `player${seat}`
        });
      } finally {
        const bucket = timing[level] ??= { ms: 0, turns: 0 };
        bucket.ms += performance.now() - startedAt; bucket.turns++;
      }
      assert.deepEqual(blob, beforeBlob, 'Bridge mutated its input blob');
      const after = engineStateFromGame(result.game);
      category = 'invariants'; assert.deepEqual(checkInvariants(after), []);
      category = 'tokens'; assertTokens(after);

      // Replay the recorded decisions to check EVERY internal turn boundary,
      // including repeats hidden inside runAiTurn's single handoff.
      let replay = before, samples = 0, boundaries = 0;
      const chanceRng = () => {
        assert.ok(samples < result.chanceSamples.length, 'Missing recorded chance sample');
        return result.chanceSamples[samples++];
      };
      for (const move of result.moves) {
        category = 'bridge';
        const step = applyMoveWithEvents(replay, move, chanceRng);
        category = 'invariants'; assert.deepEqual(checkInvariants(step.state), []);
        category = 'tokens'; assertTokens(step.state);
        category = 'alternation';
        let repeats = replay.turnState.extraTurnsPending;
        for (const event of step.events) {
          if (event.type === 'repeat_turn_awarded') repeats++;
          if (event.type === 'turn_ended') {
            assert.equal(event.playerId, `player${replay.currentPlayer}`);
            assert.equal(event.isExtraTurn, repeats > 0, 'Extra turn requires an award');
            assert.equal(event.nextPlayerId, repeats > 0 ? event.playerId : `player${3 - replay.currentPlayer}`);
            assert.equal(step.state.currentPlayer, Number(event.nextPlayerId.slice(-1)));
            if (repeats > 0) repeats--;
            boundaries++;
          }
          if (event.type === 'game_over') boundaries++;
        }
        if (!step.events.some(event => event.type === 'turn_ended')) assert.equal(step.state.currentPlayer, replay.currentPlayer);
        replay = step.state;
      }
      category = 'bridge'; assert.deepEqual(gameFromEngineState(replay), result.game);
      assert.equal(samples, result.chanceSamples.length);
      category = 'alternation';
      if (!isTerminal(after)) assert.equal(after.currentPlayer, 3 - seat, 'AI must hand control to the next seat');
      category = 'progress';
      assert.ok(result.moves.length > 0 && boundaries > 0, 'AI turn made no progress');
      const priorTurns = turns;
      turns += boundaries;
      assert.ok(turns > priorTurns);
      category = 'max-turns'; assert.ok(turns <= config.maxTurns, `Exceeded ${config.maxTurns} turns`);

      category = 'recap';
      const history = blob.turnHistory;
      const recap = aiTurnRecap(before, result.moves, {
        chanceSamples: result.chanceSamples, id: `turn-${history.nextTurnId}`,
        turnNumber: history.turns.length + 1, startedAt: 0, endedAt: 0
      });
      assert.ok(recap && Array.isArray(recap.events), 'Every AI call must return a recap record');
      assert.equal(recap.playerId, `player${seat}`);
      assert.equal(recap.turnNumber, turnIndex + 1);
      assert.equal(recap.status, isTerminal(after) ? 'victory' : 'completed');
      category = 'blob';
      const exported = gameFromEngineState(after);
      blob = roundTrip({ ...blob, ...exported, turnHistory: {
        turns: [...history.turns, recap], pendingTurn: null, nextTurnId: history.nextTurnId + 1
      } });
      assertBlob(blob, level);
      category = 'progress';
      assert.equal(blob.turnHistory.nextTurnId, history.nextTurnId + 1);
      assert.equal(blob.turnHistory.turns.length, turnIndex + 1);
      category = 'invariants'; assert.deepEqual(checkInvariants(engineStateFromGame(blob)), []);
      category = 'tokens'; assertTokens(blob.gameState);
      turnIndex++;
    }
    category = 'progress';
    assert.ok(winner(engineStateFromGame(blob)), 'Finished game must have a winner');
    return { index, seed, levels, finished: true, turns, aiTurns: turnIndex, timing };
  } catch (error) {
    return { index, seed, levels, finished: false, turns, aiTurns: turnIndex, timing,
      failure: { category, message: error.message, stack: error.stack, seed, levels, turnIndex,
        engineTurns: turns, rngSeed: turnSeed(seed, turnIndex), blobBeforeTurn: beforeBlob } };
  }
}

export async function runSoak(config) {
  const results = [];
  if (config.workers === 1) {
    for (let index = 0; index < config.games; index++) results.push(playBridgeGame(config, index));
  } else {
    const workers = [];
    try {
      await Promise.all(Array.from({ length: Math.min(config.workers, 2, config.games) }, (_, slot) => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: { config, slot, stride: Math.min(config.workers, 2) } });
        workers.push(worker);
        worker.on('message', result => results.push(result));
        worker.on('error', reject);
        worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`Soak worker exited with ${code}`)));
      })));
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }
  results.sort((a, b) => a.index - b.index);
  const failures = Object.fromEntries(failureCategories.map(category => [category, 0]));
  const timing = {};
  for (const result of results) {
    if (result.failure) {
      failures[result.failure.category]++;
      const dir = config.reproDir ?? defaultReproDir;
      await mkdir(dir, { recursive: true });
      const path = dir instanceof URL ? new URL(`soak-fail-${result.seed}.json`, dir) : `${dir}/soak-fail-${result.seed}.json`;
      await writeFile(path, `${JSON.stringify(result.failure, null, 2)}\n`);
    }
    for (const [level, bucket] of Object.entries(result.timing)) {
      const total = timing[level] ??= { ms: 0, turns: 0 };
      total.ms += bucket.ms; total.turns += bucket.turns;
    }
  }
  return { games: results.length, finished: results.filter(result => result.finished).length,
    failures, averageTurns: results.reduce((sum, result) => sum + result.turns, 0) / results.length,
    meanMsPerTurn: Object.fromEntries(Object.entries(timing).map(([level, bucket]) => [level, bucket.ms / bucket.turns])), results };
}

export async function main(args = process.argv.slice(2), log = console.log) {
  const config = parseArgs(args);
  if (config.help) { log(usage); return; }
  const summary = await runSoak(config);
  log(`Seed ${config.seed}; levels ${config.levels.join(',')}; workers ${config.workers}; max turns ${config.maxTurns}`);
  log('Games  Finished  Failed  Avg turns');
  log(`${summary.games}     ${summary.finished}        ${summary.games - summary.finished}       ${summary.averageTurns.toFixed(2)}`);
  log('Failure category  Count');
  for (const [category, count] of Object.entries(summary.failures)) log(`${category.padEnd(18)}${count}`);
  log('Level  Mean ms/AI turn');
  for (const [level, ms] of Object.entries(summary.meanMsPerTurn)) log(`${level.padEnd(7)}${ms.toFixed(2)}`);
  for (const result of summary.results.filter(result => result.failure)) log(`FAIL seed ${result.seed}, levels ${result.levels}, turn ${result.failure.turnIndex}: ${result.failure.category}: ${result.failure.message}`);
  if (summary.finished !== summary.games) process.exitCode = 1;
  return summary;
}

if (!isMainThread && workerData?.config) {
  for (let index = workerData.slot; index < workerData.config.games; index += workerData.stride) parentPort.postMessage(playBridgeGame(workerData.config, index));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
