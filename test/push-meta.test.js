import test from "node:test";
import assert from "node:assert/strict";
import { buildPushMeta } from "../src/push-meta.js";

const player1Id = "12345678-abcd-1234-abcd-123456789abc";
const player2Id = "sd-1720000000000-2";
const createBlob = (overrides = {}) => JSON.stringify({
  gameState: {
    currentPlayer: 1,
    syncAssignments: { player1Id, player2Id },
    gameOver: { winnerId: null },
    ...overrides
  }
});
const expectedMeta = (status = "active", activeSeat = 1) => ({
  player1_assigned: true,
  player2_assigned: false,
  actor_ids: [player1Id, player2Id],
  summary: {
    status,
    active_seat: activeSeat,
    players: [
      { seat: 1, actor_id: player1Id },
      { seat: 2, actor_id: player2Id }
    ]
  }
});

test("valid active state produces exact push metadata", () => {
  assert.deepEqual(buildPushMeta(createBlob()), expectedMeta());
});

test("valid finished state preserves the active seat", () => {
  assert.deepEqual(buildPushMeta(createBlob({
    currentPlayer: 2,
    gameOver: { winnerId: "player2" }
  })), expectedMeta("finished", 2));
});

test("unassigned player 2 produces no metadata", () => {
  assert.equal(buildPushMeta(createBlob({
    syncAssignments: { player1Id, player2Id: null }
  })), null);
});

test("invalid id characters in either seat produce no metadata", () => {
  for (const key of ["player1Id", "player2Id"]) {
    assert.equal(buildPushMeta(createBlob({
      syncAssignments: { player1Id, player2Id, [key]: "invalid.id" }
    })), null);
  }
});

test("the same id in both seats produces no metadata", () => {
  assert.equal(buildPushMeta(createBlob({
    syncAssignments: { player1Id, player2Id: player1Id }
  })), null);
});

test("bad JSON and missing state structures produce no metadata", () => {
  for (const blob of ["{", "null", "{}", '{"gameState":{}}', undefined]) {
    assert.equal(buildPushMeta(blob), null);
  }
});

test("currentPlayer 0, 3, or undefined produces no metadata", () => {
  for (const currentPlayer of [0, 3, undefined]) {
    assert.equal(buildPushMeta(createBlob({ currentPlayer })), null);
  }
});

test("ids longer than 64 characters in either seat produce no metadata", () => {
  for (const key of ["player1Id", "player2Id"]) {
    assert.equal(buildPushMeta(createBlob({
      syncAssignments: { player1Id, player2Id, [key]: "a".repeat(65) }
    })), null);
  }
});

test("extra keys in the blob are ignored", () => {
  const blob = JSON.parse(createBlob());
  blob.extra = true;
  blob.gameState.extra = true;
  blob.gameState.syncAssignments.extra = true;
  blob.gameState.gameOver.extra = true;
  assert.deepEqual(buildPushMeta(JSON.stringify(blob)), expectedMeta());
});
