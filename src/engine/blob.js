/** Move engine crown tracking to the live sync envelope; extras are JSON data. */
export function toSyncBlob(state, extras = {}) {
  const gameState = structuredClone(state);
  const previousCrownCounts = gameState.previousCrownCounts;
  delete gameState.previousCrownCounts;
  const activePlayerId = `player${state.currentPlayer}`;
  const defaults = {
    turnDisplayState: {
      activePlayerId, opponentPlayerId: state.currentPlayer === 1 ? 'player2' : 'player1'
    },
    turnHistory: { turns: [], pendingTurn: null, nextTurnId: 1 }
  };
  return JSON.stringify({
    gameState,
    turnDisplayState: extras.turnDisplayState === undefined ? defaults.turnDisplayState : extras.turnDisplayState,
    previousCrownCounts,
    turnHistory: extras.turnHistory === undefined ? defaults.turnHistory : extras.turnHistory
  });
}

/** Returns { state, extras }; pass both back to toSyncBlob for a lossless round trip. */
export function fromSyncBlob(blobString) {
  const blob = JSON.parse(blobString);
  if (!blob?.gameState || !blob.turnDisplayState || !blob.previousCrownCounts) {
    throw new TypeError('Invalid sync blob: missing required fields');
  }
  const state = structuredClone(blob.gameState);
  state.previousCrownCounts = structuredClone(blob.previousCrownCounts);
  const extras = { turnDisplayState: structuredClone(blob.turnDisplayState) };
  if (Object.hasOwn(blob, 'turnHistory')) extras.turnHistory = structuredClone(blob.turnHistory);
  return { state, extras };
}
