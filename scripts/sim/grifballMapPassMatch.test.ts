import { isMapBodyClear } from './grifballMapCollisionOracle';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_PASS_MATCH_CASES, runMapPassMatchTrace } from './grifballMapPassMatch';

for (const spec of MAP_PASS_MATCH_CASES) test(`complete map passing match ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runMapPassMatchTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.at(-1)!.phase, 'matchEnd');
  assert.ok(trace.passes.length > 0);
  assert.ok(trace.passGeometry.evaluations > 0);
  if (['forerunner_canyon', 'synthwave_grid_arena', 'rainy_industrial_streets'].includes(spec.map.id)) {
    assert.ok(trace.passGeometry.blockedCandidateSamples > 0);
    assert.ok(trace.passGeometry.blockedExamples.some(c => c.path.some(p => !isMapBodyClear(spec.map, { ...p, y: 0 }))));
  }
  assert.equal(trace.ticks - trace.frames.find(f => f.phase === 'matchEnd')!.tick, 181);
});
test('supplied-map passing covers five maps, mirrored teams, orders and carrier identities', () => {
  assert.equal(MAP_PASS_MATCH_CASES.length, 40);
  assert.equal(new Set(MAP_PASS_MATCH_CASES.map(s => `${s.map.id}/${s.team}/${s.reverse}/${s.main}`)).size, 40);
  assert.equal(new Set(MAP_PASS_MATCH_CASES.map(s => s.map.id)).size, 5);
});
for (const mapId of ['forerunner_canyon', 'rainy_industrial_streets', 'championship_stadium']) test(`complete map passing repeats: ${mapId}`, () => {
  const spec = MAP_PASS_MATCH_CASES.find(s => s.map.id === mapId && s.main)!;
  assert.deepEqual(runMapPassMatchTrace(spec), runMapPassMatchTrace(spec));
});
