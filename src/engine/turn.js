import { cloneState, cloneJSON } from './clone.js';
import {
  legalPrivilegeUses, applyPrivilegeUse, canRefill, applyRefill, randomOrder,
  legalTakeSelections, isStraightLine, applyTake
} from './tokens.js';
import { paymentEnumerator, paymentOptions, canPlaceWild, applyBuy } from './cards-play.js';
import {
  legalReserves, applyReserve, pendingAbilityChoices, applyAbility, crownsOf,
  royalThresholds, legalRoyalChoices, applyRoyal, tokenTotal, legalDiscards,
  applyDiscard, checkVictory, victoryStats
} from './rules-misc.js';

const GEMS = ['blue', 'white', 'green', 'black', 'red'];
export const isTerminal = state => Boolean(state.gameOver?.winnerId);
export const winner = state => state.gameOver?.winnerId ?? null;
/** All forced choices belong to the current turn's mover. */
export const mover = state => isTerminal(state) ? null : `player${state.currentPlayer}`;

function limits({ paymentLimit = 4, discardLimit = 12 } = {}) {
  for (const value of [paymentLimit, discardLimit]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Move limits must be positive integers');
  }
  return { paymentLimit, discardLimit };
}

// Structural equality ignores object insertion order, but preserves array order
// and requires exactly the same keys (including omitted optional move fields).
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' ||
      Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

/** Stable row/level/index order. Caps are deterministic prefixes, with payment
 * options ordered by least gold first. Pass the same options to applyMove when
 * using non-default caps. New setup/live states are accepted without new fields.
 */
export function legalMoves(state, options = {}) {
  const { paymentLimit, discardLimit } = limits(options);
  if (isTerminal(state)) return [];
  const id = mover(state);
  const pending = state.pending;
  if (pending?.type === 'ability') {
    return pendingAbilityChoices(state, id, pending.ability, pending.cardColor)
      .map(choice => ({ type: 'abilityChoice', choice }));
  }
  if (pending?.type === 'royal') {
    return legalRoyalChoices(state, id).map(card => ({ type: 'royal', royalId: card.id }));
  }
  if (pending?.type === 'discard') {
    return legalDiscards(state, id, discardLimit).map(discard => ({ type: 'discard', discard }));
  }
  if (pending) throw new Error('Unknown pending resolution');
  if (state.turnState.mandatoryDone ?? state.turnState.actionCompleted) return [];
  const moves = [];
  for (const cell of legalPrivilegeUses(state, id)) moves.push({ type: 'usePrivilege', cell });
  const refill = canRefill(state, id);
  if (refill) moves.push({ type: 'refill' });
  const optionalCount = moves.length;
  for (const cells of legalTakeSelections(state.board)) moves.push({ type: 'take', cells });
  for (const option of legalReserves(state, id)) moves.push({ type: 'reserve', ...option });
  const payments = paymentEnumerator(state, id);
  let wildColors;
  function buys(card, source, level, index) {
    if (!card) return;
    if (card.color === 'wild') {
      wildColors ??= GEMS.filter(color => canPlaceWild(state, id, color));
      if (!wildColors.length) return;
      for (const payment of payments(card, paymentLimit)) {
        for (const wildColor of wildColors) moves.push({ type: 'buy', source, level, index, payment, wildColor });
      }
    } else {
      for (const payment of payments(card, paymentLimit)) moves.push({ type: 'buy', source, level, index, payment });
    }
  }
  for (let level = 1; level <= 3; level++) {
    const cards = state.pyramid[`level${level}`];
    for (let index = 0; index < cards.length; index++) buys(cards[index], 'pyramid', level, index);
  }
  const reserves = state.players[id].reserves;
  for (let index = 0; index < reserves.length; index++) buys(reserves[index], 'reserve', reserves[index].level, index);
  // With no mandatory action the board must first be replenished if possible.
  if (moves.length === optionalCount && !refill) moves.push({ type: 'pass' });
  return moves;
}

// Validate only the requested decision. Payment/discard enumeration still uses
// the same deterministic caps, and exact structural matching rejects extras.
function isLegalMove(state, move, options) {
  const { paymentLimit, discardLimit } = limits(options);
  if (isTerminal(state) || !move || typeof move !== 'object') return false;
  const id = mover(state), pending = state.pending;
  if (pending) {
    if (pending.type === 'ability') return pendingAbilityChoices(state, id, pending.ability, pending.cardColor)
      .some(choice => equal({ type: 'abilityChoice', choice }, move));
    if (pending.type === 'royal') return legalRoyalChoices(state, id)
      .some(card => equal({ type: 'royal', royalId: card.id }, move));
    if (pending.type === 'discard') return legalDiscards(state, id, discardLimit)
      .some(discard => equal({ type: 'discard', discard }, move));
    throw new Error('Unknown pending resolution');
  }
  if (state.turnState.mandatoryDone ?? state.turnState.actionCompleted) return false;
  switch (move.type) {
    case 'usePrivilege':
      return legalPrivilegeUses(state, id).some(cell => equal({ type: 'usePrivilege', cell }, move));
    case 'refill': return equal({ type: 'refill' }, move) && canRefill(state, id);
    case 'take': {
      const cells = move.cells;
      if (!isStraightLine(cells)) return false;
      const canonical = cells.map(cell => [...cell]).sort(([ar, ac], [br, bc]) => ar - br || ac - bc);
      return canonical.every(([r, c]) => GEMS.includes(state.board[r][c]) || state.board[r][c] === 'pearl') &&
        equal({ type: 'take', cells: canonical }, move);
    }
    case 'reserve':
      return legalReserves(state, id).some(option => equal({ type: 'reserve', ...option }, move));
    case 'buy': {
      const { source, level, index } = move;
      if (source !== 'pyramid' && source !== 'reserve') return false;
      if (!Number.isInteger(index) || index < 0 || ![1, 2, 3].includes(level)) return false;
      const card = (source === 'pyramid' ? state.pyramid[`level${level}`] : state.players[id].reserves)[index];
      if (!card || (source === 'reserve' && card.level !== level)) return false;
      if (card.color === 'wild' && !canPlaceWild(state, id, move.wildColor)) return false;
      return paymentOptions(state, id, card, { limit: paymentLimit }).some(payment => {
        const candidate = { type: 'buy', source, level, index, payment };
        if (card.color === 'wild') candidate.wildColor = move.wildColor;
        return equal(candidate, move);
      });
    }
    case 'pass': return legalMoves(state, options).some(candidate => equal(candidate, move));
    default: return false;
  }
}

function initialize(next, crownsAtTurnStart) {
  next.pending ??= null;
  next.turnState.mandatoryDone ??= Boolean(next.turnState.actionCompleted);
  next.turnState.crownsAtTurnStart ??= crownsAtTurnStart;
  return next;
}

function endTurn(state, events) {
  const id = mover(state);
  state.previousCrownCounts ??= { player1: 0, player2: 0 };
  state.previousCrownCounts[id] = crownsOf(state, id);
  const extra = state.turnState.extraTurnsPending > 0;
  const remaining = extra ? state.turnState.extraTurnsPending - 1 : 0;
  if (!extra) state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
  const nextId = mover(state);
  state.turnState = {
    ...state.turnState, playerId: nextId, boardRefilled: false, actionCompleted: false,
    mandatoryDone: false, extraTurnsPending: remaining, isExtraTurn: extra,
    crownsAtTurnStart: crownsOf(state, nextId)
  };
  state.pending = null;
  events.push({ type: 'turn_ended', playerId: id, nextPlayerId: nextId, isExtraTurn: extra });
  return state;
}

// Resolve automatic effects until the next required decision or the next turn.
// royalsRemaining travels with pending so serialized states need no hidden queue.
function advance(state, events, royalsRemaining, ability = null, cardColor = null) {
  const id = mover(state);
  if (ability) {
    const choices = pendingAbilityChoices(state, id, ability, cardColor);
    if ((ability === 'token' || ability === 'steal') && choices.length > 1) {
      state.pending = { type: 'ability', ability, cardColor, royalsRemaining };
      return state;
    }
    // A token ability with no matching color is unavailable as well.
    if (ability === 'token' && !GEMS.includes(cardColor)) {
      events.push({ type: 'ability_skipped', playerId: id, ability });
    } else {
      const choice = ability === 'token' ? { cell: choices[0] ?? null, cardColor } : choices[0] ?? null;
      const result = applyAbility(state, id, ability, choice);
      state = result.state;
      events.push(...result.events);
    }
  }
  if (royalsRemaining > 0 && legalRoyalChoices(state, id).length) {
    state.pending = { type: 'royal', royalsRemaining };
    return state;
  }
  if (tokenTotal(state, id) > 10) {
    state.pending = { type: 'discard' };
    return state;
  }
  state.pending = null;
  const victory = checkVictory(state, id);
  if (victory.won) {
    state.gameOver = { winnerId: id, conditions: victory.conditions, winnerStats: victoryStats(state, id) };
    state.previousCrownCounts ??= { player1: 0, player2: 0 };
    state.previousCrownCounts[id] = crownsOf(state, id);
    events.push({ type: 'game_over', ...cloneJSON(state.gameOver) });
    return state;
  }
  return endTurn(state, events);
}

/** RNG is consumed by refill and reserve gold selection. Every accepted move
 * is checked against the same legal decisions, including payment/discard caps
 * and pending choices.
 */
export function applyMoveWithEvents(state, move, rng, options = {}) {
  if (!isLegalMove(state, move, options)) throw new Error('Illegal move');
  let next = state;
  const id = mover(state);
  const crownsAtTurnStart = state.turnState.crownsAtTurnStart ?? crownsOf(state, id);
  const events = [];
  const record = result => { next = initialize(result.state, crownsAtTurnStart); events.push(...result.events); };
  switch (move.type) {
    case 'usePrivilege':
      next = initialize(applyPrivilegeUse(next, id, move.cell), crownsAtTurnStart);
      events.push({ type: 'privilege_used', playerId: id, cell: [...move.cell] });
      break;
    case 'refill':
      next = initialize(applyRefill(next, id, randomOrder(next, rng)), crownsAtTurnStart);
      events.push({ type: 'board_refilled', playerId: id });
      break;
    case 'pass':
      events.push({ type: 'passed', playerId: id });
      next = endTurn(initialize(cloneState(next), crownsAtTurnStart), events);
      break;
    case 'abilityChoice': {
      const { ability, cardColor, royalsRemaining } = next.pending;
      record(applyAbility(next, id, ability,
        ability === 'token' ? { cell: move.choice, cardColor } : move.choice));
      next = advance(next, events, royalsRemaining);
      break;
    }
    case 'royal': {
      const remaining = next.pending.royalsRemaining - 1;
      const royal = next.royalCards.find(card => card.id === move.royalId);
      record(applyRoyal(next, id, move.royalId));
      next = advance(next, events, remaining, royal.ability);
      break;
    }
    case 'discard':
      record(applyDiscard(next, id, move.discard));
      next = advance(next, events, 0);
      break;
    default: {
      let ability = null;
      let color = null;
      if (move.type === 'take') {
        next = initialize(applyTake(next, id, move.cells), crownsAtTurnStart);
        events.push({ type: 'tokens_taken', playerId: id, cells: cloneJSON(move.cells) });
      } else if (move.type === 'reserve') record(applyReserve(next, id, move, { rng }));
      else if (move.type === 'buy') {
        const result = applyBuy(next, id, move);
        ability = result.events[0].card.ability;
        color = result.events[0].card.wildColorStack ?? result.events[0].card.color;
        record(result);
      }
      next.turnState.mandatoryDone = true;
      next.turnState.actionCompleted = true;
      const remaining = royalThresholds(next.turnState.crownsAtTurnStart, crownsOf(next, id)).length;
      next = advance(next, events, remaining, ability, color);
    }
  }
  return { state: next, events };
}

export function applyMove(state, move, rng, options = {}) {
  return applyMoveWithEvents(state, move, rng, options).state;
}
