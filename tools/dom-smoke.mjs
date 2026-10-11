// Run with: node tools/dom-smoke.mjs (uses the already installed jsdom).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import jsdom from 'jsdom';
import { checkInvariants } from '../src/engine/invariants.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { JSDOM, VirtualConsole } = jsdom;
const dist = '/tmp/splendor-smoke-dist';
const pages = [];
const errors = [];
const calls = [];
let failures = 0;
const watchdog = setTimeout(() => {
  console.error('FAIL timeout: smoke run exceeded 85 seconds');
  process.exit(1);
}, 85_000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, reason, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${reason}`);
    await delay(20);
  }
}
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
async function check(label, fn) {
  try { console.log(`PASS ${label}: ${await fn()}`); }
  catch (error) { failures++; console.log(`FAIL ${label}: ${error.message}`); }
}

// The single-file Vite bundle has no imports. jsdom does not execute modules;
// change only its script type in memory, leaving the built file untouched.
function openPage(html, name, url) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(`${name} console.error: ${inspect(args)}`));
  virtualConsole.on('jsdomError', error => errors.push(`${name} jsdomError: ${error.stack || error.message}`));
  let seed = 0x715c;
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true,
    resources: 'usable', virtualConsole,
    beforeParse(window) {
      // Identical startup randomness lets us compare the two page layouts.
      window.Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      window.fetch = async () => ({ ok: false, status: 503, json: async () => ({ status: 'offline' }) });
      window.crypto.randomUUID ??= randomUUID;
      window.structuredClone ??= structuredClone;
      window.matchMedia = query => ({ matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = (...args) => calls.push({ name, type: 'scrollTo', args });
      window.alert = (...args) => calls.push({ name, type: 'alert', args });
      window.confirm = (...args) => { calls.push({ name, type: 'confirm', args }); return true; };
      window.addEventListener('error', event => errors.push(`${name} window.error: ${event.error?.stack || event.message}`));
      window.addEventListener('unhandledrejection', event => errors.push(`${name} rejection: ${inspect(event.reason)}`));
    }
  });
  pages.push(dom);
  return dom.window;
}
const stateOf = window => window.__splendorDebugState().gameState;
function invariants(window) {
  const violations = checkInvariants(stateOf(window));
  requireThat(!violations.length, violations.join('; '));
}
function humanView(window) {
  // Compare actual rendered gem counts to player1, making a view flip visible.
  const player = stateOf(window).players.player1;
  for (const color of ['blue', 'white', 'green', 'red', 'black']) {
    const count = window.document.querySelectorAll(`#player-hand .color-card.${color} .hand-token`).length;
    requireThat(count === player.tokens[color], `human hand ${color}: rendered ${count}, player1 owns ${player.tokens[color]}`);
  }
  requireThat(window.document.querySelector('#player-hand #show-reserved .reserved-count')?.textContent === String(player.reserves.length), 'human reserve count/view changed');
}
async function aiFinished(window) {
  await until(() => stateOf(window).currentPlayer === 1 && !window.document.querySelector('.ai-thinking'), 'AI returns control to player1');
  requireThat(window.document.querySelector('.ai-summary'), 'computer summary banner missing');
  // renderGame attaches event listeners on a later timer.
  await until(() => window.document.querySelector('#switch-players-btn')?._handlerAttached, 'turn listeners attached');
  invariants(window);
  humanView(window);
}
function comparableLayout(window) {
  const app = window.document.querySelector('#app').cloneNode(true);
  app.querySelector('[onclick="window.showComputerLevelPicker()"]')?.remove();
  app.querySelector('#ai-level-picker')?.remove();
  app.querySelector('#mode-selection-modal')?.removeAttribute('style');
  app.querySelector('.game-container')?.classList.remove('dialog-blocking');
  return app.innerHTML;
}

try {
  console.log('PASS install: jsdom already installed; no npm install or network used');
  const built = await promisify(execFile)('npx', ['--no-install', 'vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, timeout: 30_000 });
  requireThat(!built.stderr.includes('error'), built.stderr);
  console.log(`PASS build: Vite output in ${dist}`);
  const original = await readFile(`${dist}/index.html`, 'utf8');
  requireThat(/<script\b[^>]*type="module"/.test(original), 'expected bundled module script');
  const html = original.replace(/(<script\b[^>]*\btype=)"module"/g, '$1"text/javascript"');
  const beta = openPage(html, 'beta', 'https://danieldailey.com/splendor_duel/index.html?debug');
  await until(() => beta.document.querySelector('.game-container'), 'beta page initialization');
  await check('(a) mode dialog', async () => {
    await until(() => beta.document.querySelector('#mode-selection-modal')?.style.display === 'flex', 'mode dialog shown');
    requireThat([...beta.document.querySelectorAll('#mode-selection-modal button')].some(b => b.textContent === 'Play vs Computer'), 'Play vs Computer missing');
    return 'visible dialog includes Play vs Computer';
  });
  await check('(b) kill switch and debug hook gating', async () => {
    const off = openPage(html, 'noai', 'https://danieldailey.com/splendor_duel/index.html?noai');
    await until(() => off.document.querySelector('.game-container'), 'noai page initialization');
    await delay(550);
    requireThat(![...off.document.querySelectorAll('button')].some(b => b.textContent === 'Play vs Computer'), 'computer button present despite ?noai');
    const plain = openPage(html, 'plain', 'https://danieldailey.com/splendor_duel/index.html');
    await until(() => plain.document.querySelector('.game-container'), 'plain page initialization');
    await delay(550);
    requireThat([...plain.document.querySelectorAll('button')].some(b => b.textContent === 'Play vs Computer'), 'computer button missing on the plain page');
    requireThat(!plain.__splendorDebugState, 'debug hook present without ?debug');
    requireThat(Boolean(beta.__splendorDebugState), 'debug hook missing with ?debug');
    return '?noai removes the button; debug hook only with ?debug';
  });
  await check('(c) startVsComputer(3)/human view', async () => {
    beta.startVsComputer(3);
    requireThat(beta.document.querySelector('.game-container'), 'game not rendered');
    humanView(beta);
    if (stateOf(beta).currentPlayer === 2) await aiFinished(beta);
    invariants(beta);
    humanView(beta);
    return 'level 3 game rendered; bottom hand remains player1 across AI handoff';
  });
  await check('(d) computer starts first', async () => {
    await until(() => !beta.document.querySelector('.ai-thinking'), 'previous AI finishes');
    for (let attempt = 1; attempt <= 20; attempt++) {
      beta.startVsComputer(3);
      if (stateOf(beta).currentPlayer !== 2) continue;
      await aiFinished(beta);
      return `AI first on attempt ${attempt}; scheduled turn finished, player1 control, all invariants and summary verified`;
    }
    throw new Error('AI never started first in 20 attempts');
  });
  await check('(e) human DOM turn and AI reply', async () => {
    await until(() => stateOf(beta).currentPlayer === 1 && !beta.document.querySelector('.ai-thinking'), 'human turn');
    await delay(150);
    const before = structuredClone(stateOf(beta));
    // A singleton is a legal row/column take. Choose a gem so hand identity is
    // visible, without triggering pearl/matching-three Privilege decisions.
    let cell;
    for (let row = 0; row < 5 && !cell; row++) for (let col = 0; col < 5 && !cell; col++) {
      const color = before.board[row][col];
      if (color && color !== 'gold' && color !== 'pearl') cell = { row, col, color };
    }
    requireThat(cell, 'no legal gem take found');
    const trigger = beta.document.querySelector('[data-popover="token-selection-modal"]');
    requireThat(trigger, 'token modal trigger missing');
    trigger.click();
    await delay(150);
    const overlay = beta.document.querySelector(`.token-overlay[data-row="${cell.row}"][data-col="${cell.col}"]`);
    requireThat(overlay?._clickHandler, 'token overlay listener missing');
    overlay.click();
    beta.document.querySelector('#token-selection-modal .btn-confirm').click();
    requireThat(stateOf(beta).players.player1.tokens[cell.color] === before.players.player1.tokens[cell.color] + 1, 'confirm did not transfer selected gem to player1');
    humanView(beta);
    invariants(beta);
    await until(() => beta.document.querySelector('#turn-completion-dialog')?.style.display === 'flex', 'turn completion dialog shown');
    await until(() => beta.document.querySelector('#switch-players-btn')?._handlerAttached, 'completion control listener');
    beta.document.querySelector('#switch-players-btn').click();
    requireThat(stateOf(beta).currentPlayer === 2, 'end-turn control did not schedule AI');
    humanView(beta);
    await aiFinished(beta);
    requireThat(JSON.stringify(stateOf(beta).players.player2) !== JSON.stringify(before.players.player2), 'AI player state did not change');
    return `real DOM: open board, click (${cell.row},${cell.col}) ${cell.color}, Confirm, finish turn; AI replied and player1 view/control retained`;
  });
} catch (error) {
  failures++;
  console.log(`FAIL setup: ${error.stack || error.message}`);
} finally {
  await check('console/errors', async () => {
    requireThat(errors.length === 0, errors.join('\n'));
    return '0 window errors, unhandled rejections, console.error calls, or jsdom errors';
  });
  await check('alerts', async () => {
    const alerts = calls.filter(call => call.type === 'alert');
    requireThat(!alerts.length, inspect(alerts));
    return `0 alert calls; ${calls.filter(call => call.type === 'confirm').length} confirm calls recorded`;
  });
  for (const dom of pages) dom.window.close();
  clearTimeout(watchdog);
  console.log('LIMIT: jsdom checks DOM/handlers, not visual layout, real SVG hit-testing, browser modules, service workers, or online GameSync.');
  console.log(`SUMMARY: ${failures} failed checks`);
  process.exitCode = failures ? 1 : 0;
}
