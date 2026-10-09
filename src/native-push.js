const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export const nativePushAvailable = () =>
  typeof globalThis.window?.webkit?.messageHandlers?.gameSyncPush?.postMessage === "function";

export const nativePush = async (type, fields = {}) => {
  try {
    if (!nativePushAvailable()) return { ok: false, error: "unavailable" };
    if (!["status", "enable", "disable", "mute"].includes(type) || !validId(fields?.actor_id)) {
      return { ok: false, error: "invalid" };
    }
    const body = { v: 1, type, actor_id: fields.actor_id };
    if (type === "mute") {
      if (!validId(fields.game_type) || !validId(fields.session_id) || typeof fields.muted !== "boolean") {
        return { ok: false, error: "invalid" };
      }
      Object.assign(body, { game_type: fields.game_type, session_id: fields.session_id, muted: fields.muted });
    }
    const reply = await window.webkit.messageHandlers.gameSyncPush.postMessage(body);
    return reply && typeof reply === "object" && !Array.isArray(reply)
      ? reply
      : { ok: false, error: "invalid" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
};
