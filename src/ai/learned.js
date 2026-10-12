import { FEATURE_NAMES, extractFeatures } from './features.js';
import { isTerminal, winner } from '../engine/turn.js';

export function loadLearnedWeights(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.featureNames) || data.featureNames.length !== FEATURE_NAMES.length ||
      Array.from(data.featureNames).some((n, i) => n !== FEATURE_NAMES[i])) throw new TypeError('Incompatible feature names');
  if (!Array.isArray(data.w) || data.w.length !== FEATURE_NAMES.length ||
      Array.from(data.w).some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new TypeError('Invalid learned weights');
  return Object.freeze({ featureNames: FEATURE_NAMES, w: Object.freeze([...data.w]), meta: data.meta });
}
export function evaluateLearned(state, playerId, { weights, hiddenPlayerId = null } = {}) {
  if (!['player1', 'player2'].includes(playerId)) throw new RangeError('Invalid playerId');
  if (isTerminal(state)) return winner(state) === playerId ? 1e6 : -1e6;
  if (!weights?.w || weights.w.length !== FEATURE_NAMES.length) throw new TypeError('Learned weights required');
  const features = extractFeatures(state, playerId, { hiddenPlayerId });
  return features.reduce((sum, v, i) => sum + v * weights.w[i], 0);
}
