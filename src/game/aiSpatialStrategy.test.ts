import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveAITargetPredictionFrame } from '../components/grifball/aiTargetPredictionRuntime';
import {
  BAIT_DODGE_DISTANCE,
  blendSpatialHeading,
  getBulltrueHammerTriggerBand,
  getCutoffInterceptPoint,
  getEdgePressure,
  getEvasionDetectRange,
  getEvasionDashRollChance,
  getEvasionTimingScale,
  getSpatialMovementBias,
  getSpawnGuardAimAngle,
  getTargetEdgeSelectionBonus,
  isInBulltrueHammerWindow,
  isWithinEvasionRange,
  pickPerpendicularDodgeDirection,
  resolveTargetLungeDirection,
  scorePosition,
  shouldAttemptBaitDodge,
  shouldCommitChargeAfterEvasion,
} from './aiSpatialStrategy';
import { getForwardHeadingForYaw, getYawForHeading } from './yaw';

const assertNearlyEqual = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
};

test('yaw helpers use negative Z as forward', () => {
  assertNearlyEqual(getYawForHeading(0, -1), 0);
  assertNearlyEqual(getYawForHeading(1, 0), -Math.PI / 2);
  assertNearlyEqual(getYawForHeading(-1, 0), Math.PI / 2);

  const forward = getForwardHeadingForYaw(0);
  assertNearlyEqual(forward.x, 0);
  assertNearlyEqual(forward.z, -1);

  const right = getForwardHeadingForYaw(-Math.PI / 2);
  assertNearlyEqual(right.x, 1);
  assertNearlyEqual(right.z, 0);
});

test('AI target prediction yaw follows the negative-Z forward convention', () => {
  const frame = resolveAITargetPredictionFrame({
    botPos: new THREE.Vector3(0, 0, 0),
    target: {
      pos: new THREE.Vector3(0, 0, -10),
      vel: new THREE.Vector3(),
    },
    effectiveReactionLatency: 0,
    tunedAnticipationFactor: 0,
    predictionAnticipationBonus: 0,
    predictionLandingWeight: 0,
    movementComplexity: 0,
    activeCustomMap: null,
    arenaRadius: 20,
  });

  assertNearlyEqual(frame.yaw, 0);

  const rightFrame = resolveAITargetPredictionFrame({
    botPos: new THREE.Vector3(0, 0, 0),
    target: {
      pos: new THREE.Vector3(10, 0, 0),
      vel: new THREE.Vector3(),
    },
    effectiveReactionLatency: 0,
    tunedAnticipationFactor: 0,
    predictionAnticipationBonus: 0,
    predictionLandingWeight: 0,
    movementComplexity: 0,
    activeCustomMap: null,
    arenaRadius: 20,
  });

  const lookHeading = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), rightFrame.yaw)
    .normalize();

  assertNearlyEqual(rightFrame.yaw, -Math.PI / 2);
  assert.ok(lookHeading.dot(new THREE.Vector3(1, 0, 0)) > 0.999);
});

test('getEvasionDetectRange applies spatial IQ and jitter bounds', () => {
  const low = getEvasionDetectRange({ distanceToTarget: 10, combatDistanceToTarget: 10, spatialIQ: 0, swayPhase: 0 });
  const high = getEvasionDetectRange({ distanceToTarget: 10, combatDistanceToTarget: 10, spatialIQ: 100, swayPhase: 0 });
  assert.ok(low >= 12 && low <= 18);
  assert.ok(high > low);
  assert.ok(high <= 18.5);
});

test('isWithinEvasionRange respects distance threshold', () => {
  assert.equal(
    isWithinEvasionRange({
      distanceToTarget: 14,
      combatDistanceToTarget: 14,
      spatialIQ: 50,
      swayPhase: 0,
    }),
    true
  );
  assert.equal(
    isWithinEvasionRange({
      distanceToTarget: 20,
      combatDistanceToTarget: 20,
      spatialIQ: 50,
      swayPhase: 0,
    }),
    false
  );
});

test('pickPerpendicularDodgeDirection prefers inward side near arena edge', () => {
  const nearEdge = pickPerpendicularDodgeDirection({
    botPosX: 17,
    botPosZ: 2,
    lungeDirX: 0,
    lungeDirZ: 1,
    arenaRadius: 20,
    rng: 0.5,
  });
  const afterDist = Math.hypot(17 + nearEdge.x * 3.2, 2 + nearEdge.z * 3.2);
  assert.ok(afterDist < 17.5);
});

test('resolveTargetLungeDirection prefers explicit lunge vector', () => {
  const dir = resolveTargetLungeDirection({
    targetId: 'player',
    toTargetX: 1,
    toTargetZ: 0,
    playerIsLunging: true,
    playerLungeDirX: 0,
    playerLungeDirZ: 5,
  });
  assert.ok(Math.abs(dir.z - 1) < 0.01);
  assert.ok(Math.abs(dir.x) < 0.01);
});

test('getEvasionTimingScale reacts to learned reaction time', () => {
  assert.equal(getEvasionTimingScale(null), 1);
  assert.ok(
    getEvasionTimingScale({
      avgLungeDistance: 8,
      lungeFrequency: 0.3,
      dodgeBiasX: 0,
      dodgeBiasZ: 0,
      counterRate: 0.2,
      approachSpeed: 0.5,
      edgeProximity: 0.3,
      reactionTime: 0.2,
      sampleCount: 8,
    }) < 1
  );
});

test('shouldAttemptBaitDodge only in bait band with sword out', () => {
  assert.equal(
    shouldAttemptBaitDodge({
      distanceToTarget: BAIT_DODGE_DISTANCE,
      combatDistanceToTarget: BAIT_DODGE_DISTANCE,
      spatialIQ: 60,
      targetIsLunging: false,
      targetActiveWeapon: 'sword',
      dashCooldownRemaining: 0,
      difficulty: 'hard',
      rng: 0,
    }),
    true
  );
  assert.equal(
    shouldAttemptBaitDodge({
      distanceToTarget: 8,
      combatDistanceToTarget: 8,
      spatialIQ: 60,
      targetIsLunging: false,
      targetActiveWeapon: 'sword',
      dashCooldownRemaining: 0,
      difficulty: 'hard',
      rng: 0,
    }),
    false
  );
});

test('shouldCommitChargeAfterEvasion requires recovering target in range', () => {
  assert.equal(
    shouldCommitChargeAfterEvasion({
      targetWeaponState: 'recovering',
      attackDistanceToTarget: 4,
      resolvedAiReach: 4,
      targetProtected: false,
      spatialIQ: 50,
      weaponReady: true,
    }),
    true
  );
  assert.equal(
    shouldCommitChargeAfterEvasion({
      targetWeaponState: 'ready',
      attackDistanceToTarget: 4,
      resolvedAiReach: 4,
      targetProtected: false,
      spatialIQ: 50,
      weaponReady: true,
    }),
    false
  );
});

test('bulltrue hammer window scales with timing', () => {
  const band = getBulltrueHammerTriggerBand({
    distanceToTarget: 8,
    lungeSpeed: 24,
    attackRadius: 2.1,
    timingScale: 1.1,
  });
  assert.ok(band.triggerDist > 7);
  assert.equal(isInBulltrueHammerWindow(8, band), true);
  assert.equal(isInBulltrueHammerWindow(2, band), false);
});

test('getEvasionDashRollChance scales with difficulty and mult', () => {
  const nightmare = getEvasionDashRollChance({
    difficulty: 'nightmare',
    defensiveEvasionMult: 1,
    spatialIQ: 80,
  });
  const easy = getEvasionDashRollChance({
    difficulty: 'easy',
    defensiveEvasionMult: 1,
    spatialIQ: 80,
  });
  assert.ok(nightmare > 0.9);
  assert.equal(easy, 0);
});

test('scorePosition favors bot when target is near arena edge', () => {
  const edgePin = scorePosition({
    botX: 0,
    botZ: 0,
    targetX: 18,
    targetZ: 2,
    arenaRadius: 20,
  });
  const centerFight = scorePosition({
    botX: 0,
    botZ: 0,
    targetX: 4,
    targetZ: 2,
    arenaRadius: 20,
  });
  assert.ok(edgePin.targetEdgePressure > centerFight.targetEdgePressure);
  assert.ok(edgePin.advantage > centerFight.advantage);
});

test('getEdgePressure rises toward arena boundary', () => {
  assert.equal(getEdgePressure(0, 20), 0);
  assert.ok(getEdgePressure(19, 20) > 0.8);
});

test('getCutoffInterceptPoint activates for edge target retreating to center', () => {
  const cutoff = getCutoffInterceptPoint({
    targetX: 18,
    targetZ: 0,
    targetVelX: -4,
    targetVelZ: 0,
    arenaRadius: 20,
    spatialIQ: 70,
  });
  assert.equal(cutoff.active, true);
  assert.ok(cutoff.x < 18);
});

test('getSpatialMovementBias recenters bot when exposed on edge', () => {
  const bias = getSpatialMovementBias({
    botX: 17,
    botZ: 1,
    targetX: 5,
    targetZ: 0,
    arenaRadius: 20,
    spatialIQ: 80,
  });
  assert.ok(bias.blendWeight > 0.1);
  assert.ok(bias.movementDirX < 0);
});

test('blendSpatialHeading mixes base and spatial directions', () => {
  const bias = getSpatialMovementBias({
    botX: 0,
    botZ: 0,
    targetX: 10,
    targetZ: 0,
    arenaRadius: 20,
    spatialIQ: 80,
  });
  const blended = blendSpatialHeading(1, 0, bias);
  const len = Math.hypot(blended.x, blended.z);
  assert.ok(Math.abs(len - 1) < 0.01);
});

test('getSpawnGuardAimAngle offsets toward center corridor', () => {
  const direct = getYawForHeading(8, 0);
  const guarded = getSpawnGuardAimAngle({
    botX: 6,
    botZ: 2,
    spawnX: 14,
    spawnZ: 2,
    spatialIQ: 80,
  });
  assert.notEqual(guarded, direct);

  const heading = getForwardHeadingForYaw(guarded);
  assert.ok(heading.x > 0);
});

test('getTargetEdgeSelectionBonus rewards pinned targets at high spatial IQ', () => {
  const bonus = getTargetEdgeSelectionBonus({
    botX: 0,
    botZ: 0,
    targetX: 18,
    targetZ: 0,
    arenaRadius: 20,
    spatialIQ: 80,
  });
  assert.ok(bonus > 40);
  assert.equal(
    getTargetEdgeSelectionBonus({
      botX: 0,
      botZ: 0,
      targetX: 18,
      targetZ: 0,
      arenaRadius: 20,
      spatialIQ: 10,
    }),
    0
  );
});
