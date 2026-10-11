import { playerBonuses, canPlaceWild } from '../engine/cards-play.js';
import { isTerminal, winner } from '../engine/turn.js';

// Mutable tuning parameters; evaluate itself never changes these or the state.
// Tuned by SPSA self-play (474 iterations at L5, 2026-10-11): +35 Elo vs the original hand-set weights
// (L5: CI 0.9-69.5 over 400 games). Original: points 3, crowns 2.5, threat 5, ...
export const WEIGHTS = {
  terminal: 1e6, points: 2.799, crowns: 2.743, royalNear: 1.454, colorPoints: 1.604,
  bonus: 2.398, demand: 0.576, gem: 0.768, excess: 1.306, gold: 1.336, pearl: 1.293,
  pearlDemand: 0.58, privilege: 1.059, reserve: 0.342, affordable: 2.346, oneTake: 1.286,
  progress: 0.699, opponent: 0.948, threat: 5.333
};
const GEMS = ['blue', 'white', 'green', 'red', 'black'];
const COSTS = [...GEMS, 'pearl'];

function value(state, id, visible, ownReserves, weights) {
  const player = state.players[id];
  const { bonuses, totalPoints, totalCrowns, colorPoints } = playerBonuses(state, id);
  const targets = ownReserves ? [...visible, ...player.reserves] : visible;
  const demand = Object.fromEntries(COSTS.map(c => [c, 0]));
  for (const card of targets) for (const c of COSTS) if (card.costs?.[c] > 0) demand[c]++;
  const bestColor = Math.max(...Object.values(colorPoints));
  let score = totalPoints * weights.points + Math.min(10, totalCrowns) * weights.crowns
    + Math.max(0, bestColor - 4) * weights.colorPoints;
  for (const threshold of [3, 6]) {
    const short = threshold - totalCrowns;
    if (short === 1 || short === 2) score += weights.royalNear * (3 - short);
  }
  for (const c of GEMS) score += bonuses[c] * weights.bonus *
    (1 + weights.demand * demand[c] / Math.max(1, targets.length));
  const tokens = player.tokens;
  const held = COSTS.reduce((n, c) => n + tokens[c], tokens.gold);
  score += GEMS.reduce((n, c) => n + tokens[c], 0) * weights.gem
    + tokens.gold * weights.gold + tokens.pearl * (weights.pearl +
      weights.pearlDemand * demand.pearl / Math.max(1, targets.length))
    - Math.max(0, held - 8) * (weights.gem + weights.excess)
    + player.privileges * weights.privilege + player.reserves.length * weights.reserve;
  // Cheap one-take approximation: at most three missing non-gold tokens,
  // individually present on the board. Geometry is intentionally not searched.
  const available = Object.fromEntries(COSTS.map(c => [c, 0]));
  for (const row of state.board) for (const c of row) if (c in available) available[c]++;
  let near = 0;
  for (const card of targets) {
    if (card.color === 'wild' && !GEMS.some(c => canPlaceWild(state, id, c))) continue;
    let missing = 0;
    let reachable = true;
    let cost = 0;
    for (const c of COSTS) {
      const need = Math.max(0, (card.costs?.[c] || 0) - (bonuses[c] || 0));
      const gap = Math.max(0, need - tokens[c]);
      cost += need;
      missing += gap;
      if (gap > available[c]) reachable = false;
    }
    missing = Math.max(0, missing - tokens.gold);
    const quality = 1 + (card.points || 0) * 0.2 + (card.crowns || 0) * 0.2;
    const proximity = missing === 0 ? weights.affordable :
      missing <= 3 && reachable ? weights.oneTake : weights.progress / (1 + missing);
    near = Math.max(near, proximity * quality + weights.progress / (1 + cost));
  }
  score += near;
  const threat = Math.max(totalPoints >= 17 ? totalPoints - 16 : 0,
    totalCrowns >= 8 ? (totalCrowns - 7) * 2 : 0,
    bestColor >= 7 ? bestColor - 6 : 0);
  return { score, threat };
}

/** No deck contents or opponent reserve identities are inspected. */
export function evaluate(state, playerId, { hiddenPlayerId = null, weights = WEIGHTS } = {}) {
  if (!['player1', 'player2'].includes(playerId)) throw new RangeError('Invalid playerId');
  if (isTerminal(state)) return winner(state) === playerId ? weights.terminal : -weights.terminal;
  const visible = Object.values(state.pyramid).flat().filter(Boolean);
  const opponent = playerId === 'player1' ? 'player2' : 'player1';
  const own = value(state, playerId, visible, playerId !== hiddenPlayerId, weights);
  const other = value(state, opponent, visible, false, weights);
  return own.score - weights.opponent * other.score - weights.threat * other.threat;
}

// Stable lexicographic names; positive weights retain their heuristic meaning.
// The scale is 15% of the baseline magnitude, with a 0.05 floor.
export const PARAM_SPECS = Object.freeze(Object.fromEntries(
  Object.keys(WEIGHTS).sort().map(name => [name, Object.freeze({
    min: name === 'terminal' ? 1e4 : 0,
    max: name === 'terminal' ? 1e7 : Math.max(5, WEIGHTS[name] * 4),
    scale: Math.max(0.05, Math.abs(WEIGHTS[name]) * 0.15)
  })])
));

/** Numeric leaves in stable order; accepts either nested or flattened JSON. */
export function flattenWeights(weights = WEIGHTS) {
  const flat = {};
  function visit(value, prefix) {
    if (typeof value === 'number' && Number.isFinite(value)) { flat[prefix] = value; return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid weight: ${prefix}`);
    for (const key of Object.keys(value).sort()) visit(value[key], prefix ? `${prefix}.${key}` : key);
  }
  visit(weights, '');
  return Object.fromEntries(Object.entries(flat).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export function unflattenWeights(flat) {
  const result = {};
  for (const [name, value] of Object.entries(flattenWeights(flat))) {
    const keys = name.split('.');
    let target = result;
    for (const key of keys.slice(0, -1)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Invalid weight name');
      target = target[key] ??= {};
      if (typeof target !== 'object') throw new TypeError('Conflicting weight names');
    }
    const key = keys.at(-1);
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Invalid weight name');
    target[key] = value;
  }
  return result;
}
export function clampWeights(weights, specs = PARAM_SPECS) {
  const flat = flattenWeights(weights);
  if (Object.keys(flat).join('|') !== Object.keys(specs).sort().join('|')) throw new TypeError('Weights must contain every known parameter exactly once');
  return Object.fromEntries(Object.entries(flat).map(([name, value]) =>
    [name, Math.max(specs[name].min, Math.min(specs[name].max, value))]));
}
