import { playerBonuses, canPlaceWild } from '../engine/cards-play.js';
import { mover } from '../engine/turn.js';
const GEMS = ['blue', 'white', 'green', 'red', 'black'];
const COSTS = [...GEMS, 'pearl'];
const TOKENS = [...GEMS, 'gold', 'pearl'];
const DIFF = ['points', 'crowns', ...GEMS.map(c => `bonus_${c}`), 'pearlDemandTokens',
  'bestColorPoints', ...TOKENS.map(c => `tokens_${c}`), 'excessTokens', 'privileges', 'reserves'];
const SIDE = ['crowns3', 'crowns6', 'points15', 'points17', 'points19', 'color5', 'color7',
  'royalNear3', 'royalNear6', 'affordable', 'oneTake', 'cheapestMissing', 'bestPointsPerMissing',
  ...GEMS.map(c => `costDemand_${c}`), ...GEMS.map(c => `bonusColorDemand_${c}`),
  ...GEMS.map(c => `colorPoints_${c}`)];
export const FEATURE_NAMES = Object.freeze([...DIFF.map(n => `diff_${n}`),
  ...['own', 'opp'].flatMap(s => SIDE.map(n => `${s}_${n}`)),
  'mover', 'nobodyNearPoints', 'nobodyNearCrowns', 'nobodyNearColor',
  'ownReserveAffordable', 'ownReserveOneTake', 'ownReserveCheapestMissing', 'ownReserveBestPointsPerMissing']);

// No intercept: differences negate on a perspective swap; own/opp columns swap.
// Symmetric phase flags and own-reserve signals intentionally need not negate.
// All public market signals exclude reserves. Only the observer's unmasked
// reserves may be read, never decks or opponent reserved-card identities.
export function extractFeatures(state, playerId, { hiddenPlayerId = null } = {}) {
  if (!['player1', 'player2'].includes(playerId)) throw new RangeError('Invalid playerId');
  const opponent = playerId === 'player1' ? 'player2' : 'player1';
  const visible = Object.values(state.pyramid).flat().filter(Boolean);
  const available = Object.fromEntries(COSTS.map(c => [c, 0]));
  for (const row of state.board) for (const c of row) if (c in available) available[c]++;
  function side(id) {
    const p = state.players[id];
    const b = playerBonuses(state, id);
    const best = Math.max(0, ...Object.values(b.colorPoints));
    function market(cards) {
      let affordable = 0, oneTake = 0, cheapest = Infinity, quality = 0;
      for (const card of cards) {
        if (card.color === 'wild' && !GEMS.some(c => canPlaceWild(state, id, c))) continue;
        const gaps = COSTS.map(c => Math.max(0, (card.costs?.[c] || 0) - (b.bonuses[c] || 0) - p.tokens[c]));
        const missing = Math.max(0, gaps.reduce((a, v) => a + v, 0) - p.tokens.gold);
        // Gold can cover unavailable colors before a take supplies the remainder.
        const unavailable = gaps.reduce((n, gap, i) => n + Math.max(0, gap - available[COSTS[i]]), 0);
        if (missing === 0) affordable++;
        else if (missing <= 3 && unavailable <= p.tokens.gold) oneTake++;
        cheapest = Math.min(cheapest, missing);
        quality = Math.max(quality, (card.points || 0) / (1 + missing));
      }
      return [affordable, oneTake, Number.isFinite(cheapest) ? cheapest : 0, quality];
    }
    const pearlDemand = visible.filter(c => c.costs?.pearl > 0).length / Math.max(1, visible.length);
    const diff = [b.totalPoints, Math.min(10, b.totalCrowns), ...GEMS.map(c => b.bonuses[c]),
      p.tokens.pearl * pearlDemand, best, ...TOKENS.map(c => p.tokens[c]),
      Math.max(0, TOKENS.reduce((n, c) => n + p.tokens[c], 0) - 8), p.privileges, p.reserves.length];
    const features = [b.totalCrowns >= 3, b.totalCrowns >= 6, b.totalPoints >= 15,
      b.totalPoints >= 17, b.totalPoints >= 19, best >= 5, best >= 7,
      ...[3, 6].map(t => b.totalCrowns < t ? Math.max(0, 3 - (t - b.totalCrowns)) : 0),
      ...market(visible),
      ...GEMS.map(c => b.bonuses[c] * visible.filter(card => card.costs?.[c] > 0).length / Math.max(1, visible.length)),
      ...GEMS.map(c => b.bonuses[c] * visible.filter(card => card.color === c).length / Math.max(1, visible.length)),
      ...GEMS.map(c => b.colorPoints[c])];
    return { diff, features, b, best, market };
  }
  const own = side(playerId), opp = side(opponent);
  return Float64Array.from([...own.diff.map((v, i) => v - opp.diff[i]), ...own.features, ...opp.features,
    mover(state) === null ? 0 : mover(state) === playerId ? 1 : -1,
    own.b.totalPoints < 17 && opp.b.totalPoints < 17,
    own.b.totalCrowns < 8 && opp.b.totalCrowns < 8,
    own.best < 7 && opp.best < 7,
    ...(hiddenPlayerId === playerId ? [0, 0, 0, 0] : own.market(state.players[playerId].reserves))]);
}
