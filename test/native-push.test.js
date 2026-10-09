import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { nativePushAvailable, nativePush } from "../src/native-push.js";

const originalWindow = globalThis.window;
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});
const stubBridge = (postMessage) => {
  globalThis.window = { webkit: { messageHandlers: { gameSyncPush: { postMessage } } } };
};

test("missing or non-function bridge is unavailable", async () => {
  for (const window of [undefined, {}, { webkit: {} }]) {
    globalThis.window = window;
    assert.equal(nativePushAvailable(), false);
    assert.deepEqual(await nativePush("status", { actor_id: "client_1" }), { ok: false, error: "unavailable" });
  }
  stubBridge(true);
  assert.equal(nativePushAvailable(), false);
});

test("bridge returns its reply object", async () => {
  const reply = { permission: "authorized", registered: true };
  stubBridge(async () => reply);
  assert.equal(nativePushAvailable(), true);
  assert.deepEqual(await nativePush("status", { actor_id: "client_1" }), reply);
});

test("rejected bridge calls resolve as unavailable", async () => {
  stubBridge(async () => { throw new Error("bridge failed"); });
  assert.deepEqual(await nativePush("enable", { actor_id: "client_1" }), { ok: false, error: "unavailable" });
});

test("invalid actor ids never reach the bridge", async () => {
  stubBridge(() => assert.fail("invalid id reached bridge"));
  for (const actor_id of [undefined, null, 123, "", "bad.id", "a b", "x\n", "a".repeat(65)]) {
    assert.deepEqual(await nativePush("status", { actor_id }), { ok: false, error: "invalid" });
  }
});

test("mute validates session and game ids and boolean muted", async () => {
  stubBridge(() => assert.fail("invalid mute reached bridge"));
  const fields = { actor_id: "client_1", game_type: "splendor_duel", session_id: "splendor_duel_x", muted: true };
  for (const key of ["game_type", "session_id"]) {
    for (const value of [undefined, "", "bad/id", "x\n", "a".repeat(65)]) {
      assert.deepEqual(await nativePush("mute", { ...fields, [key]: value }), { ok: false, error: "invalid" });
    }
  }
  assert.deepEqual(await nativePush("mute", { ...fields, muted: "true" }), { ok: false, error: "invalid" });
});

test("only exact contract keys reach postMessage with numeric v", async () => {
  const bodies = [];
  stubBridge(async function (body) {
    assert.equal(this, window.webkit.messageHandlers.gameSyncPush);
    bodies.push(body);
    return { ok: true };
  });
  for (const type of ["status", "enable", "disable"]) {
    await nativePush(type, { actor_id: "A_z-9", v: "bad", type: "bad", extra: true });
    assert.deepEqual(bodies.at(-1), { v: 1, type, actor_id: "A_z-9" });
  }
  const fields = { actor_id: "a".repeat(64), game_type: "splendor_duel", session_id: "splendor_duel_x", muted: false };
  await nativePush("mute", fields);
  assert.deepEqual(bodies.at(-1), { v: 1, type: "mute", ...fields });
});

test("non-object replies resolve as invalid", async () => {
  for (const reply of [undefined, null, true, "ok", 1, []]) {
    stubBridge(async () => reply);
    assert.deepEqual(await nativePush("status", { actor_id: "client_1" }), { ok: false, error: "invalid" });
  }
});
