import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webPushSupported, webPushConfigured, webPush } from '../src/web-push.js';

const names = ['window', 'navigator', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout'];
const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
afterEach(() => {
  for (const name of names) {
    if (originals[name]) Object.defineProperty(globalThis, name, originals[name]);
    else delete globalThis[name];
  }
});
const key = 'splendor_duel_webpush_enrollment_v1';
const point = Uint8Array.from({ length: 65 }, (_, i) => i === 0 ? 4 : 255);
const auth = new Uint8Array(16).fill(250);
const encoded = bytes => Buffer.from(bytes).toString('base64url');
let serial = 0;
function fixture() {
  const fields = { actor_id: `actor_${++serial}`, baseUrl: 'https://example.test/gamesync/index.php' };
  const storage = new Map();
  const calls = [];
  let unsubscribed = 0;
  let subscribed = 0;
  let subscription = null;
  const sub = { endpoint: 'https://web.push.apple.com/a', getKey: name => (name === 'auth' ? auth : point).buffer,
    unsubscribe: async () => { unsubscribed++; subscription = null; return true; } };
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async options => {
      subscribed++;
      assert.equal(options.userVisibleOnly, true);
      assert.deepEqual(options.applicationServerKey, point);
      subscription = sub; return sub;
    }
  };
  const window = { PushManager: function () {}, Notification: { permission: 'default', requestPermission: async () => {
    window.Notification.permission = 'granted'; return 'granted';
  } }, matchMedia: query => ({ matches: query === '(display-mode: standalone)' }) };
  for (const [name, value] of Object.entries({ window,
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager }) } },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: async (url, options) => {
      const action = new URL(url).searchParams.get('action');
      calls.push({ url, action, options, body: options.body ? JSON.parse(options.body) : undefined });
      return { status: action === 'device_register' && !calls.at(-1).body.device_id ? 201 : 200,
        json: async () => action === 'vapid_public_key' ? { public_key: encoded(point) }
          : action === 'device_register' ? { device_id: 'device', registration_secret: 'secret' } : { ok: true } };
    }
  })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return { fields, storage, calls, sub, window, pushManager, setSubscription: value => { subscription = value; },
    unsubscribed: () => unsubscribed, subscribed: () => subscribed };
}
const enroll = f => f.storage.set(key, JSON.stringify({ device_id: 'device', registration_secret: 'secret', actor_id: f.fields.actor_id, endpoint: f.sub.endpoint }));

test('support requires installed app and all browser APIs; standalone iOS works', () => {
  const f = fixture();
  assert.equal(webPushSupported(), true);
  f.window.matchMedia = () => ({ matches: false });
  assert.equal(webPushSupported(), false);
  navigator.standalone = true;
  assert.equal(webPushSupported(), true);
  for (const api of ['PushManager', 'Notification']) {
    const value = f.window[api]; delete f.window[api]; assert.equal(webPushSupported(), false); f.window[api] = value;
  }
  delete navigator.serviceWorker; assert.equal(webPushSupported(), false);
  delete globalThis.navigator; assert.equal(webPushSupported(), false);
});

test('enable prompts from tap, subscribes, sends exact body and saves credentials', async () => {
  const f = fixture();
  let prompted = false;
  f.window.Notification.requestPermission = async () => { prompted = true; f.window.Notification.permission = 'granted'; return 'granted'; };
  const pending = webPush('enable', f.fields);
  assert.equal(prompted, true);
  assert.deepEqual(await pending, { ok: true });
  assert.equal(f.subscribed(), 1);
  assert.equal(f.calls[0].url, `${f.fields.baseUrl}?action=vapid_public_key`);
  assert.equal(f.calls[0].options.method, 'GET');
  assert.deepEqual(f.calls[1].body, { app_id: 'splendor_duel_web', actor_id: f.fields.actor_id, kind: 'webpush',
    endpoint: f.sub.endpoint, p256dh: encoded(point), auth: encoded(auth), app_version: '0.0.0' });
  assert.equal(f.calls[1].options.method, 'POST');
  assert.deepEqual(f.calls[1].options.headers, { 'Content-Type': 'application/json' });
  assert.doesNotMatch(f.calls[1].body.p256dh + f.calls[1].body.auth, /=/);
  assert.deepEqual(JSON.parse(f.storage.get(key)), { device_id: 'device', registration_secret: 'secret', actor_id: f.fields.actor_id, endpoint: f.sub.endpoint });
  assert.deepEqual(await webPush('status', f.fields), { ok: true, registered: true, permission: 'granted' });
});

test('permission denied prevents network and subscribe', async () => {
  const f = fixture(); f.window.Notification.requestPermission = async () => 'denied';
  assert.deepEqual(await webPush('enable', f.fields), { ok: false, error: 'denied' });
  assert.equal(f.calls.length, 0); assert.equal(f.subscribed(), 0);
});

test('VAPID 404 stays disabled for both gate and enable', async () => {
  const f = fixture(); globalThis.fetch = async () => ({ status: 404, json: async () => ({ error: 'push_disabled' }) });
  assert.deepEqual(await webPushConfigured(f.fields.baseUrl), { ok: false, error: 'disabled' });
  assert.deepEqual(await webPush('enable', f.fields), { ok: false, error: 'disabled' });
  assert.equal(f.subscribed(), 0);
});

test('status repairs changed subscription once with existing credentials', async () => {
  const f = fixture(); enroll(f); f.sub.endpoint += '/new'; f.setSubscription(f.sub);
  assert.equal((await webPush('status', f.fields)).registered, true);
  await webPush('status', f.fields);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body, { app_id: 'splendor_duel_web', actor_id: f.fields.actor_id, kind: 'webpush', endpoint: f.sub.endpoint,
    p256dh: encoded(point), auth: encoded(auth), app_version: '0.0.0', device_id: 'device', registration_secret: 'secret' });
});

test('failed silent repair is attempted once and absent live subscription is off', async () => {
  const f = fixture(); enroll(f); f.sub.endpoint += '/new'; f.setSubscription(f.sub);
  let requests = 0; globalThis.fetch = async () => { requests++; throw Error('offline'); };
  assert.equal((await webPush('status', f.fields)).error, 'server');
  assert.equal((await webPush('status', f.fields)).error, 'server'); assert.equal(requests, 1);
  f.setSubscription(null); assert.equal((await webPush('status', f.fields)).registered, false);
});

test('disable unregisters then unsubscribes and clears; server failure preserves enrollment', async () => {
  const f = fixture(); enroll(f); f.setSubscription(f.sub);
  const goodFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 503, json: async () => ({}) });
  assert.equal((await webPush('disable', f.fields)).error, 'server');
  assert.equal(f.unsubscribed(), 0); assert.ok(f.storage.has(key));
  globalThis.fetch = goodFetch;
  assert.deepEqual(await webPush('disable', f.fields), { ok: true });
  assert.deepEqual(f.calls[0].body, { app_id: 'splendor_duel_web', actor_id: f.fields.actor_id, device_id: 'device', registration_secret: 'secret' });
  assert.equal(f.calls[0].action, 'device_unregister'); assert.equal(f.unsubscribed(), 1);
  // The server keeps the token-less enrollment, so the secret must survive for re-enable (no 409 dead end).
  assert.equal(JSON.parse(f.storage.get(key)).registration_secret, 'secret'); assert.equal(JSON.parse(f.storage.get(key)).endpoint, null);
});

test('re-enable after disable registers with the kept credentials', async () => {
  const f = fixture(); enroll(f); f.setSubscription(f.sub);
  assert.deepEqual(await webPush('disable', f.fields), { ok: true });
  f.calls.length = 0;
  const reply = await webPush('enable', f.fields);
  assert.equal(reply.ok, true);
  const register = f.calls.find(c => c.action === 'device_register');
  assert.equal(register.body.device_id, 'device'); assert.equal(register.body.registration_secret, 'secret');
});

test('403 on disable clears unknown enrollment', async () => {
  const f = fixture(); enroll(f); f.setSubscription(f.sub);
  globalThis.fetch = async () => ({ status: 403, json: async () => ({ error: 'invalid_credentials' }) });
  assert.deepEqual(await webPush('disable', f.fields), { ok: true }); assert.equal(f.storage.has(key), false);
});

test('mute exact body and unavailable without enrollment', async () => {
  const f = fixture(); const fields = { ...f.fields, game_type: 'splendor_duel', session_id: 'game_1', muted: true };
  assert.deepEqual(await webPush('mute', fields), { ok: false, error: 'unavailable' }); enroll(f);
  assert.deepEqual(await webPush('mute', fields), { ok: true });
  assert.equal(f.calls[0].action, 'session_mute');
  assert.deepEqual(f.calls[0].body, { app_id: 'splendor_duel_web', actor_id: f.fields.actor_id, device_id: 'device', registration_secret: 'secret', game_type: 'splendor_duel', session_id: 'game_1', muted: true });
});

test('storage failure unsubscribes rather than lose the one-time secret', async () => {
  const f = fixture(); localStorage.setItem = () => { throw Error('blocked'); };
  assert.deepEqual(await webPush('enable', f.fields), { ok: false, error: 'unavailable' });
  assert.equal(f.unsubscribed(), 1);
});

test('all fetch paths time out at 10s and abort even if fetch ignores signal', async () => {
  const f = fixture(); enroll(f); let signal;
  globalThis.fetch = async (_, options) => { signal = options.signal; return new Promise(() => {}); };
  globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 10_000); return originals.setTimeout.value(fn, 0); };
  for (const call of [() => webPushConfigured(f.fields.baseUrl), () => webPush('enable', f.fields),
    () => webPush('disable', f.fields), () => webPush('mute', { ...f.fields, game_type: 'splendor_duel', session_id: 'g', muted: false })]) {
    assert.deepEqual(await call(), { ok: false, error: 'timeout' }); assert.equal(signal.aborted, true);
  }
});

test('invalid inputs, rejected browser APIs, broken storage and malformed responses never throw', async () => {
  const f = fixture();
  for (const [type, fields] of [['bad', f.fields], ['enable', null], ['status', { ...f.fields, actor_id: 'bad.id' }], ['mute', { ...f.fields, muted: 'true' }]]) {
    assert.equal((await webPush(type, fields)).error, 'invalid');
  }
  f.storage.set(key, '{bad'); assert.equal((await webPush('status', f.fields)).registered, false);
  f.window.Notification.requestPermission = async () => { throw Error('broken'); };
  assert.equal((await webPush('enable', f.fields)).error, 'unavailable');
  globalThis.fetch = async () => ({ status: 200, json: async () => ({ public_key: 'bad' }) });
  assert.equal((await webPushConfigured(f.fields.baseUrl)).error, 'invalid');
});

test('service worker shows exactly one generic notification on every push; click focuses same scope or opens', async () => {
  const handlers = {}; const notifications = []; const opened = []; let windows = []; let focused = 0; let closed = 0;
  const self = { addEventListener: (name, fn) => { handlers[name] = fn; }, registration: { scope: 'https://example.test/game/',
    showNotification: async (...args) => notifications.push(args) }, clients: { matchAll: async options => {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { type: 'window', includeUncontrolled: true }); return windows;
    }, openWindow: async url => opened.push(url) } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL });
  let work;
  handlers.push({ waitUntil: promise => { work = promise; } }); await work;
  assert.deepEqual(JSON.parse(JSON.stringify(notifications)), [['Splendor Duel', { body: 'Your turn', tag: 'splendor-duel-turn', renotify: true, icon: 'icons/icon-192.png', data: { url: './' } }]]);
  const event = { notification: { close: () => closed++ }, waitUntil: promise => { work = promise; } };
  windows = [{ url: 'https://evil.test/game/', focus: () => assert.fail('wrong origin') },
    { url: 'https://example.test/game-other/', focus: () => assert.fail('wrong scope') },
    { url: 'https://example.test/game/index.html', focus: async () => focused++ }];
  handlers.notificationclick(event); await work; assert.equal(focused, 1); assert.equal(opened.length, 0);
  windows = []; handlers.notificationclick(event); await work; assert.deepEqual(opened, ['./']); assert.equal(closed, 2);
});
