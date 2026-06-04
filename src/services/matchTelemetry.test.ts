import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchTelemetry,
  clamp01,
  shouldAdmitLocally,
  TELEMETRY_FINGERPRINT_SCHEMA,
  type MatchTelemetryInput,
} from './matchTelemetry';

const input: MatchTelemetryInput = {
  map: 'rectangular',
  mode: 'sandbox',
  aiDifficulty: 'normal',
  aiArchetype: 'none',
  gameMode: 'sandbox',
  scorePlayer: 5,
  scoreEnemy: 3,
  playerKills: 7,
  playerDeaths: 4,
  durationSeconds: 142.5,
  isMultiplayer: 0,
  opponentCount: 1,
  multikills: 1,
  sprees: 0,
  lungeAttempts: 12,
  lungeHits: 7,
  hammerAttacks: 9,
  weaponSwaps: 4,
  dashes: 15,
  countersAttempted: 5,
  countersLanded: 3,
  damageDealtCount: 20,
  damageReceivedCount: 14,
  player: {
    avgLungeDistance: 11.2,
    lungeFrequency: 0.62,
    dodgeBiasX: 0.4,
    dodgeBiasZ: -0.1,
    counterRate: 0.33,
    approachSpeed: 0.71,
    edgeProximity: 0.28,
    reactionTime: 0.24,
    sampleCount: 88,
  },
};

test('buildMatchTelemetry stamps identity, version and schema onto the input', () => {
  const payload = buildMatchTelemetry(
    input,
    { anonId: 'anon-123', appVersion: '1.2.3', liveConfigVersion: 9 },
    1_700_000_000_000,
  );

  assert.equal(payload.anonId, 'anon-123');
  assert.equal(payload.appVersion, '1.2.3');
  assert.equal(payload.liveConfigVersion, 9);
  assert.equal(payload.ts, 1_700_000_000_000);
  assert.equal(payload.fingerprintSchema, TELEMETRY_FINGERPRINT_SCHEMA);
  // Input fields pass through untouched.
  assert.equal(payload.scorePlayer, 5);
  assert.equal(payload.player.counterRate, 0.33);
});

test('buildMatchTelemetry never carries a raw player name (no PII)', () => {
  const payload = buildMatchTelemetry(
    input,
    { anonId: 'anon-123', appVersion: 'dev', liveConfigVersion: 0 },
  );
  assert.ok(!('playerName' in payload));
  assert.ok(!('name' in payload));
});

test('clamp01 bounds and rejects non-finite values', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(0.33), 0.33);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(Infinity), 1);
});

test('shouldAdmitLocally admits everything at probability 1', () => {
  assert.equal(shouldAdmitLocally(1, 0), true);
  assert.equal(shouldAdmitLocally(1, 0.999), true);
});

test('shouldAdmitLocally drops everything at probability 0', () => {
  assert.equal(shouldAdmitLocally(0, 0), false);
  assert.equal(shouldAdmitLocally(0, 0.5), false);
});

test('shouldAdmitLocally splits the rng range at the probability boundary', () => {
  // p = 0.25: admit when rng < 0.25, drop otherwise.
  assert.equal(shouldAdmitLocally(0.25, 0.1), true);
  assert.equal(shouldAdmitLocally(0.25, 0.25), false);
  assert.equal(shouldAdmitLocally(0.25, 0.9), false);
});
