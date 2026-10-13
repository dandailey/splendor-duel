import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndoSlot, capture, canUndo, clear, take, undoAvailable } from '../src/ai/vs-computer-undo.js';
import { createVsComputerState, enableComputer, disableComputer, cancelComputerWork, scheduleComputerTurn } from '../src/ai/vs-computer.js';
import { serializeSnapshot, validateSnapshot } from '../src/ai/vs-computer-save.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { gameFromEngineState } from '../src/ai/bridge.js';
import { mulberry32 } from './helpers/rng.js';

const fixture = () => ({
  ...gameFromEngineState(newGame(loadCards(), mulberry32(42), { firstPlayer: 1 })),
  turnDisplayState: { activePlayerId: 'player1', opponentPlayerId: 'player2' },
  turnHistory: { turns: [], pendingTurn: null, nextTurnId: 1 }
});

test('single slot captures the save payload exactly without aliasing, takes once, and clears', () => {
  const slot = createUndoSlot();
  assert.equal(canUndo(slot), false);
  assert.equal(take(slot), null);
  const live = fixture();
  const before = structuredClone(live);
  assert.ok(validateSnapshot(JSON.parse(serializeSnapshot(live, { level: 3, savedAt: 123 }))));
  capture(slot, live);
  assert.equal(canUndo(slot), true);
  live.gameState.board[0][0] = null;
  live.gameState.decks.level1.reverse();
  live.gameState.players.player1.tokens.blue++;
  live.turnHistory.turns.push({ id: 'changed' });
  const restored = take(slot);
  assert.deepEqual(restored, before);
  assert.notEqual(restored, before);
  assert.notEqual(restored.gameState.decks.level1, live.gameState.decks.level1);
  assert.equal(canUndo(slot), false);
  assert.equal(take(slot), null);
  capture(slot, before);
  capture(slot, live);
  assert.deepEqual(take(slot), live, 'capture replaces, never stacks');
  capture(slot, before);
  clear(slot);
  clear(slot);
  assert.equal(canUndo(slot), false);
});

test('availability excludes disabled, online, busy, empty and finished games', () => {
  const slot = createUndoSlot(), computer = createVsComputerState(), live = fixture();
  capture(slot, live);
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
  enableComputer(3, computer);
  assert.equal(undoAvailable(slot, computer, live.gameState), true);
  assert.equal(undoAvailable(slot, computer, live.gameState, true), false);
  computer.busy = true;
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
  computer.busy = false;
  live.gameState.currentPlayer = 2;
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
  live.gameState.currentPlayer = 1;
  live.gameState.gameOver.winnerId = 'player1';
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
  live.gameState.gameOver.winnerId = null;
  clear(slot);
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
  capture(slot, live);
  disableComputer(computer);
  assert.equal(undoAvailable(slot, computer, live.gameState), false);
});

test('undo cancellation before the computer timer runs invalidates its stale result without disabling the opponent', () => {
  const slot = createUndoSlot(), computer = createVsComputerState();
  let live = fixture(), queued, applied = 0, ran = 0;
  const before = structuredClone(live);
  capture(slot, live);
  enableComputer(3, computer);
  live.gameState.currentPlayer = 2;
  scheduleComputerTurn({ getGame: () => live, refresh() {}, schedule: callback => { queued = callback; },
    runTurn() { ran++; return { game: live, summary: ['stale'] }; },
    applyGame() { applied++; } }, computer);
  const controller = computer.controller, generation = computer.generation;
  // The button is disabled while busy; exercise the underlying abort guard anyway.
  cancelComputerWork(computer);
  live = take(slot);
  queued();
  assert.equal(controller.signal.aborted, true);
  assert.equal(computer.generation, generation + 1);
  assert.equal(computer.enabled, true);
  assert.equal(computer.busy, false);
  assert.equal(computer.controller, null);
  assert.deepEqual(computer.summary, []);
  assert.equal(computer.error, null);
  assert.equal(ran, 0);
  assert.equal(applied, 0);
  assert.deepEqual(live, before);
});

test('an already running asynchronous computer result cannot publish after undo', async () => {
  const computer = createVsComputerState();
  enableComputer(3, computer);
  let queued, resolve, applied = 0;
  const live = fixture();
  live.gameState.currentPlayer = 2;
  scheduleComputerTurn({ getGame: () => live, refresh() {}, schedule: callback => { queued = callback; },
    runTurn: () => new Promise(done => { resolve = done; }), applyGame() { applied++; } }, computer);
  queued();
  cancelComputerWork(computer);
  resolve({ game: live, summary: ['stale'] });
  await new Promise(done => setImmediate(done));
  assert.equal(applied, 0);
  assert.deepEqual(computer.summary, []);
  assert.equal(computer.busy, false);
});
