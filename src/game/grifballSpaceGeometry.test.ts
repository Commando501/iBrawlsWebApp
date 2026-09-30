import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PREMADE_MAPS } from './premadeMaps';
import { toGrifballArena } from './grifballMaps';
import { getGoalPlates } from './grifballGoals';
import { seededRandom } from './simulationRandom';
import { buildGrifballSpaceGeometry, createSpaceRouterFactory, isSpaceSegmentOpen, type GrifballSpaceGeometry } from './grifballSpaceGeometry';

test('shared routing preserves the pre-optimization 7,200-query supplied-map corpus', () => {
  const random = seededRandom(1907), results = [];
  for (const map of PREMADE_MAPS.map(toGrifballArena).filter(map => getGoalPlates(map).length === 2)) {
    const geometry = buildGrifballSpaceGeometry(map, map.arenaRadius);
    const factory = createSpaceRouterFactory(geometry);
    const starts = Object.values(map.teamSpawns ?? {}).flat().map(p => ({ x: p.x, z: p.z }));
    starts.push({ x: 0, z: 0 });
    const ends = Array.from({ length: 80 }, () => ({ x: (random() * 2 - 1) * geometry.x * 1.05, z: (random() * 2 - 1) * geometry.z * 1.05 }));
    for (const start of starts) {
      const route = factory(start);
      for (const end of ends) for (const distanceOnly of [false, true]) results.push({ map: map.id, start, end, distanceOnly, route: route(end, distanceOnly) });
    }
  }
  const encoded = JSON.stringify(results, (_key, v) => typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v);
  assert.equal(results.length, 7200);
  // Captured from ed8edc3's independent per-player routers before changing routing.
  assert.equal(createHash('sha256').update(encoded).digest('hex'), '4f5fabd210dfce3f528bd7eecbba3d97a6ce150786ed8ba02fa8af57e85b0189');
});

const wall = (height = 4): GrifballSpaceGeometry => ({ key: `router-wall-${height}`, shape: 'rectangular', x: 20, z: 12,
  blockers: [{ kind: 'box', x: 0, z: 0, hx: .5, hz: height }] });

test('shared endpoints keep each origin independent and returned paths cannot poison later queries', () => {
  const geometry = wall(), factory = createSpaceRouterFactory(geometry);
  const start = { x: -8, z: 0 }, end = { x: 8, z: 0 };
  const left = factory(start), right = factory(end);
  const expected = structuredClone(left(end));
  assert.equal(expected.status, 'routed');
  let from = { ...start };
  for (const point of expected.points) { assert.ok(isSpaceSegmentOpen(geometry, from, point)); from = point; }
  assert.deepEqual(right(end), { status: 'direct', points: [end], length: 0 });
  const returned = left(end); returned.points[0].x = 900;
  const originalEnd = { ...end };
  end.z = 8; assert.notDeepEqual(left(end), expected);
  start.x = 8; // A router belongs to the captured snapshot, not a mutable live position.
  assert.deepEqual(left(originalEnd), expected);
  assert.deepEqual(factory(start)(originalEnd), { status: 'direct', points: [originalEnd], length: 0 });
});

test('endpoint eviction and other geometry factories preserve reachable and blocked results', () => {
  const geometry = wall(), route = createSpaceRouterFactory(geometry)({ x: -8, z: 0 });
  const end = { x: 8, z: 0 }, expected = route(end);
  // More distinct obstructed endpoints than the cache cap; eviction affects only work.
  for (let i = 0; i < 2100; i++) assert.equal(route({ x: 8, z: i / 1000 - 1.05 }, true).status, 'routed');
  assert.deepEqual(route(end), expected);
  const sealed = createSpaceRouterFactory(wall(20))({ x: -8, z: 0 });
  for (const distanceOnly of [false, true]) {
    assert.deepEqual(sealed(end, distanceOnly), { status: 'blocked', points: [], length: Infinity });
    assert.deepEqual(route({ x: 0, z: 0 }, distanceOnly), { status: 'blocked', points: [], length: Infinity });
    assert.deepEqual(route({ x: 21, z: 0 }, distanceOnly), { status: 'blocked', points: [], length: Infinity });
  }
  assert.deepEqual(route(end), expected);
});

test('reusing a router preserves results across near, far, direct and blocked query orders', () => {
  const geometry = wall(9), start = { x: -2, z: 9.8 };
  const endpoints = [{ x: 2, z: 8 }, { x: 15, z: -10 }, { x: 2, z: 0 }, { x: -10, z: 8 },
    { x: 0, z: 0 }, { x: 21, z: 0 }, { x: 2, z: -8 }, { x: 15, z: 10 }];
  const expected = endpoints.map(end => [false, true].map(distanceOnly => createSpaceRouterFactory(geometry)(start)(end, distanceOnly)));
  assert.ok(expected.some(pair => pair[0].status === 'routed'));
  assert.ok(expected.some(pair => pair[0].status === 'blocked'));
  for (const order of [[0, 1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1, 0], [4, 3, 0, 7, 5, 2, 6, 1]]) {
    const route = createSpaceRouterFactory(geometry)(start);
    for (const index of [...order, ...[...order].reverse()]) for (const distanceOnly of [false, true]) {
      assert.deepEqual(route(endpoints[index], distanceOnly), expected[index][Number(distanceOnly)]);
    }
  }
});

test('route queries isolate modes, metadata mutations and signed-zero endpoints', () => {
  const geometry = wall(), start = { x: -8, z: 0 }, end = { x: 8, z: 0 };
  const factory = createSpaceRouterFactory(geometry), route = factory(start);
  const path = structuredClone(route(end)), distance = structuredClone(route(end, true));
  assert.equal(path.status, 'routed');
  assert.ok(path.points.length > 0); assert.deepEqual(distance.points, []);
  const changed = route(end); changed.length = -1; changed.status = 'blocked'; changed.points.length = 0;
  const changedDistance = route(end, true); changedDistance.length = -2; changedDistance.points.push({ x: 900, z: 900 });
  assert.deepEqual(route(end), path); assert.deepEqual(route(end, true), distance);
  for (const distanceOnly of [false, true]) for (const z of [0, -0, 0, -0]) {
    const point = { x: -4, z };
    assert.deepEqual(route(point, distanceOnly), factory(start)(point, distanceOnly));
    assert.ok(Object.is(route(point, distanceOnly).points[0].z, z));
  }
});
