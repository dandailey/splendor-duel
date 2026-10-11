import { chooseMove, chooseMoveAsync } from './index.js';
import { applyMoveWithEvents, mover, isTerminal, winner } from '../engine/turn.js';
import { crownsOf } from '../engine/rules-misc.js';
import { spiralOrder } from '../engine/tokens.js';
import { TOKEN_SUPPLY } from '../engine/setup.js';

const IDS = ['player1', 'player2'];
const LEVELS = ['level1', 'level2', 'level3'];
const fail = path => { throw new Error(`Unusable game state: ${path}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function count(value, path) {
  // Some page/sync snapshots carry count values as decimal strings.
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0) fail(`${path} must be a non-negative integer`);
  return n;
}
function cards(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  for (const card of value) {
    if (!object(card) || typeof card.id !== 'string' || ![1, 2, 3].includes(card.level) && !card.id.startsWith('royal-')) fail(`${path} contains an invalid card`);
    if (!Number.isFinite(card.points) || card.points < 0) fail(`${path} contains invalid points`);
    if (!card.id.startsWith('royal-') && (typeof card.color !== 'string' || !object(card.costs) || !Number.isSafeInteger(card.crowns) || card.crowns < 0)) fail(`${path} contains invalid card fields`);
    if (card.costs && Object.values(card.costs).some(n => !Number.isSafeInteger(n) || n < 0)) fail(`${path} contains invalid costs`);
  }
}

/** Accept live start-of-turn snapshots or engine snapshots, always on a clone. */
export function engineStateFromGame({ gameState, previousCrownCounts } = {}) {
  if (!object(gameState)) fail('gameState must be an object');
  let state;
  try { state = structuredClone(gameState); } catch { fail('gameState must be cloneable'); }
  if (![1, 2].includes(state.currentPlayer)) fail('currentPlayer must be 1 or 2');
  for (const source of ['decks', 'pyramid']) {
    for (const level of LEVELS) cards(state[source]?.[level], `${source}.${level}`);
  }
  if (!Array.isArray(state.board) || state.board.length !== 5 || state.board.some(row => !Array.isArray(row) || row.length !== 5 || row.some(token => token !== null && !Object.hasOwn(TOKEN_SUPPLY, token)))) fail('board must be 5x5 with known tokens or null');
  if (!object(state.bag) || !object(state.players)) fail('bag and players are required');
  for (const color of Object.keys(TOKEN_SUPPLY)) state.bag[color] = count(state.bag[color], `bag.${color}`);
  state.scrollPool = count(state.scrollPool, 'scrollPool');
  for (const id of IDS) {
    const player = state.players[id];
    if (!object(player) || !object(player.tokens)) fail(`${id}.tokens is required`);
    for (const color of Object.keys(TOKEN_SUPPLY)) player.tokens[color] = count(player.tokens[color], `${id}.tokens.${color}`);
    cards(player.cards, `${id}.cards`);
    cards(player.reserves, `${id}.reserves`);
    player.privileges = count(player.privileges ?? 0, `${id}.privileges`);
  }
  cards(state.royalCards, 'royalCards');
  if (state.royalCards.some(card => typeof card.taken !== 'boolean')) fail('royalCards require taken flags');
  const id = `player${state.currentPlayer}`;
  if (!object(state.turnState) || state.turnState.playerId !== id) state.turnState = { playerId: id };
  const turn = state.turnState;
  for (const key of ['boardRefilled', 'actionCompleted', 'isExtraTurn']) if (typeof turn[key] !== 'boolean') turn[key] = false;
  if (!Number.isSafeInteger(turn.extraTurnsPending) || turn.extraTurnsPending < 0) turn.extraTurnsPending = 0;
  state.pending ??= null;
  if (state.pending && !['ability', 'royal', 'discard'].includes(state.pending.type)) fail('unknown pending resolution');
  turn.mandatoryDone ??= Boolean(turn.actionCompleted);
  turn.crownsAtTurnStart ??= crownsOf(state, id);
  if (typeof turn.mandatoryDone !== 'boolean') fail('mandatoryDone must be boolean');
  turn.crownsAtTurnStart = count(turn.crownsAtTurnStart, 'crownsAtTurnStart');
  state.gameOver ??= { winnerId: null, conditions: [], winnerStats: null };
  if (!object(state.gameOver)) fail('gameOver must be an object');
  state.gameOver.winnerId ??= null;
  state.gameOver.conditions ??= [];
  state.gameOver.winnerStats ??= null;
  if (state.gameOver.winnerId !== null && !IDS.includes(state.gameOver.winnerId) || !Array.isArray(state.gameOver.conditions)) fail('invalid gameOver');
  state.previousCrownCounts = structuredClone(previousCrownCounts ?? state.previousCrownCounts ?? Object.fromEntries(IDS.map(player => [player, crownsOf(state, player)])));
  if (!object(state.previousCrownCounts)) fail('previousCrownCounts must be an object');
  for (const player of IDS) state.previousCrownCounts[player] = count(state.previousCrownCounts[player], `previousCrownCounts.${player}`);
  // Original sizes cannot be recovered from a mid-game deck's current length.
  if (!object(state.initialDeckSizes)) fail('initialDeckSizes is required');
  for (const level of LEVELS) state.initialDeckSizes[level] = count(state.initialDeckSizes[level], `initialDeckSizes.${level}`);
  state.syncAssignments ??= { player1Id: null, player2Id: null };
  return state;
}

/** Export only at a turn boundary or game end: live snapshots cannot store forced choices. */
export function gameFromEngineState(engineState) {
  const state = engineStateFromGame({ gameState: engineState });
  if (state.pending || !isTerminal(state) && state.turnState.mandatoryDone) fail('cannot export an unresolved turn');
  const previousCrownCounts = state.previousCrownCounts;
  delete state.previousCrownCounts;
  delete state.pending;
  const { boardRefilled, actionCompleted, extraTurnsPending, isExtraTurn } = state.turnState;
  state.turnState = { playerId: `player${state.currentPlayer}`, boardRefilled, actionCompleted, extraTurnsPending, isExtraTurn };
  return { gameState: state, previousCrownCounts };
}

function actionSummary(before, move, events) {
  const lines = [];
  if (move.type === 'take') lines.push(`Took ${move.cells.map(([r, c]) => before.board[r][c]).join(', ')}`);
  if (move.type === 'reserve') lines.push(move.source === 'deck' ? `Reserved a card from the level ${move.level} deck` : `Reserved a level ${move.level} card`);
  for (const event of events) {
    switch (event.type) {
      case 'bought': lines.push(`Bought a level ${event.card.level} ${event.card.color} card (${event.card.points} points)`); break;
      case 'privilege_used': lines.push('Used a Privilege'); break;
      case 'board_refilled': lines.push('Refilled the board'); break;
      case 'royal_acquired': lines.push('Royal card claimed'); break;
      case 'tokens_discarded': { const total = Object.values(event.tokens).reduce((a, b) => a + b, 0); lines.push(`Discarded ${total} token${total === 1 ? '' : 's'}`); break; }
      case 'bonus_token_taken': lines.push(`Collected a bonus ${event.color} token`); break;
      case 'token_stolen': lines.push(`Stole a ${event.color} token`); break;
      case 'repeat_turn_awarded': lines.push('Gained an extra turn'); break;
      case 'scroll_gained': lines.push('Gained a Privilege'); break;
      case 'passed': lines.push('Passed'); break;
    }
  }
  return lines;
}

/** Includes forced resolutions and any extra turns until control leaves the AI. */
export function runAiTurn(game, { level, rng, aiPlayerId = 'player2', maxDecisions = 200 } = {}) {
  if (!IDS.includes(aiPlayerId)) throw new Error('aiPlayerId must be player1 or player2');
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!Number.isSafeInteger(maxDecisions) || maxDecisions < 1) throw new RangeError('maxDecisions must be a positive integer');
  let state = engineStateFromGame(game);
  const moves = [], summary = [], events = [], chanceSamples = [];
  const chanceRng = () => { const sample = rng(); chanceSamples.push(sample); return sample; };
  while (mover(state) === aiPlayerId) {
    if (moves.length >= maxDecisions) throw new Error(`AI turn exceeded maxDecisions (${maxDecisions})`);
    const move = chooseMove(state, { level, rng });
    if (!move) throw new Error('AI has no legal move in an unfinished turn');
    const result = applyMoveWithEvents(state, move, chanceRng);
    summary.push(...actionSummary(state, move, result.events));
    moves.push(structuredClone(move));
    events.push(...result.events);
    state = result.state;
  }
  return { game: gameFromEngineState(state), moves, summary, events, chanceSamples, finished: isTerminal(state), winnerId: winner(state) };
}

/** Async boundary retains the complete turn privately until it finishes. */
export async function runAiTurnAsync(game, { level, rng, aiPlayerId = 'player2', maxDecisions = 200, signal, sliceMs } = {}) {
  if (!IDS.includes(aiPlayerId)) throw new Error('aiPlayerId must be player1 or player2');
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  if (!Number.isSafeInteger(maxDecisions) || maxDecisions < 1) throw new RangeError('maxDecisions must be a positive integer');
  let state = engineStateFromGame(game);
  const moves = [], summary = [], events = [], chanceSamples = [];
  const chanceRng = () => { const sample = rng(); chanceSamples.push(sample); return sample; };
  while (mover(state) === aiPlayerId) {
    if (moves.length >= maxDecisions) throw new Error(`AI turn exceeded maxDecisions (${maxDecisions})`);
    const move = await chooseMoveAsync(state, { level, rng, signal, sliceMs });
    if (signal?.aborted) throw Object.assign(new Error('Turn aborted'), { name: 'AbortError' });
    if (!move) throw new Error('AI has no legal move in an unfinished turn');
    const result = applyMoveWithEvents(state, move, chanceRng);
    summary.push(...actionSummary(state, move, result.events));
    moves.push(structuredClone(move));
    events.push(...result.events);
    state = result.state;
  }
  return { game: gameFromEngineState(state), moves, summary, events, chanceSamples, finished: isTerminal(state), winnerId: winner(state) };
}

// These projections match main.js summarizeCard/aggregateTokens/summarizeSpend.
// In particular, the page's card preview does not include wildColorStack.
const recapCard = card => ({
  id: card.id, ...(card.level === undefined ? {} : { level: card.level }),
  ...(card.color === undefined ? {} : { color: card.color }), points: card.points || 0,
  crowns: card.crowns || 0, ability: card.ability || null,
  isDouble: !!card.isDouble, costs: { ...card.costs }
});
const recapSpend = counts => Object.keys(counts).filter(color => counts[color] > 0)
  .map(color => ({ color, count: counts[color] }));
const recapTokens = colors => {
  const counts = {};
  for (const color of colors) counts[color] = (counts[color] || 0) + 1;
  return recapSpend(counts);
};

/** Replay ordered decisions with the SAME chance samples used during play.
 * Metadata is caller supplied, keeping this projection deterministic and pure.
 * A context-free legacy events call still returns null.
 */
export function aiTurnRecap(before, moves, {
  rng, chanceSamples = [], id = 'turn-1', turnNumber = 1,
  startedAt = 0, endedAt = startedAt
} = {}) {
  if (!before?.players || !Array.isArray(moves)) return null;
  let state = structuredClone(before), sampleIndex = 0;
  const replayRng = rng ?? (() => {
    if (sampleIndex >= chanceSamples.length) throw new Error('Recap replay requires recorded chance samples');
    return chanceSamples[sampleIndex++];
  });
  const turn = { id, playerId: `player${state.currentPlayer}`, turnNumber,
    startedAt, endedAt, status: 'completed', events: [] };
  const emit = (type, payload) => turn.events.push({
    id: `${id}-event-${turn.events.length + 1}`, type, timestamp: endedAt, ...payload
  });
  let abilityCard = state.players[turn.playerId].cards.at(-1);
  for (const move of moves) {
    const pre = state;
    if (mover(pre) !== turn.playerId) throw new Error('Recap moves must belong to one player');
    const result = applyMoveWithEvents(pre, move, replayRng);
    state = result.state;
    const other = turn.playerId === 'player1' ? 'player2' : 'player1';
    for (const event of result.events) {
      switch (event.type) {
        case 'tokens_taken': {
          const colors = event.cells.map(([r, c]) => pre.board[r][c]);
          const scrollReasons = [];
          if (colors.length === 3 && colors.every(c => c === colors[0])) scrollReasons.push('three_match');
          if (colors.filter(c => c === 'pearl').length >= 2) scrollReasons.push('two_pearls');
          emit('tokens_taken', { tokens: recapTokens(colors), scrollReasons,
            scrollAwardedTo: scrollReasons.length ? other : null, bonusColor: null });
          break;
        }
        case 'privilege_used':
          emit('scroll_token', { token: pre.board[event.cell[0]][event.cell[1]] }); break;
        case 'board_refilled': {
          const colors = spiralOrder().filter(([r, c]) => pre.board[r][c] === null)
            .map(([r, c]) => state.board[r][c]).filter(Boolean);
          emit('board_refilled', { tokensPlaced: colors.length, tokens: recapTokens(colors),
            scrollAwardedTo: state.players[other].privileges > pre.players[other].privileges ? other : null });
          break;
        }
        case 'bought':
          abilityCard = event.card;
          emit('card_purchased', { card: recapCard(event.card), fromReserve: move.source === 'reserve',
            tokensSpent: recapSpend(move.payment.spend ?? move.payment), ability: event.card.ability || null }); break;
        case 'card_reserved': {
          const card = pre.pyramid[`level${move.level}`][move.index];
          // Human deck reservations use source/level to render a card back.
          // Omit the hidden identity altogether from the Computer's record.
          emit('card_reserved', { card: move.source === 'deck' ? null : recapCard(card),
            goldAwarded: true, source: move.source, ...(move.source === 'deck' ? { level: move.level } : {}) });
          break;
        }
        case 'royal_acquired':
          abilityCard = pre.royalCards.find(card => card.id === event.cardId);
          emit('royal_acquired', { card: recapCard(abilityCard) }); break;
        case 'bonus_token_taken':
          emit('bonus_token_collected', { tokens: recapTokens([event.color]),
            scrollAwardedTo: null, scrollReasons: [], bonusColor: event.color }); break;
        case 'token_stolen': emit('token_stolen', { color: event.color }); break;
        case 'tokens_discarded': emit('tokens_discarded', { tokens: recapSpend(event.tokens) }); break;
        case 'repeat_turn_awarded':
        case 'scroll_gained':
        case 'scroll_unavailable': emit(event.type, { card: recapCard(abilityCard) }); break;
        case 'game_over': turn.status = 'victory'; break;
        // turn_ended/ability_pending/ability_skipped are engine control events,
        // and have no counterpart in the page's action history.
      }
    }
  }
  if (turn.events.length) turn.updatedAt = endedAt;
  return turn;
}
