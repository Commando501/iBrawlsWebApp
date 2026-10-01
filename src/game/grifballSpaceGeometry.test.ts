import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PREMADE_MAPS } from './premadeMaps';
import { toGrifballArena } from './grifballMaps';
import { getGoalPlates } from './grifballGoals';
import { seededRandom } from './simulationRandom';
import { buildGrifballSpaceGeometry, createSpaceRouterFactory, isSpaceSegmentOpen, type GrifballSpaceGeometry } from './grifballSpaceGeometry';

test('stable routing preserves the audited 7,200-query supplied-map corpus', () => {
  const random = seededRandom(1907), results = [];
  for (const map of PREMADE_MAPS.map(toGrifballArena).filter(map => getGoalPlates(map).length === 2)) {
    const geometry = buildGrifballSpaceGeometry(map, map.arenaRadius);
    const factory = createSpaceRouterFactory(geometry);
    const starts = Object.values(map.teamSpawns ?? {}).flat().map(p => ({ x: p.x, z: p.z }));
    starts.push({ x: 0, z: 0 });
    const ends = Array.from({ length: 80 }, () => ({ x: (random() * 2 - 1) * geometry.x * 1.05, z: (random() * 2 - 1) * geometry.z * 1.05 }));
    for (const start of starts) {
      const route = factory(start);
      for (const end of ends) for (const distanceOnly of [false, true]) {
        const result = route(end, distanceOnly);
        let from = start, length = 0;
        for (const point of result.points) {
          assert.ok(isSpaceSegmentOpen(geometry, from, point), `${map.id}: route crosses a blocker`);
          length += Math.hypot(point.x - from.x, point.z - from.z); from = point;
        }
        if (!distanceOnly && result.status !== 'blocked') {
          assert.deepEqual(from, end);
          assert.ok(Math.abs(length - result.length) < 1e-9);
        }
        results.push({ map: map.id, start, end, distanceOnly, route: result });
      }
    }
  }
  const encoded = JSON.stringify(results, (_key, v) => typeof v === 'number' && !Number.isFinite(v) ? { $number: String(v) } : v);
  assert.equal(results.length, 7200);
  // Stable integer-cost ties intentionally replace the original floating-cost
  // paths. All 7,200 reachability statuses match the pre-fix corpus; the maximum
  // distance-only change is < 1.8e-8. Segments are also checked independently above.
  assert.equal(createHash('sha256').update(encoded).digest('hex'), '5787e419e321ccb6ac0b4e8521e1f9bdd91ca0fd8cf979b52ee5a35de2470e6f');
});

const wall = (height = 4): GrifballSpaceGeometry => ({ key: `router-wall-${height}`, shape: 'rectangular', x: 20, z: 12,
  blockers: [{ kind: 'box', x: 0, z: 0, hx: .5, hz: height }] });

test('wall routes stay stable across the observed browser/Node carrier roundoff', () => {
  const map = toGrifballArena(PREMADE_MAPS.find(map => map.id === 'forerunner_canyon')!);
  const geometry = buildGrifballSpaceGeometry(map, map.arenaRadius);
  const factory = createSpaceRouterFactory(geometry), end = { x: -47, z: 0 };
  // The same carrier at tick 862 of the seed-101 local-player Canyon match.
  const starts = [
    { x: -12.035787978321046, z: 2.6459085930308817 },
    { x: -12.035787978321048, z: 2.6459085930308825 },
  ];
  const routes = starts.map(start => factory(start)(end));
  assert.equal(routes[0].status, 'routed');
  assert.deepEqual(routes[0].points, routes[1].points);
  assert.ok(Math.abs(routes[0].length - routes[1].length) < 1e-9);
  for (const [index, route] of routes.entries()) {
    let from = starts[index];
    for (const point of route.points) {
      assert.ok(isSpaceSegmentOpen(geometry, from, point));
      from = point;
    }
  }
  // Check both attack directions and more than the two captured float values.
  for (const side of [1, -1]) {
    const target = { x: end.x * side, z: end.z };
    const origin = { x: starts[0].x * side, z: starts[0].z };
    const expected = factory(origin)(target);
    for (const epsilon of [-1e-12, -1e-14, 0, 1e-14, 1e-12]) {
      const route = factory({ x: origin.x + epsilon, z: origin.z - epsilon })(target);
      assert.deepEqual(route.points, expected.points);
      assert.ok(Math.abs(route.length - expected.length) < 1e-9);
    }
  }
});

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
