import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialGrifballMatchState,
  resolveMatchConfig,
  tickGrifballMatch,
  registerGoal,
  isGrifballLive,
} from './grifballMatch';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

const settings = { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' as const };
const config = resolveMatchConfig(settings);

test('config reads grifball tuning with sensible defaults', () => {
  assert.equal(config.goalTarget, 5);
  assert.equal(config.countdownDuration, 3);
  assert.equal(config.roundResetDelay, 4);
});

test('starts in countdown and transitions to playing after the countdown', () => {
  const state = createInitialGrifballMatchState(settings);
  assert.equal(state.phase, 'countdown');
  assert.ok(!isGrifballLive(state));

  // Not enough time yet.
  let r = tickGrifballMatch(state, 1.0, config);
  assert.equal(state.phase, 'countdown');
  assert.equal(r.startedPlaying, false);

  // Cross the threshold.
  r = tickGrifballMatch(state, 2.5, config);
  assert.equal(state.phase, 'playing');
  assert.equal(r.startedPlaying, true);
  assert.ok(isGrifballLive(state));
});

test('a goal pauses to scored, then resets to the next round', () => {
  const state = createInitialGrifballMatchState(settings);
  tickGrifballMatch(state, 3.1, config); // → playing

  assert.ok(registerGoal(state, 'blue', 1, config));
  assert.equal(state.phase, 'scored');
  assert.equal(state.lastScoringTeam, 'blue');
  assert.equal(state.winningTeam, null);

  const r = tickGrifballMatch(state, config.roundResetDelay + 0.1, config);
  assert.equal(r.roundReset, true);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.roundNumber, 2);
});

test('reaching the goal target ends the match', () => {
  const state = createInitialGrifballMatchState(settings);
  tickGrifballMatch(state, 3.1, config); // → playing

  registerGoal(state, 'red', config.goalTarget, config);
  assert.equal(state.winningTeam, 'red');

  const r = tickGrifballMatch(state, config.roundResetDelay + 0.1, config);
  assert.equal(r.matchEnded, true);
  assert.equal(state.phase, 'matchEnd');
});

test('goals are ignored unless the match is live', () => {
  const state = createInitialGrifballMatchState(settings);
  // Still in countdown.
  assert.equal(registerGoal(state, 'blue', 1, config), false);
  assert.equal(state.phase, 'countdown');
});
