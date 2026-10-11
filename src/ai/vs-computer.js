import { LEVELS } from './index.js';
import { runAiTurn } from './bridge.js';

export function aiModeAvailable(location = globalThis.location) {
  return Boolean(location && (/beta/i.test(location.pathname) || new URLSearchParams(location.search).has('ai')));
}

export const LEVEL_LABELS = Object.freeze(Object.fromEntries(
  Object.keys(LEVELS).map((level, i) => [level, `${level} ${['Beginner', 'Easy', 'Medium', 'Hard', 'Expert'][i]}`])
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
  return `<div class="ai-summary" role="status"><span>Computer: ${summary.map(escapeHtml).join('; ')}.</span><button type="button" aria-label="Dismiss computer summary" onclick="window.dismissComputerSummary()">×</button></div>`;
}
export function levelPickerHtml(selected = 1) {
  return `<label for="ai-level">Computer level</label><select id="ai-level">${Object.entries(LEVEL_LABELS).map(([level, label]) => `<option value="${level}"${Number(level) === selected ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="action-button" onclick="window.startVsComputer(Number(document.getElementById('ai-level').value))">Start game</button>`;
}
export const createVsComputerState = () => ({ enabled: false, level: 1, aiPlayerId: 'player2', busy: false, summary: [], error: null, generation: 0 });
export const vsComputer = createVsComputerState();
export function disableComputer(state = vsComputer) {
  state.generation++;
  state.enabled = false;
  state.busy = false;
  state.summary = [];
  state.error = null;
}
export function enableComputer(level, state = vsComputer) {
  if (!validLevel(level)) throw new RangeError('level must be 1 through 5');
  disableComputer(state);
  state.enabled = true;
  state.level = Number(level);
}

/** UI callbacks and the timer are injectable so the whole handoff can be smoked without DOM. */
export function scheduleComputerTurn({ getGame, applyGame, refresh, rng, schedule = setTimeout, runTurn = runAiTurn }, state = vsComputer) {
  const game = getGame();
  if (!state.enabled || state.busy || game.gameState.gameOver.winnerId || game.gameState.currentPlayer !== 2) return false;
  state.busy = true;
  state.error = null;
  state.summary = [];
  const generation = state.generation;
  refresh();
  schedule(() => {
    if (!state.enabled || state.generation !== generation) return;
    try {
      const result = runTurn(getGame(), { level: state.level, aiPlayerId: state.aiPlayerId, rng });
      applyGame(result.game);
      state.summary = result.summary;
    } catch (error) {
      // Keep the original AI boundary intact so a retry cannot repeat a partial turn.
      state.error = 'The computer could not finish its turn. Please retry.';
      console.error('Computer turn failed:', error);
    } finally {
      state.busy = false;
      refresh();
    }
  }, 60);
  return true;
}
