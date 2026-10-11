import { LEVELS } from './index.js';

// Pure snapshot codec. Storage and time are supplied by the page.
export const VS_COMPUTER_SAVE_KEY = 'splendor_duel_vs_computer_save_v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const playerId = value => value === 'player1' || value === 'player2';
const colors = ['white', 'blue', 'green', 'red', 'black', 'pearl', 'gold'];
const counts = (value, keys) => object(value) && keys.every(key => count(value[key]));
const card = value => object(value) && typeof value.id === 'string' && count(value.points)
  && (value.id.startsWith('royal-') || ([1, 2, 3].includes(value.level)
    && typeof value.color === 'string' && count(value.crowns) && typeof value.isDouble === 'boolean'
    && counts(value.costs, colors.slice(0, 6))));
const cards = value => Array.isArray(value) && value.every(card);
const turn = value => object(value) && typeof value.id === 'string' && playerId(value.playerId)
  && Array.isArray(value.events) && value.events.every(event => object(event) && typeof event.type === 'string');

export function validateSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.v !== 1 || !count(snapshot.savedAt)
      || !(Number.isInteger(snapshot.level) && Object.hasOwn(LEVELS, snapshot.level)) || snapshot.aiPlayerId !== 'player2'
      || !(snapshot.lastSeenTurnId === null || typeof snapshot.lastSeenTurnId === 'string')) return false;
  const payload = snapshot.state;
  if (!object(payload)) return false;
  const { gameState: game, turnDisplayState: view, previousCrownCounts: crowns, turnHistory: history } = payload;
  if (!object(game) || !object(view) || view.activePlayerId !== 'player1' || view.opponentPlayerId !== 'player2'
      || !counts(crowns, ['player1', 'player2']) || !object(history) || !count(history.nextTurnId)
      || history.nextTurnId < 1 || !Array.isArray(history.turns) || !history.turns.every(turn)
      || !(history.pendingTurn === null || turn(history.pendingTurn))) return false;
  const levels = ['level1', 'level2', 'level3'];
  if (!object(game.decks) || !object(game.pyramid) || !levels.every(level => cards(game.decks[level]) && cards(game.pyramid[level]))
      || !counts(game.initialDeckSizes, levels) || !counts(game.bag, colors) || !count(game.scrollPool)
      || !Array.isArray(game.board) || game.board.length !== 5 || !game.board.every(row => Array.isArray(row)
        && row.length === 5 && row.every(cell => cell === null || colors.includes(cell))) || !cards(game.royalCards)
      || ![1, 2].includes(game.currentPlayer) || !object(game.players)) return false;
  if (!['player1', 'player2'].every(id => {
    const player = game.players[id];
    return object(player) && counts(player.tokens, colors) && cards(player.cards) && cards(player.reserves) && count(player.privileges);
  })) return false;
  const phase = game.turnState;
  return object(phase) && phase.playerId === `player${game.currentPlayer}` && typeof phase.boardRefilled === 'boolean'
    && typeof phase.actionCompleted === 'boolean' && typeof phase.isExtraTurn === 'boolean' && count(phase.extraTurnsPending)
    && object(game.gameOver) && (game.gameOver.winnerId === null || playerId(game.gameOver.winnerId))
    && Array.isArray(game.gameOver.conditions) && (game.gameOver.winnerStats === null || object(game.gameOver.winnerStats))
    && object(game.syncAssignments) && ['player1Id', 'player2Id'].every(key => game.syncAssignments[key] === null || typeof game.syncAssignments[key] === 'string');
}

export function serializeSnapshot(state, { level, savedAt, lastSeenTurnId = null }) {
  const snapshot = { v: 1, savedAt, level, aiPlayerId: 'player2', state: structuredClone(state), lastSeenTurnId };
  if (!validateSnapshot(snapshot)) throw new TypeError('Invalid vs-Computer snapshot');
  return JSON.stringify(snapshot);
}

export function parseSnapshot(raw) {
  try {
    const snapshot = JSON.parse(raw);
    return validateSnapshot(snapshot) && !snapshot.state.gameState.gameOver.winnerId ? snapshot : null;
  } catch { return null; }
}
