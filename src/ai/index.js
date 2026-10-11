import { legalMoves, applyMove, mover, isTerminal, winner } from '../engine/turn.js';
import { determinize } from './hidden.js';
import { checkVictory } from '../engine/rules-misc.js';
import { evaluate } from './eval.js';

export const LEVELS = Object.freeze({
  1: Object.freeze({ noise: 0 }), 2: Object.freeze({ noise: 2.4 }),
  3: Object.freeze({ noise: 0.9 }), 4: Object.freeze({ noise: 0.25 }),
  5: Object.freeze({ noise: 0, candidates: 6, replies: 4 })
});
function sample(rng) {
  const n = rng();
  if (!Number.isFinite(n) || n < 0 || n >= 1) throw new RangeError('Invalid rng sample');
  return n;
}
function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - sample(rng))) * Math.cos(2 * Math.PI * sample(rng));
}

// Public-only reply shortlist. Prioritize buys and full takes; spread sampling
// across the remaining options rather than favoring the engine's row prefix.
function replies(state, limit) {
  const moves = legalMoves(state).filter(m => !(m.type === 'buy' && m.source === 'reserve'));
  const buys = moves.filter(m => m.type === 'buy');
  const rest = moves.filter(m => m.type !== 'buy').sort((a, b) =>
    (b.cells?.length || 0) - (a.cells?.length || 0));
  const selected = buys.slice(0, limit);
  const slots = limit - selected.length;
  for (let i = 0; i < Math.min(slots, rest.length); i++) {
    selected.push(rest[Math.floor(i * rest.length / Math.min(slots, rest.length))]);
  }
  return selected;
}

/** Required caller RNG is the sole source of randomness, including tie breaks.
 * Terminal positions return null. Defaults to the strongest level.
 */
export function chooseMove(state, { level = 5, rng } = {}) {
  if (!LEVELS[level]) throw new RangeError('level must be 1 through 5');
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const id = mover(state);
  const ds = determinize(state, id, rng);
  if (level === 1) {
    const wins = moves.filter(m => {
      if (m.type !== 'buy') return false;
      const next = applyMove(ds, m, rng);
      // A buy can meet victory conditions while its forced ability/Royal
      // decision is still pending; those effects cannot remove points/crowns.
      return winner(next) === id || checkVictory(next, id).won;
    });
    const pool = wins.length ? wins : moves;
    return pool[Math.floor(sample(rng) * pool.length)];
  }
  const ranked = moves.map(move => {
    const next = applyMove(ds, move, rng);
    return { move, next, score: evaluate(next, id) + LEVELS[level].noise * gaussian(rng), tie: sample(rng) };
  }).sort((a, b) => b.score - a.score || b.tie - a.tie);
  if (level !== 5 || isTerminal(ranked[0].next)) return ranked[0].move;
  const candidates = ranked.slice(0, LEVELS[5].candidates);
  for (const candidate of candidates) {
    if (mover(candidate.next) === id || isTerminal(candidate.next)) continue;
    // Greedy opponent evaluation with their reserve identities masked.
    // Hidden reserve purchases cannot be modeled until the engine tracks them.
    const responses = replies(candidate.next, LEVELS[5].replies);
    let bestReply = null;
    let bestValue = -Infinity;
    const opponent = mover(candidate.next);
    for (const reply of responses) {
      const after = applyMove(candidate.next, reply, rng);
      const value = evaluate(after, opponent, { hiddenPlayerId: opponent });
      if (value > bestValue) { bestValue = value; bestReply = after; }
    }
    if (bestReply) candidate.score = evaluate(bestReply, id);
  }
  candidates.sort((a, b) => b.score - a.score || b.tie - a.tie);
  return candidates[0].move;
}
