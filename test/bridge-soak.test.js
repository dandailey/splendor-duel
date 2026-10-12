import test from 'node:test';
import assert from 'node:assert/strict';
import { runSoak, parseArgs } from '../tools/bridge-soak.mjs';

test('six seeded games survive the complete live bridge and JSON path at levels 1 and 3', async () => {
  const summary = await runSoak(parseArgs(['--games', '6', '--seed', '19', '--levels', '1,3', '--workers', '2']));
  assert.equal(summary.games, 6);
  assert.equal(summary.finished, 6, JSON.stringify(summary.results.filter(result => result.failure)));
  assert.ok(Object.values(summary.failures).every(count => count === 0));
  assert.ok(summary.averageTurns > 0 && summary.averageTurns <= 400);
  assert.deepEqual(Object.keys(summary.meanMsPerTurn), ['1', '3']);
  assert.ok(summary.results.every(result => result.aiTurns > 0));
});

test('turn limit failures produce replayable blobs and continue to the next game', async t => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const reproDir = await mkdtemp(join(tmpdir(), 'bridge-soak-'));
  t.after(() => rm(reproDir, { recursive: true, force: true }));
  const config = parseArgs(['--games', '2', '--seed', '100', '--levels', '1', '--max-turns', '1', '--workers', '9']);
  assert.equal(config.workers, 2);
  const summary = await runSoak({ ...config, reproDir });
  assert.equal(summary.games, 2);
  assert.equal(summary.finished, 0);
  assert.equal(summary.failures['max-turns'], 2);
  for (const seed of [100, 101]) {
    const repro = JSON.parse(await readFile(join(reproDir, `soak-fail-${seed}.json`), 'utf8'));
    assert.equal(repro.seed, seed);
    assert.deepEqual(repro.levels, [1, 1]);
    assert.equal(repro.turnIndex, 1);
    assert.equal(repro.blobBeforeTurn.turnHistory.nextTurnId, 2);
    assert.ok(Number.isInteger(repro.rngSeed));
  }
});
