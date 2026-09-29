import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_MATCH_CASES, runMapMatchTrace } from './grifballMapMatch';
import { isMapBodyClear } from './grifballMapCollisionOracle';
import type { CustomMapData } from '../../src/types';

for (const spec of MAP_MATCH_CASES) test(`complete supplied-map match ${spec.map.id}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runMapMatchTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, trace.ticks);
  assert.ok(trace.ticks <= 108000);
  const terminal = trace.frames.find(f => f.phase === 'matchEnd')!;
  assert.equal(trace.ticks - terminal.tick, 181);
});

test('complete map match matrix retains both teams, orders and carrier identities on five maps', () => {
  assert.equal(MAP_MATCH_CASES.length, 40);
  assert.equal(new Set(MAP_MATCH_CASES.map(s => `${s.map.id}/${s.team}/${s.reverse}/${s.main}`)).size, 40);
  assert.equal(new Set(MAP_MATCH_CASES.map(s => s.map.id)).size, 5);
});
for (const mapId of ['forerunner_canyon', 'rainy_industrial_streets', 'championship_stadium']) test(`complete supplied-map match repeats: ${mapId}`, () => {
  const spec = MAP_MATCH_CASES.find(s => s.map.id === mapId && s.main)!;
  assert.deepEqual(runMapMatchTrace(spec), runMapMatchTrace(spec));
});

for (const type of ['box', 'cylinder', 'sphere'] as const) test(`map collision oracle rejects body penetration: ${type}`, () => {
  const map = { objects: [{ type, isCollidable: true, position: { x: 0, y: 1, z: 0 }, scale: { x: 2, y: 2, z: 2 } }] } as CustomMapData;
  assert.equal(isMapBodyClear(map, { x: 0, y: 0, z: 0 }), false);
  assert.equal(isMapBodyClear(map, { x: 1.54, y: 0, z: 0 }), false);
  assert.equal(isMapBodyClear(map, { x: 1.55, y: 0, z: 0 }), true);
  assert.equal(isMapBodyClear(map, { x: 0, y: 4, z: 0 }), true);
  if (type !== 'sphere') assert.equal(isMapBodyClear(map, { x: 0, y: 2, z: 0 }), true);
});
test('map body oracle allows rounded box-corner contact but rejects penetration', () => {
  const map = { objects: [{ type: 'box', isCollidable: true, position: { x: 0, y: 1, z: 0 }, scale: { x: 2, y: 2, z: 2 } }] } as CustomMapData;
  assert.equal(isMapBodyClear(map, { x: 1 + .55 / Math.SQRT2, y: 0, z: 1 + .55 / Math.SQRT2 }), true);
  assert.equal(isMapBodyClear(map, { x: 1.38, y: 0, z: 1.38 }), false);
});
