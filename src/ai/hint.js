import { runAiTurnAsync, engineStateFromGame, aiTurnRecap } from './bridge.js';

const colors = tokens => tokens.flatMap(({ color, count }) => Array(count).fill(color)).join(', ');

/** A private simulated human turn; never exports its resulting game to the caller. */
export async function computeHint(game, { level = 6, rng, signal } = {}) {
  const snapshot = structuredClone(game);
  const result = await runAiTurnAsync(snapshot, {
    level: Math.min(8, Math.max(6, level)), rng, signal,
    aiPlayerId: `player${snapshot.gameState.currentPlayer}`
  });
  const recap = aiTurnRecap(engineStateFromGame(snapshot), result.moves, {
    chanceSamples: result.chanceSamples
  });
  const lines = recap.events.flatMap(event => {
    switch (event.type) {
      case 'tokens_taken': return [`Took ${colors(event.tokens)}`];
      case 'card_purchased': return [`Bought a level ${event.card.level} ${event.card.color} card (${event.card.points} points)`];
      case 'card_reserved': return [event.source === 'deck' ? `Reserved a card from the level ${event.level} deck` : `Reserved a level ${event.card.level} card`];
      case 'scroll_token': return ['Used a Privilege'];
      case 'board_refilled': return ['Refilled the board'];
      case 'royal_acquired': return ['Royal card claimed'];
      case 'tokens_discarded': {
        const total = event.tokens.reduce((sum, token) => sum + token.count, 0);
        return [`Discarded ${total} token${total === 1 ? '' : 's'}`];
      }
      case 'bonus_token_collected': return [`Collected a bonus ${event.bonusColor} token`];
      case 'token_stolen': return [`Stole a ${event.color} token`];
      case 'repeat_turn_awarded': return ['Gained an extra turn'];
      case 'scroll_gained': return ['Gained a Privilege'];
      default: return [];
    }
  });
  // Passing has no history event in the page recap.
  if (!lines.length && result.moves.some(move => move.type === 'pass')) lines.push('Passed');
  return { lines, moves: result.moves };
}
