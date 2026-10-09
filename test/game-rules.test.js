import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVILEGE_SUPPLY,
  awardPrivilege,
  consumeExtraTurn,
  createEmptyPlayer,
  createTurnState,
  getOpponentTurnsSinceLastLocalTurn,
  getPrivilegeTotal,
  queueExtraTurn,
  resetGamePieces,
  spendPrivilege
} from "../src/game-rules.js";

const createState = () => ({
  board: [],
  bag: {},
  scrollPool: PRIVILEGE_SUPPLY,
  players: {
    player1: createEmptyPlayer(),
    player2: createEmptyPlayer()
  }
});

test("resetGamePieces clears both players and restores the physical supply", () => {
  const state = createState();
  state.players.player1.tokens.blue = 4;
  state.players.player1.cards.push({ id: "kept-by-bug" });
  state.players.player2.reserves.push({ id: "also-kept-by-bug" });
  state.players.player2.privileges = 2;
  state.scrollPool = 0;

  resetGamePieces(state);

  assert.deepEqual(state.players.player1, createEmptyPlayer());
  assert.deepEqual(state.players.player2, createEmptyPlayer());
  assert.equal(state.scrollPool, PRIVILEGE_SUPPLY);
  assert.equal(state.board.flat().filter(Boolean).length, 0);
});

test("awarding a Privilege preserves the three-piece supply", () => {
  const state = createState();

  assert.equal(awardPrivilege(state, "player2"), true);
  assert.equal(state.players.player2.privileges, 1);
  assert.equal(state.scrollPool, 2);
  assert.equal(getPrivilegeTotal(state), PRIVILEGE_SUPPLY);
});

test("an award transfers from the opponent when the pool is empty", () => {
  const state = createState();
  state.scrollPool = 0;
  state.players.player1.privileges = 2;
  state.players.player2.privileges = 1;

  assert.equal(awardPrivilege(state, "player1"), true);
  assert.equal(state.players.player1.privileges, 3);
  assert.equal(state.players.player2.privileges, 0);
  assert.equal(getPrivilegeTotal(state), PRIVILEGE_SUPPLY);
});

test("an award does nothing when the recipient already owns all Privileges", () => {
  const state = createState();
  state.scrollPool = 0;
  state.players.player1.privileges = 3;

  assert.equal(awardPrivilege(state, "player1"), false);
  assert.equal(getPrivilegeTotal(state), PRIVILEGE_SUPPLY);
});

test("an award never invents a missing Privilege", () => {
  const state = createState();
  state.scrollPool = 0;

  assert.equal(awardPrivilege(state, "player1"), false);
  assert.equal(state.players.player1.privileges, 0);
  assert.equal(state.players.player2.privileges, 0);
});

test("spending a Privilege returns it to the shared pool", () => {
  const state = createState();
  awardPrivilege(state, "player1");

  assert.equal(spendPrivilege(state, "player1"), true);
  assert.equal(state.players.player1.privileges, 0);
  assert.equal(state.scrollPool, PRIVILEGE_SUPPLY);
  assert.equal(getPrivilegeTotal(state), PRIVILEGE_SUPPLY);
});

test("an extra turn starts a fresh irreversible action boundary for the same player", () => {
  const turnState = createTurnState("player1");
  turnState.boardRefilled = true;
  turnState.actionCompleted = true;
  queueExtraTurn(turnState);

  const extraTurn = consumeExtraTurn(turnState);

  assert.deepEqual(extraTurn, {
    playerId: "player1",
    boardRefilled: false,
    actionCompleted: false,
    extraTurnsPending: 0,
    isExtraTurn: true
  });
});

test("queued extra turns are consumed one at a time", () => {
  const turnState = createTurnState("player2");
  queueExtraTurn(turnState);
  queueExtraTurn(turnState);

  const firstExtraTurn = consumeExtraTurn(turnState);
  const secondExtraTurn = consumeExtraTurn(firstExtraTurn);

  assert.equal(firstExtraTurn.extraTurnsPending, 1);
  assert.equal(secondExtraTurn.extraTurnsPending, 0);
  assert.equal(consumeExtraTurn(secondExtraTurn), null);
});

test("opponent recap includes only turns since the local player's last turn", () => {
  const oldOpponentTurn = { id: "old-opponent", playerId: "player2" };
  const localTurn = { id: "local", playerId: "player1" };
  const opponentTurn = { id: "opponent", playerId: "player2" };
  const turnHistory = { turns: [oldOpponentTurn, localTurn, opponentTurn] };

  assert.deepEqual(
    getOpponentTurnsSinceLastLocalTurn(turnHistory, "player1"),
    [opponentTurn]
  );
});

test("opponent recap keeps an entire extra-turn chain together", () => {
  const localTurn = { id: "local", playerId: "player1" };
  const firstTurn = { id: "opponent-1", playerId: "player2" };
  const extraTurn = { id: "opponent-2", playerId: "player2" };
  const turnHistory = { turns: [localTurn, firstTurn, extraTurn] };

  assert.deepEqual(
    getOpponentTurnsSinceLastLocalTurn(turnHistory, "player1"),
    [firstTurn, extraTurn]
  );
});
