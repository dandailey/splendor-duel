/** Resample unknown deck order, preserving each deck's multiset.
 * Engine limitation: blind and pyramid reservations have no provenance flag.
 * Opponent reserves remain intact for engine compatibility, but evaluation and
 * reply search must ignore their identities (even formerly public reservations).
 */
export function determinize(state, aiPlayerId, rng) {
  if (!['player1', 'player2'].includes(aiPlayerId)) throw new RangeError('Invalid playerId');
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  const next = structuredClone(state);
  for (const deck of Object.values(next.decks)) {
    for (let i = deck.length - 1; i > 0; i--) {
      const value = rng();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid rng sample');
      const j = Math.floor(value * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return next;
}
