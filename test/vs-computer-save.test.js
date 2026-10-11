import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeSnapshot, parseSnapshot, validateSnapshot } from '../src/ai/vs-computer-save.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { gameFromEngineState } from '../src/ai/bridge.js';
import { mulberry32 } from './helpers/rng.js';

function fixture() {
  const state = gameFromEngineState(newGame(loadCards(), mulberry32(42), { firstPlayer: 1 }));
  state.turnDisplayState = { activePlayerId: 'player1', opponentPlayerId: 'player2' };
  state.turnHistory = { turns: [{ id: 'turn-1', playerId: 'player2', events: [{ type: 'tokens_taken' }] }], pendingTurn: null, nextTurnId: 2 };
  return JSON.parse(serializeSnapshot(state, { level: 3, savedAt: 123, lastSeenTurnId: 'turn-1' }));
}

test('snapshot round trip preserves the sync payload and recap acknowledgement without mutating inputs', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot.state);
  const raw = serializeSnapshot(snapshot.state, snapshot);
  assert.deepEqual(parseSnapshot(raw), snapshot);
  assert.deepEqual(snapshot.state, before);
  snapshot.state.gameState.bag.blue = 99;
  assert.notEqual(parseSnapshot(raw).state.gameState.bag.blue, 99);
});

test('snapshot parser rejects corrupt JSON, missing fields, old versions and invalid nested shapes', () => {
  for (const raw of ['', '{', 'null', '[]', '{}', 'true']) assert.equal(parseSnapshot(raw), null);
  const changes = [
    s => { s.v = 0; }, s => { s.v = 2; }, s => { s.level = 0; }, s => { s.level = 11; },
    s => { s.level = 1.5; }, s => { s.level = '3'; },
    s => { s.savedAt = -1; }, s => { s.aiPlayerId = 'player1'; }, s => { delete s.lastSeenTurnId; },
    s => { s.state = []; }, s => { s.state.gameState.board = [[]]; },
    s => { s.state.gameState.board[0][0] = 'purple'; }, s => { s.state.gameState.players.player1.tokens.blue = -1; },
    s => { s.state.gameState.decks.level1 = [null]; }, s => { delete s.state.gameState.pyramid.level2; },
    s => { s.state.gameState.currentPlayer = 3; }, s => { s.state.gameState.turnState.playerId = 'player2'; },
    s => { s.state.gameState.turnState.actionCompleted = 'yes'; }, s => { s.state.gameState.gameOver = {}; },
    s => { s.state.turnDisplayState.activePlayerId = 'player2'; }, s => { s.state.previousCrownCounts = {}; },
    s => { s.state.turnHistory.turns[0].events = null; }, s => { s.state.turnHistory.pendingTurn = {}; },
    s => { s.state.turnHistory.nextTurnId = 0; }, s => { delete s.state.gameState.syncAssignments; }
  ];
  for (const change of changes) {
    const snapshot = fixture();
    change(snapshot);
    assert.equal(validateSnapshot(snapshot), false, change.toString());
    assert.equal(parseSnapshot(JSON.stringify(snapshot)), null, change.toString());
  }
  assert.throws(() => serializeSnapshot({}, { level: 3, savedAt: 123 }), TypeError);
});

test('finished games never resume; both human checkpoints and Computer boundaries can resume', () => {
  const snapshot = fixture();
  snapshot.state.gameState.gameOver.winnerId = 'player2';
  assert.equal(validateSnapshot(snapshot), true);
  assert.equal(parseSnapshot(JSON.stringify(snapshot)), null);
  snapshot.state.gameState.gameOver.winnerId = null;
  snapshot.state.gameState.turnState.actionCompleted = true;
  assert.ok(parseSnapshot(JSON.stringify(snapshot)));
  snapshot.state.gameState.currentPlayer = 2;
  snapshot.state.gameState.turnState.playerId = 'player2';
  snapshot.state.gameState.turnState.actionCompleted = false;
  assert.ok(parseSnapshot(JSON.stringify(snapshot)));
});

test('all ten levels save and resume at human and Computer turn boundaries', () => {
  for (let level = 1; level <= 10; level++) {
    for (const currentPlayer of [1, 2]) {
      const snapshot = fixture();
      snapshot.level = level;
      snapshot.state.gameState.currentPlayer = currentPlayer;
      snapshot.state.gameState.turnState.playerId = `player${currentPlayer}`;
      const before = structuredClone(snapshot);
      assert.equal(validateSnapshot(snapshot), true);
      assert.deepEqual(parseSnapshot(serializeSnapshot(snapshot.state, snapshot)), snapshot);
      assert.deepEqual(snapshot, before);
    }
  }
});
