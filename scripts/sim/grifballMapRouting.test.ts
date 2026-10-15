import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_ROUTING_CASES, runMapRoutingTrace } from './grifballMapRouting';
for (const spec of MAP_ROUTING_CASES) test(`autonomous supplied-map routing ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.retrieverId}`, () => {
  const trace=runMapRoutingTrace(spec);
  assert.equal(trace.failureCount,0,JSON.stringify(trace.failures));
  assert.equal(trace.frames.length,1440);
});
test('routing matrix covers five goal-capable supplied maps and both AI identities', () => {
  assert.equal(MAP_ROUTING_CASES.length,40);
  assert.equal(new Set(MAP_ROUTING_CASES.map(s=>s.map.id)).size,5);
});
for (const mapId of ['forerunner_canyon','rainy_industrial_streets','championship_stadium']) test(`supplied-map routing repeats: ${mapId}`, () => {
  const spec=MAP_ROUTING_CASES.find(s=>s.map.id===mapId)!;
  assert.deepEqual(runMapRoutingTrace(spec),runMapRoutingTrace(spec));
});
