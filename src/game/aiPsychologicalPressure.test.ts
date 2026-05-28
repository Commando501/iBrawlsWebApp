import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accumulateStandoffTimer,
  createBotPsychState,
  getEffectiveReactionLatency,
  getPostKillApproachSpeed,
  getStandoffCommitChance,
  isInStandoffBand,
  isPsychPressureEnabled,
  notifyBotKill,
  shouldForceStandoffCommit,
  shouldTelegraphSwordAtSpawn,
  TEMPO_CYCLE_DURATION,
  tickBotPsychState,
} from './aiPsychologicalPressure';
import { NEUTRAL_MATCH_MULTIPLIERS } from './aiTuning';

test('isPsychPressureEnabled skips easy and low aggression', () => {
  assert.equal(isPsychPressureEnabled('easy', 100), false);
  assert.equal(isPsychPressureEnabled('hard', 10), false);
  assert.equal(isPsychPressureEnabled('hard', 20), true);
});

test('notifyBotKill stores spawn pressure and clears standoff', () => {
  const state = createBotPsychState();
  state.standoffTimer = 2;
  notifyBotKill(state, {
    victimId: 'player',
    spawnX: 10,
    spawnZ: 0,
    lungeKill: true,
  });
  assert.equal(state.postKill?.victimId, 'player');
  assert.equal(state.postKill?.lungeKill, true);
  assert.equal(state.standoffTimer, 0);
});

test('tempo alternation scales reaction latency', () => {
  const state = createBotPsychState();
  state.tempoPhase = 'slow';
  assert.ok(getEffectiveReactionLatency(0.2, state, true) > 0.2);
  state.tempoPhase = 'fast';
  assert.ok(getEffectiveReactionLatency(0.2, state, true) < 0.2);
  assert.equal(getEffectiveReactionLatency(0.2, state, false), 0.2);
});

test('tickBotPsychState expires post-kill and flips tempo', () => {
  const state = createBotPsychState();
  notifyBotKill(state, {
    victimId: 'player',
    spawnX: 0,
    spawnZ: 12,
    lungeKill: false,
    duration: 0.5,
  });
  state.tempoTimer = 0.1;
  tickBotPsychState(state, 0.6);
  assert.equal(state.postKill, undefined);
  assert.equal(state.tempoPhase, 'slow');
  assert.equal(state.tempoTimer, TEMPO_CYCLE_DURATION);
});

test('standoff commit chance escalates with timer and playstyle', () => {
  const low = getStandoffCommitChance(0.5, 0.2, NEUTRAL_MATCH_MULTIPLIERS);
  const high = getStandoffCommitChance(2.5, 0.9, {
    ...NEUTRAL_MATCH_MULTIPLIERS,
    matchPointCommitBias: 1.35,
    aggressionMult: 1.2,
  });
  assert.ok(high > low);
  assert.equal(shouldForceStandoffCommit(0.1, 0.9, NEUTRAL_MATCH_MULTIPLIERS, 0), false);
  assert.equal(shouldForceStandoffCommit(2, 0.9, NEUTRAL_MATCH_MULTIPLIERS, 0.2), true);
});

test('standoff band and post-kill helpers', () => {
  assert.equal(isInStandoffBand(12, 8), true);
  assert.equal(isInStandoffBand(8, 8), false);
  assert.equal(shouldTelegraphSwordAtSpawn(true, 6), true);
  assert.equal(shouldTelegraphSwordAtSpawn(false, 6), false);
  assert.ok(getPostKillApproachSpeed(true, 80) > getPostKillApproachSpeed(false, 40));
});

test('accumulateStandoffTimer resets outside band', () => {
  assert.equal(accumulateStandoffTimer(1.2, false, 0.1), 0);
  assert.equal(accumulateStandoffTimer(0.5, true, 0.2), 0.7);
});
