import { LEVELS } from './index.js';
import { runAiTurnAsync } from './bridge.js';

// Computer mode is part of the live game. `?noai` is a kill switch (e.g. to compare against plain hotseat).
export function aiModeAvailable(location = globalThis.location) {
  return Boolean(location) && !new URLSearchParams(location.search).has('noai');
}

export const LEVEL_LABELS = Object.freeze(Object.fromEntries(
  Object.keys(LEVELS).map((level, i) => [level, `${level} ${['Beginner', 'Easy', 'Medium', 'Hard', 'Expert', 'Strong', 'Very strong', 'Expert search', 'Master', 'Grandmaster'][i]}`])
));
const validLevel = level => Object.hasOwn(LEVELS, level);
export function rememberedLevel() {
  try {
    const level = Number(globalThis.localStorage.getItem('splendor-ai-level'));
    if (validLevel(level)) return level;
  } catch { /* Storage may be unavailable. */ }
  return 1;
}
export function rememberLevel(level) {
  try { globalThis.localStorage.setItem('splendor-ai-level', String(level)); } catch { /* Optional preference. */ }
}

/** Deliberately mutates the live target, preserving compatible object/array identities.
 * The source is cloned before copying, so neither aliases nor inputs are retained.
 */
export function applyGameInto(target, source) {
  const copy = (into, from) => {
    for (const key of Object.keys(into)) if (!Object.hasOwn(from, key)) delete into[key];
    if (Array.isArray(into)) into.length = from.length;
    for (const [key, value] of Object.entries(from)) {
      if (value && typeof value === 'object' && into[key] && typeof into[key] === 'object'
          && Array.isArray(value) === Array.isArray(into[key])) copy(into[key], value);
      else into[key] = value;
    }
  };
  copy(target, structuredClone(source));
  return target;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function summaryBannerHtml(summary) {
  if (!summary.length) return '';
  return `<div class="ai-summary" role="status"><span>Computer: ${summary.map(escapeHtml).join('; ')}.</span><button type="button" aria-label="Dismiss computer summary" data-action="dismissComputerSummary">×</button></div>`;
}
export function hintBannerHtml(lines) {
  if (!lines.length) return '';
  return `<div class="ai-summary ai-hint-summary" role="status" aria-label="Hint suggestion"><span>Hint: ${lines.map(escapeHtml).join('; ')}. <small>Just a suggestion.</small></span><button type="button" aria-label="Dismiss hint" data-action="dismissHint">×</button></div>`;
}
export function levelPickerHtml(selected = 1) {
  return `<label for="ai-level">Computer level</label><select id="ai-level">${Object.entries(LEVEL_LABELS).map(([level, label]) => `<option value="${level}"${Number(level) === selected ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="action-button" data-action="startComputerFromPicker">Start game</button>`;
}
export const createVsComputerState = () => ({ enabled: false, level: 1, aiPlayerId: 'player2', busy: false, summary: [], error: null, generation: 0 });
export const vsComputer = createVsComputerState();
export function cancelComputerWork(state = vsComputer) {
  state.controller?.abort();
  state.controller = null;
  state.generation++;
  state.busy = false;
  state.summary = [];
  state.error = null;
}
export function disableComputer(state = vsComputer) {
  cancelComputerWork(state);
  state.enabled = false;
}
export function enableComputer(level, state = vsComputer) {
  if (!validLevel(level)) throw new RangeError('level must be 1 through 10');
  disableComputer(state);
  state.enabled = true;
  state.level = Number(level);
}

/** UI callbacks and the timer are injectable so the whole handoff can be smoked without DOM. */
export function scheduleComputerTurn({ getGame, applyGame, refresh, rng, schedule = setTimeout, runTurn }, state = vsComputer) {
  const game = getGame();
  if (!state.enabled || state.busy || game.gameState.gameOver.winnerId || game.gameState.currentPlayer !== 2) return false;
  state.busy = true;
  state.error = null;
  state.summary = [];
  const generation = state.generation;
  refresh();
  const controller = new AbortController();
  state.controller = controller;
  schedule(() => {
    if (!state.enabled || state.generation !== generation) return;
    const active = () => state.enabled && state.generation === generation && !controller.signal.aborted;
    const finish = result => {
      if (!active()) return;
      applyGame(result.game, result);
      state.summary = result.summary;
    };
    const fail = error => {
      if (!active() || error.name === 'AbortError') return;
      state.error = 'The computer could not finish its turn. Please retry.';
      console.error('Computer turn failed:', error);
    };
    const release = () => {
      if (!active()) return;
      state.controller = null;
      state.busy = false;
      refresh();
    };
    try {
      const turn = runTurn ?? runAiTurnAsync;
      const result = turn(getGame(), { level: state.level, aiPlayerId: state.aiPlayerId, rng, signal: controller.signal });
      if (result && typeof result.then === 'function') result.then(finish).catch(fail).finally(release);
      else { finish(result); release(); }
    } catch (error) { fail(error); release(); }
  }, 60);
  return true;
}
