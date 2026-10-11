import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame } from '../src/engine/setup.js';
import { loadCards } from '../src/engine/cards-node.js';
import { legalMoves, applyMoveWithEvents, isTerminal } from '../src/engine/turn.js';
import { mulberry32 } from './helpers/rng.js';

// Recorded from the unoptimized S11 engine before any S12 changes.
const expected = [
  {"seed": 1,"decisions": 140,"turns": 99,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 7,"colorPoints": {"blue": 3,"white": 6,"green": 1,"red": 0,"black": 7},"maxColor": "black","maxPoints": 7}}},
  {"seed": 2,"decisions": 151,"turns": 99,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 3,"colorPoints": {"blue": 6,"white": 1,"green": 1,"red": 4,"black": 0},"maxColor": "blue","maxPoints": 6}}},
  {"seed": 3,"decisions": 151,"turns": 105,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 8,"colorPoints": {"blue": 6,"white": 4,"green": 3,"red": 1,"black": 2},"maxColor": "blue","maxPoints": 6}}},
  {"seed": 4,"decisions": 137,"turns": 104,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 6,"colorPoints": {"blue": 2,"white": 5,"green": 2,"red": 5,"black": 2},"maxColor": "white","maxPoints": 5}}},
  {"seed": 5,"decisions": 142,"turns": 88,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 3,"colorPoints": {"blue": 7,"white": 1,"green": 0,"red": 3,"black": 0},"maxColor": "blue","maxPoints": 7}}},
  {"seed": 6,"decisions": 199,"turns": 123,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 6,"colorPoints": {"blue": 1,"white": 4,"green": 3,"red": 1,"black": 6},"maxColor": "black","maxPoints": 6}}},
  {"seed": 7,"decisions": 158,"turns": 109,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 5,"colorPoints": {"blue": 1,"white": 3,"green": 4,"red": 4,"black": 7},"maxColor": "black","maxPoints": 7}}},
  {"seed": 8,"decisions": 228,"turns": 135,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 6,"colorPoints": {"blue": 6,"white": 1,"green": 3,"red": 6,"black": 1},"maxColor": "blue","maxPoints": 6}}},
  {"seed": 9,"decisions": 152,"turns": 105,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 21,"totalCrowns": 6,"colorPoints": {"blue": 6,"white": 2,"green": 2,"red": 3,"black": 4},"maxColor": "blue","maxPoints": 6}}},
  {"seed": 10,"decisions": 134,"turns": 94,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 5,"colorPoints": {"blue": 3,"white": 3,"green": 4,"red": 0,"black": 1},"maxColor": "green","maxPoints": 4}}},
  {"seed": 11,"decisions": 173,"turns": 111,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 22,"totalCrowns": 9,"colorPoints": {"blue": 2,"white": 7,"green": 1,"red": 1,"black": 1},"maxColor": "white","maxPoints": 7}}},
  {"seed": 12,"decisions": 200,"turns": 119,"gameOver": {"winnerId": "player2","conditions": [{"key": "crowns_10","label": "10+ crowns"}],"winnerStats": {"totalPoints": 19,"totalCrowns": 11,"colorPoints": {"blue": 5,"white": 4,"green": 4,"red": 0,"black": 1},"maxColor": "blue","maxPoints": 5}}},
  {"seed": 13,"decisions": 134,"turns": 93,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 22,"totalCrowns": 6,"colorPoints": {"blue": 0,"white": 3,"green": 6,"red": 0,"black": 6},"maxColor": "green","maxPoints": 6}}},
  {"seed": 14,"decisions": 150,"turns": 108,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 5,"colorPoints": {"blue": 5,"white": 3,"green": 2,"red": 3,"black": 5},"maxColor": "blue","maxPoints": 5}}},
  {"seed": 15,"decisions": 145,"turns": 110,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 23,"totalCrowns": 4,"colorPoints": {"blue": 1,"white": 8,"green": 2,"red": 0,"black": 4},"maxColor": "white","maxPoints": 8}}},
  {"seed": 16,"decisions": 159,"turns": 110,"gameOver": {"winnerId": "player1","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 3,"colorPoints": {"blue": 2,"white": 0,"green": 5,"red": 0,"black": 7},"maxColor": "black","maxPoints": 7}}},
  {"seed": 17,"decisions": 131,"turns": 88,"gameOver": {"winnerId": "player2","conditions": [{"key": "color_points_10","label": "10+ prestige points in black"}],"winnerStats": {"totalPoints": 17,"totalCrowns": 3,"colorPoints": {"blue": 0,"white": 1,"green": 1,"red": 0,"black": 10},"maxColor": "black","maxPoints": 10}}},
  {"seed": 18,"decisions": 178,"turns": 109,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 7,"colorPoints": {"blue": 3,"white": 4,"green": 5,"red": 2,"black": 1},"maxColor": "green","maxPoints": 5}}},
  {"seed": 19,"decisions": 176,"turns": 109,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 2,"colorPoints": {"blue": 5,"white": 1,"green": 5,"red": 8,"black": 1},"maxColor": "red","maxPoints": 8}}},
  {"seed": 20,"decisions": 150,"turns": 105,"gameOver": {"winnerId": "player2","conditions": [{"key": "points_20","label": "20+ total prestige points"},{"key": "crowns_10","label": "10+ crowns"}],"winnerStats": {"totalPoints": 20,"totalCrowns": 10,"colorPoints": {"blue": 3,"white": 2,"green": 2,"red": 5,"black": 4},"maxColor": "red","maxPoints": 5}}}
];

test('twenty seeded random games retain their exact baseline results and turn/decision counts', () => {
  const cards = loadCards();
  for (const baseline of expected) {
    const rng = mulberry32(baseline.seed);
    let state = newGame(cards, rng);
    let decisions = 0;
    let turns = 0;
    while (!isTerminal(state) && decisions < 4000) {
      const moves = legalMoves(state);
      const result = applyMoveWithEvents(state, moves[Math.floor(rng() * moves.length)], rng);
      state = result.state;
      decisions++;
      turns += result.events.filter(event => event.type === 'turn_ended' || event.type === 'game_over').length;
    }
    assert.deepEqual({ seed: baseline.seed, decisions, turns, gameOver: state.gameOver }, baseline);
  }
});
