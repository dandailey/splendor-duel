import { readFileSync } from 'node:fs';
import { parseCards } from './cards.js';

/** Node-only convenience loader, independent of the process working directory. */
export function loadCards() {
  return parseCards(readFileSync(new URL('../splendor_cards.csv', import.meta.url), 'utf8'));
}
