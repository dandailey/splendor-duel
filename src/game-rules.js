export const PRIVILEGE_SUPPLY = 3;

export const createInitialBag = () => ({
  blue: 4,
  white: 4,
  green: 4,
  black: 4,
  red: 4,
  pearl: 2,
  gold: 3
});

export const createEmptyPlayer = () => ({
  tokens: {
    blue: 0,
    white: 0,
    green: 0,
    black: 0,
    red: 0,
    pearl: 0,
    gold: 0
  },
  cards: [],
  reserves: [],
  privileges: 0
});

export const createTurnState = (playerId, options = {}) => ({
  playerId,
  boardRefilled: false,
  actionCompleted: false,
  extraTurnsPending: Math.max(0, options.extraTurnsPending || 0),
  isExtraTurn: Boolean(options.isExtraTurn)
});

export const queueExtraTurn = (turnState) => {
  turnState.extraTurnsPending = Math.max(0, turnState.extraTurnsPending || 0) + 1;
  return turnState.extraTurnsPending;
};

export const consumeExtraTurn = (turnState) => {
  const pending = Math.max(0, turnState.extraTurnsPending || 0);
  if (pending === 0) return null;

  return createTurnState(turnState.playerId, {
    extraTurnsPending: pending - 1,
    isExtraTurn: true
  });
};

export const getOpponentTurnsSinceLastLocalTurn = (turnHistory, localPlayerId) => {
  if (!localPlayerId) return [];

  const turns = Array.isArray(turnHistory?.turns) ? turnHistory.turns : [];
  const recent = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    if (turn.playerId === localPlayerId) break;
    recent.unshift(turn);
  }
  return recent;
};

export const resetGamePieces = (state) => {
  state.bag = createInitialBag();
  state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
  state.scrollPool = PRIVILEGE_SUPPLY;
  state.players = {
    player1: createEmptyPlayer(),
    player2: createEmptyPlayer()
  };
};

export const getPrivilegeTotal = (state) => (
  (state.scrollPool || 0) +
  (state.players.player1.privileges || 0) +
  (state.players.player2.privileges || 0)
);

export const awardPrivilege = (state, playerId) => {
  const player = state.players[playerId];
  if (!player || (player.privileges || 0) >= PRIVILEGE_SUPPLY) return false;

  if ((state.scrollPool || 0) > 0) {
    state.scrollPool -= 1;
    player.privileges = (player.privileges || 0) + 1;
    return true;
  }

  const opponentId = playerId === "player1" ? "player2" : "player1";
  const opponent = state.players[opponentId];
  if ((opponent?.privileges || 0) <= 0) return false;

  opponent.privileges -= 1;
  player.privileges = (player.privileges || 0) + 1;
  return true;
};

export const spendPrivilege = (state, playerId) => {
  const player = state.players[playerId];
  if (!player || (player.privileges || 0) <= 0) return false;

  player.privileges -= 1;
  state.scrollPool = Math.min(PRIVILEGE_SUPPLY, (state.scrollPool || 0) + 1);
  return true;
};
