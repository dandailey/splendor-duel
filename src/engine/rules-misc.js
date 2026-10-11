import { TOKEN_SUPPLY } from './setup.js';
import { goldCells } from './tokens.js';
import { awardPrivilege, queueExtraTurn } from '../game-rules.js';

const COLORS = Object.keys(TOKEN_SUPPLY);
const GEMS = ['blue', 'white', 'green', 'red', 'black'];
const STEALABLE = [...GEMS, 'pearl'];
const LEVELS = [1, 2, 3];
const opponentOf = id => id === 'player1' ? 'player2' : 'player1';
const isCell = cell => Array.isArray(cell) && cell.length === 2 &&
  cell.every(n => Number.isInteger(n) && n >= 0 && n < 5);
function playerOf(state, playerId) {
  if (!['player1', 'player2'].includes(playerId) || !state.players?.[playerId]) {
    throw new Error('playerId must identify player1 or player2');
  }
  return state.players[playerId];
}

/** Numeric internal levels; gold availability permits each card option once. */
export function legalReserves(state, playerId) {
  if (playerOf(state, playerId).reserves.length >= 3) return [];
  if (!goldCells(state.board).length) return [];
  const options = [];
  for (const level of LEVELS) {
    state.pyramid[`level${level}`].forEach((card, index) => {
      if (card) options.push({ source: 'pyramid', level, index });
    });
    if (state.decks[`level${level}`].length) {
      options.push({ source: 'deck', level });
    }
  }
  return options;
}

/** Official rules allow choosing gold; Daniel's ruling deliberately follows the
 * live game: take a uniformly random gold cell instead. Deck order is already
 * resolved in state. Supply chance.goldCell to fix the outcome for search/tests,
 * otherwise chance.rng must supply a sample in [0, 1).
 */
export function applyReserve(state, playerId, option, chance) {
  if (!option || !legalReserves(state, playerId).some(candidate =>
    candidate.source === option.source && candidate.level === option.level &&
    (candidate.source === 'deck' ? !Object.hasOwn(option, 'index') : candidate.index === option.index)) ||
    Object.hasOwn(option, 'goldCell')) {
    throw new Error('Illegal reserve');
  }
  const cells = goldCells(state.board);
  let goldCell;
  if (chance && Object.hasOwn(chance, 'goldCell')) {
    goldCell = chance.goldCell;
    if (!isCell(goldCell) || !cells.some(cell => cell.every((n, i) => n === goldCell[i]))) {
      throw new Error('Illegal reserve gold cell');
    }
  } else {
    if (typeof chance?.rng !== 'function') throw new TypeError('Reserve requires chance.rng or chance.goldCell');
    const sample = chance.rng();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('Invalid rng sample');
    goldCell = cells[Math.floor(sample * cells.length)];
  }
  const next = structuredClone(state);
  const { source, level, index } = option;
  const [row, col] = goldCell;
  const key = `level${level}`;
  let card;
  if (source === 'deck') card = next.decks[key].shift();
  else {
    [card] = next.pyramid[key].splice(index, 1);
    if (next.decks[key].length) next.pyramid[key].splice(index, 0, next.decks[key].shift());
  }
  next.players[playerId].reserves.push(card);
  next.board[row][col] = null;
  next.players[playerId].tokens.gold += 1;
  return { state: next, events: [{ type: 'card_reserved', playerId, source, level,
    cardId: card.id, goldCell: [row, col] }] };
}

export function pendingAbilityChoices(state, playerId, ability, cardColor) {
  playerOf(state, playerId);
  if (ability === 'steal') return STEALABLE.filter(color => state.players[opponentOf(playerId)].tokens[color] > 0);
  if (ability !== 'token' || !GEMS.includes(cardColor)) return [];
  const cells = [];
  state.board.forEach((row, r) => row.forEach((color, c) => {
    if (color === cardColor) cells.push([r, c]);
  }));
  return cells;
}

/** For token, pass {cell: [row,col], cardColor} to validate matching color.
 * A bare [row,col] is also accepted: the dispatcher must have checked membership
 * in pendingAbilityChoices for the acquired card. Null skips an unavailable
 * choice effect (token skips require {cell:null, cardColor}). Wild is external.
 */
export function applyAbility(state, playerId, ability, choice) {
  playerOf(state, playerId);
  const next = structuredClone(state);
  const events = [];
  const emit = (type, details = {}) => events.push({ type, playerId, ...details });
  if (ability === 'again') {
    queueExtraTurn(next.turnState);
    emit('repeat_turn_awarded');
  } else if (ability === 'scroll') {
    const from = next.scrollPool > 0 ? 'pool' : opponentOf(playerId);
    const awarded = awardPrivilege(next, playerId);
    emit(awarded ? 'scroll_gained' : 'scroll_unavailable', awarded ? { from } : {});
  } else if (ability === 'steal') {
    const choices = pendingAbilityChoices(state, playerId, ability);
    if (!choices.length && choice == null) emit('ability_skipped', { ability });
    else {
      if (!choices.includes(choice)) throw new Error('Illegal steal choice');
      next.players[opponentOf(playerId)].tokens[choice] -= 1;
      next.players[playerId].tokens[choice] += 1;
      emit('token_stolen', { color: choice, from: opponentOf(playerId) });
    }
  } else if (ability === 'token') {
    const cell = Array.isArray(choice) ? choice : choice?.cell;
    const cardColor = Array.isArray(choice) && isCell(choice) ? state.board[choice[0]][choice[1]] : choice?.cardColor;
    const choices = pendingAbilityChoices(state, playerId, ability, cardColor);
    if (!GEMS.includes(cardColor)) throw new Error('Illegal token ability color');
    if (!choices.length && cell == null) emit('ability_skipped', { ability });
    else {
      if (!isCell(cell) || !choices.some(coord => coord.every((n, i) => n === cell[i]))) {
        throw new Error('Illegal token ability choice');
      }
      next.board[cell[0]][cell[1]] = null;
      next.players[playerId].tokens[cardColor] += 1;
      emit('bonus_token_taken', { color: cardColor, cell: [...cell] });
    }
  } else if (ability != null && ability !== '') throw new Error('Unsupported ability');
  return { state: next, events };
}

export function crownsOf(state, playerId) {
  return playerOf(state, playerId).cards.reduce((sum, card) => sum + (card.crowns || 0), 0);
}

/** Return crossed thresholds; accepts (beforeCrowns, afterCrowns) or
 * (state, playerId), using state.previousCrownCounts in the latter form.
 * Does not consume crossings: the dispatcher records the turn baseline.
 */
export function royalThresholds(before, after) {
  if (typeof before === 'object' && before !== null) {
    const state = before;
    before = state.previousCrownCounts?.[after] ?? 0;
    after = crownsOf(state, after);
  }
  if (![before, after].every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid crown counts');
  return [3, 6].filter(threshold => before < threshold && after >= threshold);
}

/** Availability only; the dispatcher must establish a threshold entitlement. */
export function legalRoyalChoices(state, playerId) {
  playerOf(state, playerId);
  return structuredClone(state.royalCards.filter(card => !card.taken));
}

/** Emits the ability for the caller to resolve before discard/victory checks. */
export function applyRoyal(state, playerId, royalId) {
  playerOf(state, playerId);
  if (!state.royalCards.some(card => card.id === royalId && !card.taken)) throw new Error('Illegal Royal choice');
  const next = structuredClone(state);
  const royal = next.royalCards.find(card => card.id === royalId);
  const acquired = { ...royal, level: 3, color: 'none', crowns: 0, costs: {} };
  next.players[playerId].cards.push(acquired);
  royal.taken = true;
  const events = [{ type: 'royal_acquired', playerId, cardId: royalId, ability: royal.ability }];
  if (royal.ability) events.push({ type: 'ability_pending', playerId, ability: royal.ability, cardId: royalId });
  return { state: next, events };
}

export function tokenTotal(state, playerId) {
  const tokens = playerOf(state, playerId).tokens;
  return COLORS.reduce((sum, color) => sum + tokens[color], 0);
}

/** Full count maps, ascending counts in TOKEN_SUPPLY color order. Returns a
 * deterministic prefix at limit; applyDiscard also accepts omitted zeroes.
 */
export function legalDiscards(state, playerId, limit = 200) {
  const tokens = playerOf(state, playerId).tokens;
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Invalid discard limit');
  const excess = tokenTotal(state, playerId) - 10;
  if (excess <= 0 || limit === 0) return [];
  const result = [];
  const suffix = Array(COLORS.length + 1).fill(0);
  for (let i = COLORS.length - 1; i >= 0; i -= 1) suffix[i] = suffix[i + 1] + tokens[COLORS[i]];
  function visit(index, remaining, map) {
    if (result.length >= limit) return;
    if (index === COLORS.length) {
      if (remaining === 0) result.push({ ...map });
      return;
    }
    const color = COLORS[index];
    for (let count = Math.max(0, remaining - suffix[index + 1]); count <= Math.min(tokens[color], remaining); count += 1) {
      map[color] = count;
      visit(index + 1, remaining - count, map);
      if (result.length >= limit) break;
    }
  }
  visit(0, excess, {});
  return result;
}

export function applyDiscard(state, playerId, discardMap) {
  const tokens = playerOf(state, playerId).tokens;
  const excess = tokenTotal(state, playerId) - 10;
  if (!discardMap || Array.isArray(discardMap) || typeof discardMap !== 'object' || excess <= 0 ||
    Object.keys(discardMap).some(color => !COLORS.includes(color)) ||
    Object.entries(discardMap).some(([color, count]) => !Number.isInteger(count) || count < 0 || count > tokens[color]) ||
    Object.values(discardMap).reduce((sum, count) => sum + count, 0) !== excess) {
    throw new Error('Illegal discard: return exactly the excess tokens');
  }
  const next = structuredClone(state);
  for (const [color, count] of Object.entries(discardMap)) {
    next.players[playerId].tokens[color] -= count;
    next.bag[color] += count;
  }
  return { state: next, events: [{ type: 'tokens_discarded', playerId, tokens: structuredClone(discardMap) }] };
}

export function victoryStats(state, playerId) {
  const colorPoints = Object.fromEntries(GEMS.map(color => [color, 0]));
  let totalPoints = 0;
  let totalCrowns = 0;
  for (const card of playerOf(state, playerId).cards) {
    const points = card.points || 0;
    totalPoints += points;
    totalCrowns += card.crowns || 0;
    const color = card.color === 'wild' ? card.wildColorStack : card.color;
    if (GEMS.includes(color)) colorPoints[color] += points;
  }
  let maxColor = GEMS[0];
  for (const color of GEMS) if (colorPoints[color] > colorPoints[maxColor]) maxColor = color;
  return { totalPoints, totalCrowns, colorPoints, maxColor, maxPoints: colorPoints[maxColor] };
}

export function checkVictory(state, playerId) {
  const stats = victoryStats(state, playerId);
  const conditions = [];
  if (stats.totalPoints >= 20) conditions.push({ key: 'points_20', label: '20+ total prestige points' });
  if (stats.totalCrowns >= 10) conditions.push({ key: 'crowns_10', label: '10+ crowns' });
  if (stats.maxPoints >= 10) conditions.push({ key: 'color_points_10', label: `10+ prestige points in ${stats.maxColor}` });
  return { won: conditions.length > 0, conditions };
}
