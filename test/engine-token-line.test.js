import test from 'node:test';
import assert from 'node:assert/strict';
import { isStraightLine, legalTakeSelections } from '../src/engine/tokens.js';

function permutations(coords) {
  if (coords.length === 0) return [[]];
  return coords.flatMap((coord, index) =>
    permutations(coords.filter((_, other) => other !== index)).map(rest => [coord, ...rest]));
}

test('straight-line helper accepts every legal take in any order without mutation', () => {
  const board = Array.from({ length: 5 }, () => Array(5).fill('blue'));
  const selections = legalTakeSelections(board);
  assert.equal(selections.length, 145);
  for (const selection of selections) {
    for (const coords of permutations(selection)) {
      const before = structuredClone(coords);
      coords.forEach(Object.freeze);
      Object.freeze(coords);
      assert.equal(isStraightLine(coords), true, JSON.stringify(coords));
      assert.deepEqual(coords, before);
    }
  }
});

test('straight-line helper rejects bends, gaps, duplicates and malformed coordinates', () => {
  const invalid = [
    [[0, 0], [1, 2], [2, 2]],
    [[0, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [1, 1]],
    [[0, 0], [0, 2]], [[0, 0], [2, 2]],
    [[0, 0], [1, 1], [3, 3]],
    [[0, 0], [0, 0]], [[0, 0], [0, 1], [0, 1]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
    [[0.5, 0]], [['0', 0]], [[NaN, 0]], [[Infinity, 0]],
    [[-1, 0]], [[5, 0]], [[0]], [[0, 0, 0]], [null], [], null
  ];
  for (const coords of invalid) {
    assert.equal(isStraightLine(coords), false, JSON.stringify(coords));
    if (Array.isArray(coords)) {
      for (const permuted of permutations(coords)) assert.equal(isStraightLine(permuted), false);
    }
  }
});
