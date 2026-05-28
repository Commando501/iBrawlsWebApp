import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialTournamentRounds,
  buildNextTournamentRoundMatches,
  getTournamentBotCount,
  getTournamentRoundLabels,
  simulateBotMatch,
} from './tournament';

test('builds the expected tournament bracket shape', () => {
  assert.equal(getTournamentBotCount(3), 7);
  assert.deepEqual(getTournamentRoundLabels(3), ['Quarterfinals', 'Semifinals', 'Final']);

  const rounds = buildInitialTournamentRounds(3);
  assert.equal(rounds.length, 3);
  assert.equal(rounds[0].length, 4);
  assert.deepEqual(rounds[0][0], { opponent1: 'player', opponent2: 'bot_1', isCompleted: false });
  assert.equal(rounds[1].length, 2);
  assert.equal(rounds[2].length, 1);
});

test('builds next-round matches from winners', () => {
  assert.deepEqual(buildNextTournamentRoundMatches(['player', 'bot_2']), [
    { opponent1: 'player', opponent2: 'bot_2', isCompleted: false },
  ]);
});

test('simulates bot matches without changing match identity', () => {
  const match = { opponent1: 'bot_1', opponent2: 'bot_2', isCompleted: false };
  const result = simulateBotMatch(match, {
    bot_1: {
      id: 'bot_1',
      name: 'One',
      hue: 10,
      difficulty: 'normal',
      reactionLatency: 0.2,
      anticipationFactor: 0.4,
      movementComplexity: 50,
      weaponSwapIQ: 50,
      playstyle: 50,
      behavior: 'defensive',
    },
    bot_2: {
      id: 'bot_2',
      name: 'Two',
      hue: 20,
      difficulty: 'normal',
      reactionLatency: 0.2,
      anticipationFactor: 0.4,
      movementComplexity: 50,
      weaponSwapIQ: 50,
      playstyle: 50,
      behavior: 'aggressive',
    },
  }, 25);

  assert.equal(result.isCompleted, true);
  assert.ok(result.winner === 'bot_1' || result.winner === 'bot_2');
  assert.ok(result.score1 !== undefined);
  assert.ok(result.score2 !== undefined);
});
