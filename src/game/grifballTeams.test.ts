import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGrifballTeam, GRIFBALL_TOTAL_AI } from './grifballTeams';

test('player is always blue', () => {
  assert.equal(resolveGrifballTeam('player'), 'blue');
});

test('7 AI split 4 red / 3 blue for a 4v4 with the human on blue', () => {
  const aiIds = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'];
  assert.equal(aiIds.length, GRIFBALL_TOTAL_AI);

  const teams = aiIds.map(resolveGrifballTeam);
  const red = teams.filter((t) => t === 'red').length;
  const blue = teams.filter((t) => t === 'blue').length;

  assert.equal(red, 4);
  assert.equal(blue, 3);
  // Player + 3 AI = 4 blue vs 4 red.
  assert.equal(blue + 1, red);
});

test('assignment is deterministic and stable per id', () => {
  assert.equal(resolveGrifballTeam('main_ai'), 'red');
  assert.equal(resolveGrifballTeam('bot_2'), 'blue');
  assert.equal(resolveGrifballTeam('bot_3'), 'red');
  assert.equal(resolveGrifballTeam('bot_2'), 'blue');
});
