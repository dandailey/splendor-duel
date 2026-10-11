import { TOKEN_SUPPLY, CARD_COUNTS, PRIVILEGE_SUPPLY, ROYAL_CARDS, ROYAL_SUPPLY } from './setup.js';

/** Read-only diagnostics. Optional state.returned is a color/count map; normally
 * returned tokens already live in bag and must not be counted twice here. */
export function checkInvariants(state) {
  const violations = [];
  if (!state || typeof state !== 'object') return ['State must be an object'];
  const array = (value, path) => {
    if (Array.isArray(value)) return value;
    violations.push(`${path} must be an array`);
    return [];
  };
  const count = (value, path) => {
    if (Number.isInteger(value) && value >= 0) return value;
    violations.push(`${path} must be a non-negative integer`);
    return 0;
  };
  const boardCounts = Object.fromEntries(Object.keys(TOKEN_SUPPLY).map(color => [color, 0]));
  if (!Array.isArray(state.board) || state.board.length !== 5 ||
      state.board.some(row => !Array.isArray(row) || row.length !== 5)) {
    violations.push('Board must be 5x5');
  }
  for (const row of Array.isArray(state.board) ? state.board : []) {
    for (const token of Array.isArray(row) ? row : []) {
      if (token === null) continue;
      if (Object.hasOwn(TOKEN_SUPPLY, token)) boardCounts[token] += 1;
      else violations.push(`Unknown board token: ${String(token)}`);
    }
  }
  const jewels = [];
  const ownedRoyals = [];
  const collect = (cards, path, allowRoyal = false) => {
    for (const card of array(cards, path)) {
      if (!card || typeof card.id !== 'string') {
        violations.push(`Invalid card in ${path}`);
        continue;
      }
      if (card.id.startsWith('royal-')) {
        if (!allowRoyal) violations.push(`Royal card in ${path}`);
        ownedRoyals.push(card);
      } else jewels.push(card);
    }
  };
  for (const level of Object.keys(CARD_COUNTS)) {
    for (const source of ['decks', 'pyramid']) {
      const path = `${source}.${level}`;
      collect(state[source]?.[level], path);
      for (const card of Array.isArray(state[source]?.[level]) ? state[source][level] : []) {
        if (card && `level${card.level}` !== level) violations.push(`Card ${card.id} in wrong level: ${path}`);
      }
    }
  }
  let privileges = count(state.scrollPool, 'scrollPool');
  const playerTokens = Object.fromEntries(Object.keys(TOKEN_SUPPLY).map(color => [color, 0]));
  for (const playerId of ['player1', 'player2']) {
    const player = state.players?.[playerId];
    privileges += count(player?.privileges, `${playerId}.privileges`);
    for (const color of Object.keys(TOKEN_SUPPLY)) {
      playerTokens[color] += count(player?.tokens?.[color], `${playerId}.tokens.${color}`);
    }
    collect(player?.cards, `${playerId}.cards`, true);
    collect(player?.reserves, `${playerId}.reserves`);
    if (player?.reserves?.length > 3) violations.push(`${playerId} reserves exceed 3`);
  }
  for (const [color, supply] of Object.entries(TOKEN_SUPPLY)) {
    const total = boardCounts[color] + playerTokens[color] + count(state.bag?.[color], `bag.${color}`) +
      (state.returned === undefined ? 0 : count(state.returned[color] ?? 0, `returned.${color}`));
    if (total !== supply) violations.push(`Token conservation: ${color} total ${total}, expected ${supply}`);
  }
  const seen = new Set();
  for (const card of jewels) {
    if (seen.has(card.id)) violations.push(`Card conservation: duplicate ${card.id}`);
    seen.add(card.id);
    if (!Object.hasOwn(CARD_COUNTS, `level${card.level}`)) violations.push(`Invalid level for ${card.id}`);
  }
  for (const [level, expected] of Object.entries(CARD_COUNTS)) {
    const total = jewels.filter(card => `level${card.level}` === level).length;
    if (total !== expected) violations.push(`Card conservation: ${level} total ${total}, expected ${expected}`);
  }
  // Taken Royals in the shared list are location markers, not extra physical cards.
  const royals = array(state.royalCards, 'royalCards');
  if (royals.length !== ROYAL_SUPPLY) violations.push(`Royal registry must contain ${ROYAL_SUPPLY} cards`);
  const royalIds = new Set(ROYAL_CARDS.map(card => card.id));
  for (const card of [...royals, ...ownedRoyals]) {
    if (!royalIds.has(card?.id)) violations.push(`Royal conservation: unknown Royal ${card?.id}`);
  }
  for (const id of royalIds) {
    const markers = royals.filter(card => card?.id === id);
    const owners = ownedRoyals.filter(card => card.id === id).length;
    if (markers.length !== 1 || typeof markers[0]?.taken !== 'boolean' ||
        owners !== (markers[0]?.taken ? 1 : 0)) {
      violations.push(`Royal conservation: ${id} must be available or owned exactly once`);
    }
  }
  if (privileges !== PRIVILEGE_SUPPLY) {
    violations.push(`Privilege conservation: total ${privileges}, expected ${PRIVILEGE_SUPPLY}`);
  }
  if (state.currentPlayer !== 1 && state.currentPlayer !== 2) violations.push('currentPlayer must be 1 or 2');
  return violations;
}
