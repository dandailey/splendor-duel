import { SPIRAL_ORDER, TOKEN_SUPPLY } from './setup.js';
import { awardPrivilege, spendPrivilege } from '../game-rules.js';

const COLORS = Object.keys(TOKEN_SUPPLY);
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const compareCoords = ([ar, ac], [br, bc]) => ar - br || ac - bc;
const isCoord = coord => Array.isArray(coord) && coord.length === 2 &&
  coord.every(value => Number.isInteger(value) && value >= 0 && value < 5);
const isTakeable = color => COLORS.includes(color) && color !== 'gold';
const opponent = playerId => playerId === 'player1' ? 'player2' : 'player1';

function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== 5 || board.some(row =>
    !Array.isArray(row) || row.length !== 5 || row.some(color => color !== null && !COLORS.includes(color)))) {
    throw new Error('Board must be a 5x5 array of token colors or null');
  }
}

function validatePlayer(state, playerId) {
  if (!['player1', 'player2'].includes(playerId) || !state.players?.[playerId]) {
    throw new Error('playerId must identify player1 or player2');
  }
}

function bagTokens(state) {
  if (!state.bag || Object.keys(state.bag).some(color => !COLORS.includes(color)) ||
    COLORS.some(color => !Number.isInteger(state.bag[color]) || state.bag[color] < 0)) {
    throw new Error('Bag must contain non-negative integer counts for all token colors');
  }
  return COLORS.flatMap(color => Array(state.bag[color]).fill(color));
}

/** Fresh coordinates, in the live center-first clockwise refill order. */
export function spiralOrder() {
  return structuredClone(SPIRAL_ORDER);
}

/** Each selection is sorted by row then column; reversals occur only once. */
export function legalTakeSelections(board) {
  validateBoard(board);
  const selections = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (!isTakeable(board[row][col])) continue;
      selections.push([[row, col]]);
      for (const [dr, dc] of DIRECTIONS) {
        const line = [[row, col]];
        for (let length = 2; length <= 3; length += 1) {
          const next = [row + dr * (length - 1), col + dc * (length - 1)];
          if (!isCoord(next) || !isTakeable(board[next[0]][next[1]])) break;
          line.push(next);
          if (isStraightLine(line)) selections.push(line.map(coord => [...coord]).sort(compareCoords));
        }
      }
    }
  }
  return selections;
}

/** 1–3 board cells in any order, contiguous along one unit-step line. */
export function isStraightLine(coords) {
  if (!Array.isArray(coords) || coords.length < 1 || coords.length > 3 || !coords.every(isCoord)) return false;
  if (coords.length === 1) return true;
  const sorted = structuredClone(coords).sort(compareCoords);
  const dr = sorted[1][0] - sorted[0][0];
  const dc = sorted[1][1] - sorted[0][1];
  if (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) return false;
  return sorted.slice(1).every(([row, col], index) =>
    row - sorted[index][0] === dr && col - sorted[index][1] === dc);
}

/** Colors from one mandatory take, rather than the player's complete holding. */
export function takePrivilegeBonus(tokens) {
  return (tokens.length === 3 && tokens.every(color => color === tokens[0])) ||
    tokens.filter(color => color === 'pearl').length >= 2;
}

// These primitives only change the pieces named in their contracts. The turn
// dispatcher owns mandatory-action completion and end-of-turn sequencing.
export function applyTake(state, playerId, coords) {
  validatePlayer(state, playerId);
  if (!Array.isArray(coords) || coords.length < 1 || coords.length > 3 || !coords.every(isCoord)) {
    throw new Error('Illegal take: choose 1–3 valid board coordinates');
  }
  const canonical = coords.map(coord => [...coord]).sort(compareCoords);
  const key = JSON.stringify(canonical);
  if (!legalTakeSelections(state.board).some(selection => JSON.stringify(selection) === key)) {
    throw new Error('Illegal take: tokens must be non-gold and contiguous in one straight line');
  }
  const next = structuredClone(state);
  const colors = canonical.map(([row, col]) => next.board[row][col]);
  for (const [row, col] of canonical) {
    next.players[playerId].tokens[next.board[row][col]] += 1;
    next.board[row][col] = null;
  }
  if (takePrivilegeBonus(colors)) awardPrivilege(next, opponent(playerId));
  return next;
}

export function legalPrivilegeUses(state, playerId) {
  validatePlayer(state, playerId);
  validateBoard(state.board);
  if (state.players[playerId].privileges < 1 || state.turnState.boardRefilled) return [];
  return legalTakeSelections(state.board).filter(selection => selection.length === 1).map(([coord]) => coord);
}

export function applyPrivilegeUse(state, playerId, coord) {
  if (!isCoord(coord) || !legalPrivilegeUses(state, playerId).some(([row, col]) => row === coord[0] && col === coord[1])) {
    throw new Error('Illegal Privilege use: requires a Privilege, a non-gold token, and no refill this turn');
  }
  const next = structuredClone(state);
  spendPrivilege(next, playerId);
  const [row, col] = coord;
  next.players[playerId].tokens[next.board[row][col]] += 1;
  next.board[row][col] = null;
  return next;
}

export function canRefill(state, playerId) {
  validatePlayer(state, playerId);
  return !state.turnState.boardRefilled && bagTokens(state).length > 0;
}

export function applyRefill(state, playerId, order) {
  if (!canRefill(state, playerId)) throw new Error('Cannot refill: bag is empty or board was already refilled this turn');
  validateBoard(state.board);
  const tokens = bagTokens(state);
  if (!Array.isArray(order) || order.length !== tokens.length || order.some(color => !COLORS.includes(color)) ||
    COLORS.some(color => order.filter(token => token === color).length !== state.bag[color])) {
    throw new Error('Refill order must be a permutation of every token in the bag');
  }
  const empty = spiralOrder().filter(([row, col]) => state.board[row][col] === null);
  if (empty.length < order.length) throw new Error('Cannot refill: not enough empty board cells for the bag');
  const next = structuredClone(state);
  order.forEach((color, index) => {
    const [row, col] = empty[index];
    next.board[row][col] = color;
  });
  for (const color of COLORS) next.bag[color] = 0;
  awardPrivilege(next, opponent(playerId));
  next.turnState.boardRefilled = true;
  return next;
}

/** Fisher–Yates on a fresh bag array; the caller supplies all randomness. */
export function randomOrder(state, rng) {
  if (typeof rng !== 'function') throw new Error('rng must be a function');
  const tokens = bagTokens(state);
  for (let index = tokens.length - 1; index > 0; index -= 1) {
    const sample = rng();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('rng must return a number in [0, 1)');
    const other = Math.floor(sample * (index + 1));
    [tokens[index], tokens[other]] = [tokens[other], tokens[index]];
  }
  return tokens;
}

export function goldCells(board) {
  validateBoard(board);
  const coords = [];
  board.forEach((row, r) => row.forEach((color, c) => { if (color === 'gold') coords.push([r, c]); }));
  return coords;
}

/** Gold transfer only; the reservation dispatcher validates/acquires the card. */
export function takeGoldFrom(state, playerId, coord) {
  validatePlayer(state, playerId);
  validateBoard(state.board);
  if (!isCoord(coord) || state.board[coord[0]][coord[1]] !== 'gold') {
    throw new Error('Illegal gold choice: choose a gold token on the board');
  }
  const next = structuredClone(state);
  next.board[coord[0]][coord[1]] = null;
  next.players[playerId].tokens.gold += 1;
  return next;
}
