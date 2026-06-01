import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlayerModel,
  observePlayerCounter,
  observePlayerDash,
  observePlayerLungeStart,
  observePlayerPosition,
  getApproachLateralOffset,
  getFeintPressureMultiplier,
  getOrCreatePlayerModel,
  getPlayerModelSnapshot,
  applyLungeAimBias,
  PLAYER_MODEL_EMA_ALPHA,
  toPlayerModelSnapshot,
} from './aiPlayerModel';
import { createAIMatchContext } from './aiMatchContext';

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

test('getOrCreatePlayerModel builds independent models per combatant id', () => {
  const context = createAIMatchContext();

  const player = getOrCreatePlayerModel(context, 'player');
  const bot = getOrCreatePlayerModel(context, 'bot_1');

  assert.notEqual(player, bot);
  // Re-fetching the same id returns the same instance (not a fresh model).
  assert.equal(getOrCreatePlayerModel(context, 'bot_1'), bot);
  assert.equal(context.playerModels.size, 2);

  // Observing one id must not bleed into another id's model.
  for (let i = 0; i < 10; i += 1) {
    observePlayerLungeStart(getOrCreatePlayerModel(context, 'bot_1'), 12);
  }
  assert.ok(bot.sampleCount >= 10);
  assert.equal(player.sampleCount, 0);
  assert.ok(Math.abs(player.avgLungeDistance - bot.avgLungeDistance) > 1);
});

test('getPlayerModelSnapshot gates on minSamples and returns the right id', () => {
  const context = createAIMatchContext();
  const bot = getOrCreatePlayerModel(context, 'bot_1');

  // Below the gate: no snapshot yet.
  observePlayerDash(bot, 1, 0);
  assert.equal(getPlayerModelSnapshot(context, 'bot_1', 3), null);
  // Unobserved id never returns a snapshot.
  assert.equal(getPlayerModelSnapshot(context, 'bot_2', 3), null);

  for (let i = 0; i < 15; i += 1) {
    observePlayerDash(bot, 1, 0);
  }
  const snap = getPlayerModelSnapshot(context, 'bot_1', 3);
  assert.ok(snap);
  assert.ok(snap!.dodgeBiasX > 0.5);
});

test('a populated bot model drives consumers differently than a null model', () => {
  const model = createPlayerModel();
  // Build a strong diagonal dodge bias (X drives the lateral offset, Z gives a
  // perpendicular component for an X-axis lunge) plus a high counter rate.
  for (let i = 0; i < 30; i += 1) {
    observePlayerDash(model, 1, 1);
    observePlayerCounter(model, true);
  }
  const snapshot = toPlayerModelSnapshot(model);

  // applyLungeAimBias: a null model leaves the heading untouched; a populated one bends it.
  const nullBias = applyLungeAimBias(1, 0, null);
  const learnedBias = applyLungeAimBias(1, 0, snapshot);
  assert.equal(nullBias.z, 0);
  assert.notEqual(learnedBias.z, nullBias.z);

  // getApproachLateralOffset: null → 0; populated → non-zero offset toward the dodge bias.
  assert.equal(getApproachLateralOffset(null), 0);
  assert.ok(Math.abs(getApproachLateralOffset(snapshot)) > 0.4);

  // getFeintPressureMultiplier: null → 1 (no reduction); a counter-heavy model reduces it.
  assert.equal(getFeintPressureMultiplier(null), 1);
  assert.ok(getFeintPressureMultiplier(snapshot) < 1);
});
