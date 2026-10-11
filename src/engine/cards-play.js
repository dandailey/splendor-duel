import { TOKEN_SUPPLY } from './setup.js';

const COLORS = Object.keys(TOKEN_SUPPLY);
const GEMS = COLORS.filter(color => color !== 'pearl' && color !== 'gold');
const COST_COLORS = COLORS.filter(color => color !== 'gold');
const zeros = colors => Object.fromEntries(colors.map(color => [color, 0]));

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
  const bonuses = zeros(GEMS);
  const colorPoints = zeros(GEMS);
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

/** Exact payments, ascending gold count, then lexicographic gold assignments
 * in blue/white/green/black/red/pearl order. limit bounds returned options. */
export function paymentOptions(state, playerId, card, { limit = 64 } = {}) {
  count(limit, 'limit');
  const { tokens, needs } = paymentContext(state, playerId, card);
  const minimum = needs.map((need, i) => Math.max(0, need - tokens[COST_COLORS[i]]));
  const minGold = minimum.reduce((sum, n) => sum + n, 0);
  const maxGold = Math.min(tokens.gold, needs.reduce((sum, n) => sum + n, 0));
  const options = [];
  const spend = zeros(COLORS);
  function visit(index, remaining) {
    if (options.length >= limit) return;
    if (index === COST_COLORS.length) {
      if (remaining === 0) options.push({ spend: { ...spend } });
      return;
    }
    const suffixMin = minimum.slice(index + 1).reduce((sum, n) => sum + n, 0);
    const suffixMax = needs.slice(index + 1).reduce((sum, n) => sum + n, 0);
    const low = Math.max(minimum[index], remaining - suffixMax);
    const high = Math.min(needs[index], remaining - suffixMin);
    for (let gold = low; gold <= high && options.length < limit; gold += 1) {
      spend[COST_COLORS[index]] = needs[index] - gold;
      visit(index + 1, remaining - gold);
    }
  }
  for (let gold = minGold; gold <= maxGold && options.length < limit; gold += 1) {
    spend.gold = gold;
    visit(0, gold);
  }
  return options;
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
  const next = structuredClone(state);
  const nextPlayer = next.players[playerId];
  for (const color of COLORS) {
    nextPlayer.tokens[color] -= spend[color];
    next.bag[color] += spend[color];
  }
  const purchased = (source === 'pyramid' ? next.pyramid[levelKey] : nextPlayer.reserves).splice(index, 1)[0];
  if (source === 'pyramid' && next.decks[levelKey].length > 0) {
    next.pyramid[levelKey].splice(index, 0, next.decks[levelKey].shift());
  }
  if (purchased.color === 'wild') purchased.wildColorStack = wildColor;
  nextPlayer.cards.push(purchased);
  return { state: next, events: [{
    type: 'bought', card: structuredClone(purchased),
    abilities: purchased.ability ? [purchased.ability] : [],
    crownsBefore, crownsAfter: playerBonuses(next, playerId).totalCrowns
  }] };
}
