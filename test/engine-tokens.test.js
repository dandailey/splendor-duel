import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spiralOrder, legalTakeSelections, takePrivilegeBonus, applyTake,
  legalPrivilegeUses, applyPrivilegeUse, canRefill, applyRefill,
  randomOrder, goldCells, takeGoldFrom
} from '../src/engine/tokens.js';
import { newGame, TOKEN_SUPPLY } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { checkInvariants } from '../src/engine/invariants.js';
import { mulberry32 } from './helpers/rng.js';

const cards = loadCards();
const emptyBoard = () => Array.from({ length: 5 }, () => Array(5).fill(null));
const key = coords => JSON.stringify([...coords].sort(([ar, ac], [br, bc]) => ar - br || ac - bc));
function fixture(placements = []) {
  const state = newGame(cards, mulberry32(1), { firstPlayer: 1 });
  state.board = emptyBoard();
  state.bag = { ...TOKEN_SUPPLY };
  state.scrollPool = 3;
  state.players.player2.privileges = 0;
  for (const [row, col, color] of placements) {
    state.board[row][col] = color;
    state.bag[color] -= 1;
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
function immutableTransition(state, transition) {
  const before = structuredClone(state);
  freeze(state);
  const next = transition(state);
  assert.notEqual(next, state);
  assert.deepEqual(state, before);
  assert.deepEqual(checkInvariants(next), []);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
  return next;
}

test('spiral matches the entire live clockwise path and returns independent coordinates', () => {
  const expected = [
    [2, 2], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3],
    [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0],
    [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4]
  ];
  assert.deepEqual(spiralOrder(), expected);
  const changed = spiralOrder();
  changed[0][0] = 99;
  assert.deepEqual(spiralOrder(), expected);
  assert.equal(new Set(expected.map(coord => JSON.stringify(coord))).size, 25);
});

test('handmade lines enumerate singles, adjacent pairs, and triples in every direction', () => {
  for (const coords of [
    [[1, 1], [1, 2], [1, 3]], [[1, 1], [2, 1], [3, 1]],
    [[1, 1], [2, 2], [3, 3]], [[1, 3], [2, 2], [3, 1]]
  ]) {
    const board = emptyBoard();
    coords.forEach(([row, col]) => { board[row][col] = 'blue'; });
    freeze(board);
    const actual = legalTakeSelections(board).map(key).sort();
    const expected = [...coords.map(coord => [coord]), coords.slice(0, 2), coords.slice(1), coords];
    assert.deepEqual(actual, expected.map(key).sort());
  }
});

test('bent diagonals, gaps, empty cells and gold cannot form a take', () => {
  const board = emptyBoard();
  [[0, 0], [1, 2], [2, 2]].forEach(([r, c]) => { board[r][c] = 'pearl'; });
  board[0][1] = 'gold';
  const selections = legalTakeSelections(board);
  assert.equal(selections.some(selection => selection.length === 3), false);
  assert.equal(selections.some(selection => key(selection) === key([[0, 0], [2, 2]])), false);
  assert.ok(selections.flat().every(([r, c]) => board[r][c] === 'pearl'));
  assert.deepEqual(legalTakeSelections(emptyBoard()), []);
});

// Independent oracle enumerates combinations, using distances and a cross
// product rather than walking the implementation's four directions.
function bruteForce(board) {
  const cells = [];
  board.forEach((row, r) => row.forEach((color, c) => {
    if (color !== null && color !== 'gold') cells.push([r, c]);
  }));
  const distance = ([r, c], [s, d]) => (r - s) ** 2 + (c - d) ** 2;
  const result = cells.map(coord => [coord]);
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const [a, b] = [cells[i], cells[j]];
      if ([1, 2].includes(distance(a, b))) result.push([a, b]);
      for (let k = j + 1; k < cells.length; k += 1) {
        const c = cells[k];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const distances = [distance(a, b), distance(b, c), distance(a, c)].sort((x, y) => x - y);
        if (cross === 0 && [1, 2].includes(distances[0]) && distances[1] === distances[0] && distances[2] === 4 * distances[0]) {
          result.push([a, b, c]);
        }
      }
    }
  }
  return result.map(key).sort();
}

test('full board has exactly 25 singles, 72 pairs, 48 triples; agrees with independent brute force', () => {
  const board = Array.from({ length: 5 }, () => Array(5).fill('blue'));
  const actual = legalTakeSelections(board);
  assert.deepEqual([1, 2, 3].map(length => actual.filter(coords => coords.length === length).length), [25, 72, 48]);
  assert.equal(new Set(actual.map(key)).size, 145);
  assert.deepEqual(actual.map(key).sort(), bruteForce(board));
  actual.forEach(coords => assert.equal(JSON.stringify(coords), key(coords)));
  for (let seed = 0; seed < 20; seed += 1) {
    const rng = mulberry32(seed);
    const sparse = board.map(row => row.map(() => ['blue', 'pearl', 'gold', null][Math.floor(rng() * 4)]));
    assert.deepEqual(legalTakeSelections(sparse).map(key).sort(), bruteForce(sparse));
  }
});

test('Privilege bonus covers three matching colors or at least two pearls', () => {
  for (const tokens of [['red', 'red', 'red'], ['pearl', 'pearl'], ['pearl', 'blue', 'pearl'], ['pearl', 'pearl', 'pearl']]) {
    assert.equal(takePrivilegeBonus(freeze(tokens)), true);
  }
  for (const tokens of [[], ['red'], ['red', 'red'], ['red', 'blue', 'red'], ['pearl', 'blue']]) {
    assert.equal(takePrivilegeBonus(tokens), false);
  }
});

test('take transfers tokens, accepts reverse input, and awards opponent from pool', () => {
  const state = fixture([[0, 0, 'red'], [0, 1, 'red'], [0, 2, 'red']]);
  const coords = freeze([[0, 2], [0, 1], [0, 0]]);
  const next = immutableTransition(state, value => applyTake(value, 'player1', coords));
  assert.equal(next.players.player1.tokens.red, 3);
  assert.deepEqual(next.board[0].slice(0, 3), [null, null, null]);
  assert.equal(next.scrollPool, 2);
  assert.equal(next.players.player2.privileges, 1);
  assert.deepEqual(next.turnState, state.turnState);
});

test('two pearls award once; empty pool takes a Privilege from taker; all three held means no award', () => {
  for (const [taker, receiver] of [[0, 0], [2, 1], [0, 3]]) {
    const state = fixture([[1, 1, 'pearl'], [2, 2, 'pearl']]);
    state.players.player2.privileges = taker;
    state.players.player1.privileges = receiver;
    state.scrollPool = 3 - taker - receiver;
    const next = immutableTransition(state, value => applyTake(value, 'player2', [[1, 1], [2, 2]]));
    assert.equal(next.players.player1.privileges, Math.min(3, receiver + 1));
    assert.equal(next.players.player2.privileges, taker - (state.scrollPool === 0 && receiver < 3 ? 1 : 0));
  }
});

test('ordinary take has no Privilege penalty; illegal takes reject without mutation', () => {
  const state = freeze(fixture([[0, 0, 'blue'], [1, 2, 'red'], [2, 2, 'green'], [0, 1, 'gold']]));
  const next = immutableTransition(state, value => applyTake(value, 'player1', [[0, 0]]));
  assert.equal(next.scrollPool, 3);
  for (const coords of [[], [[0, 0], [0, 0]], [[0, 0], [1, 2], [2, 2]], [[0, 1]], [[4, 4]], [[-1, 0]], [[0.5, 0]], null]) {
    assert.throws(() => applyTake(state, 'player1', coords), /Illegal take/);
  }
  assert.throws(() => applyTake(state, 'player3', [[0, 0]]), /playerId/);
});

test('Privilege uses are repeatable before refill, return scrolls, and never take gold or award a bonus', () => {
  const state = fixture([[0, 0, 'pearl'], [0, 1, 'pearl'], [0, 2, 'gold']]);
  state.players.player1.privileges = 2;
  state.scrollPool = 1;
  assert.deepEqual(legalPrivilegeUses(state, 'player1'), [[0, 0], [0, 1]]);
  assert.deepEqual(legalPrivilegeUses(state, 'player2'), []);
  const first = immutableTransition(state, value => applyPrivilegeUse(value, 'player1', [0, 0]));
  const second = immutableTransition(first, value => applyPrivilegeUse(value, 'player1', [0, 1]));
  assert.equal(second.scrollPool, 3);
  assert.equal(second.players.player1.tokens.pearl, 2);
  assert.equal(second.players.player2.privileges, 0);
  assert.deepEqual(legalPrivilegeUses(second, 'player1'), []);
  for (const coord of [[0, 2], [4, 4], [-1, 0], null]) assert.throws(() => applyPrivilegeUse(state, 'player1', coord), /Illegal Privilege/);
  const refilled = structuredClone(state);
  refilled.turnState.boardRefilled = true;
  assert.deepEqual(legalPrivilegeUses(refilled, 'player1'), []);
  assert.throws(() => applyPrivilegeUse(refilled, 'player1', [0, 0]), /Illegal Privilege/);
});

test('refill fills only empty spiral cells, empties bag, awards Privilege and prevents repeat/use', () => {
  const state = fixture([[2, 2, 'gold'], [3, 3, 'pearl'], [0, 0, 'red']]);
  state.players.player1.privileges = 1;
  state.scrollPool = 2;
  const order = freeze(randomOrder(state, mulberry32(77)));
  assert.equal(canRefill(freeze(state), 'player1'), true);
  const next = immutableTransition(state, value => applyRefill(value, 'player1', order));
  let index = 0;
  for (const [r, c] of spiralOrder()) {
    assert.equal(next.board[r][c], state.board[r][c] ?? order[index++]);
  }
  assert.ok(Object.values(next.bag).every(count => count === 0));
  assert.equal(next.turnState.boardRefilled, true);
  assert.equal(next.players.player2.privileges, 1);
  assert.equal(canRefill(next, 'player1'), false);
  assert.deepEqual(legalPrivilegeUses(next, 'player1'), []);
  assert.throws(() => applyRefill(next, 'player1', []), /Cannot refill/);
});

test('refill awards by transferring from actor when pool is empty, or does nothing at receiver cap', () => {
  for (const [actor, receiver] of [[3, 0], [0, 3]]) {
    const state = fixture();
    state.scrollPool = 0;
    state.players.player1.privileges = actor;
    state.players.player2.privileges = receiver;
    const next = immutableTransition(state, value => applyRefill(value, 'player1', randomOrder(value, mulberry32(3))));
    assert.equal(next.players.player2.privileges, Math.min(3, receiver + 1));
    assert.equal(next.players.player1.privileges, actor === 3 ? 2 : 0);
  }
});

test('refill rejects invalid chance outcomes and insufficient space without changing inputs', () => {
  const state = freeze(fixture());
  const order = randomOrder(state, mulberry32(2));
  for (const invalid of [null, [], order.slice(1), [...order, 'blue'], order.map(() => 'blue'), order.map(() => 'orange')]) {
    assert.throws(() => applyRefill(state, 'player1', invalid), /permutation/);
  }
  const impossible = structuredClone(state);
  impossible.board = Array.from({ length: 5 }, () => Array(5).fill('blue'));
  assert.throws(() => applyRefill(impossible, 'player1', order), /empty board cells/);
  const emptyBag = newGame(cards, mulberry32(1));
  assert.equal(canRefill(emptyBag, 'player1'), false);
  assert.throws(() => applyRefill(emptyBag, 'player1', []), /bag is empty/);
  const alreadyRefilled = structuredClone(state);
  alreadyRefilled.turnState.boardRefilled = true;
  assert.equal(canRefill(alreadyRefilled, 'player1'), false);
});

test('randomOrder is seeded, preserves bag multiset, and uses Fisher–Yates with validated rng', () => {
  const state = freeze(fixture());
  assert.deepEqual(randomOrder(state, mulberry32(123)), randomOrder(state, mulberry32(123)));
  assert.notDeepEqual(randomOrder(state, mulberry32(123)), randomOrder(state, mulberry32(124)));
  const initial = Object.entries(state.bag).flatMap(([color, count]) => Array(count).fill(color));
  assert.deepEqual(randomOrder(state, () => 0), [...initial.slice(1), initial[0]]);
  assert.deepEqual(randomOrder(state, () => 0.999), initial);
  assert.deepEqual(randomOrder(state, mulberry32(4)).sort(), initial.sort());
  for (const invalid of [-1, 1, NaN, Infinity, '0']) assert.throws(() => randomOrder(state, () => invalid), /\[0, 1\)/);
  assert.throws(() => randomOrder(state), /function/);
});

test('reserving player chooses a gold cell; other gold cells stay on board and no Privilege is awarded', () => {
  const state = fixture([[0, 0, 'gold'], [2, 2, 'gold'], [4, 4, 'gold'], [1, 1, 'blue']]);
  assert.deepEqual(goldCells(freeze(state.board)), [[0, 0], [2, 2], [4, 4]]);
  const next = immutableTransition(state, value => takeGoldFrom(value, 'player2', freeze([4, 4])));
  assert.equal(next.players.player2.tokens.gold, 1);
  assert.deepEqual(goldCells(next.board), [[0, 0], [2, 2]]);
  assert.equal(next.scrollPool, 3);
  for (const coord of [[1, 1], [3, 3], [5, 5], null]) assert.throws(() => takeGoldFrom(state, 'player2', coord), /gold choice/);
  assert.deepEqual(goldCells(emptyBoard()), []);
});
