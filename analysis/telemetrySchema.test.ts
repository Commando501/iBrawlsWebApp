import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsSqlSelectColumns,
  toAnalyticsDataPoint,
  TELEMETRY_BLOB_FIELDS,
  TELEMETRY_DOUBLE_FIELDS,
  TELEMETRY_SAMPLING_KEY_SEPARATOR,
} from '../worker/src/telemetrySchema';

const body = {
  anonId: 'anon-1',
  appVersion: '1.0.0',
  liveConfigVersion: 7,
  map: 'rectangular',
  mode: 'sandbox',
  aiDifficulty: 'hard',
  aiArchetype: 'berserker',
  gameMode: 'grifball',
  scorePlayer: 5,
  scoreEnemy: 3,
  playerKills: 8,
  playerDeaths: 4,
  durationSeconds: 120,
  fingerprintSchema: 1,
  isMultiplayer: 1,
  opponentCount: 3,
  multikills: 2,
  sprees: 1,
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
    avgLungeDistance: 11,
    lungeFrequency: 0.6,
    dodgeBiasX: 0.3,
    dodgeBiasZ: -0.1,
    counterRate: 0.4,
    approachSpeed: 0.7,
    edgeProximity: 0.2,
    reactionTime: 0.25,
    sampleCount: 40,
  },
};

test('toAnalyticsDataPoint emits columns in schema order with nested resolution', () => {
  const dp = toAnalyticsDataPoint(body);

  // Single composite index: gameMode + separator + aiDifficulty (sampling key).
  assert.deepEqual(dp.indexes, [`grifball${TELEMETRY_SAMPLING_KEY_SEPARATOR}hard`]);
  // aiDifficulty is appended as a blob so SQL can filter it without parsing the index.
  assert.deepEqual(dp.blobs, [
    'anon-1', '1.0.0', '7', 'rectangular', 'sandbox', 'berserker', 'grifball', 'hard',
  ]);
  // Outcome → fingerprint → fingerprintSchema → context → action volumes (see schema).
  assert.deepEqual(dp.doubles, [
    5, 3, 8, 4, 120, // outcome
    11, 0.6, 0.3, -0.1, 0.4, 0.7, 0.2, 0.25, 40, // fingerprint
    1, // fingerprintSchema
    1, 3, 2, 1, // context: isMultiplayer, opponentCount, multikills, sprees
    12, 7, 9, 4, 15, 5, 3, 20, 14, // action volumes
  ]);
});

test('toAnalyticsDataPoint array lengths match the schema field counts', () => {
  const dp = toAnalyticsDataPoint(body);
  // Always exactly one AE index (the composite sampling key).
  assert.equal(dp.indexes.length, 1);
  assert.equal(dp.blobs.length, TELEMETRY_BLOB_FIELDS.length);
  assert.equal(dp.doubles.length, TELEMETRY_DOUBLE_FIELDS.length);
});

test('toAnalyticsDataPoint coerces missing / bad values safely', () => {
  const dp = toAnalyticsDataPoint({ anonId: 'x' });
  assert.equal(dp.blobs[0], 'x');
  // Missing string fields become '', missing numbers become 0 (never NaN).
  assert.ok(dp.blobs.every((b) => typeof b === 'string'));
  assert.ok(dp.doubles.every((d) => Number.isFinite(d)));
});

test('analyticsSqlSelectColumns aliases positional AE columns to field names', () => {
  const sql = analyticsSqlSelectColumns();
  assert.match(sql, /index1 AS samplingKey/);
  assert.match(sql, /blob1 AS anonId/);
  assert.match(sql, /blob8 AS aiDifficulty/);
  assert.match(sql, /double1 AS scorePlayer/);
  assert.match(sql, /double6 AS avgLungeDistance/);
  // One projection per schema column: the single composite index + blobs + doubles.
  const expected = 1 + TELEMETRY_BLOB_FIELDS.length + TELEMETRY_DOUBLE_FIELDS.length;
  assert.equal(sql.split(',').length, expected);
});
