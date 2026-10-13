import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHint } from '../src/ai/hint.js';
import { hintBannerHtml } from '../src/ai/vs-computer.js';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { gameFromEngineState } from '../src/ai/bridge.js';
import { mulberry32 } from './helpers/rng.js';

test('hint simulates the human seat deterministically without changing the input', async () => {
  const game = gameFromEngineState(newGame(loadCards(), mulberry32(21), { firstPlayer: 1 }));
  const before = structuredClone(game);
  const first = await computeHint(game, { level: 1, rng: mulberry32(42) });
  assert.deepEqual(game.gameState, before.gameState);
  assert.deepEqual(game, before);
  assert.ok(first.lines.length);
  assert.ok(first.moves.length);
  assert.ok(first.lines.every(line => typeof line === 'string' && line.length));
  assert.deepEqual(await computeHint(game, { level: 6, rng: mulberry32(42) }), first);
  assert.deepEqual(game, before);
});

test('hint cancellation leaves the original game unchanged', async () => {
  const game = gameFromEngineState(newGame(loadCards(), mulberry32(21), { firstPlayer: 1 }));
  const before = structuredClone(game);
  const controller = new AbortController();
  const pending = computeHint(game, { level: 10, rng: mulberry32(42), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(game, before);
});

test('hint banner escapes suggestions and has distinct accessible dismissal', () => {
  assert.equal(hintBannerHtml([]), '');
  const html = hintBannerHtml(['<script>&"\'']);
  assert.match(html, /&lt;script&gt;&amp;&quot;&#39;/);
  assert.match(html, /ai-hint-summary/);
  assert.match(html, /aria-label="Hint suggestion"/);
  assert.match(html, /Dismiss hint/);
  assert.match(html, /Just a suggestion\./);
});
