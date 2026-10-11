import test from 'node:test';
import assert from 'node:assert/strict';
import { engineStateFromGame, gameFromEngineState, runAiTurn, aiTurnRecap } from '../src/ai/bridge.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMove, mover, isTerminal } from '../src/engine/turn.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { mulberry32 } from './helpers/rng.js';
const cards = loadCards();
const fresh = seed => newGame(cards, mulberry32(seed), { firstPlayer: 2 });
const randomStep = (state, rng) => {
  const moves = legalMoves(state);
  return applyMove(state, moves[Math.floor(rng() * moves.length)], rng);
};
// Independent projection of the page schema, rather than using the bridge to
// construct the expected round-trip value.
function live(state) {
  const gameState = structuredClone(state);
  const previousCrownCounts = gameState.previousCrownCounts;
  delete gameState.previousCrownCounts;
  delete gameState.pending;
  delete gameState.turnState.mandatoryDone;
  delete gameState.turnState.crownsAtTurnStart;
  return { gameState, previousCrownCounts };
}

test('fresh and random-playout turn boundaries round trip through the page schema', () => {
  for (let seed = 1; seed <= 5; seed++) {
    let state = fresh(seed);
    const rng = mulberry32(seed + 100);
    let boundaries = 0;
    for (let step = 0; step < 200 && !isTerminal(state); step++) {
      if (!state.pending && !state.turnState.mandatoryDone) {
        const game = live(state), before = structuredClone(game);
        const engine = engineStateFromGame(game);
        assert.equal(engine.pending, null);
        assert.equal(engine.turnState.crownsAtTurnStart, state.players[mover(state)].cards.reduce((n, card) => n + (card.crowns || 0), 0));
        assert.deepEqual(gameFromEngineState(engine), game);
        assert.deepEqual(game, before);
        assert.ok(legalMoves(engine).length);
        boundaries++;
      }
      state = randomStep(state, rng);
    }
    assert.ok(boundaries > 20);
  }
  const setup = fresh(8);
  assert.deepEqual(gameFromEngineState(engineStateFromGame({ gameState: setup })), live(setup));
});

test('normalizes live count and turn fields and reports unusable shapes', () => {
  const game = live(fresh(3));
  game.gameState.scrollPool = '2';
  game.gameState.players.player1.privileges = '1';
  delete game.gameState.turnState;
  const before = structuredClone(game);
  const engine = engineStateFromGame(game);
  assert.equal(engine.scrollPool, 2);
  assert.equal(engine.players.player1.privileges, 1);
  assert.deepEqual(engine.turnState, { playerId: 'player2', boardRefilled: false, actionCompleted: false, isExtraTurn: false, extraTurnsPending: 0, mandatoryDone: false, crownsAtTurnStart: 0 });
  assert.deepEqual(game, before);
  for (const change of [s => { s.board = []; }, s => { s.currentPlayer = 3; }, s => { s.players.player1.tokens.gold = -1; }, s => { s.pyramid.level1 = null; }, s => { s.scrollPool = 'no'; }]) {
    const invalid = live(fresh(1));
    change(invalid.gameState);
    assert.throws(() => engineStateFromGame(invalid), /Unusable game state:/);
  }
});

test('AI turns from many seeded mid-game positions are immutable, deterministic and reusable', () => {
  const rng = mulberry32(702);
  let state = fresh(22), checked = 0;
  for (let step = 0; step < 350 && checked < 40; step++) {
    if (isTerminal(state)) state = fresh(step + 1000);
    if (mover(state) === 'player2' && !state.pending && !state.turnState.mandatoryDone && step > 5) {
      const game = live(state), before = structuredClone(game);
      const options = () => ({ level: 3, rng: mulberry32(step + 2000) });
      const result = runAiTurn(game, options());
      assert.deepEqual(result, runAiTurn(game, options()));
      assert.deepEqual(game, before);
      const next = engineStateFromGame(result.game);
      assert.deepEqual(checkInvariants(next), []);
      assert.ok(isTerminal(next) || mover(next) === 'player1');
      assert.equal(result.finished, isTerminal(next));
      assert.equal(result.winnerId, next.gameOver.winnerId);
      assert.ok(result.moves.length);
      assert.ok(isTerminal(next) || legalMoves(next).length);
      checked++;
    }
    state = randomStep(state, rng);
  }
  assert.equal(checked, 40);
});

test('blind reservation summary hides identity and recap honestly reports missing context', () => {
  const state = fresh(9);
  // Leave only gold on the board so sampling exercises reservations without
  // depending on how many token-take moves or gold chance outcomes exist.
  state.board.forEach(row => row.forEach((color, col) => {
    if (color && color !== 'gold') {
      state.bag[color] += 1;
      row[col] = null;
    }
  }));
  assert.deepEqual(checkInvariants(state), []);
  const game = live(state);
  let result;
  for (let seed = 0; seed < 100; seed++) {
    const candidate = runAiTurn(game, { level: 1, rng: mulberry32(seed) });
    if (candidate.events.some(e => e.type === 'card_reserved' && e.source === 'deck')) { result = candidate; break; }
  }
  assert.ok(result, 'seeded sampling exercised a blind reservation');
  for (const event of result.events.filter(e => e.type === 'card_reserved' && e.source === 'deck')) {
    assert.ok(result.summary.includes(`Reserved a card from the level ${event.level} deck`));
    assert.ok(!result.summary.join(' ').includes(event.cardId));
    const card = result.game.gameState.players.player2.reserves.find(c => c.id === event.cardId);
    assert.ok(card);
    assert.ok(!result.summary.join(' ').includes(`${card.points} points`));
  }
  assert.equal(aiTurnRecap(result.events), null);
});

test('AI resolves forced choices and extra turns, handles terminal/no-op calls and guards decisions', () => {
  const state = fresh(4);
  Object.assign(state.pyramid.level3[0], { costs: {}, ability: 'again', points: 0 });
  // Remove all other mandatory options, so the first move must be this buy.
  // This synthetic fixture checks lifecycle rather than conservation.
  state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
  for (const level of ['level1', 'level2']) { state.decks[level] = []; state.pyramid[level] = []; }
  state.pyramid.level3 = [state.pyramid.level3[0]];
  state.decks.level3 = [];
  const game = live(state);
  assert.throws(() => runAiTurn(game, { level: 3, rng: mulberry32(1), maxDecisions: 1 }), /exceeded maxDecisions/);
  const result = runAiTurn(game, { level: 3, rng: mulberry32(1) });
  assert.equal(result.moves[0].type, 'buy');
  assert.equal(result.moves.length, 2);
  assert.equal(result.game.gameState.currentPlayer, 1);
  assert.deepEqual(result.game.gameState.turnState, { playerId: 'player1', boardRefilled: false, actionCompleted: false, extraTurnsPending: 0, isExtraTurn: false });
  const human = result.game;
  assert.deepEqual(runAiTurn(human, { rng: mulberry32(3) }).moves, []);
  const terminal = fresh(2);
  Object.assign(terminal.pyramid.level3[0], { costs: {}, ability: null, points: 20 });
  const won = runAiTurn(live(terminal), { level: 1, rng: mulberry32(3) });
  assert.equal(won.finished, true);
  assert.equal(won.winnerId, 'player2');
  assert.deepEqual(runAiTurn(won.game, { rng: mulberry32(3) }).moves, []);
  const forced = fresh(10);
  forced.pending = { type: 'discard' };
  forced.turnState.mandatoryDone = true;
  forced.players.player2.tokens.blue = 11;
  assert.throws(() => gameFromEngineState(forced), /unresolved turn/);
  const resolved = runAiTurn({ gameState: forced }, { level: 3, rng: mulberry32(8) });
  assert.equal(resolved.moves[0].type, 'discard');
  assert.equal(resolved.game.gameState.currentPlayer, 1);
});

test('twenty full games alternate random human decisions and level 3 AI turns until terminal', () => {
  for (let seed = 0; seed < 20; seed++) {
    const rng = mulberry32(30000 + seed);
    let state = newGame(cards, rng, { firstPlayer: seed % 2 + 1 });
    for (let step = 0; step < 700 && !isTerminal(state); step++) {
      if (mover(state) === 'player2') {
        const game = live(state), before = structuredClone(game);
        const result = runAiTurn(game, { level: 3, rng });
        assert.deepEqual(game, before);
        state = engineStateFromGame(result.game);
        assert.ok(isTerminal(state) || mover(state) === 'player1');
      } else state = randomStep(state, rng);
      assert.deepEqual(checkInvariants(state), [], `seed ${seed}, step ${step}`);
    }
    assert.ok(isTerminal(state), `game ${seed} must finish`);
  }
});
