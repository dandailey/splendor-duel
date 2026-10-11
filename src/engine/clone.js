/** Copy JSON containers. Card records are immutable engine values and shared;
 * callers replacing card data must replace the record rather than edit it. */
export function cloneJSON(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJSON);
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = cloneJSON(value[key]);
  return copy;
}

const cloneLevels = levels => ({
  level1: levels.level1.slice(), level2: levels.level2.slice(), level3: levels.level3.slice()
});
const clonePlayer = player => ({
  privileges: player.privileges, tokens: { ...player.tokens }, cards: player.cards.slice(), reserves: player.reserves.slice()
});

/** Schema-specialized immutable snapshot: every mutable rules container is
 * detached, while all Jewel/purchased card records retain their identity. Royal
 * supply records are copied because claiming one changes its taken flag. */
export function cloneState(state) {
  const next = {
    currentPlayer: state.currentPlayer, scrollPool: state.scrollPool,
    decks: cloneLevels(state.decks), pyramid: cloneLevels(state.pyramid),
    bag: { ...state.bag }, board: state.board.map(row => row.slice()),
    players: {
      player1: clonePlayer(state.players.player1), player2: clonePlayer(state.players.player2) },
    royalCards: state.royalCards.map(card => ({ ...card })),
    turnState: { ...state.turnState },
    gameOver: state.gameOver?.winnerId ? cloneJSON(state.gameOver) :
      { ...state.gameOver, conditions: state.gameOver.conditions.map(cloneJSON),
        winnerStats: cloneJSON(state.gameOver.winnerStats) }
  };
  if (state.pending !== undefined) next.pending = cloneJSON(state.pending);
  if (state.initialDeckSizes !== undefined) next.initialDeckSizes = { ...state.initialDeckSizes };
  if (state.syncAssignments !== undefined) next.syncAssignments = { ...state.syncAssignments };
  if (state.previousCrownCounts !== undefined) next.previousCrownCounts = { ...state.previousCrownCounts };
  return next;
}
