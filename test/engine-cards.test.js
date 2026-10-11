import test from 'node:test';
import assert from 'node:assert/strict';
import { playerBonuses, canPlaceWild, paymentOptions, canAfford, applyBuy } from '../src/engine/cards-play.js';
import { newGame, TOKEN_SUPPLY } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { mulberry32 } from './helpers/rng.js';

const colors = Object.keys(TOKEN_SUPPLY);
const costs = colors.filter(color => color !== 'gold');
const gems = costs.filter(color => color !== 'pearl');
const zero = () => Object.fromEntries(colors.map(color => [color, 0]));
const card = (props = {}) => ({ id: 'test-card', level: 3, color: 'blue', points: 0,
  crowns: 0, ability: '', isDouble: false, costs: {}, ...props });
const fresh = () => newGame(loadCards(), mulberry32(1), { firstPlayer: 1 });
function fixture(tokens = {}, owned = []) {
  const state = fresh();
  state.players.player1.tokens = { ...zero(), ...tokens };
  state.players.player1.cards = owned;
  return state;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const key = payment => JSON.stringify(colors.map(color => payment.spend[color]));

test('bonuses count doubles and assigned wilds; totals include grey cards and Royals', () => {
  const state = freeze(fixture({}, [
    card({ isDouble: true, points: 2, crowns: 1 }),
    card({ color: 'wild', wildColorStack: 'blue', points: 3, crowns: 2 }),
    card({ color: 'red', points: 4 }), card({ color: 'none', points: 5 }),
    { id: 'royal-1', points: 2 }, card({ color: 'wild', points: 1 })
  ]));
  assert.deepEqual(playerBonuses(state, 'player1'), {
    bonuses: { blue: 3, white: 0, green: 0, black: 0, red: 1 },
    totalPoints: 17, totalCrowns: 3,
    colorPoints: { blue: 5, white: 0, green: 0, black: 0, red: 4 }
  });
  assert.equal(playerBonuses(state, 'player2').totalPoints, 0);
  assert.throws(() => playerBonuses(state, 'player3'), /playerId/);
});

// Independent oracle enumerates token spends (rather than gold assignments),
// filters exact discounted total coverage, and compares unordered result sets.
function bruteForce(state, target) {
  const tokens = state.players.player1.tokens;
  const discounts = Object.fromEntries(gems.map(color => [color, state.players.player1.cards.reduce((sum, c) =>
    sum + ((c.color === 'wild' ? c.wildColorStack : c.color) === color ? (c.isDouble ? 2 : 1) : 0), 0)]));
  const needs = Object.fromEntries(costs.map(color => [color,
    Math.max(0, (target.costs[color] || 0) - (discounts[color] || 0))]));
  const result = [];
  const spend = zero();
  function visit(index) {
    if (index === colors.length) {
      if (costs.every(color => spend[color] <= needs[color]) &&
          costs.reduce((sum, color) => sum + needs[color] - spend[color], 0) === spend.gold) {
        result.push({ spend: { ...spend } });
      }
      return;
    }
    const color = colors[index];
    for (let n = 0; n <= tokens[color]; n += 1) {
      spend[color] = n;
      visit(index + 1);
    }
  }
  visit(0);
  return result;
}

test('exact payment enumeration agrees with brute force, including optional gold and pearls', () => {
  const cases = [
    [{ blue: 2, pearl: 1, gold: 2 }, { blue: 2, pearl: 1 }, 5],
    [{ gold: 2 }, { red: 1, pearl: 1 }, 1],
    [{ blue: 1, red: 1, gold: 1 }, { blue: 1, red: 1 }, 3],
    [{ blue: 1, gold: 1 }, { blue: 2, pearl: 1 }, 0],
    [{ gold: 3 }, {}, 1]
  ];
  for (const [tokens, price, expected] of cases) {
    const state = freeze(fixture(tokens));
    const target = freeze(card({ costs: price }));
    const actual = paymentOptions(state, 'player1', target);
    assert.equal(actual.length, expected);
    assert.deepEqual(actual.map(key).sort(), bruteForce(state, target).map(key).sort());
    assert.equal(new Set(actual.map(key)).size, actual.length);
    assert.deepEqual(actual.map(p => p.spend.gold), actual.map(p => p.spend.gold).sort((a, b) => a - b));
    assert.equal(canAfford(state, 'player1', target), expected > 0);
  }
  const rng = mulberry32(13);
  for (let i = 0; i < 40; i += 1) {
    const tokens = Object.fromEntries(colors.map(color => [color, Math.floor(rng() * 3)]));
    const price = Object.fromEntries(costs.map(color => [color, Math.floor(rng() * 3)]));
    const state = fixture(tokens, [card({ color: gems[i % gems.length], isDouble: i % 2 === 0 })]);
    const target = card({ costs: price });
    const actual = paymentOptions(state, 'player1', target, { limit: 1000 });
    assert.deepEqual(actual.map(key).sort(), bruteForce(state, target).map(key).sort());
  }
});

test('pearls never receive discounts and free costs cannot consume gold', () => {
  const state = fixture({ gold: 1 }, [card({ color: 'pearl', isDouble: true }), card({ isDouble: true })]);
  const target = card({ costs: { blue: 1, pearl: 1 } });
  assert.deepEqual(paymentOptions(state, 'player1', target), [{ spend: { ...zero(), gold: 1 } }]);
  state.players.player1.tokens.gold = 0;
  assert.equal(canAfford(state, 'player1', target), false);
  assert.deepEqual(paymentOptions(state, 'player1', card({ costs: { blue: 1 } })), [{ spend: zero() }]);
});

test('limits return deterministic cheapest prefixes and default cap is 64', () => {
  const state = freeze(fixture({ blue: 4, white: 4, green: 4, black: 4, red: 4, pearl: 2, gold: 3 }));
  const target = card({ costs: { blue: 4, white: 4, green: 4, black: 4, red: 4, pearl: 2 } });
  const all = paymentOptions(state, 'player1', target, { limit: 1000 });
  assert.ok(all.length > 64);
  assert.deepEqual(paymentOptions(state, 'player1', target), all.slice(0, 64));
  assert.deepEqual(paymentOptions(state, 'player1', target, { limit: 2 }), all.slice(0, 2));
  assert.deepEqual(paymentOptions(state, 'player1', target, { limit: 0 }), []);
  for (const limit of [-1, 1.5, Infinity, NaN]) assert.throws(() => paymentOptions(state, 'player1', target, { limit }), /limit/);
});

test('wild placement requires an existing stack with a non-wild top', () => {
  const state = fixture({}, [card(), card({ color: 'wild', wildColorStack: 'blue' }), card({ color: 'red', isDouble: true })]);
  assert.equal(canPlaceWild(state, 'player1', 'blue'), false);
  assert.equal(canPlaceWild(state, 'player1', 'red'), true);
  for (const color of ['white', 'pearl', 'gold', 'wild', undefined]) assert.equal(canPlaceWild(state, 'player1', color), false);
  state.players.player1.cards.push(card());
  assert.equal(canPlaceWild(freeze(state), 'player1', 'blue'), true);
});

test('pyramid buy returns spent tokens, refills same index from deck top, and emits unresolved facts', () => {
  const state = fixture({ blue: 1, gold: 1 }, [card({ color: 'red', crowns: 2 })]);
  state.pyramid.level3[1] = card({ crowns: 1, ability: 'steal', costs: { blue: 1, pearl: 1 } });
  const before = structuredClone(state);
  const move = freeze({ source: 'pyramid', level: 3, index: 1, payment: paymentOptions(state, 'player1', state.pyramid.level3[1])[0] });
  const result = applyBuy(freeze(state), 'player1', move, freeze({}));
  assert.deepEqual(state, before);
  assert.deepEqual(result.state.pyramid.level3[1], before.decks.level3[0]);
  assert.deepEqual(result.state.decks.level3, before.decks.level3.slice(1));
  assert.deepEqual(result.state.players.player1.tokens, zero());
  assert.equal(result.state.bag.blue, before.bag.blue + 1);
  assert.equal(result.state.bag.gold, before.bag.gold + 1);
  assert.deepEqual(result.events, [{ type: 'bought', card: before.pyramid.level3[1], abilities: ['steal'], crownsBefore: 2, crownsAfter: 3 }]);
  for (const field of ['turnState', 'previousCrownCounts', 'royalCards', 'gameOver']) assert.deepEqual(result.state[field], before[field]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  result.events[0].card.points = 99;
  assert.equal(result.state.players.player1.cards.at(-1).points, 0);
});

test('empty deck removes slot; reserve wild purchase assigns color without refilling', () => {
  const state = fixture({}, [card()]);
  state.decks.level3 = [];
  state.pyramid.level3[1] = card();
  const next = applyBuy(freeze(state), 'player1', { source: 'pyramid', level: 'level3', index: 1, payment: zero() }).state;
  assert.deepEqual(next.pyramid.level3, state.pyramid.level3.filter((_, i) => i !== 1));
  const reserved = structuredClone(state);
  reserved.players.player1.reserves = [card({ color: 'wild' })];
  const move = { source: 'reserve', index: 0, payment: { spend: zero() }, wildColor: 'blue' };
  const result = applyBuy(freeze(reserved), 'player1', freeze(move));
  assert.equal(result.state.players.player1.cards.at(-1).wildColorStack, 'blue');
  assert.deepEqual(result.state.players.player1.reserves, []);
  assert.deepEqual(result.state.pyramid, reserved.pyramid);
  assert.deepEqual(result.state.decks, reserved.decks);
  assert.deepEqual(result.events[0].abilities, []);
});

test('invalid sources, indices, levels, payments and wild placements reject without mutation', () => {
  const state = fixture({ blue: 1, gold: 2 });
  state.pyramid.level3[0] = card({ costs: { blue: 1 } });
  const move = { source: 'pyramid', level: 3, index: 0, payment: { ...zero(), blue: 1 } };
  const before = structuredClone(state);
  freeze(state);
  for (const patch of [
    { source: 'deck' }, { level: 0 }, { level: 2, index: 99 }, { index: -1 }, { index: 0.5 },
    { payment: zero() }, { payment: { ...zero(), gold: 2 } },
    { payment: { ...zero(), blue: 2 } }, { payment: { ...zero(), blue: -1 } },
    { payment: { ...zero(), blue: 0.5 } }, { payment: {} },
    { payment: { ...zero(), blue: 1, orange: 1 } }
  ]) assert.throws(() => applyBuy(state, 'player1', { ...move, ...patch }));
  assert.throws(() => applyBuy(state, 'player3', move), /playerId/);
  const wild = structuredClone(state);
  wild.pyramid.level3[0] = card({ color: 'wild' });
  for (const wildColor of [undefined, 'blue', 'pearl']) {
    assert.throws(() => applyBuy(freeze(wild), 'player1', { ...move, payment: zero(), wildColor }), /wild/);
  }
  assert.deepEqual(state, before);
});

test('300 seeded legal purchases from fresh games conserve all tokens and cards', () => {
  const rng = mulberry32(301);
  let state = fresh();
  let games = 1;
  for (let purchases = 0; purchases < 300;) {
    // Supply setup isolates the buy primitive from turn phases/token acquisition.
    // Recover board and bag tokens without creating or deleting physical pieces.
    state = structuredClone(state);
    for (const row of state.board) for (let i = 0; i < row.length; i += 1) {
      if (row[i] !== null) state.players.player1.tokens[row[i]] += 1;
      row[i] = null;
    }
    for (const color of colors) {
      state.players.player1.tokens[color] += state.bag[color];
      state.bag[color] = 0;
    }
    assert.deepEqual(checkInvariants(state), []);
    const moves = [];
    for (const level of [1, 2, 3]) state.pyramid[`level${level}`].forEach((target, index) => {
      if (!canAfford(state, 'player1', target)) return;
      const placements = target.color === 'wild' ? gems.filter(color => canPlaceWild(state, 'player1', color)) : [undefined];
      for (const wildColor of placements) moves.push({ source: 'pyramid', level, index, wildColor, target });
    });
    if (moves.length === 0) {
      state = newGame(loadCards(), rng, { firstPlayer: 1 });
      games += 1;
      assert.ok(games < 100);
      continue;
    }
    const { target, ...move } = moves[Math.floor(rng() * moves.length)];
    const payments = paymentOptions(state, 'player1', target);
    move.payment = payments[Math.floor(rng() * payments.length)];
    const before = structuredClone(state);
    const result = applyBuy(freeze(state), 'player1', freeze(move));
    assert.deepEqual(state, before);
    assert.deepEqual(checkInvariants(result.state), []);
    assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
    state = result.state;
    purchases += 1;
  }
  assert.ok(games > 1);
});
