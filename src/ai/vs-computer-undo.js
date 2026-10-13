// Memory-only: reloading discards the slot; the next human turn can establish one.
// Payload is the same serializable state accepted by serializeSnapshot().
export const createUndoSlot = () => ({ snapshot: null });
export function capture(slot, state) {
  slot.snapshot = structuredClone(state);
}
export const canUndo = slot => slot.snapshot !== null;
export function clear(slot) {
  slot.snapshot = null;
}
export function take(slot) {
  const snapshot = slot.snapshot === null ? null : structuredClone(slot.snapshot);
  clear(slot);
  return snapshot;
}
export const undoAvailable = (slot, computer, game, online = false) =>
  computer.enabled && !online && !computer.busy && game.currentPlayer === 1
  && !game.gameOver.winnerId && canUndo(slot);
