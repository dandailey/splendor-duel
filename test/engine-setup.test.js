import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCards } from '../src/engine/cards.js';
import { loadCards } from '../src/engine/cards-node.js';
import { newGame, CARD_COUNTS, TOKEN_SUPPLY } from '../src/engine/setup.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { toSyncBlob, fromSyncBlob } from '../src/engine/blob.js';
import { mulberry32 } from './helpers/rng.js';

const cards = loadCards();
const fresh = seed => newGame(cards, mulberry32(seed));

test('CSV parsing matches live card fields, empty values, doubles and deterministic IDs', () => {
  const csv = 'level,color,points,crowns,ability,is_double,cost_w,cost_bl,cost_g,cost_r,cost_bk,cost_p\r\n2, green,1,,steal,yes,3,,,4,,\r\n';
  const expected = [{
    id: 'card-0', level: 2, color: 'green', points: 1, crowns: 0, ability: 'steal', isDouble: true,
    costs: { white: 3, blue: 0, green: 0, red: 4, black: 0, pearl: 0 }
  }];
  assert.deepEqual(parseCards(csv), expected);
  assert.deepEqual(parseCards(csv), expected);
  assert.equal(cards.length, 67);
  assert.deepEqual(cards.map(card => card.id), Array.from({ length: 67 }, (_, i) => `card-${i}`));
  for (const [level, count] of Object.entries(CARD_COUNTS)) {
    assert.equal(cards.filter(card => `level${card.level}` === level).length, count);
  }
});

test('seeded setup is deterministic and preserves live initial state conventions', () => {
  const state = fresh(123);
  assert.deepEqual(state, fresh(123));
  assert.notDeepEqual(state.board, fresh(124).board);
  assert.deepEqual(state.initialDeckSizes, { level1: 10, level2: 20, level3: 25 });
  assert.deepEqual(Object.values(state.pyramid).map(deck => deck.length), [3, 4, 5]);
  assert.deepEqual(state.bag, Object.fromEntries(Object.keys(TOKEN_SUPPLY).map(color => [color, 0])));
  assert.equal(state.scrollPool, 2);
  assert.equal(state.players[`player${state.currentPlayer}`].privileges, 0);
  assert.equal(state.players[state.currentPlayer === 1 ? 'player2' : 'player1'].privileges, 1);
  assert.deepEqual(state.turnState, {
    playerId: `player${state.currentPlayer}`, boardRefilled: false, actionCompleted: false,
    extraTurnsPending: 0, isExtraTurn: false
  });
  assert.deepEqual(state.previousCrownCounts, { player1: 0, player2: 0 });
  assert.deepEqual(state.gameOver, { winnerId: null, conditions: [], winnerStats: null });
  assert.deepEqual(state.syncAssignments, { player1Id: null, player2Id: null });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('fresh games satisfy invariants for 200 seeds without checker mutation', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const state = fresh(seed);
    const before = structuredClone(state);
    assert.deepEqual(checkInvariants(state), [], `seed ${seed}`);
    assert.deepEqual(state, before);
  }
});

test('invariants detect missing tokens, missing/duplicate cards and extra Privileges', () => {
  const token = fresh(1);
  token.board[2][2] = null;
  assert.ok(checkInvariants(token).some(message => message.includes('Token conservation')));
  const duplicate = fresh(1);
  duplicate.decks.level1[0] = structuredClone(duplicate.pyramid.level1[0]);
  assert.ok(checkInvariants(duplicate).some(message => message.includes('duplicate')));
  const missing = fresh(1);
  missing.decks.level2.pop();
  assert.ok(checkInvariants(missing).some(message => message.includes('Card conservation')));
  const privilege = fresh(1);
  privilege.scrollPool += 1;
  assert.ok(checkInvariants(privilege).some(message => message.includes('Privilege conservation')));
});

test('invariants check board shape, negative tokens, reserve limits and currentPlayer', () => {
  const state = fresh(2);
  state.board[0].pop();
  state.players.player1.tokens.blue = -1;
  state.players.player1.reserves = state.decks.level3.splice(0, 4);
  state.currentPlayer = 3;
  const messages = checkInvariants(state);
  for (const fragment of ['5x5', 'non-negative', 'reserves exceed', 'currentPlayer']) {
    assert.ok(messages.some(message => message.includes(fragment)), fragment);
  }
});

test('Royal conservation supports live taken markers and detects lost/duplicate ownership', () => {
  const state = fresh(3);
  const royal = state.royalCards[0];
  state.players.player1.cards.push({ ...royal, level: 3, color: 'none', crowns: 0, costs: {} });
  royal.taken = true;
  assert.deepEqual(checkInvariants(state), []);
  state.players.player2.cards.push(structuredClone(state.players.player1.cards[0]));
  assert.ok(checkInvariants(state).some(message => message.includes('Royal conservation')));
  state.players.player1.cards = [];
  state.players.player2.cards = [];
  assert.ok(checkInvariants(state).some(message => message.includes('Royal conservation')));
});

test('returned tokens can be accounted for separately or in the live bag', () => {
  const state = fresh(4);
  const color = state.board[2][2];
  state.board[2][2] = null;
  state.returned = { [color]: 1 };
  assert.deepEqual(checkInvariants(state), []);
  delete state.returned;
  state.bag[color] += 1;
  assert.deepEqual(checkInvariants(state), []);
});

test('known unshuffled tokens follow the live clockwise spiral', () => {
  // Each Fisher-Yates swap is with itself when RNG is sufficiently close to 1.
  const state = newGame(cards, () => 0.999999, { firstPlayer: 1 });
  assert.deepEqual(state.board, [
    ['pearl', 'pearl', 'gold', 'gold', 'gold'],
    ['red', 'white', 'white', 'green', 'green'],
    ['red', 'white', 'blue', 'blue', 'green'],
    ['red', 'white', 'blue', 'blue', 'green'],
    ['red', 'black', 'black', 'black', 'black']
  ]);
});

test('firstPlayer override skips one RNG draw and awards the opponent a Privilege', () => {
  for (const firstPlayer of [1, 2]) {
    let draws = 0;
    const rng = () => { draws += 1; return 0.25; };
    const explicit = newGame(cards, rng, { firstPlayer });
    const explicitDraws = draws;
    assert.equal(explicit.currentPlayer, firstPlayer);
    assert.equal(explicit.players[firstPlayer === 1 ? 'player2' : 'player1'].privileges, 1);
    assert.deepEqual(checkInvariants(explicit), []);
    draws = 0;
    assert.equal(newGame(cards, rng).currentPlayer, 1);
    assert.equal(draws, explicitDraws + 1);
  }
  assert.equal(newGame(cards, () => 0.75).currentPlayer, 2);
  assert.throws(() => newGame(cards, () => 1), RangeError);
  assert.throws(() => newGame(cards, mulberry32(1), { firstPlayer: 0 }), RangeError);
});

test('sync blob round trip preserves state and extras in the live envelope', () => {
  const state = fresh(5);
  state.previousCrownCounts.player1 = 3;
  const extras = {
    turnDisplayState: { activePlayerId: 'player2', opponentPlayerId: 'player1', custom: true },
    turnHistory: { turns: [{ id: 'turn-1', events: [{ type: 'test', timestamp: 42 }] }], pendingTurn: null, nextTurnId: 2 }
  };
  const before = structuredClone({ state, extras });
  const blob = toSyncBlob(state, extras);
  const parsed = JSON.parse(blob);
  assert.deepEqual(Object.keys(parsed).sort(), ['gameState', 'previousCrownCounts', 'turnDisplayState', 'turnHistory'].sort());
  assert.equal(Object.hasOwn(parsed.gameState, 'previousCrownCounts'), false);
  const decoded = fromSyncBlob(blob);
  assert.deepEqual(decoded, { state, extras });
  assert.equal(toSyncBlob(decoded.state, decoded.extras), blob);
  assert.deepEqual({ state, extras }, before);
  decoded.state.players.player1.tokens.blue = 99;
  assert.equal(state.players.player1.tokens.blue, 0);
  assert.deepEqual(fromSyncBlob(toSyncBlob(state)).state, state);
  assert.throws(() => fromSyncBlob('{}'), TypeError);
});

test('newGame neither mutates nor shares nested input card objects', () => {
  const input = structuredClone(cards);
  const before = structuredClone(input);
  const options = { firstPlayer: 2 };
  const state = newGame(input, mulberry32(6), options);
  assert.deepEqual(input, before);
  assert.deepEqual(options, { firstPlayer: 2 });
  const dealt = state.pyramid.level1[0];
  dealt.costs.blue = 99;
  assert.deepEqual(input, before);
  const other = newGame(input, mulberry32(6), options);
  assert.notEqual(other.pyramid.level1[0].costs.blue, 99);
});
