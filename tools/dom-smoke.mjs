// Run with: node tools/dom-smoke.mjs (uses the already installed jsdom).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { VS_COMPUTER_SAVE_KEY } from '../src/ai/vs-computer-save.js';
import { inspect } from 'node:util';
import jsdom from 'jsdom';
import { checkInvariants } from '../src/engine/invariants.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const shellResources = new Map();
const localResources = {
  interceptors: [requestInterceptor(request => {
    const body = shellResources.get(request.url);
    if (!body) throw new Error(`Unexpected resource request: ${request.url}`);
    return new Response(body, { headers: {
      'Content-Type': request.url.endsWith('.css') ? 'text/css' : 'text/javascript'
    } });
  })]
};
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

// The app bundle has no imports. jsdom does not execute modules;
// change only its script type in memory and serve JS/CSS from the local build.
function openPage(html, name, url, storage = {}, fetchImpl = null, configureWindow = null) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...args) => errors.push(`${name} console.error: ${inspect(args)}`));
  virtualConsole.on('jsdomError', error => errors.push(`${name} jsdomError: ${error.stack || error.message}`));
  let seed = 0x715c;
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true,
    resources: localResources, virtualConsole,
    beforeParse(window) {
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
      // Identical startup randomness lets us compare the two page layouts.
      window.Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      window.fetch = fetchImpl || (async () => ({ ok: false, status: 503, json: async () => ({ status: 'offline' }) }));
      window.crypto.randomUUID ??= randomUUID;
      window.structuredClone ??= structuredClone;
      window.matchMedia = query => ({ matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      configureWindow?.(window);
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
const copyStorage = window => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => {
  const key = window.localStorage.key(i);
  return [key, window.localStorage.getItem(key)];
}));
const plainState = window => JSON.parse(JSON.stringify(window.__splendorDebugState()));
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
  requireThat(window.document.querySelector('#turn-completion-dialog')?.style.display === 'flex', 'computer recap overlay missing');
  requireThat(window.document.querySelector('#turn-summary-list .turn-event-row'), 'computer recap actions missing');
  requireThat(!window.document.querySelector('.ai-summary'), 'duplicate computer banner');
  // renderGame attaches event listeners on a later timer.
  await until(() => window.document.querySelector('#switch-players-btn')?._handlerAttached, 'turn listeners attached');
  invariants(window);
  humanView(window);
}
function comparableLayout(window) {
  const app = window.document.querySelector('#app').cloneNode(true);
  app.querySelector('[data-action="showComputerLevelPicker"]')?.remove();
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
  for (const asset of ['assets/app.js', 'assets/app.css']) {
    shellResources.set(`https://danieldailey.com/splendor_duel/${asset}`, await readFile(`${dist}/${asset}`));
  }
  requireThat(/<script\b[^>]*type="module"/.test(original), 'expected bundled module script');
  const html = original.replace(/(<script\b[^>]*\btype=)"module"/g, '$1"text/javascript"');
  const beta = openPage(html, 'beta', 'https://danieldailey.com/splendor_duel/index.html?debug');
  await until(() => beta.document.querySelector('.game-container'), 'beta page initialization');
  await check('delegated settings open/close', async () => {
    beta.document.querySelector('[data-action="closeModeSelection"]').click();
    beta.document.querySelector('#settings-btn').click();
    const modal = beta.document.querySelector('#settings-modal');
    requireThat(modal.style.display === 'flex', 'settings did not open');
    modal.querySelector('[data-action="closeSettings"]').click();
    requireThat(modal.style.display === 'none', 'settings did not close');
    beta.showModeSelection();
    return 'converted settings buttons open and close the modal';
  });
  await check('Web Push Settings dark gate', async () => {
    for (const status of [404, 200]) {
      let vapidCalls = 0;
      const page = openPage(html, `webpush-${status}`, 'https://danieldailey.com/splendor_duel/index.html?debug', {},
        async url => {
          if (new URL(url).searchParams.get('action') === 'vapid_public_key') {
            vapidCalls++;
            return { status, json: async () => status === 200
              ? { public_key: Buffer.from([4, ...new Array(64).fill(1)]).toString('base64url') }
              : { error: 'push_disabled' } };
          }
          return { ok: false, status: 503, json: async () => ({ status: 'offline' }) };
        }, window => {
          window.matchMedia = query => ({ matches: query === '(display-mode: standalone)',
            addEventListener() {}, removeEventListener() {} });
          window.PushManager = function () {};
          window.Notification = { permission: 'default', requestPermission: async () => 'granted' };
          Object.defineProperty(window.navigator, 'serviceWorker', { value: {
            register: async () => ({}), ready: Promise.resolve({ pushManager: { getSubscription: async () => null } })
          } });
        });
      await until(() => page.document.querySelector('.game-container'), 'web push initialization');
      requireThat(vapidCalls === 0, 'VAPID check must be lazy');
      page.document.querySelector('[data-action="closeModeSelection"]').click();
      page.document.querySelector('#settings-btn').click();
      await until(() => vapidCalls === 1, 'lazy VAPID request');
      if (status === 200) {
        await until(() => page.document.querySelector('#native-push-status')?.textContent === 'Push is off', 'web push controls');
        requireThat(page.document.querySelector('#settings-content').textContent.includes("Your device's push address is stored on the game server."), 'privacy copy missing');
        requireThat(!page.document.querySelector('#settings-content [data-action="enableTurnNotifications"]'), 'old controls still shown');
      } else {
        await delay(50);
        requireThat(!page.document.querySelector('#native-push-button'), '404 must keep web push dark');
        requireThat(page.document.querySelector('#settings-content [data-action="enableTurnNotifications"]'), 'browser fallback missing');
      }
      page.document.querySelector('[data-action="closeSettings"]').click();
    }
    return 'installed PWA checks lazily; VAPID 200 reveals controls and 404 preserves fallback';
  });
  await check('online Nudge with fake GameSync', async () => {
    const fixture = plainState(beta);
    fixture.turnDisplayState = { activePlayerId: 'player2', opponentPlayerId: 'player1' };
    fixture.gameState.currentPlayer = 1;
    fixture.gameState.syncAssignments = { player1Id: 'fake-opponent', player2Id: 'fake-nudger' };
    fixture.gameState.players.player1.name = 'Alex';
    const session = { session_id: 'nudge-smoke', version: 1, state_blob: JSON.stringify(fixture), meta: {} };
    let nudges = 0;
    let reply = { status: 429, headers: { get: key => key.toLowerCase() === 'retry-after' ? '14400' : null },
      json: async () => ({ error: 'rate_limited' }) };
    const fakeFetch = async (url, options) => {
      const action = new URL(url).searchParams.get('action');
      if (action === 'nudge') {
        nudges++;
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(options.body), { actor_id: 'fake-nudger', game_type: 'splendor_duel', session_id: 'nudge-smoke' });
        return reply;
      }
      return { ok: true, status: 200, json: async () => action === 'status' ? { status: 'operational' } : session };
    };
    const online = openPage(html, 'nudge-online', 'https://danieldailey.com/splendor_duel/index.html?debug&session=nudge-smoke',
      { splendor_duel_client_id: 'fake-nudger' }, fakeFetch);
    const button = () => online.document.querySelector('#sync-nudge-btn');
    await until(() => button() && !button().hidden, 'waiting Nudge appears');
    requireThat(online.document.querySelector('#sync-turn-indicator').textContent === 'Waiting on opponent', 'not waiting');
    requireThat(button().getAttribute('aria-label') === 'Nudge opponent', 'accessible label missing');
    requireThat(nudges === 0, 'Nudge auto-fired');
    button().click();
    requireThat(button().disabled, 'in-flight button enabled');
    await until(() => button().textContent === 'Nudge in 4h 00m', '429 countdown appears');
    requireThat(button().disabled && nudges === 1, 'rate limit did not disable button');
    button().click();
    requireThat(nudges === 1, 'disabled Nudge sent twice');
    const deadline = Number(online.localStorage.getItem('splendor_duel_nudge_deadline:nudge-smoke'));
    requireThat(deadline > online.Date.now(), 'deadline not persisted');
    await until(() => button().textContent === 'Nudge in 3h 59m', 'countdown ticks each second', 2500);
    const restored = openPage(html, 'nudge-restored', 'https://danieldailey.com/splendor_duel/index.html?debug&session=nudge-smoke',
      copyStorage(online), fakeFetch);
    await until(() => restored.document.querySelector('#sync-nudge-btn')?.textContent.startsWith('Nudge in '), 'persisted cooldown restored');
    requireThat(restored.document.querySelector('#sync-nudge-btn').disabled && nudges === 1, 'restored cooldown enabled or auto-fired');
    restored.close();
    const realNow = online.Date.now;
    online.Date.now = () => deadline + 1;
    online.updateSyncIndicator();
    requireThat(!button().disabled && button().textContent === 'Nudge', 'expired cooldown did not enable');
    reply = { status: 200, json: async () => ({ ok: true, next_allowed_in: 0, reachable: false, remaining_today: 0 }) };
    button().click();
    await until(() => online.document.querySelector('#sync-nudge-message').textContent === 'Nudged Alex. They have not turned on notifications.', 'success message');
    requireThat(!button().disabled, 'client imposed a quota limit');
    online.Date.now = realNow;
    const state = stateOf(online);
    state.currentPlayer = 2;
    online.updateSyncIndicator();
    requireThat(button().hidden, 'Nudge visible on own turn');
    state.currentPlayer = 1;
    state.gameOver.winnerId = 'player1';
    online.updateSyncIndicator();
    requireThat(button().hidden, 'Nudge visible after game over');
    state.gameOver.winnerId = null;
    state.syncAssignments.player1Id = null;
    online.updateSyncIndicator();
    requireThat(button().hidden, 'Nudge visible without seated opponent');
    online.selectLocalMode();
    online.updateSyncIndicator();
    requireThat(button().hidden, 'Nudge visible locally');
    return 'waiting button, explicit POST, 429 four-hour countdown/storage, expiry, 200 unreachable message; hidden on own turn/game over/empty seat/local';
  });
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
  await check('token straight-line regression', async () => {
    const local = openPage(html, 'token-lines', 'https://danieldailey.com/splendor_duel/index.html?debug');
    await until(() => local.document.querySelector('#mode-selection-modal')?.style.display === 'flex', 'local mode dialog');
    local.selectLocalMode();
    const state = stateOf(local);
    // Return the old board to the bag, then create a token-conserving fixture.
    state.board.forEach(row => row.forEach(color => { if (color) state.bag[color]++; }));
    state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
    for (const [row, col, color] of [[0, 0, 'blue'], [1, 2, 'red'], [2, 2, 'green'], [1, 1, 'white'], [2, 0, 'black']]) {
      state.board[row][col] = color;
      state.bag[color]--;
    }
    local.document.querySelector('[data-popover="token-selection-modal"]').click();
    await until(() => local.document.querySelector('.token-overlay[data-row="0"][data-col="0"]')?._clickHandler, 'token listeners');
    const clickCell = (row, col) => {
      const overlay = local.document.querySelector(`.token-overlay[data-row="${row}"][data-col="${col}"]`);
      requireThat(overlay?._clickHandler, `missing listener at (${row},${col})`);
      overlay.click();
    };
    const hasError = () => {
      const error = local.document.querySelector('#token-selection-error');
      return Boolean(error && error.style.display !== 'none');
    };
    const confirm = () => local.document.querySelector('#token-selection-modal .btn-confirm').click();
    const before = JSON.stringify(state);
    clickCell(0, 0);
    requireThat(!hasError(), 'singleton incorrectly flagged');
    clickCell(1, 2);
    requireThat(!hasError(), 'gapped partial selection must not be flagged mid-selection');
    clickCell(2, 2);
    requireThat(hasError(), 'endpoint-only bent triple not flagged');
    confirm();
    requireThat(JSON.stringify(state) === before, 'bent Confirm changed game state');
    requireThat(local.document.querySelector('#token-selection-error')?.textContent === 'Tokens must be adjacent and in a straight line', 'existing straight-line error message missing');
    clickCell(1, 2); // Remove the bend, leaving two separated endpoints.
    clickCell(2, 2);
    clickCell(1, 1);
    requireThat(!hasError(), 'adjacent diagonal pair incorrectly flagged');
    clickCell(2, 0);
    requireThat(hasError(), 'non-collinear third token not flagged');
    confirm();
    requireThat(JSON.stringify(state) === before, 'incremental bend Confirm changed game state');
    clickCell(2, 0);
    requireThat(!hasError(), 'deselecting bend did not clear error');
    clickCell(2, 2);
    requireThat(!hasError(), 'straight diagonal triple incorrectly flagged');
    const playerId = state.currentPlayer === 1 ? 'player1' : 'player2';
    const tokens = { ...state.players[playerId].tokens };
    confirm();
    for (const [row, col, color] of [[0, 0, 'blue'], [1, 1, 'white'], [2, 2, 'green']]) {
      requireThat(state.board[row][col] === null, 'straight Confirm did not clear board cell');
      requireThat(state.players[playerId].tokens[color] === tokens[color] + 1, 'straight Confirm did not transfer token');
    }
    requireThat(state.board[1][2] === 'red' && state.board[2][0] === 'black', 'bent cells were taken');
    invariants(local);
    return 'bent triples flagged during selection and rejected on Confirm; adjacent pair grows into accepted straight diagonal';
  });
  // Drive the live purchase/ability/Royal/discard callbacks through real DOM
  // controls. Each fixture starts with ten tokens and a free one-crown card.
  for (const scenario of [
    { name: 'Royal steal after card token', crowns: 2, ability: 'token', royal: 'steal', excess: 2 },
    { name: 'Royal steal from exactly ten', crowns: 2, ability: null, royal: 'steal', excess: 1 },
    { name: 'six-crown Royal scroll', crowns: 5, ability: 'token', royal: 'scroll', excess: 1 },
    { name: 'Royal extra turn', crowns: 2, ability: 'token', royal: 'again', excess: 1 },
    { name: 'Royal victory before extra turn', crowns: 2, ability: 'token', royal: 'again', excess: 1, victory: true },
    { name: 'no Royal control', crowns: 0, ability: 'token', royal: null, excess: 1 }
  ]) await check(`completion order: ${scenario.name}`, async () => {
    const local = openPage(html, scenario.name, 'https://danieldailey.com/splendor_duel/index.html?debug');
    await until(() => local.document.querySelector('#mode-selection-modal')?.style.display === 'flex', 'local mode dialog');
    local.selectLocalMode();
    const { gameState: state, previousCrownCounts } = local.__splendorDebugState();
    const playerId = state.currentPlayer === 1 ? 'player1' : 'player2';
    const otherId = playerId === 'player1' ? 'player2' : 'player1';
    const player = state.players[playerId];
    // Redistribute the existing tokens so supply remains conserved.
    state.board.forEach(row => row.forEach(color => { if (color) state.bag[color]++; }));
    state.board = Array.from({ length: 5 }, () => Array(5).fill(null));
    const grant = (owner, color, count) => {
      state.bag[color] -= count;
      owner.tokens[color] += count;
    };
    for (const color of ['blue', 'white', 'green', 'red', 'black']) grant(player, color, 2);
    grant(state.players[otherId], 'pearl', 1);
    state.board[0][0] = 'blue';
    state.bag.blue--;
    const crownCard = state.decks.level1.shift();
    Object.assign(crownCard, { crowns: scenario.crowns, points: 0, color: 'red', ability: null });
    player.cards.push(crownCard);
    if (scenario.victory) {
      crownCard.points = 9;
      const pointsCard = state.decks.level1.shift();
      Object.assign(pointsCard, { crowns: 0, points: 9, color: 'white', ability: null });
      player.cards.push(pointsCard);
    }
    previousCrownCounts[playerId] = scenario.crowns;
    const buyCard = state.decks.level3.shift();
    Object.assign(buyCard, { crowns: 1, points: 0, color: 'blue', ability: scenario.ability,
      costs: { white: 0, blue: 0, green: 0, red: 0, black: 0, pearl: 0 } });
    player.reserves.push(buyCard);
    const total = () => Object.values(player.tokens).reduce((sum, count) => sum + count, 0);
    const visible = id => local.document.getElementById(id)?.style.display === 'flex';
    let discardOffers = 0;
    const countOffers = records => {
      // Each showTokenDiscardModal call populates this grid once, including
      // calls on nodes that renderGame subsequently replaces.
      discardOffers += records.filter(record => record.target.id === 'token-discard-grid' && record.addedNodes.length).length;
    };
    const observer = new local.MutationObserver(countOffers);
    observer.observe(local.document.querySelector('#app'), { childList: true, subtree: true });
    const flushOffers = () => countOffers(observer.takeRecords());
    try {
      local.document.querySelector('#show-reserved').click();
      local.document.querySelector('#reserved-modal .buy-button').click();
      const buy = local.document.querySelector('#card-detail-popover .buy-button');
      requireThat(buy && !buy.disabled, 'fixture card is not purchasable');
      buy.click();
      if (scenario.ability === 'token') {
        requireThat(visible('confirmation-modal'), 'purchase token-limit warning missing');
        local.document.querySelector('#confirmation-confirm-btn').click();
        requireThat(visible('token-selection-modal'), 'card ability must precede Royal/discard');
        requireThat(!visible('royal-modal') && !visible('token-discard-modal'), 'completion ran before card ability');
        await until(() => local.document.querySelector('.token-overlay[data-row="0"][data-col="0"]')?._clickHandler, 'bonus token listener');
        local.document.querySelector('.token-overlay[data-row="0"][data-col="0"]').click();
        local.document.querySelector('#token-selection-modal .btn-confirm').click();
        requireThat(visible('confirmation-modal'), 'bonus-token warning missing');
        local.document.querySelector('#confirmation-confirm-btn').click();
      }
      requireThat(player.cards.some(card => card.id === buyCard.id), 'buy did not acquire card');
      if (scenario.royal) {
        requireThat(visible('royal-modal'), 'Royal selection must appear before discard');
        flushOffers();
        requireThat(discardOffers === 0 && !visible('token-discard-modal'), 'discard offered before Royal');
        const royal = state.royalCards.find(card => card.ability === scenario.royal);
        const privileges = player.privileges;
        local.document.querySelector(`#royal-modal [data-card-id="${royal.id}"] .card`).click();
        local.document.querySelector('#royal-modal-body button').click();
        requireThat(royal.taken && player.cards.some(card => card.id === royal.id), 'Royal not claimed');
        if (scenario.royal === 'steal') {
          requireThat(visible('steal-token-modal') && !visible('token-discard-modal'), 'discard preceded Royal steal');
          local.document.querySelector('.steal-token-option[data-color="pearl"]').click();
          local.document.querySelector('#confirm-steal-token-btn').click();
          requireThat(player.tokens.pearl === 1 && state.players[otherId].tokens.pearl === 0, 'Royal steal did not transfer pearl');
        } else if (scenario.royal === 'scroll') {
          requireThat(player.privileges === privileges + 1, 'Royal scroll ability not resolved');
        } else {
          requireThat(state.turnState.extraTurnsPending === 1, 'Royal extra turn not queued');
          requireThat(!visible('repeat-turn-dialog'), 'extra turn offered before discard');
        }
      } else requireThat(!visible('royal-modal'), 'control unexpectedly offered a Royal');
      requireThat(visible('token-discard-modal'), 'discard missing after abilities');
      requireThat(!state.gameOver.winnerId && !visible('victory-modal'), 'victory checked before discard');
      requireThat(total() === 10 + scenario.excess, `wrong token total before discard: ${total()}`);
      requireThat(local.document.querySelector('#token-discard-message').textContent.includes(`Select ${scenario.excess} token`), 'wrong excess in discard prompt');
      flushOffers();
      requireThat(discardOffers === 1, `expected one discard offer, got ${discardOffers}`);
      for (const token of [...local.document.querySelectorAll('.token-discard-item')].slice(0, scenario.excess)) token.click();
      requireThat(!local.document.querySelector('#confirm-discard-btn').disabled, 'exact excess selection did not enable Confirm');
      local.document.querySelector('#confirm-discard-btn').click();
      flushOffers();
      requireThat(total() === 10 && discardOffers === 1 && !visible('token-discard-modal'), 'discard repeated or final total is not ten');
      const completion = scenario.victory ? 'victory-modal' : scenario.royal === 'again' ? 'repeat-turn-dialog' : 'turn-completion-dialog';
      requireThat(visible(completion), 'completion missing after discard');
      if (scenario.victory) requireThat(state.gameOver.winnerId === playerId && !visible('repeat-turn-dialog'), 'victory must precede queued extra turn');
      requireThat(state.currentPlayer === (playerId === 'player1' ? 1 : 2), 'handoff occurred before completion confirmation');
      invariants(local);
      return `abilities → ${scenario.royal ? 'Royal/ability → ' : ''}one discard of ${scenario.excess} → ${scenario.victory ? 'victory' : scenario.royal === 'again' ? 'extra turn' : 'completion'}; final total 10`;
    } finally {
      observer.disconnect();
    }
  });
  await check('(c) startVsComputer(3)/human view', async () => {
    beta.startVsComputer(3);
    beta.updateSyncIndicator();
    requireThat(beta.document.querySelector('#sync-nudge-btn')?.hidden, 'Nudge visible vs Computer');
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
      requireThat(!beta.document.querySelector('#hint-btn'), 'Hint visible while computer busy');
      await aiFinished(beta);
      return `AI first on attempt ${attempt}; scheduled turn finished, player1 control, all invariants and summary verified`;
    }
    throw new Error('AI never started first in 20 attempts');
  });
  await check('Hint preview is isolated and dismissible', async () => {
    const local = openPage(html, 'hint-local', 'https://danieldailey.com/splendor_duel/index.html?debug');
    await until(() => local.document.querySelector('.game-container'), 'local hint page');
    local.selectLocalMode();
    requireThat(!local.document.querySelector('#hint-btn'), 'Hint visible in local mode');
    const hint = openPage(html, 'hint-computer', 'https://danieldailey.com/splendor_duel/index.html?debug');
    await until(() => hint.document.querySelector('.game-container'), 'hint computer page');
    hint.startVsComputer(3);
    if (stateOf(hint).currentPlayer === 2) await aiFinished(hint);
    await until(() => stateOf(hint).currentPlayer === 1 && !hint.document.querySelector('.ai-thinking'), 'hint human turn');
    await until(() => hint.document.querySelector('#switch-players-btn')?._handlerAttached, 'hint recap acknowledgement');
    if (hint.document.querySelector('#turn-completion-dialog').style.display === 'flex') hint.document.querySelector('#switch-players-btn').click();
    const button = hint.document.querySelector('#hint-btn');
    requireThat(button?.getAttribute('aria-label') === 'Show a hint', 'human Hint button missing');
    const before = plainState(hint);
    const storage = copyStorage(hint);
    const recap = hint.document.querySelector('#turn-completion-dialog').style.display;
    button.click();
    await until(() => hint.document.querySelector('.ai-hint-summary'), 'hint banner', 15000);
    requireThat(hint.document.querySelector('.ai-hint-summary').textContent.includes('Just a suggestion.'), 'hint note missing');
    assert.deepEqual(plainState(hint), before);
    assert.deepEqual(copyStorage(hint), storage);
    requireThat(hint.document.querySelector('#turn-completion-dialog').style.display === recap, 'hint changed recap overlay');
    hint.document.querySelector('[aria-label="Dismiss hint"]').click();
    requireThat(!hint.document.querySelector('.ai-hint-summary'), 'hint dismissal failed');
    assert.deepEqual(plainState(hint), before);
    // Start again and immediately act: the old async search cannot publish.
    hint.document.querySelector('#hint-btn').click();
    hint.document.querySelector('[data-popover="token-selection-modal"]').click();
    await delay(250);
    requireThat(!hint.document.querySelector('.ai-hint-summary'), 'cancelled hint reappeared');
    hint.closePopover('token-selection-modal');
    return 'only vs Computer human turns; preview preserves game/crowns/history/storage/recap; dismiss and cancellation work';
  });
  await check('(e) human DOM turn and AI reply', async () => {
    await until(() => stateOf(beta).currentPlayer === 1 && !beta.document.querySelector('.ai-thinking'), 'human turn');
    await delay(150);
    beta.document.querySelector('#switch-players-btn').click(); // Acknowledge the preceding Computer turn.
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
    requireThat(!beta.document.querySelector('#hint-btn'), 'Hint visible with selected tokens');
    beta.document.querySelector('#token-selection-modal .btn-confirm').click();
    requireThat(stateOf(beta).players.player1.tokens[cell.color] === before.players.player1.tokens[cell.color] + 1, 'confirm did not transfer selected gem to player1');
    humanView(beta);
    invariants(beta);
    await until(() => beta.document.querySelector('#turn-completion-dialog')?.style.display === 'flex', 'turn completion dialog shown');
    await until(() => beta.document.querySelector('#switch-players-btn')?._handlerAttached, 'completion control listener');
    const humanCheckpoint = openPage(html, 'human-checkpoint', 'https://danieldailey.com/splendor_duel/index.html?debug', copyStorage(beta));
    await until(() => humanCheckpoint.document.querySelector('.computer-resume-notice'), 'completed human action resumes');
    assert.deepEqual(plainState(humanCheckpoint), plainState(beta));
    requireThat(humanCheckpoint.document.querySelector('#turn-completion-dialog').style.display === 'flex', 'completed human action lost its End Turn dialog');
    humanView(humanCheckpoint);
    beta.document.querySelector('#switch-players-btn').click();
    requireThat(stateOf(beta).currentPlayer === 2, 'end-turn control did not schedule AI');
    humanView(beta);
    const interruptedStorage = copyStorage(beta);
    requireThat(JSON.parse(interruptedStorage[VS_COMPUTER_SAVE_KEY]).state.gameState.currentPlayer === 2, 'human handoff not saved before AI');
    const interrupted = openPage(html, 'interrupted-AI', 'https://danieldailey.com/splendor_duel/index.html?debug', interruptedStorage);
    await until(() => interrupted.document.querySelector('.computer-resume-notice'), 'interrupted AI resume notice');
    await aiFinished(interrupted);
    await aiFinished(beta);
    requireThat(JSON.stringify(stateOf(beta).players.player2) !== JSON.stringify(before.players.player2), 'AI player state did not change');
    const summary = beta.document.querySelector('#turn-summary-list').innerHTML;
    const turns = beta.__splendorDebugState().turnHistory.turns;
    requireThat(turns.at(-1).playerId === 'player2', 'Computer history missing');
    requireThat(turns.at(-2).playerId === 'player1', 'human history missing');
    requireThat(beta.document.querySelectorAll('#turn-summary-list .turn-event-row').length === turns.at(-1).events.length, 'recap does not display the recorded Computer actions');
    await delay(250);
    requireThat(beta.document.querySelector('#turn-completion-dialog').style.display === 'flex', 'recap disappeared without dismissal');
    beta.__splendorDebugRender();
    requireThat(beta.document.querySelector('#turn-completion-dialog').style.display === 'flex', 're-render dismissed recap');
    {
      // SVG gradient ids carry a global render counter (e.g. pearlGradient96 -> pearlGradient97); ignore it.
      const normalize = html => html.replace(/(Gradient)\d+/g, '$1#');
      const after = beta.document.querySelector('#turn-summary-list').innerHTML;
      requireThat(normalize(after) === normalize(summary), 're-render changed recap');
    }
    await until(() => beta.document.querySelector('#switch-players-btn')?._handlerAttached, 'recap dismissal listener');
    const savedStorage = copyStorage(beta);
    const expected = plainState(beta);
    assert.deepEqual(JSON.parse(savedStorage[VS_COMPUTER_SAVE_KEY]).state.gameState, expected.gameState);
    const resumed = openPage(html, 'resumed', 'https://danieldailey.com/splendor_duel/index.html?debug', savedStorage);
    await until(() => resumed.document.querySelector('.computer-resume-notice'), 'resume notice');
    await aiFinished(resumed);
    assert.deepEqual(plainState(resumed), expected);
    requireThat(resumed.document.querySelector('.computer-resume-notice').textContent === 'Resumed your game vs Computer (level 3)', 'wrong resume notice');
    await delay(550);
    requireThat(resumed.document.querySelector('#mode-selection-modal').style.display !== 'flex', 'resume showed mode dialog');
    resumed.document.querySelector('#switch-players-btn').click();
    const acknowledged = openPage(html, 'acknowledged', 'https://danieldailey.com/splendor_duel/index.html?debug', copyStorage(resumed));
    await until(() => acknowledged.document.querySelector('.computer-resume-notice'), 'acknowledged resume');
    await delay(100);
    assert.deepEqual(plainState(acknowledged), expected);
    humanView(acknowledged);
    requireThat(acknowledged.document.querySelector('#turn-completion-dialog').style.display !== 'flex', 'acknowledged recap reappeared after restart');
    for (const [name, mutate, query] of [
      ['game-over', snapshot => { snapshot.state.gameState.gameOver.winnerId = 'player2'; }, '?debug'],
      ['corrupt', () => null, '?debug'],
      ['online-link', snapshot => snapshot, '?debug&session=example'],
      ['empty-online-link', snapshot => snapshot, '?debug&session='],
      ['kill-switch-save', snapshot => snapshot, '?debug&noai']
    ]) {
      const snapshot = JSON.parse(savedStorage[VS_COMPUTER_SAVE_KEY]);
      const result = mutate(snapshot);
      const storage = { ...savedStorage, [VS_COMPUTER_SAVE_KEY]: result === null ? '{broken' : JSON.stringify(snapshot) };
      const page = openPage(html, name, `https://danieldailey.com/splendor_duel/index.html${query}`, storage);
      await until(() => page.document.querySelector('.game-container'), `${name} initializes`);
      await delay(550);
      requireThat(!page.document.querySelector('.computer-resume-notice'), `${name} resumed local game`);
      requireThat(page.document.querySelector('#settings-modal-content')?.textContent?.includes('vs Computer') !== true, `${name} enabled Computer`);
      if (name === 'game-over' || name === 'corrupt') requireThat(page.localStorage.getItem(VS_COMPUTER_SAVE_KEY) === null, `${name} snapshot not deleted`);
    }
    acknowledged.selectLocalMode();
    requireThat(acknowledged.localStorage.getItem(VS_COMPUTER_SAVE_KEY) === null, 'hotseat retained Computer save');
    acknowledged.startVsComputer(3);
    const fresh = JSON.parse(acknowledged.localStorage.getItem(VS_COMPUTER_SAVE_KEY));
    requireThat(fresh.level === 3 && fresh.state.turnHistory.turns.length === 0, 'new Computer game did not write fresh save');
    acknowledged.showJoinDialog();
    requireThat(acknowledged.localStorage.getItem(VS_COMPUTER_SAVE_KEY) === null, 'online mode retained Computer save');
    const afterAI = JSON.stringify(stateOf(beta));
    beta.document.querySelector('#switch-players-btn').click();
    requireThat(beta.document.querySelector('#turn-completion-dialog').style.display === 'none', 'Start Turn did not dismiss recap');
    requireThat(JSON.stringify(stateOf(beta)) === afterAI, 'dismissal changed game state');
    beta.__splendorDebugRender();
    await delay(100);
    requireThat(beta.document.querySelector('#turn-completion-dialog').style.display === 'none', 'dismissed recap reappeared');
    return `app-kill resume deep-equals game/crowns/history, retains human view, shows notice without mode dialog, runs interrupted AI, restores recap exactly once, rejects finished/corrupt saves and online URLs; recap matches Computer history, persists until Start Turn, survives re-render, and stays dismissed; real DOM: open board, click (${cell.row},${cell.col}) ${cell.color}, Confirm, finish turn; AI replied and player1 view/control retained`;
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
