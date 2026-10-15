import { isMapBodyClear } from './grifballMapCollisionOracle';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_PASS_MATCH_CASES, runMapPassMatchTrace } from './grifballMapPassMatch';
import { PASS_MATCH_CASES, runPassMatch, postResetPassCoverage, type PostResetPassTrace } from './grifballPassMatch';

const postResetTraces: PostResetPassTrace[] = [];
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
  postResetTraces.push({ name: trace.name, scenario: { team: spec.team, main: spec.main },
    passesAfterReset: trace.passesAfterReset, failureCount: trace.failureCount });
});

test('combined flat and supplied-map matrix retains post-reset passing for both teams and carrier identities', () => {
  // Match the execution gate's fixed coverage population. Neither subset alone
  // has to produce every tactical opportunity, but missing evidence still fails.
  const flat = runPassMatch();
  assert.equal(postResetTraces.length, MAP_PASS_MATCH_CASES.length);
  assert.equal(flat.length, PASS_MATCH_CASES.length);
  assert.ok(flat.every(t => t.failureCount === 0), JSON.stringify(flat.filter(t => t.failureCount).map(t => ({ name: t.name, failures: t.failures }))));
  assert.deepEqual(postResetPassCoverage([...postResetTraces, ...flat]).missing, []);
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
