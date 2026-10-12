import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_NAMES, extractFeatures } from '../src/ai/features.js';
import { evaluateLearned, loadLearnedWeights } from '../src/ai/learned.js';
import { chooseMove, chooseMoveAsync } from '../src/ai/index.js';
import { runAiTurn, runAiTurnAsync, gameFromEngineState } from '../src/ai/bridge.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves } from '../src/engine/turn.js';
import { fitLogistic, sigmoid, dot, splitGames } from '../tools/fitvalue.mjs';
import { mulberry32 } from './helpers/rng.js';
const state = () => newGame(loadCards(), mulberry32(19), { firstPlayer: 1 });
const weights = () => ({ featureNames: [...FEATURE_NAMES], w: FEATURE_NAMES.map(n => n === 'diff_points' ? 1 : n === 'diff_tokens_blue' ? 0.2 : 0) });

test('features have stable finite dimensions, antisymmetric differences, swapped sides, no mutation and deterministic output', () => {
  const s = state();
  s.players.player1.cards.push({ color: 'blue', points: 7, crowns: 3, isDouble: true });
  s.players.player1.tokens.blue = 4;
  s.players.player2.tokens.pearl = 2;
  const before = structuredClone(s);
  const a = extractFeatures(s, 'player1'), b = extractFeatures(s, 'player2');
  assert.ok(a instanceof Float64Array);
  assert.equal(a.length, FEATURE_NAMES.length);
  assert.ok(a.length >= 60 && a.length <= 90);
  assert.equal(new Set(FEATURE_NAMES).size, a.length);
  assert.ok(a.every(Number.isFinite));
  for (const [i, name] of FEATURE_NAMES.entries()) {
    if (name.startsWith('diff_') || name === 'mover') assert.ok(Math.abs(a[i] + b[i]) < 1e-12, name);
    if (name.startsWith('own_')) assert.equal(a[i], b[FEATURE_NAMES.indexOf(name.replace('own_', 'opp_'))]);
  }
  assert.deepEqual(a, extractFeatures(s, 'player1'));
  assert.deepEqual(s, before);
  assert.throws(() => extractFeatures(s, 'bad'), RangeError);
});

test('hidden decks and opponent reserve identities are never read; masking own reserves works', () => {
  const s = state();
  s.players.player2.reserves = new Proxy([{}], { get(target, key) { if (key !== 'length') throw Error('Opponent reserve inspected'); return target.length; } });
  Object.defineProperty(s, 'decks', { get() { throw Error('Deck inspected'); } });
  assert.ok(extractFeatures(s, 'player1').every(Number.isFinite));
  s.players.player1.reserves = [{ color: 'blue', costs: {}, points: 3 }];
  assert.equal(extractFeatures(s, 'player1')[FEATURE_NAMES.indexOf('ownReserveAffordable')], 1);
  s.players.player1.reserves = new Proxy([{}], { get(target, key) { if (key !== 'length') throw Error('Masked reserve inspected'); return target.length; } });
  assert.equal(extractFeatures(s, 'player1', { hiddenPlayerId: 'player1' })[FEATURE_NAMES.indexOf('ownReserveAffordable')], 0);
});

test('learned weights validate names, lengths and finite numeric values; scoring and terminals', () => {
  const w = weights(), loaded = loadLearnedWeights(JSON.stringify(w));
  assert.deepEqual(loaded.w, w.w);
  for (const bad of [{ ...w, featureNames: [...w.featureNames].reverse() }, { ...w, w: [] }, { ...w, w: Array(w.w.length) }, { ...w, featureNames: Array(w.w.length) }, { ...w, w: w.w.map(() => NaN) }, { ...w, w: w.w.map(() => '1') }]) assert.throws(() => loadLearnedWeights(bad), TypeError);
  const s = state();
  assert.equal(evaluateLearned(s, 'player1', { weights: loaded }), dot(loaded.w, extractFeatures(s, 'player1')));
  s.gameOver.winnerId = 'player1';
  assert.equal(evaluateLearned(s, 'player1', { weights: loaded }), 1e6);
  assert.equal(evaluateLearned(s, 'player2', { weights: loaded }), -1e6);
});

test('tiny synthetic soft-outcome dataset recovers planted logistic weights', () => {
  const planted = [0.7, -1.1, 0.35], rng = mulberry32(42);
  const rows = Array.from({ length: 160 }, () => {
    const x = Array.from({ length: 3 }, () => (rng() - 0.5) * 6);
    return { x, y: sigmoid(dot(planted, x)) };
  });
  const fitted = fitLogistic(rows, { lambda: 0, iterations: 1200 });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(fitted[i] - planted[i]) < 0.001, `${i}: ${fitted[i]}`);
  // Replicated binary outcomes approximate the same planted probabilities.
  const binary = rows.slice(0, 60).flatMap(r => Array.from({ length: 40 }, (_, i) => ({ x: r.x, y: i < Math.round(40 * r.y) ? 1 : 0 })));
  const binaryFit = fitLogistic(binary, { lambda: 0, iterations: 600 });
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(binaryFit[i] - planted[i]) < 0.06);
  const games = Array.from({ length: 10 }, (_, seed) => ({ seed }));
  const split = splitGames(games, 7);
  assert.deepEqual(split, splitGames([...games].reverse(), 7));
  assert.ok(split.train.every(g => !split.val.some(v => v.seed === g.seed)));
});

test('learned evaluator returns legal deterministic choices through sync and async search', async () => {
  const s = state(), w = loadLearnedWeights(weights()), before = structuredClone(s);
  for (const level of [3, 5, 6]) {
    const options = () => ({ level, evaluator: 'learned', learnedWeights: w, rng: mulberry32(44), search: { iterations: 4 }, sliceMs: 1 });
    const move = chooseMove(s, options());
    assert.ok(legalMoves(s).some(m => JSON.stringify(m) === JSON.stringify(move)));
    assert.deepEqual(move, chooseMove(s, options()));
    assert.deepEqual(move, await chooseMoveAsync(s, options()));
  }
  assert.deepEqual(s, before);
});

test('learned options reach both complete-turn bridge APIs', async () => {
  const s = state(), game = gameFromEngineState(s);
  const options = () => ({ aiPlayerId: 'player1', level: 3, rng: mulberry32(73), evaluator: 'learned', learnedWeights: weights() });
  const sync = runAiTurn(game, options());
  const asyncResult = await runAiTurnAsync(game, options());
  assert.ok(sync.moves.length > 0);
  assert.deepEqual(sync, asyncResult);
});
