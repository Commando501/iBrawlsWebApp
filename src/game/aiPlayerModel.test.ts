import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayerModel,
  observePlayerCounter,
  observePlayerDash,
  observePlayerLungeStart,
  observePlayerPosition,
  getApproachLateralOffset,
  applyLungeAimBias,
  PLAYER_MODEL_EMA_ALPHA,
  toPlayerModelSnapshot,
} from './aiPlayerModel';

test('EMA converges toward repeated lunge distance samples', () => {
  const model = createPlayerModel();
  const targetDistance = 11.5;

  for (let i = 0; i < 40; i += 1) {
    observePlayerLungeStart(model, targetDistance);
  }

  assert.ok(Math.abs(model.avgLungeDistance - targetDistance) < 0.35);
  assert.ok(model.sampleCount >= 40);
});

test('dash observations bias lateral offset in the learned direction', () => {
  const model = createPlayerModel();

  for (let i = 0; i < 30; i += 1) {
    observePlayerDash(model, 1, 0);
  }

  const snapshot = toPlayerModelSnapshot(model);
  assert.ok(snapshot.dodgeBiasX > 0.5);
  assert.ok(getApproachLateralOffset(snapshot) > 0.4);
});

test('counter rate rises after successful counter observations', () => {
  const model = createPlayerModel();
  const initial = model.counterRate;

  for (let i = 0; i < 10; i += 1) {
    observePlayerCounter(model, true);
  }

  assert.ok(model.counterRate > initial);
  assert.ok(model.counterRate > 0.5);
});

test('applyLungeAimBias shifts direction perpendicular to learned dodge side', () => {
  const model = createPlayerModel();
  for (let i = 0; i < 20; i += 1) {
    observePlayerDash(model, 0, 1);
  }
  const snapshot = toPlayerModelSnapshot(model);

  const biased = applyLungeAimBias(1, 0, snapshot);
  assert.notEqual(biased.z, 0);
  const length = Math.hypot(biased.x, biased.z);
  assert.ok(Math.abs(length - 1) < 0.001);
});

test('position sampling respects throttle interval', () => {
  const model = createPlayerModel();
  observePlayerPosition(model, 12, 0, 20, 1.0);
  const firstCount = model.sampleCount;
  observePlayerPosition(model, 14, 0, 20, 1.1);
  assert.equal(model.sampleCount, firstCount);
  observePlayerPosition(model, 14, 0, 20, 1.26);
  assert.equal(model.sampleCount, firstCount + 1);
});

test('EMA alpha constant matches plan default', () => {
  assert.equal(PLAYER_MODEL_EMA_ALPHA, 0.08);
});
