import { playerBonuses, canPlaceWild } from '../engine/cards-play.js';
import { isTerminal, winner } from '../engine/turn.js';

// Mutable tuning parameters; evaluate itself never changes these or the state.
export const WEIGHTS = {
  terminal: 1e6, points: 3, crowns: 2.5, royalNear: 1.5, colorPoints: 1.5,
  bonus: 2, demand: 0.6, gem: 0.8, excess: 1.2, gold: 1.5, pearl: 1.2,
  pearlDemand: 0.6, privilege: 1.2, reserve: 0.35, affordable: 2.4,
  oneTake: 1.2, progress: 0.7, opponent: 0.9, threat: 5
};
const GEMS = ['blue', 'white', 'green', 'red', 'black'];
const COSTS = [...GEMS, 'pearl'];

function value(state, id, visible, ownReserves) {
  const player = state.players[id];
  const { bonuses, totalPoints, totalCrowns, colorPoints } = playerBonuses(state, id);
  const targets = ownReserves ? [...visible, ...player.reserves] : visible;
  const demand = Object.fromEntries(COSTS.map(c => [c, 0]));
  for (const card of targets) for (const c of COSTS) if (card.costs?.[c] > 0) demand[c]++;
  const bestColor = Math.max(...Object.values(colorPoints));
  let score = totalPoints * WEIGHTS.points + Math.min(10, totalCrowns) * WEIGHTS.crowns
    + Math.max(0, bestColor - 4) * WEIGHTS.colorPoints;
  for (const threshold of [3, 6]) {
    const short = threshold - totalCrowns;
    if (short === 1 || short === 2) score += WEIGHTS.royalNear * (3 - short);
  }
  for (const c of GEMS) score += bonuses[c] * WEIGHTS.bonus *
    (1 + WEIGHTS.demand * demand[c] / Math.max(1, targets.length));
  const tokens = player.tokens;
  const held = COSTS.reduce((n, c) => n + tokens[c], tokens.gold);
  score += GEMS.reduce((n, c) => n + tokens[c], 0) * WEIGHTS.gem
    + tokens.gold * WEIGHTS.gold + tokens.pearl * (WEIGHTS.pearl +
      WEIGHTS.pearlDemand * demand.pearl / Math.max(1, targets.length))
    - Math.max(0, held - 8) * (WEIGHTS.gem + WEIGHTS.excess)
    + player.privileges * WEIGHTS.privilege + player.reserves.length * WEIGHTS.reserve;
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
    const proximity = missing === 0 ? WEIGHTS.affordable :
      missing <= 3 && reachable ? WEIGHTS.oneTake : WEIGHTS.progress / (1 + missing);
    near = Math.max(near, proximity * quality + WEIGHTS.progress / (1 + cost));
  }
  score += near;
  const threat = Math.max(totalPoints >= 17 ? totalPoints - 16 : 0,
    totalCrowns >= 8 ? (totalCrowns - 7) * 2 : 0,
    bestColor >= 7 ? bestColor - 6 : 0);
  return { score, threat };
}

/** No deck contents or opponent reserve identities are inspected. */
export function evaluate(state, playerId, { hiddenPlayerId = null } = {}) {
  if (!['player1', 'player2'].includes(playerId)) throw new RangeError('Invalid playerId');
  if (isTerminal(state)) return winner(state) === playerId ? WEIGHTS.terminal : -WEIGHTS.terminal;
  const visible = Object.values(state.pyramid).flat().filter(Boolean);
  const opponent = playerId === 'player1' ? 'player2' : 'player1';
  const own = value(state, playerId, visible, playerId !== hiddenPlayerId);
  const other = value(state, opponent, visible, false);
  return own.score - WEIGHTS.opponent * other.score - WEIGHTS.threat * other.threat;
}
