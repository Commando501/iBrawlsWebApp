import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceAISlide,
  getSlideSpeed,
  getSprintSpeedMultiplier,
  getTargetRecedingSpeed,
  shouldAISprint,
  shouldStartAISlide,
  SLIDE_MIN_COMPLEXITY,
} from './aiMovementMechanics';

test('getTargetRecedingSpeed is positive when fleeing, negative when closing', () => {
  // Target at +10 on X, moving further out (+X) → fleeing.
  assert.ok(getTargetRecedingSpeed(0, 0, 10, 0, 5, 0) > 0);
  // Target moving back toward the AI (-X) → closing.
  assert.ok(getTargetRecedingSpeed(0, 0, 10, 0, -5, 0) < 0);
  // Degenerate (same position) → 0.
  assert.equal(getTargetRecedingSpeed(0, 0, 0, 0, 5, 0), 0);
});

test('shouldAISprint chases when target is far beyond engage range', () => {
  const base = {
    enableSprint: true,
    state: 'APPROACHING',
    distanceToTarget: 20,
    engageRange: 4,
    isCrouching: false,
    isDashing: false,
    isSliding: false,
    targetRecedingSpeed: 0,
  };
  assert.equal(shouldAISprint(base), true);
  // Close enough that no sprint is needed.
  assert.equal(shouldAISprint({ ...base, distanceToTarget: 5 }), false);
});

test('shouldAISprint triggers a chase against a fleeing target at shorter range', () => {
  const input = {
    enableSprint: true,
    state: 'PRESSURING',
    distanceToTarget: 7,
    engageRange: 4,
    isCrouching: false,
    isDashing: false,
    isSliding: false,
    targetRecedingSpeed: 6,
  };
  assert.equal(shouldAISprint(input), true);
  // Not fleeing and within the engage gap → no sprint.
  assert.equal(shouldAISprint({ ...input, targetRecedingSpeed: 0 }), false);
});

test('shouldAISprint respects the toggle and conflicting movement', () => {
  const base = {
    enableSprint: true,
    state: 'APPROACHING',
    distanceToTarget: 20,
    engageRange: 4,
    isCrouching: false,
    isDashing: false,
    isSliding: false,
    targetRecedingSpeed: 0,
  };
  assert.equal(shouldAISprint({ ...base, enableSprint: false }), false);
  assert.equal(shouldAISprint({ ...base, isCrouching: true }), false);
  assert.equal(shouldAISprint({ ...base, isDashing: true }), false);
  assert.equal(shouldAISprint({ ...base, isSliding: true }), false);
  assert.equal(shouldAISprint({ ...base, state: 'SIDE_STEPPING' }), false);
});

test('getSprintSpeedMultiplier scales from percentage with a floor', () => {
  assert.equal(getSprintSpeedMultiplier(150), 1.5);
  assert.equal(getSprintSpeedMultiplier(undefined), 1.0);
  assert.equal(getSprintSpeedMultiplier(0), 0.2);
});

test('shouldStartAISlide fires only in the medium approach band when enabled', () => {
  const base = {
    enableSlide: true,
    slideCooldownRemaining: 0,
    state: 'APPROACHING',
    distanceToTarget: 12,
    engageRange: 4,
    movementComplexity: 60,
    isDashing: false,
    isSliding: false,
    targetProtected: false,
    rng: 0.0,
  };
  assert.equal(shouldStartAISlide(base), true);
  // Too close (inside SLIDE_MIN_GAP).
  assert.equal(shouldStartAISlide({ ...base, distanceToTarget: 5 }), false);
  // Too far (beyond SLIDE_MAX_GAP).
  assert.equal(shouldStartAISlide({ ...base, distanceToTarget: 40 }), false);
});

test('shouldStartAISlide honours toggle, cooldown, complexity, state and rng', () => {
  const base = {
    enableSlide: true,
    slideCooldownRemaining: 0,
    state: 'APPROACHING',
    distanceToTarget: 12,
    engageRange: 4,
    movementComplexity: 60,
    isDashing: false,
    isSliding: false,
    targetProtected: false,
    rng: 0.0,
  };
  assert.equal(shouldStartAISlide({ ...base, enableSlide: false }), false);
  assert.equal(shouldStartAISlide({ ...base, slideCooldownRemaining: 1.0 }), false);
  assert.equal(shouldStartAISlide({ ...base, movementComplexity: SLIDE_MIN_COMPLEXITY - 1 }), false);
  assert.equal(shouldStartAISlide({ ...base, state: 'CHARGE_ATTACK' }), false);
  assert.equal(shouldStartAISlide({ ...base, isSliding: true }), false);
  assert.equal(shouldStartAISlide({ ...base, targetProtected: true }), false);
  // rng above the trigger chance → no slide this frame.
  assert.equal(shouldStartAISlide({ ...base, rng: 0.99 }), false);
});

test('getSlideSpeed scales the base ground speed from percentage', () => {
  assert.equal(getSlideSpeed(100), 5.8);
  assert.ok(getSlideSpeed(200) > getSlideSpeed(100));
});

test('advanceAISlide accumulates distance and finishes at the cap', () => {
  const step = advanceAISlide({ distanceTraveled: 0, slideSpeed: 10, dt: 0.1, maxSlideDistance: 8 });
  assert.equal(step.distanceTraveled, 1);
  assert.equal(step.finished, false);

  const done = advanceAISlide({ distanceTraveled: 7.5, slideSpeed: 10, dt: 0.1, maxSlideDistance: 8 });
  assert.equal(done.finished, true);
});
