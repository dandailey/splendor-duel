import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legalReserves, applyReserve, pendingAbilityChoices, applyAbility, crownsOf,
  royalThresholds, legalRoyalChoices, applyRoyal, tokenTotal, legalDiscards,
  applyDiscard, victoryStats, checkVictory
} from '../src/engine/rules-misc.js';
import { newGame, TOKEN_SUPPLY, ROYAL_CARDS } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { applyTake, applyRefill, randomOrder, legalTakeSelections } from '../src/engine/tokens.js';
import { mulberry32 } from './helpers/rng.js';

const colors = Object.keys(TOKEN_SUPPLY);
const cards = loadCards();
function fixture(placements = [], holdings = {}) {
  const state = newGame(cards, mulberry32(1), { firstPlayer: 1 });
  state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
  state.bag = { ...TOKEN_SUPPLY };
  for (const [r, c, color] of placements) {
    state.board[r][c] = color;
    state.bag[color] -= 1;
  }
  for (const [id, tokens] of Object.entries(holdings)) {
    Object.assign(state.players[id].tokens, tokens);
    for (const [color, count] of Object.entries(tokens)) state.bag[color] -= count;
  }
  assert.deepEqual(checkInvariants(state), []);
  return state;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function transition(state, fn) {
  const snapshot = structuredClone(state);
  freeze(state);
  const result = fn(state);
  assert.notEqual(result.state, state);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(checkInvariants(result.state), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  return result;
}

test('reserve options cross every visible card and nonempty deck with each gold cell', () => {
  const state = freeze(fixture([[0, 0, 'gold'], [4, 4, 'gold']]));
  const options = legalReserves(state, 'player1');
  assert.equal(options.length, (3 + 4 + 5 + 3) * 2);
  assert.deepEqual(options.slice(0, 2), [
    { source: 'pyramid', level: 1, index: 0, goldCell: [0, 0] },
    { source: 'pyramid', level: 1, index: 0, goldCell: [4, 4] }
  ]);
  for (const option of options) {
    freeze(option);
    const { state: next, events } = transition(state, s => applyReserve(s, 'player1', option));
    const key = `level${option.level}`;
    assert.deepEqual(next.players.player1.reserves[0], option.source === 'deck' ? state.decks[key][0] : state.pyramid[key][option.index]);
    assert.equal(next.players.player1.tokens.gold, 1);
    assert.equal(next.board[option.goldCell[0]][option.goldCell[1]], null);
    assert.equal(next.board[option.goldCell[0] === 0 ? 4 : 0][option.goldCell[1] === 0 ? 4 : 0], 'gold');
    assert.equal(next.decks[key].length, state.decks[key].length - 1);
    assert.deepEqual(next.turnState, state.turnState);
    assert.equal(events[0].type, 'card_reserved');
    if (option.source === 'pyramid') assert.deepEqual(next.pyramid[key][option.index], state.decks[key][0]);
    else assert.deepEqual(next.pyramid, state.pyramid);
  }
});

test('reserve rejects full reserves, absent gold, empty decks and invalid options; exhausted pyramid shrinks', () => {
  const state = fixture([[2, 2, 'gold']]);
  state.players.player2.cards.push(...state.decks.level1.splice(0));
  assert.equal(legalReserves(state, 'player1').some(o => o.source === 'deck' && o.level === 1), false);
  const { state: next } = transition(state, s => applyReserve(s, 'player1', { source: 'pyramid', level: 1, index: 1, goldCell: [2, 2] }));
  assert.deepEqual(next.pyramid.level1, [state.pyramid.level1[0], state.pyramid.level1[2]]);
  for (const option of [null, { source: 'deck', level: 1, goldCell: [2, 2] },
    { source: 'pyramid', level: 2, index: -1, goldCell: [2, 2] },
    { source: 'deck', level: 2, goldCell: [0, 0] }]) {
    assert.throws(() => applyReserve(state, 'player1', option), /Illegal reserve/);
  }
  assert.deepEqual(legalReserves(fixture(), 'player1'), []);
  const full = fixture([[0, 0, 'gold']]);
  full.players.player1.reserves.push(...full.decks.level2.splice(0, 3));
  assert.deepEqual(legalReserves(freeze(full), 'player1'), []);
});

test('reserve can exceed ten tokens without discarding or resolving reserved abilities', () => {
  const state = fixture([[0, 0, 'gold']], { player1: { blue: 4, white: 4, pearl: 2 } });
  const { state: next } = transition(state, s => applyReserve(s, 'player1', legalReserves(s, 'player1')[0]));
  assert.equal(tokenTotal(next, 'player1'), 11);
  assert.deepEqual(next.turnState, state.turnState);
  assert.equal(next.players.player1.cards.length, 0);
});

test('again queues cumulatively; scroll uses pool, transfers from opponent, and respects cap', () => {
  let state = fixture();
  for (let i = 1; i <= 2; i += 1) {
    const result = transition(state, s => applyAbility(s, 'player1', 'again'));
    assert.equal(result.state.turnState.extraTurnsPending, i);
    assert.equal(result.events[0].type, 'repeat_turn_awarded');
    state = result.state;
  }
  for (const [own, other, pool] of [[0, 1, 2], [0, 3, 0], [3, 0, 0]]) {
    state = fixture();
    state.players.player1.privileges = own;
    state.players.player2.privileges = other;
    state.scrollPool = pool;
    const { state: next, events } = transition(state, s => applyAbility(s, 'player1', 'scroll'));
    assert.equal(next.players.player1.privileges, Math.min(3, own + 1));
    assert.equal(next.scrollPool, Math.max(0, pool - 1));
    assert.equal(next.players.player2.privileges, other - (pool === 0 && own < 3 ? 1 : 0));
    assert.equal(events[0].type, own === 3 ? 'scroll_unavailable' : 'scroll_gained');
  }
});

test('token choices match card color; explicit choice checks color and never takes gold', () => {
  const state = freeze(fixture([[0, 0, 'blue'], [4, 4, 'blue'], [1, 1, 'red'], [2, 2, 'gold']]));
  assert.deepEqual(pendingAbilityChoices(state, 'player1', 'token', 'blue'), [[0, 0], [4, 4]]);
  for (const color of ['wild', 'none', 'gold', 'pearl']) assert.deepEqual(pendingAbilityChoices(state, 'player1', 'token', color), []);
  for (const cell of [[0, 0], [4, 4]]) {
    const { state: next } = transition(state, s => applyAbility(s, 'player1', 'token', freeze({ cell, cardColor: 'blue' })));
    assert.equal(next.players.player1.tokens.blue, 1);
    assert.equal(next.board[cell[0]][cell[1]], null);
  }
  transition(state, s => applyAbility(s, 'player1', 'token', [0, 0]));
  for (const choice of [[2, 2], [-1, 0], { cell: [1, 1], cardColor: 'blue' }, { cell: null, cardColor: 'blue' }]) {
    assert.throws(() => applyAbility(state, 'player1', 'token', choice), /Illegal token/);
  }
  const skipped = transition(state, s => applyAbility(s, 'player1', 'token', { cell: null, cardColor: 'green' }));
  assert.deepEqual(skipped.state, state);
  assert.equal(skipped.events[0].type, 'ability_skipped');
});

test('steal includes pearls and every gem but never gold; unavailable effects skip', () => {
  const state = freeze(fixture([], { player2: { blue: 1, white: 1, green: 1, red: 1, black: 1, pearl: 1, gold: 3 } }));
  const choices = pendingAbilityChoices(state, 'player1', 'steal');
  assert.deepEqual(choices, ['blue', 'white', 'green', 'red', 'black', 'pearl']);
  for (const color of choices) {
    const { state: next } = transition(state, s => applyAbility(s, 'player1', 'steal', color));
    assert.equal(next.players.player1.tokens[color], 1);
    assert.equal(next.players.player2.tokens[color], 0);
    assert.equal(next.players.player2.tokens.gold, 3);
  }
  for (const choice of ['gold', 'orange', null]) assert.throws(() => applyAbility(state, 'player1', 'steal', choice), /Illegal steal/);
  const goldOnly = freeze(fixture([], { player2: { gold: 3 } }));
  assert.deepEqual(pendingAbilityChoices(goldOnly, 'player1', 'steal'), []);
  assert.deepEqual(transition(goldOnly, s => applyAbility(s, 'player1', 'steal')).state, goldOnly);
  assert.throws(() => applyAbility(state, 'player1', 'wild'), /Unsupported/);
  assert.deepEqual(transition(state, s => applyAbility(s, 'player1', null)).events, []);
});

test('Royal thresholds use derived crowns and report both crossings without consuming baseline', () => {
  for (const [before, after, expected] of [[0, 2, []], [2, 3, [3]], [3, 5, []], [5, 6, [6]], [0, 6, [3, 6]], [6, 10, []]]) {
    assert.deepEqual(royalThresholds(before, after), expected);
  }
  const state = fixture();
  state.players.player1.cards = [{ points: 0, crowns: 2 }, { points: 0, crowns: 4 }];
  state.players.player1.crowns = 99;
  state.previousCrownCounts.player1 = 2;
  freeze(state);
  assert.equal(crownsOf(state, 'player1'), 6);
  assert.deepEqual(royalThresholds(state, 'player1'), [3, 6]);
  assert.equal(state.previousCrownCounts.player1, 2);
  assert.throws(() => royalThresholds(-1, 3), /Invalid crown/);
});

test('Royal acquisition marks registry, adds points and emits ability without resolving it', () => {
  const state = freeze(fixture());
  assert.deepEqual(legalRoyalChoices(state, 'player1'), ROYAL_CARDS);
  const detached = legalRoyalChoices(state, 'player1');
  detached[0].taken = true;
  assert.equal(state.royalCards[0].taken, false);
  for (const royal of ROYAL_CARDS) {
    const { state: next, events } = transition(state, s => applyRoyal(s, 'player1', royal.id));
    assert.equal(next.royalCards.find(c => c.id === royal.id).taken, true);
    assert.equal(legalRoyalChoices(next, 'player2').length, 3);
    assert.equal(victoryStats(next, 'player1').totalPoints, royal.points);
    assert.equal(crownsOf(next, 'player1'), 0);
    assert.deepEqual(next.turnState, state.turnState);
    assert.equal(events[0].ability, royal.ability);
    assert.equal(events.length, royal.ability ? 2 : 1);
    assert.throws(() => applyRoyal(next, 'player2', royal.id), /Illegal Royal/);
  }
  assert.throws(() => applyRoyal(state, 'player1', 'unknown'), /Illegal Royal/);
});

// Independent oracle: Cartesian product of counts, followed by a total filter.
function bruteDiscards(tokens) {
  let products = [{}];
  for (const color of colors) {
    products = products.flatMap(map => Array.from({ length: tokens[color] + 1 }, (_, count) => ({ ...map, [color]: count })));
  }
  const excess = Object.values(tokens).reduce((a, b) => a + b, 0) - 10;
  return excess <= 0 ? [] : products.filter(map => Object.values(map).reduce((a, b) => a + b, 0) === excess);
}

test('discard enumeration agrees with brute force across seeded holdings and deterministic caps', () => {
  const rng = mulberry32(712);
  for (let i = 0; i < 35; i += 1) {
    const tokens = Object.fromEntries(colors.map(color => [color, Math.floor(rng() * (TOKEN_SUPPLY[color] + 1))]));
    const state = freeze(fixture([], { player1: tokens }));
    const expected = bruteDiscards(tokens);
    const actual = legalDiscards(state, 'player1', 100000);
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual.map(JSON.stringify)).size, actual.length);
    assert.deepEqual(legalDiscards(state, 'player1'), expected.slice(0, 200));
    assert.deepEqual(legalDiscards(state, 'player1', 2), expected.slice(0, 2));
    assert.deepEqual(legalDiscards(state, 'player1', 0), []);
    for (const map of actual.slice(0, 5)) {
      const { state: next } = transition(state, s => applyDiscard(s, 'player1', freeze(map)));
      assert.equal(tokenTotal(next, 'player1'), 10);
      for (const color of colors) assert.equal(next.bag[color], state.bag[color] + map[color]);
    }
  }
  const all = fixture([], { player1: TOKEN_SUPPLY });
  assert.equal(legalDiscards(all, 'player1').length, 200);
  assert.throws(() => legalDiscards(all, 'player1', -1), /Invalid discard limit/);
});

test('discard accepts gold and pearls, rejects under/over-discard and invalid counts without mutation', () => {
  const state = freeze(fixture([], { player1: { blue: 4, white: 4, pearl: 2, gold: 2 } }));
  const { state: next } = transition(state, s => applyDiscard(s, 'player1', freeze({ pearl: 1, gold: 1 })));
  assert.equal(next.bag.pearl, 1);
  assert.equal(next.bag.gold, 2);
  for (const map of [null, [], {}, { blue: 1 }, { blue: 3 }, { red: 2 }, { orange: 2 }, { gold: -1, blue: 3 }, { gold: 0.5, pearl: 1.5 }]) {
    assert.throws(() => applyDiscard(state, 'player1', map), /Illegal discard/);
  }
  assert.throws(() => applyDiscard(next, 'player1', {}), /Illegal discard/);
});

test('victory derives totals, assigned wild color, Royals, and live condition labels with stable ties', () => {
  const state = fixture();
  state.players.player1.cards = [
    { color: 'blue', points: 7, crowns: 5 },
    { color: 'wild', wildColorStack: 'blue', points: 3, crowns: 5 },
    { color: 'red', points: 10, crowns: 0 },
    { color: 'none', points: 3, crowns: 0 }
  ];
  state.players.player1.reserves = [{ color: 'green', points: 99, crowns: 99 }];
  freeze(state);
  assert.deepEqual(victoryStats(state, 'player1'), {
    totalPoints: 23, totalCrowns: 10, colorPoints: { blue: 10, white: 0, green: 0, red: 10, black: 0 }, maxColor: 'blue', maxPoints: 10
  });
  assert.deepEqual(checkVictory(state, 'player1'), { won: true, conditions: [
    { key: 'points_20', label: '20+ total prestige points' },
    { key: 'crowns_10', label: '10+ crowns' },
    { key: 'color_points_10', label: '10+ prestige points in blue' }
  ] });
  for (const [points, crowns, color, expected] of [[19, 9, 'none', []], [20, 0, 'none', ['points_20']], [0, 10, 'blue', ['crowns_10']], [10, 0, 'black', ['color_points_10']]]) {
    const s = fixture();
    s.players.player1.cards = [{ points, crowns, color }];
    assert.deepEqual(checkVictory(freeze(s), 'player1').conditions.map(c => c.key), expected);
  }
  assert.deepEqual(checkVictory(state, 'player2'), { won: false, conditions: [] });
});

test('seeded mixed sequences preserve all invariants, immutability and deterministic results', () => {
  function run(seed) {
    const rng = mulberry32(seed);
    let state = newGame(cards, rng, { firstPlayer: 1 });
    for (let i = 0; i < 70; i += 1) {
      const id = i % 2 ? 'player2' : 'player1';
      const kind = Math.floor(rng() * 6);
      if (kind === 0 && legalReserves(state, id).length) {
        const options = legalReserves(state, id);
        const option = options[Math.floor(rng() * options.length)];
        state = transition(state, s => applyReserve(s, id, option)).state;
      } else if (kind === 1) {
        const choices = pendingAbilityChoices(state, id, 'steal');
        state = transition(state, s => applyAbility(s, id, 'steal', choices.length ? choices[Math.floor(rng() * choices.length)] : null)).state;
      } else if (kind === 2) {
        state = transition(state, s => applyAbility(s, id, 'scroll')).state;
      } else if (kind === 3) {
        const selections = legalTakeSelections(state.board);
        if (selections.length) {
          const choice = selections[Math.floor(rng() * selections.length)];
          state = transition(state, s => ({ state: applyTake(s, id, choice), events: [] })).state;
        }
      } else if (kind === 4) {
        const color = ['blue', 'white', 'green', 'red', 'black'][Math.floor(rng() * 5)];
        const choices = pendingAbilityChoices(state, id, 'token', color);
        state = transition(state, s => applyAbility(s, id, 'token', { cardColor: color, cell: choices.length ? choices[Math.floor(rng() * choices.length)] : null })).state;
      } else {
        const choices = legalRoyalChoices(state, id);
        if (choices.length) {
          const royal = choices[Math.floor(rng() * choices.length)];
          state = transition(state, s => applyRoyal(s, id, royal.id)).state;
          if (royal.ability) {
            const choices = pendingAbilityChoices(state, id, royal.ability);
            state = transition(state, s => applyAbility(s, id, royal.ability, choices[0] ?? null)).state;
          }
        }
      }
      if (tokenTotal(state, id) > 10) {
        const choices = legalDiscards(state, id);
        state = transition(state, s => applyDiscard(s, id, choices[Math.floor(rng() * choices.length)])).state;
      }
      if (Object.values(state.bag).some(n => n > 0) && i % 7 === 0) {
        const refill = structuredClone(state);
        refill.turnState.boardRefilled = false;
        const order = randomOrder(refill, rng);
        state = transition(refill, s => ({ state: applyRefill(s, id, order), events: [] })).state;
      }
    }
    return state;
  }
  for (let seed = 1; seed <= 8; seed += 1) assert.deepEqual(run(seed), run(seed));
});

test('all player-taking APIs reject unknown players', () => {
  const state = freeze(fixture());
  for (const fn of [legalReserves, pendingAbilityChoices, applyAbility, crownsOf, legalRoyalChoices,
    applyRoyal, tokenTotal, legalDiscards, applyDiscard, victoryStats, checkVictory]) {
    assert.throws(() => fn(state, 'player3'), /playerId/);
  }
});
