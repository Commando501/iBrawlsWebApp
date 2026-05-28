import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIMatchContext } from './aiMatchContext';
import {
  applyCalibrationMultipliers,
  computeCalibrationBias,
  computeCalibrationMultipliers,
  createBotCalibrationState,
  isSkillCalibrationEnabled,
  MAX_CALIBRATION_DRIFT,
  NEUTRAL_CALIBRATION_MULTIPLIERS,
  recordCalibrationCounterAttempt,
  recordCalibrationCounterFailed,
  recordCalibrationCounterSuccess,
  recordCalibrationDeath,
  recordCalibrationDodgeAttempt,
  recordCalibrationDodgeFailed,
  recordCalibrationDodgeSucceeded,
  recordCalibrationKill,
  tickCalibrationPendingDodge,
} from './aiSkillCalibration';

test('isSkillCalibrationEnabled skips easy, custom, and preset ids', () => {
  assert.equal(isSkillCalibrationEnabled('easy'), false);
  assert.equal(isSkillCalibrationEnabled('custom'), false);
  assert.equal(isSkillCalibrationEnabled('preset_aggressive'), false);
  assert.equal(isSkillCalibrationEnabled('normal'), true);
  assert.equal(isSkillCalibrationEnabled('hard'), true);
  assert.equal(isSkillCalibrationEnabled('nightmare'), true);
});

test('computeCalibrationBias is positive when the player is dominating', () => {
  const state = createBotCalibrationState();
  const context = createAIMatchContext();

  for (let i = 0; i < 4; i += 1) {
    recordCalibrationDeath(context, 'main_ai', 10 + i * 5);
  }
  recordCalibrationKill(context, 'main_ai', 30);

  Object.assign(state, context.skillCalibration.get('main_ai'));
  assert.ok(computeCalibrationBias(state) > 0);
});

test('computeCalibrationBias is negative when the bot is dominating', () => {
  const state = createBotCalibrationState();
  const context = createAIMatchContext();

  for (let i = 0; i < 4; i += 1) {
    recordCalibrationKill(context, 'main_ai', 10 + i * 3);
  }
  recordCalibrationDeath(context, 'main_ai', 25);

  Object.assign(state, context.skillCalibration.get('main_ai'));
  assert.ok(computeCalibrationBias(state) < 0);
});

test('computeCalibrationMultipliers stay within subtle drift bounds', () => {
  const context = createAIMatchContext();
  for (let i = 0; i < 6; i += 1) {
    recordCalibrationDeath(context, 'main_ai', 5 + i);
  }

  const state = context.skillCalibration.get('main_ai')!;
  const mults = computeCalibrationMultipliers(state);

  assert.ok(mults.reactionLatencyMult >= 1 - MAX_CALIBRATION_DRIFT - 0.001);
  assert.ok(mults.reactionLatencyMult <= 1);
  assert.ok(mults.anticipationFactorMult >= 1);
  assert.ok(mults.anticipationFactorMult <= 1 + MAX_CALIBRATION_DRIFT + 0.001);
  assert.ok(mults.aggressiveLungeMult >= 1);
  assert.ok(mults.aggressiveLungeMult <= 1 + MAX_CALIBRATION_DRIFT + 0.001);
});

test('dodge and counter snapshots resolve through match context helpers', () => {
  const context = createAIMatchContext();

  recordCalibrationDodgeAttempt(context, 'main_ai');
  recordCalibrationDodgeFailed(context, 'main_ai');

  recordCalibrationDodgeAttempt(context, 'main_ai');
  tickCalibrationPendingDodge(context, 'main_ai', 0.2, true);
  tickCalibrationPendingDodge(context, 'main_ai', 0.2, false);
  recordCalibrationDodgeSucceeded(context, 'main_ai');

  recordCalibrationCounterAttempt(context, 'main_ai');
  recordCalibrationCounterSuccess(context, 'main_ai');

  recordCalibrationCounterAttempt(context, 'main_ai');
  recordCalibrationCounterFailed(context, 'main_ai');

  const state = context.skillCalibration.get('main_ai')!;
  assert.equal(state.snapshots.length, 4);
  assert.equal(state.snapshots[0].dodgeSuccesses, 0);
  assert.equal(state.snapshots[1].dodgeSuccesses, 1);
  assert.equal(state.snapshots[2].counterSuccesses, 1);
  assert.equal(state.snapshots[3].counterSuccesses, 0);
});

test('applyCalibrationMultipliers clamps anticipation and keeps latency positive', () => {
  const calibrated = applyCalibrationMultipliers({
    reactionLatency: 0.02,
    anticipationFactor: 0.95,
    aggressiveLungeMult: 1.8,
    multipliers: {
      reactionLatencyMult: 1 - MAX_CALIBRATION_DRIFT,
      anticipationFactorMult: 1 + MAX_CALIBRATION_DRIFT,
      aggressiveLungeMult: 1 + MAX_CALIBRATION_DRIFT,
    },
  });

  assert.ok(calibrated.reactionLatency >= 0.01);
  assert.ok(calibrated.anticipationFactor <= 1);
  assert.ok(calibrated.aggressiveLungeMult > 1.8);
});

test('neutral multipliers leave knobs unchanged', () => {
  const calibrated = applyCalibrationMultipliers({
    reactionLatency: 0.25,
    anticipationFactor: 0.4,
    aggressiveLungeMult: 1.0,
    multipliers: NEUTRAL_CALIBRATION_MULTIPLIERS,
  });

  assert.equal(calibrated.reactionLatency, 0.25);
  assert.equal(calibrated.anticipationFactor, 0.4);
  assert.equal(calibrated.aggressiveLungeMult, 1.0);
});
