import { cloneState, cloneJSON } from './clone.js';
import { TOKEN_SUPPLY } from './setup.js';

const COLORS = Object.keys(TOKEN_SUPPLY);
const GEMS = COLORS.filter(color => color !== 'pearl' && color !== 'gold');
const COST_COLORS = COLORS.filter(color => color !== 'gold');

function player(state, playerId) {
  if (!['player1', 'player2'].includes(playerId) || !state.players?.[playerId]) {
    throw new Error('playerId must identify player1 or player2');
  }
  return state.players[playerId];
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

/** Discounts and victory totals; doubles multiply bonuses only, never points/crowns. */
export function playerBonuses(state, playerId) {
  const bonuses = { blue: 0, white: 0, green: 0, black: 0, red: 0 };
  const colorPoints = { blue: 0, white: 0, green: 0, black: 0, red: 0 };
  let totalPoints = 0;
  let totalCrowns = 0;
  for (const card of player(state, playerId).cards) {
    const color = card.color === 'wild' ? card.wildColorStack : card.color;
    totalPoints += card.points || 0;
    totalCrowns += card.crowns || 0;
    if (GEMS.includes(color)) {
      bonuses[color] += card.isDouble ? 2 : 1;
      colorPoints[color] += card.points || 0;
    }
  }
  return { bonuses, totalPoints, totalCrowns, colorPoints };
}

/** Acquisition order determines the top of each color stack. */
export function canPlaceWild(state, playerId, color) {
  const cards = player(state, playerId).cards;
  if (!GEMS.includes(color)) return false;
  const top = cards.findLast(card => (card.color === 'wild' ? card.wildColorStack : card.color) === color);
  return Boolean(top && top.color !== 'wild');
}

function paymentContext(state, playerId, card) {
  const tokens = player(state, playerId).tokens;
  const { bonuses } = playerBonuses(state, playerId);
  if (!card?.costs) throw new Error('Card must have costs');
  COLORS.forEach(color => count(tokens[color], `tokens.${color}`));
  const needs = COST_COLORS.map(color => Math.max(0,
    count(card.costs[color] ?? 0, `costs.${color}`) - (bonuses[color] || 0)));
  return { tokens, needs };
}

function costNeed(card, color, discount) {
  const cost = card.costs[color] ?? 0;
  if (!Number.isSafeInteger(cost) || cost < 0) throw new Error(`costs.${color} must be a non-negative integer`);
  return Math.max(0, cost - discount);
}

/** Prepare holdings and discounts once for a batch of cards. The returned
 * enumerator is local to one legalMoves call; no state-keyed caches can go stale. */
export function paymentEnumerator(state, playerId) {
  const owner = player(state, playerId), tokens = owner.tokens;
  const bonuses = { blue: 0, white: 0, green: 0, black: 0, red: 0 };
  for (const card of owner.cards) {
    const color = card.color === 'wild' ? card.wildColorStack : card.color;
    if (GEMS.includes(color)) bonuses[color] += card.isDouble ? 2 : 1;
  }
  for (const color of COLORS) {
    if (!Number.isSafeInteger(tokens[color]) || tokens[color] < 0) count(tokens[color], `tokens.${color}`);
  }
  return (card, limit) => {
    if (!card?.costs) throw new Error('Card must have costs');
    const blue = costNeed(card, 'blue', bonuses.blue);
    const white = costNeed(card, 'white', bonuses.white);
    const green = costNeed(card, 'green', bonuses.green);
    const black = costNeed(card, 'black', bonuses.black);
    const red = costNeed(card, 'red', bonuses.red);
    const pearl = costNeed(card, 'pearl', 0);
    const minGold = Math.max(0, blue - tokens.blue) + Math.max(0, white - tokens.white) +
      Math.max(0, green - tokens.green) + Math.max(0, black - tokens.black) +
      Math.max(0, red - tokens.red) + Math.max(0, pearl - tokens.pearl);
    if (minGold > tokens.gold || limit === 0) return [];
    if (tokens.gold === 0) return [{ spend: { blue, white, green, black, red, pearl, gold: 0 } }];
    const needs = [blue, white, green, black, red, pearl];
    const minimum = needs.map((need, i) => Math.max(0, need - tokens[COST_COLORS[i]]));
    const maxGold = Math.min(tokens.gold, blue + white + green + black + red + pearl);
    const suffixMin = Array(7).fill(0), suffixMax = Array(7).fill(0);
    for (let i = 5; i >= 0; i--) {
      suffixMin[i] = suffixMin[i + 1] + minimum[i];
      suffixMax[i] = suffixMax[i + 1] + needs[i];
    }
    const options = [];
    const spend = { blue: 0, white: 0, green: 0, black: 0, red: 0, pearl: 0, gold: 0 };
    function visit(index, remaining) {
      if (options.length >= limit) return;
      if (index === 6) {
        if (remaining === 0) options.push({ spend: { ...spend } });
        return;
      }
      const low = Math.max(minimum[index], remaining - suffixMax[index + 1]);
      const high = Math.min(needs[index], remaining - suffixMin[index + 1]);
      for (let gold = low; gold <= high && options.length < limit; gold++) {
        spend[COST_COLORS[index]] = needs[index] - gold;
        visit(index + 1, remaining - gold);
      }
    }
    for (let gold = minGold; gold <= maxGold && options.length < limit; gold++) {
      spend.gold = gold;
      visit(0, gold);
    }
    return options;
  };
}

/** Exact payments, ascending gold count, then lexicographic gold assignments
 * in blue/white/green/black/red/pearl order. limit bounds returned options. */
export function paymentOptions(state, playerId, card, { limit = 64 } = {}) {
  count(limit, 'limit');
  return paymentEnumerator(state, playerId)(card, limit);
}

/** Financial affordability only; wild placement is a separate legality check. */
export function canAfford(state, playerId, card) {
  const { tokens, needs } = paymentContext(state, playerId, card);
  return needs.reduce((sum, need, i) => sum + Math.max(0, need - tokens[COST_COLORS[i]]), 0) <= tokens.gold;
}

/** payment accepts a paymentOptions entry or its spend map. Deck order is the
 * complete chance outcome, so chance is reserved for the future dispatcher.
 * Like token primitives, this does not enforce or advance turn phases. */
export function applyBuy(state, playerId, { source, level, index, payment, wildColor }, chance) {
  const owner = player(state, playerId);
  if (!['pyramid', 'reserve'].includes(source)) throw new Error('Invalid purchase source');
  const levelKey = Number.isInteger(level) ? `level${level}` : level;
  if ((source === 'pyramid' || level !== undefined) && !['level1', 'level2', 'level3'].includes(levelKey)) {
    throw new Error('Invalid purchase level');
  }
  const collection = source === 'pyramid' ? state.pyramid[levelKey] : owner.reserves;
  if (!Number.isInteger(index) || index < 0 || index >= collection.length || !collection[index]) {
    throw new Error('Invalid purchase index');
  }
  const card = collection[index];
  if (level !== undefined && `level${card.level}` !== levelKey) throw new Error('Card does not match purchase level');
  if (card.color === 'wild' && !canPlaceWild(state, playerId, wildColor)) throw new Error('Illegal wild placement');
  const spend = payment?.spend ?? payment;
  if (!spend || typeof spend !== 'object' || Array.isArray(spend) ||
      Object.keys(spend).some(color => !COLORS.includes(color))) throw new Error('Invalid payment');
  const { tokens, needs } = paymentContext(state, playerId, card);
  for (const color of COLORS) {
    count(spend[color], `payment.${color}`);
    if (spend[color] > tokens[color]) throw new Error('Payment exceeds available tokens');
    count(state.bag[color], `bag.${color}`);
  }
  let remaining = 0;
  COST_COLORS.forEach((color, i) => {
    if (spend[color] > needs[i]) throw new Error('Payment overpays a color');
    remaining += needs[i] - spend[color];
  });
  if (remaining !== spend.gold) throw new Error('Payment must cover the cost exactly');
  const crownsBefore = playerBonuses(state, playerId).totalCrowns;
  const next = cloneState(state);
  const nextPlayer = next.players[playerId];
  for (const color of COLORS) {
    nextPlayer.tokens[color] -= spend[color];
    next.bag[color] += spend[color];
  }
  let purchased = (source === 'pyramid' ? next.pyramid[levelKey] : nextPlayer.reserves).splice(index, 1)[0];
  if (source === 'pyramid' && next.decks[levelKey].length > 0) {
    next.pyramid[levelKey].splice(index, 0, next.decks[levelKey].shift());
  }
  if (purchased.color === 'wild') purchased = { ...purchased, wildColorStack: wildColor };
  nextPlayer.cards.push(purchased);
  return { state: next, events: [{
    type: 'bought', card: cloneJSON(purchased),
    abilities: purchased.ability ? [purchased.ability] : [],
    crownsBefore, crownsAfter: playerBonuses(next, playerId).totalCrowns
  }] };
}
