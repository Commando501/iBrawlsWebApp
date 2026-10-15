import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_MATCH_CASES, runMapMatchTrace } from './grifballMapMatch';
import { isMapBodyClear } from './grifballMapCollisionOracle';
import type { CustomMapData } from '../../src/types';
import * as THREE from 'three';
import { resolveObstacleCollisions } from '../../src/game/mapPhysics';

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

for (const type of ['box', 'cylinder'] as const) for (const [edge, centerY, y, clear] of [
  ['above-top-skin', 1, 1.9500000000000002, true],
  ['at-top-skin', 1, 1.95, false],
  ['inside-top-skin', 1, 1.9499999999999, false],
  ['below-underside-skin', 4, 1.0499999999999, true],
  ['at-underside-skin', 4, 1.05, false],
  ['inside-underside-skin', 4, 1.0500000000001, false],
] as const) test(`vertical collision skin agrees with resolved contact: ${type}/${edge}`, () => {
  const map = { objects: [{ type, isCollidable: true, position: { x: 0, y: centerY, z: 0 }, scale: { x: 2, y: 2, z: 2 } }] } as CustomMapData;
  const pos = new THREE.Vector3(0, y, 0), vel = new THREE.Vector3(0, 1, 0);
  assert.equal(isMapBodyClear(map, pos), clear);
  const resolved = resolveObstacleCollisions(pos, vel, map.objects);
  assert.equal(resolved.position.equals(pos), clear, 'only actual vertical overlap requires horizontal correction');
  assert.equal(isMapBodyClear(map, resolved.position), true);
});

test('vertical collision skin accepts the recorded ascending Rainy Industrial crate skim', () => {
  const map = MAP_MATCH_CASES.find(s => s.map.id === 'rainy_industrial_streets')!.map;
  // cover at tick 23,740 in the retained 71196c70 development trace.
  const pos = new THREE.Vector3(15.594153612297394, 1.9500000000000002, 10.032779083814887);
  assert.equal(isMapBodyClear(map, pos), true);
  assert.equal(isMapBodyClear(map, { x: pos.x, y: 1.94, z: pos.z }), false);
  const resolved = resolveObstacleCollisions(pos, new THREE.Vector3(-6.738217990309976, 12.199999999999996, -1.3645670797227267), map.objects);
  assert.deepEqual(resolved.position.toArray(), pos.toArray());
});
