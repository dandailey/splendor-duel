export const NUDGE_FAILURE = "Couldn't send the nudge. Try again later.";
const STORAGE_PREFIX = 'splendor_duel_nudge_deadline:';

export function formatCountdown(ms) {
  const duration = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  const seconds = Math.ceil(duration / 1000);
  if (duration < 600000) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const secondsValue = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function parseNudgeResponse(status, headers, body) {
  if (status === 200 && body?.ok === true) {
    return { ok: true, cooldownSeconds: secondsValue(body.next_allowed_in) ?? 0,
      remainingToday: body.remaining_today, reachable: body.reachable };
  }
  if (status === 429) {
    const header = typeof headers?.get === 'function'
      ? headers.get('Retry-After')
      : Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
    return { ok: false, error: 'rate_limited',
      cooldownSeconds: secondsValue(header) ?? secondsValue(body?.retry_after) ?? 0 };
  }
  // 403 covers every ineligible case server-side; stay silent rather than explain.
  if (status === 403) return { ok: false, error: 'not_allowed', message: '' };
  return { ok: false, error: 'failure', message: NUDGE_FAILURE };
}

export function loadNudgeDeadline(storage, sessionId, now = Date.now()) {
  try {
    const deadline = Number(storage.getItem(`${STORAGE_PREFIX}${sessionId}`));
    return Number.isFinite(deadline) && deadline > now ? deadline : 0;
  } catch { return 0; }
}

export function saveNudgeDeadline(storage, sessionId, deadline) {
  try {
    storage.setItem(`${STORAGE_PREFIX}${sessionId}`, String(deadline));
  } catch { /* The in-memory countdown works without storage. */ }
}

export async function postNudge(fetchImpl, baseUrl, payload) {
  try {
    const response = await fetchImpl(`${baseUrl}?action=nudge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => null);
    return parseNudgeResponse(response.status, response.headers, body);
  } catch { return parseNudgeResponse(0, null, null); }
}
