import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_MOBILITY_CASES, runMapMobilityTrace } from './grifballMapMobility';
for (const spec of MAP_MOBILITY_CASES) test(`supplied map mobility ${spec.map.id}/${spec.surface}/${spec.owner}/${spec.id}`, () => {
  const trace = runMapMobilityTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 180);
});
test('map mobility covers every supplied map and all elevated landing fixtures', () => {
  assert.equal(new Set(MAP_MOBILITY_CASES.map(c => c.map.id)).size, 8);
  assert.equal(MAP_MOBILITY_CASES.length, 92);
  assert.equal(MAP_MOBILITY_CASES.filter(c => c.surface === 'platform').length, 28);
});
for (const owner of ['recovery', 'engagement'] as const) test(`map mobility repeats exactly: ${owner}`, () => {
  const spec = MAP_MOBILITY_CASES.find(c => c.surface === 'platform' && c.owner === owner)!;
  assert.deepEqual(runMapMobilityTrace(spec), runMapMobilityTrace(spec));
});
