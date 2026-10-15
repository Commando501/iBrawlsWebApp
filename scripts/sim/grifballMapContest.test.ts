import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_CONTEST_CASES, runMapContestTrace } from './grifballMapContest';
for (const spec of MAP_CONTEST_CASES) test(`opposing supplied-map decisions ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace=runMapContestTrace(spec);
  assert.equal(trace.failureCount,0,JSON.stringify(trace.failures));
  assert.equal(trace.frames.length,1800);
});
test('map contest matrix covers five supplied maps and both initial carrier identities', () => {
  assert.equal(MAP_CONTEST_CASES.length,40);
  assert.equal(new Set(MAP_CONTEST_CASES.map(s=>s.map.id)).size,5);
});
for (const mapId of ['forerunner_canyon','rainy_industrial_streets','championship_stadium']) test(`opposing map decisions repeat: ${mapId}`, () => {
  const spec=MAP_CONTEST_CASES.find(s=>s.map.id===mapId&&s.main)!;
  assert.deepEqual(runMapContestTrace(spec),runMapContestTrace(spec));
});
