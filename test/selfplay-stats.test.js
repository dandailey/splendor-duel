import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eloFromScore, summarize, sprt } from '../tools/lib/stats.mjs';
import { main } from '../tools/selfplay.mjs';

async function cli(args) {
  const lines = [];
  await main(args, line => lines.push(line));
  return { stdout: lines.join('\n') };
}

test('logistic Elo gives about +191 for a 75% score', () => {
  assert.ok(Math.abs(eloFromScore(0.75) - 190.8485) < 0.001);
  const stats = summarize(75, 0, 25);
  assert.equal(stats.scorePercent, 75);
  assert.equal(stats.elo, eloFromScore(0.75));
  assert.ok(stats.ci95[0] < stats.elo && stats.elo < stats.ci95[1]);
});

test('normal CI is symmetric at equal scores and under seat reversal', () => {
  const equal = summarize(40, 20, 40);
  assert.equal(equal.elo, 0);
  assert.ok(Math.abs(equal.ci95[0] + equal.ci95[1]) < 1e-10);
  const a = summarize(70, 20, 10);
  const b = summarize(10, 20, 70);
  assert.ok(Math.abs(a.elo + b.elo) < 1e-10);
  assert.ok(Math.abs(a.ci95[0] + b.ci95[1]) < 1e-10);
  assert.ok(Math.abs(a.ci95[1] + b.ci95[0]) < 1e-10);
});

test('100% and 0% scores use finite symmetric continuity corrections', () => {
  const a = summarize(10, 0, 0);
  const b = summarize(0, 0, 10);
  assert.equal(a.score, 1);
  assert.equal(a.elo, eloFromScore(10.5 / 11));
  assert.ok([a.elo, ...a.ci95, b.elo, ...b.ci95].every(Number.isFinite));
  assert.ok(Math.abs(a.elo + b.elo) < 1e-10);
  assert.ok(a.ci95[0] <= a.elo && a.ci95[1] >= a.elo);
  assert.throws(() => summarize(0, 0, 0), RangeError);
  assert.throws(() => summarize(-1, 0, 1), RangeError);
});

test('trinomial SPRT continues without data and stops for strong evidence', () => {
  const empty = sprt(0, 0, 0, 0, 10);
  assert.equal(empty.llr, 0);
  assert.equal(empty.decision, 'continue');
  assert.ok(Math.abs(empty.upper - Math.log(19)) < 1e-12);
  assert.equal(sprt(1000, 0, 0, 0, 10).decision, 'acceptH1');
  assert.equal(sprt(0, 0, 1000, 0, 10).decision, 'acceptH0');
  assert.equal(sprt(0, 1000, 0, -10, 10).decision, 'continue');
  assert.throws(() => sprt(1, 0, 0, 10, 0), RangeError);
});

test('four L2 vs random CLI games produce a summary and deterministic worker results', { timeout: 59000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selfplay-test-'));
  try {
    const args = ['--a', '2', '--b', 'random', '--games', '4', '--max-turns', '600', '--seed', '1'];
    const serialPath = join(dir, 'serial.json');
    const serial = await cli([...args, '--json', serialPath]);
    assert.match(serial.stdout, /Summary: 4 games; L2 vs random: wins A \d+ \/ wins B \d+ \/ draws \d+; score A [\d.]+%; Elo/);
    assert.match(serial.stdout, /95% CI .*avg turns/);
    assert.match(serial.stdout, /Mean ms\/decision: .*L2/);
    const a = JSON.parse(await readFile(serialPath, 'utf8'));
    assert.equal(a.games, 4);
    assert.equal(a.winsA + a.winsB + a.draws, 4);
    assert.ok(a.averageTurns > 0 && a.averageTurns <= 600);
    assert.ok(a.meanMsPerDecision['2'] >= 0 && a.meanMsPerDecision.random >= 0);
    const parallelPath = join(dir, 'parallel.json');
    await cli([...args, '--workers', '2', '--json', parallelPath]);
    const b = JSON.parse(await readFile(parallelPath, 'utf8'));
    for (const key of ['winsA', 'winsB', 'draws', 'elo', 'ci95', 'averageTurns']) assert.deepEqual(a[key], b[key]);
    const cutoffPath = join(dir, 'cutoff.json');
    await cli(['--a', 'random', '--b', 'random', '--games', '2', '--max-turns', '1', '--json', cutoffPath]);
    const cutoff = JSON.parse(await readFile(cutoffPath, 'utf8'));
    assert.equal(cutoff.draws, 2);
    assert.equal(cutoff.averageTurns, 1);
    const stoppedPath = join(dir, 'stopped.json');
    await cli(['--a', 'random', '--b', 'random', '--games', '12', '--max-turns', '1',
      '--workers', '2', '--sprt', '-1000', '-900', '--json', stoppedPath]);
    const stopped = JSON.parse(await readFile(stoppedPath, 'utf8'));
    assert.equal(stopped.games, 6);
    assert.equal(stopped.sprt.decision, 'acceptH1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
