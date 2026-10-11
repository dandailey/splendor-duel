/** Standard logistic Elo; scores and intervals are from A's perspective. */
export function eloFromScore(score) {
  if (!(score > 0 && score < 1)) throw new RangeError('score must be between 0 and 1');
  return 400 * Math.log10(score / (1 - score));
}

function validate(wins, draws, losses) {
  if (![wins, draws, losses].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw new RangeError('Result counts must be nonnegative integers');
  }
}

/** Normal binomial-score approximation (draws count as half a win).
 * At the endpoints, half a pseudo-win and pseudo-loss make Elo finite.
 * CI endpoints are clipped to that same continuity-correction floor.
 */
export function summarize(wins, draws, losses) {
  validate(wins, draws, losses);
  const games = wins + draws + losses;
  if (!games) throw new RangeError('At least one game is required');
  const score = (wins + draws / 2) / games;
  const floor = 0.5 / (games + 1);
  const corrected = score === 0 || score === 1 ? (wins + draws / 2 + 0.5) / (games + 1) : score;
  const margin = 1.959963984540054 * Math.sqrt(corrected * (1 - corrected) / games);
  return {
    games, wins, draws, losses, score, scorePercent: score * 100,
    elo: eloFromScore(corrected),
    ci95: [eloFromScore(Math.max(floor, corrected - margin)),
      eloFromScore(Math.min(1 - floor, corrected + margin))]
  };
}

// Trinomial generalized SPRT: maximize likelihood over the draw probability
// subject to the hypothesized mean score. No fixed draw-rate assumption.
function logLikelihood(wins, draws, losses, score) {
  const maximum = 2 * Math.min(score, 1 - score);
  const value = d => {
    const probabilities = [score - d / 2, d, 1 - score - d / 2];
    return [wins, draws, losses].reduce((sum, count, i) =>
      count === 0 ? sum : sum + count * Math.log(Math.max(Number.MIN_VALUE, probabilities[i])), 0);
  };
  let lo = 0;
  let hi = maximum;
  for (let i = 0; i < 100; i++) {
    const left = lo + (hi - lo) / 3;
    const right = hi - (hi - lo) / 3;
    if (value(left) < value(right)) lo = left;
    else hi = right;
  }
  return Math.max(value(0), value(maximum), value((lo + hi) / 2));
}

export function sprt(wins, draws, losses, elo0, elo1, alpha = 0.05, beta = 0.05) {
  validate(wins, draws, losses);
  if (!Number.isFinite(elo0) || !Number.isFinite(elo1) || elo0 >= elo1 ||
      !(alpha > 0 && alpha < 1 && beta > 0 && beta < 1)) throw new RangeError('Invalid SPRT parameters');
  const score = elo => 1 / (1 + 10 ** (-elo / 400));
  const llr = logLikelihood(wins, draws, losses, score(elo1)) -
    logLikelihood(wins, draws, losses, score(elo0));
  const lower = Math.log(beta / (1 - alpha));
  const upper = Math.log((1 - beta) / alpha);
  return { llr, lower, upper, decision: llr >= upper ? 'acceptH1' : llr <= lower ? 'acceptH0' : 'continue' };
}
