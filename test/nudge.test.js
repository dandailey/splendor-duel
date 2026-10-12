import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, parseNudgeResponse, loadNudgeDeadline, saveNudgeDeadline,
  postNudge, NUDGE_FAILURE } from '../src/nudge.js';

test('countdown rounds up seconds and formats boundaries', () => {
  for (const [ms, expected] of [[-1, '00:00'], [0, '00:00'], [1, '00:01'],
    [1000, '00:01'], [59999, '01:00'], [599000, '09:59'], [599999, '10:00'], [600000, '0h 10m'],
    [3599000, '0h 59m'], [3600000, '1h 00m'], [14399000, '3h 59m'],
    [14400000, '4h 00m']]) assert.equal(formatCountdown(ms), expected);
});

test('success retains the server cooldown, reachability and remaining quota', () => {
  assert.deepEqual(parseNudgeResponse(200, {}, { ok: true, next_allowed_in: 42,
    remaining_today: 2, reachable: false }), {
    ok: true, cooldownSeconds: 42, remainingToday: 2, reachable: false
  });
  assert.equal(parseNudgeResponse(200, {}, { ok: true, next_allowed_in: 0 }).cooldownSeconds, 0);
});

test('rate limit prefers Retry-After, including zero, and falls back to body', () => {
  assert.deepEqual(parseNudgeResponse(429, new Headers({ 'Retry-After': '14400' }),
    { error: 'rate_limited', retry_after: 10 }), {
    ok: false, error: 'rate_limited', cooldownSeconds: 14400
  });
  assert.equal(parseNudgeResponse(429, { 'retry-after': '0' }, { retry_after: 10 }).cooldownSeconds, 0);
  for (const headers of [{}, { 'Retry-After': 'invalid' }, { 'Retry-After': '-2' }]) {
    assert.equal(parseNudgeResponse(429, headers, { retry_after: 60 }).cooldownSeconds, 60);
  }
  assert.equal(parseNudgeResponse(429, null, null).cooldownSeconds, 0);
});

test('all failures have the generic message, including malformed success', () => {
  for (const status of [0, 200, 400, 404, 503]) {
    assert.deepEqual(parseNudgeResponse(status, {}, { error: 'private detail' }), {
      ok: false, error: 'failure', message: NUDGE_FAILURE
    });
  }
});

test('deadlines persist separately per session and ignore expired or invalid values', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value) };
  saveNudgeDeadline(storage, 'a', 2000);
  saveNudgeDeadline(storage, 'b', 3000);
  assert.equal(loadNudgeDeadline(storage, 'a', 1000), 2000);
  assert.equal(loadNudgeDeadline(storage, 'b', 1000), 3000);
  assert.equal(loadNudgeDeadline(storage, 'a', 2000), 0);
  assert.equal(loadNudgeDeadline(storage, 'a', 2001), 0);
  assert.equal(loadNudgeDeadline(storage, 'missing', 1000), 0);
  for (const value of ['broken', 'Infinity', '-1']) {
    saveNudgeDeadline(storage, 'a', value);
    assert.equal(loadNudgeDeadline(storage, 'a', 1000), 0);
  }
});

test('throwing storage is harmless', () => {
  const storage = { getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); } };
  assert.equal(loadNudgeDeadline(storage, 'a'), 0);
  assert.doesNotThrow(() => saveNudgeDeadline(storage, 'a', 2000));
  assert.equal(loadNudgeDeadline(null, 'a'), 0);
  assert.doesNotThrow(() => saveNudgeDeadline(null, 'a', 2000));
});

test('POST uses the exact session contract and parses the response', async () => {
  const payload = { actor_id: 'actor', game_type: 'splendor_duel', session_id: 'session' };
  let calls = 0;
  const result = await postNudge(async (url, options) => {
    calls++;
    assert.equal(url, 'https://fake.invalid/index.php?action=nudge');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), payload);
    return { status: 200, headers: {}, json: async () => ({ ok: true, next_allowed_in: 12, reachable: true }) };
  }, 'https://fake.invalid/index.php', payload);
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.cooldownSeconds, 12);
});

test('POST handles 429 without JSON and network/HTTP/JSON failures', async () => {
  const limited = await postNudge(async () => ({ status: 429,
    headers: new Headers({ 'Retry-After': '14400' }), json: async () => { throw new Error('empty'); }
  }), '/fake', {});
  assert.equal(limited.cooldownSeconds, 14400);
  for (const fetchImpl of [async () => { throw new Error('network'); },
    async () => ({ status: 400, json: async () => ({ error: 'bad' }) }),
    async () => ({ status: 200, json: async () => { throw new Error('JSON'); } })]) {
    assert.deepEqual(await postNudge(fetchImpl, '/fake', {}), {
      ok: false, error: 'failure', message: NUDGE_FAILURE
    });
  }
});

test('403 is silent: no message, no cooldown', () => {
  const r = parseNudgeResponse(403, null, { error: 'not_allowed' });
  assert.equal(r.ok, false);
  assert.equal(r.message, '');
  assert.equal(r.error, 'not_allowed');
});
