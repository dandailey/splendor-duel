import test from 'node:test';
import assert from 'node:assert/strict';
import { aiModeAvailable, applyGameInto, LEVEL_LABELS, summaryBannerHtml, levelPickerHtml,
  createVsComputerState, enableComputer, disableComputer, scheduleComputerTurn,
  rememberedLevel, rememberLevel } from '../src/ai/vs-computer.js';
import { LEVELS } from '../src/ai/index.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { gameFromEngineState, engineStateFromGame } from '../src/ai/bridge.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { mulberry32 } from './helpers/rng.js';

test('Computer mode is on everywhere except with the ?noai kill switch', () => {
  for (const [pathname, search, expected] of [
    ['/', '', true], ['/splendor_duel/', '?session=abc', true], ['/beta/', '', true],
    ['/', '?noai', false], ['/', '?x=1&noai=1', false], ['/', '?NOAI', true], ['/', '?ai=0', true]
  ]) assert.equal(aiModeAvailable({ pathname, search }), expected, `${pathname}${search}`);
  assert.equal(aiModeAvailable(undefined), false);
});

test('live copy preserves nested identities, deletes removed keys and never aliases the source', () => {
  const target = { players: { player1: { tokens: { blue: 2 }, obsolete: true } }, board: [['blue', 'red']], gone: 1 };
  const refs = [target.players, target.players.player1, target.players.player1.tokens, target.board, target.board[0]];
  const source = { players: { player1: { tokens: { blue: 0, pearl: 1 } } }, board: [[null]], newField: { value: 2 } };
  const before = structuredClone(source);
  assert.equal(applyGameInto(target, source), target);
  assert.deepEqual(target, source);
  assert.deepEqual([target.players, target.players.player1, target.players.player1.tokens, target.board, target.board[0]], refs);
  refs.forEach((ref, i) => assert.equal(ref, [target.players, target.players.player1, target.players.player1.tokens, target.board, target.board[0]][i]));
  target.newField.value = 9;
  target.players.player1.tokens.pearl = 3;
  assert.deepEqual(source, before);
  applyGameInto(target, target);
  assert.equal(target.newField.value, 9);
});

test('level labels cover the AI levels and builders escape summaries', () => {
  assert.deepEqual(Object.keys(LEVEL_LABELS), Object.keys(LEVELS));
  assert.deepEqual(Object.values(LEVEL_LABELS), ['1 Beginner', '2 Easy', '3 Medium', '4 Hard', '5 Expert']);
  assert.match(levelPickerHtml(5), /value="5" selected/);
  assert.equal(summaryBannerHtml([]), '');
  assert.match(summaryBannerHtml(['<script>&"\'']), /&lt;script&gt;&amp;&quot;&#39;/);
  assert.match(summaryBannerHtml(['Took blue']), /Dismiss computer summary/);
});

test('level preference tolerates unavailable storage and remembers valid choices', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(rememberedLevel(), 1);
    assert.doesNotThrow(() => rememberLevel(4));
    let saved;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem: (_, value) => { saved = value; } } });
    rememberLevel(4);
    assert.equal(rememberedLevel(), 4);
    saved = '99';
    assert.equal(rememberedLevel(), 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('DOM-free smoke: real bridge turn applies in place, paints before running and blocks duplicate starts', () => {
  for (const winning of [false, true]) {
    const rng = mulberry32(88);
    const initial = newGame(loadCards(), rng, { firstPlayer: 2 });
    if (winning) Object.assign(initial.pyramid.level3[0], { costs: {}, points: 20, ability: null, color: 'red', crowns: 0, isDouble: false });
    const live = gameFromEngineState(initial);
    const gameIdentity = live.gameState, playersIdentity = live.gameState.players;
    const crownsIdentity = live.previousCrownCounts;
    const state = createVsComputerState();
    enableComputer(1, state);
    let queued, paints = 0;
    const options = {
      getGame: () => live, rng,
      schedule: (callback, delay) => { queued = callback; assert.equal(delay, 60); },
      refresh: () => { paints++; },
      applyGame: game => { applyGameInto(live.gameState, game.gameState); applyGameInto(live.previousCrownCounts, game.previousCrownCounts); }
    };
    assert.equal(scheduleComputerTurn(options, state), true);
    assert.equal(paints, 1);
    assert.equal(state.busy, true);
    assert.equal(scheduleComputerTurn(options, state), false);
    queued();
    assert.equal(paints, 2);
    assert.equal(state.busy, false);
    assert.equal(state.error, null);
    assert.ok(state.summary.length);
    assert.equal(live.gameState, gameIdentity);
    assert.equal(live.gameState.players, playersIdentity);
    assert.equal(live.previousCrownCounts, crownsIdentity);
    assert.equal(live.gameState.gameOver.winnerId, winning ? 'player2' : null);
    if (!winning) {
      assert.equal(live.gameState.currentPlayer, 1);
      assert.equal(live.gameState.turnState.actionCompleted, false);
      assert.deepEqual(checkInvariants(engineStateFromGame(live)), []);
    }
    assert.equal(scheduleComputerTurn(options, state), false);
  }
});

test('cancelled game callbacks cannot apply to a new game; disabled and human turns cannot start', () => {
  const state = createVsComputerState();
  let queued, applied = 0;
  const game = { gameState: { currentPlayer: 2, gameOver: { winnerId: null } } };
  const options = { getGame: () => game, refresh() {}, schedule: callback => { queued = callback; },
    applyGame() { applied++; }, runTurn() { throw new Error('must never run'); } };
  assert.equal(scheduleComputerTurn(options, state), false);
  enableComputer(3, state);
  scheduleComputerTurn(options, state);
  disableComputer(state);
  enableComputer(5, state);
  queued();
  assert.equal(applied, 0);
  assert.equal(state.busy, false);
  game.gameState.currentPlayer = 1;
  assert.equal(scheduleComputerTurn(options, state), false);
});

test('failed computer turn preserves the boundary, releases the busy guard and can retry', () => {
  const state = createVsComputerState();
  enableComputer(2, state);
  const live = { gameState: { currentPlayer: 2, gameOver: { winnerId: null } } };
  const before = structuredClone(live);
  let queued, applies = 0;
  const options = { getGame: () => live, refresh() {}, schedule: callback => { queued = callback; },
    applyGame() { applies++; }, runTurn() { throw new Error('simulated'); } };
  const originalError = console.error;
  try {
    console.error = () => {};
    scheduleComputerTurn(options, state);
    queued();
  } finally { console.error = originalError; }
  assert.deepEqual(live, before);
  assert.equal(applies, 0);
  assert.equal(state.busy, false);
  assert.match(state.error, /retry/);
  assert.equal(scheduleComputerTurn(options, state), true);
  assert.equal(state.error, null);
  disableComputer(state);
});
