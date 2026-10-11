export const TOKEN_SUPPLY = Object.freeze({
  blue: 4, white: 4, green: 4, black: 4, red: 4, pearl: 2, gold: 3
});
export const CARD_COUNTS = Object.freeze({ level1: 13, level2: 24, level3: 30 });
export const PYRAMID_COUNTS = Object.freeze({ level1: 3, level2: 4, level3: 5 });
export const PRIVILEGE_SUPPLY = 3;
export const ROYAL_CARDS = Object.freeze([
  Object.freeze({ id: 'royal-1', points: 2, ability: 'scroll', taken: false }),
  Object.freeze({ id: 'royal-2', points: 2, ability: 'steal', taken: false }),
  Object.freeze({ id: 'royal-4', points: 2, ability: 'again', taken: false }),
  Object.freeze({ id: 'royal-3', points: 3, ability: null, taken: false })
]);
export const ROYAL_SUPPLY = ROYAL_CARDS.length;

// The live board's center-first clockwise spiral (right, down, left, up).
export const SPIRAL_ORDER = Object.freeze([
  [2, 2], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3],
  [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0],
  [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4]
].map(Object.freeze));

function sample(rng) {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('rng must return a number in [0, 1)');
  }
  return value;
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(sample(rng) * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

const emptyTokens = () => Object.fromEntries(Object.keys(TOKEN_SUPPLY).map(color => [color, 0]));
const emptyPlayer = () => ({ tokens: emptyTokens(), cards: [], reserves: [], privileges: 0 });

/** RNG is required. An explicit firstPlayer (1 or 2) skips the final RNG draw. */
export function newGame(cards, rng, { firstPlayer } = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (firstPlayer !== undefined && firstPlayer !== 1 && firstPlayer !== 2) {
    throw new RangeError('firstPlayer must be 1 or 2');
  }
  const decks = { level1: [], level2: [], level3: [] };
  for (const original of cards) {
    // Setup owns fresh editable fixtures; subsequent states share these records.
    const card = { ...original, costs: { ...original.costs } };
    const deck = decks[`level${card.level}`];
    if (!deck) throw new RangeError(`Invalid card level: ${card.level}`);
    deck.push(card);
  }
  const pyramid = {};
  const initialDeckSizes = {};
  for (const level of Object.keys(decks)) {
    shuffle(decks[level], rng);
    pyramid[level] = decks[level].splice(0, PYRAMID_COUNTS[level]);
    initialDeckSizes[level] = decks[level].length;
  }
  const tokens = Object.entries(TOKEN_SUPPLY).flatMap(([color, count]) => Array(count).fill(color));
  shuffle(tokens, rng);
  const board = Array.from({ length: 5 }, () => Array(5).fill(null));
  SPIRAL_ORDER.forEach(([row, col], i) => { board[row][col] = tokens[i]; });
  const currentPlayer = firstPlayer ?? (sample(rng) < 0.5 ? 1 : 2);
  const players = { player1: emptyPlayer(), player2: emptyPlayer() };
  players[currentPlayer === 1 ? 'player2' : 'player1'].privileges = 1;
  return {
    decks, initialDeckSizes, pyramid, bag: emptyTokens(), board,
    royalCards: ROYAL_CARDS.map(card => ({ ...card })), scrollPool: PRIVILEGE_SUPPLY - 1,
    players, currentPlayer,
    turnState: {
      playerId: `player${currentPlayer}`, boardRefilled: false, actionCompleted: false,
      extraTurnsPending: 0, isExtraTurn: false
    },
    gameOver: { winnerId: null, conditions: [], winnerStats: null },
    syncAssignments: { player1Id: null, player2Id: null },
    previousCrownCounts: { player1: 0, player2: 0 }
  };
}
