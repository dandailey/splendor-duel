const STORAGE_KEY = 'splendor_duel_webpush_enrollment_v1';
const APP_ID = 'splendor_duel_web';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const failure = error => ({ ok: false, error });
// At most one silent repair per subscription/actor during this page lifetime.
const repairs = new Map();

export const webPushSupported = () => {
  try {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  } catch { return false; }
};

async function request(baseUrl, action, body) {
  let timer;
  try {
    const controller = new AbortController();
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(failure('timeout')); }, 10_000);
    });
    return await Promise.race([timeout, (async () => {
      const response = await fetch(`${baseUrl}?action=${action}`, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      });
      const data = await response.json();
      if (action === 'vapid_public_key' && response.status === 404) return failure('disabled');
      if (response.status !== 200 && response.status !== 201) {
        return { ...failure(response.status === 403 || response.status === 409 ? 'invalid' : 'server'), status: response.status };
      }
      return { ok: true, status: response.status, data };
    })().catch(error => failure(error?.name === 'AbortError' ? 'timeout' : 'server'))]);
  } catch { return failure('unavailable'); }
  finally { clearTimeout(timer); }
}

const decodeKey = key => {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('key');
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('key');
  return bytes;
};
const encodeKey = key => {
  if (!key) throw new Error('key');
  return btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
function load(actor) {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value?.actor_id === actor && typeof value.device_id === 'string' && value.device_id
      && typeof value.registration_secret === 'string' && value.registration_secret ? value : null;
  } catch { return null; }
}
function save(value) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Verify below, including existing credentials. */ }
  const stored = load(value.actor_id);
  return stored?.device_id === value.device_id && stored?.registration_secret === value.registration_secret
    && stored?.endpoint === value.endpoint;
}
const credentials = enrollment => ({ device_id: enrollment.device_id, registration_secret: enrollment.registration_secret });

// Used lazily by Settings; never asks for permission or subscribes.
export async function webPushConfigured(baseUrl) {
  try {
    if (!webPushSupported()) return failure('unavailable');
    const reply = await request(baseUrl, 'vapid_public_key');
    if (!reply.ok) return reply;
    decodeKey(reply.data?.public_key);
    return { ok: true };
  } catch { return failure('invalid'); }
}

async function register(baseUrl, actor, subscription, enrollment) {
  const reply = await request(baseUrl, 'device_register', {
    app_id: APP_ID, actor_id: actor, kind: 'webpush', endpoint: subscription.endpoint,
    p256dh: encodeKey(subscription.getKey('p256dh')), auth: encodeKey(subscription.getKey('auth')),
    app_version: '0.0.0', ...(enrollment ? credentials(enrollment) : {})
  });
  if (!reply.ok) return reply;
  const stored = { ...(enrollment || reply.data), actor_id: actor, endpoint: subscription.endpoint };
  if (!stored.device_id || !stored.registration_secret || !save(stored)) {
    try { await subscription.unsubscribe(); } catch { /* Best effort on lost one-time secret. */ }
    return failure('unavailable');
  }
  return { ok: true };
}

export async function webPush(type, fields = {}) {
  try {
    if (!webPushSupported()) return failure('unavailable');
    if (!['status', 'enable', 'disable', 'mute'].includes(type) || !validId(fields?.actor_id)
      || typeof fields.baseUrl !== 'string' || !fields.baseUrl) return failure('invalid');
    const actor = fields.actor_id;
    const enrollment = load(actor);
    if (type === 'mute') {
      if (!validId(fields.game_type) || !validId(fields.session_id) || typeof fields.muted !== 'boolean') return failure('invalid');
      if (!enrollment) return failure('unavailable');
      const reply = await request(fields.baseUrl, 'session_mute', {
        app_id: APP_ID, actor_id: actor, ...credentials(enrollment),
        game_type: fields.game_type, session_id: fields.session_id, muted: fields.muted
      });
      return reply.ok ? { ok: true } : reply;
    }
    // Keep the permission prompt before the first await so enable retains the tap's activation.
    if (type === 'enable') {
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') return failure('denied');
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (type === 'status') {
      if (enrollment && subscription && subscription.endpoint !== enrollment.endpoint) {
        const key = JSON.stringify([fields.baseUrl, actor, subscription.endpoint]);
        if (!repairs.has(key)) repairs.set(key, register(fields.baseUrl, actor, subscription, enrollment));
        const reply = await repairs.get(key);
        if (!reply.ok) return reply;
      }
      return { ok: true, registered: !!(load(actor) && subscription && subscription.endpoint === load(actor).endpoint),
        permission: window.Notification.permission };
    }
    if (type === 'disable') {
      if (!enrollment) return failure('unavailable');
      const reply = await request(fields.baseUrl, 'device_unregister', { app_id: APP_ID, actor_id: actor, ...credentials(enrollment) });
      if (!reply.ok && reply.status !== 403) return reply;
      try {
        if (subscription) await subscription.unsubscribe();
      } finally {
        // The server keeps the (token-less) enrollment, so keep the one-time secret for re-enable.
        // Drop it only when the server no longer recognizes it (403).
        if (reply.status === 403) {
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
        } else save({ ...enrollment, endpoint: null });
      }
      return { ok: true };
    }
    const vapid = await request(fields.baseUrl, 'vapid_public_key');
    if (!vapid.ok) return vapid;
    const applicationServerKey = decodeKey(vapid.data?.public_key);
    const active = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    return await register(fields.baseUrl, actor, active, enrollment);
  } catch (error) { return failure(error?.name === 'NotAllowedError' ? 'denied' : 'unavailable'); }
}
