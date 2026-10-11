import { legalMoves, applyMove, mover, isTerminal, winner } from '../engine/turn.js';
import { checkVictory } from '../engine/rules-misc.js';
import { determinize } from './hidden.js';
import { evaluate } from './eval.js';

export const SEARCH_LEVELS = Object.freeze(Object.fromEntries(
  [150, 300, 600, 1200, 2400].map((iterations, i) => [i + 6, Object.freeze({ iterations })])
));
const other = id => id === 'player1' ? 'player2' : 'player1';
const keyOf = move => JSON.stringify(move);
const node = () => ({ visits: 0, children: new Map(), priors: new Map() });
// Reserve provenance is absent from engine snapshots. Conservatively treat all
// opponent reserves as hidden, including reservations made during the search.
const movesFor = (state, rootPlayer) => legalMoves(state).filter(move =>
  mover(state) === rootPlayer || move.type !== 'buy' || move.source !== 'reserve');
const score = (state, id, rootPlayer) => evaluate(state, id, { hiddenPlayerId: other(rootPlayer) });
function value(state, rootPlayer) {
  if (isTerminal(state)) return winner(state) === rootPlayer ? 1 : 0;
  // A spread of +/- 12 maps to .2/.8; ordinary opening differences stay modest.
  return 1 / (1 + Math.exp(-(score(state, rootPlayer, rootPlayer) -
    score(state, other(rootPlayer), rootPlayer)) / 9));
}
function cheapPrior(state, move) {
  if (move.type === 'buy') {
    const card = move.source === 'reserve' ? state.players[mover(state)].reserves[move.index] :
      state.pyramid[`level${move.level}`][move.index];
    return 10 + card.points * 3 + card.crowns * 2.5 + (card.isDouble ? 2 : 0);
  }
  if (move.type === 'take') return move.cells.length * 2 +
    move.cells.reduce((n, [r, c]) => n + (state.board[r][c] === 'pearl' ? .3 : 0), 0);
  if (move.type === 'usePrivilege') return 5;
  if (move.type === 'reserve') return 1;
  return 3;
}

/** Single-observer tree: edges are decisions, never hidden deck identities.
 * Edge sums use the parent mover's perspective, not alternating depth signs.
 * Priors are ordering hints cached on first encounter, not legality caches.
 */
export function createSearch(state, { rng, rootPlayer = mover(state), exploration = 1.2,
  leafDepth = 0, maxChildren = 16 } = {}) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!isTerminal(state) && !['player1', 'player2'].includes(rootPlayer)) throw new RangeError('Invalid rootPlayer');
  if (!Number.isFinite(exploration) || exploration < 0) throw new RangeError('Invalid exploration');
  if (!Number.isSafeInteger(leafDepth) || leafDepth < 0) throw new RangeError('Invalid leafDepth');
  if (!Number.isSafeInteger(maxChildren) || maxChildren < 1) throw new RangeError('Invalid maxChildren');
  const rootState = structuredClone(state), root = node();
  const rootMoves = legalMoves(rootState);
  let iterations = 0;
  const sample = () => {
    const n = rng();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new RangeError('Invalid rng sample');
    return n;
  };
  function candidates(position, current, depth) {
    const moves = movesFor(position, rootPlayer);
    const id = mover(position);
    // Full one-step evaluation at the root; inexpensive move-class ordering
    // deeper in the tree avoids evaluating hundreds of token/payment variants.
    for (const move of moves) {
      const key = keyOf(move);
      if (!current.priors.has(key)) current.priors.set(key, depth === 0 ?
        score(applyMove(position, move, sample), id, rootPlayer) : cheapPrior(position, move));
    }
    const keyed = moves.map(move => ({ move, key: keyOf(move) }));
    return { legal: new Set(keyed.map(candidate => candidate.key)), shortlist: keyed
      .sort((a, b) => current.priors.get(b.key) - current.priors.get(a.key))
      .slice(0, maxChildren) };
  }
  function iteration() {
    let position = determinize(rootState, rootPlayer, sample), current = root;
    const path = [], nodes = [root];
    // Bound optional-action/extra-turn paths even in pathological pass cycles.
    for (let depth = 0; depth < 80 && !isTerminal(position); depth++) {
      const { shortlist: candidatesNow, legal } = candidates(position, current, depth);
      if (!candidatesNow.length) break;
      // Availability counts include every currently legal existing edge, even
      // when a changed determinization moves it outside the expansion shortlist.
      for (const [key, edge] of current.children) if (legal.has(key)) edge.availability++;
      const unexplored = candidatesNow.find(candidate => !current.children.has(candidate.key));
      let edge, expanded = false;
      if (unexplored) {
        edge = { move: unexplored.move, visits: 0, sum: 0, availability: 1, child: node() };
        current.children.set(unexplored.key, edge);
        expanded = true;
      } else {
        let bestUcb = -Infinity;
        for (const [key, candidate] of current.children) {
          if (!legal.has(key)) continue;
          const ucb = candidate.sum / candidate.visits + exploration *
            Math.sqrt(Math.log(candidate.availability) / candidate.visits);
          if (ucb > bestUcb) { bestUcb = ucb; edge = candidate; }
        }
      }
      if (!edge) break;
      path.push({ edge, id: mover(position) });
      position = applyMove(position, edge.move, sample);
      current = edge.child;
      nodes.push(current);
      if (expanded) break;
    }
    for (let depth = 0; depth < leafDepth && !isTerminal(position); depth++) {
      const id = mover(position);
      let bestNext, bestScore = -Infinity;
      for (const move of movesFor(position, rootPlayer)) {
        const next = applyMove(position, move, sample), s = score(next, id, rootPlayer);
        if (s > bestScore) { bestNext = next; bestScore = s; }
      }
      if (!bestNext) break;
      position = bestNext;
    }
    const result = value(position, rootPlayer);
    for (const visited of nodes) visited.visits++;
    for (const { edge, id } of path) {
      edge.visits++;
      edge.sum += id === rootPlayer ? result : 1 - result;
    }
    iterations++;
  }
  return {
    step(count) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('iterations must be non-negative');
      if (rootMoves.length) for (let i = 0; i < count; i++) iteration();
      return this;
    },
    best() {
      if (!rootMoves.length) return null;
      // Guaranteed victories include buys awaiting harmless forced resolutions.
      const winning = rootMoves.find(move => {
        if (move.type !== 'buy') return false;
        const next = applyMove(rootState, move, () => 0);
        return checkVictory(next, mover(rootState)).won;
      });
      if (winning) return structuredClone(winning);
      const legal = new Set(rootMoves.map(keyOf));
      const ranked = [...root.children.entries()].filter(([key]) => legal.has(key))
        .map(([, edge]) => edge).sort((a, b) => b.visits - a.visits || b.sum / b.visits - a.sum / a.visits);
      return structuredClone(ranked[0]?.move ?? rootMoves[0]);
    },
    stats() {
      return { iterations, visits: root.visits, children: [...root.children.values()].map(edge => ({
        move: structuredClone(edge.move), visits: edge.visits, availability: edge.availability,
        value: edge.visits ? edge.sum / edge.visits : 0
      })) };
    },
    get iterations() { return iterations; }
  };
}
export function chooseMoveSearch(state, { level = 6, rng } = {}) {
  if (!SEARCH_LEVELS[level]) throw new RangeError('search level must be 6 through 10');
  return createSearch(state, { rng }).step(SEARCH_LEVELS[level].iterations).best();
}
