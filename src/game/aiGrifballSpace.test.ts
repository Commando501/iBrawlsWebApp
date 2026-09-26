import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS as settings } from '../settings/gameplaySettings';
import type { CustomMapData, CustomMapObject } from '../types';
import { buildGrifballSpaceGeometry, createSpaceRouter, isSpaceSegmentOpen, isSpacePointOpen } from './grifballSpaceGeometry';
import { estimateSpaceAttackTime, observeGrifballSpace } from './aiGrifballSpace';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics, validateGrifballTactics, TACTICS_FIELDS } from './grifballTacticsConfig';

export const obstacle = (x: number, z: number, sx = 1, sz = 8): CustomMapObject => ({ type: 'box', position: { x, y: 1, z }, scale: { x: sx, y: 2, z: sz }, rotation: { x: 0, y: Math.PI / 4, z: 0 }, isCollidable: true } as CustomMapObject);
export const court = (objects: CustomMapObject[] = []): CustomMapData => ({ id: 'space-test', mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects } as CustomMapData);
export const player = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true, space: observeGrifballSpace(settings, 'hammer', 'ready') });
export const scene = (): GrifballTacticalSnapshot => ({ round: 1, playing: true, ball: { x: 0, z: 0 }, holderId: 'carrier', spacing: 4, goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, tactics: defaultGrifballTactics(), geometry: buildGrifballSpaceGeometry(court(), 52), players: [player('carrier', 'blue', 0, 0), player('support', 'blue', 3, 0), player('enemy', 'red', 8, 0)] });

test('ground routes detour around thin walls, reject sealed goals, and invalidate geometry on edits', () => {
  const map = court([obstacle(0, 0, 0.01)]), start = { x: -8, z: 0 }, end = { x: 8, z: 0 };
  const g = buildGrifballSpaceGeometry(map, 52), route = createSpaceRouter(g, start)(end);
  assert.equal(route.status, 'routed'); assert.ok(route.length > 16);
  route.points.forEach((p, i) => assert.ok(isSpaceSegmentOpen(g, i ? route.points[i - 1] : start, p)));
  map.objects[0].scale.z = 60;
  const sealed = buildGrifballSpaceGeometry(map, 52);
  assert.notEqual(sealed.key, g.key);
  assert.equal(createSpaceRouter(sealed, start)(end).status, 'blocked');
  assert.deepEqual(createSpaceRouter(sealed, start)(end).points, []);
});

test('collision footprints respect ground height, cylinders, spheres, boundaries and noncollidable goal plates', () => {
  const plate = { ...obstacle(47, 0), type: 'cylinder', isCollidable: false } as CustomMapObject;
  const overhead = obstacle(0, 0); overhead.position.y = 5;
  const g = buildGrifballSpaceGeometry(court([plate, overhead]), 52);
  assert.ok(isSpaceSegmentOpen(g, { x: 0, z: 0 }, { x: 47, z: 0 }));
  assert.equal(isSpacePointOpen(g, { x: 52, z: 0 }), false);
  for (const type of ['cylinder', 'sphere'] as const) {
    const shape = { ...obstacle(0, 0, 4, 4), type };
    assert.equal(isSpaceSegmentOpen(buildGrifballSpaceGeometry(court([shape]), 52), { x: -8, z: 0 }, { x: 8, z: 0 }), false);
  }
  assert.equal(isSpacePointOpen(buildGrifballSpaceGeometry(null, 20), { x: 15, z: 15 }), false);
  const wall = buildGrifballSpaceGeometry(court([obstacle(0, 0, 2, 8)]), 52);
  assert.ok(isSpaceSegmentOpen(wall, { x: 1.55, z: 0 }, { x: 2, z: 0 }), 'a combatant already touching a wall can move away');
  assert.ok(isSpacePointOpen(wall, { x: 1.4, z: 4.4 }), 'rounded clearance agrees with physics at box corners');
});

test('threat timing uses visible phase, momentum, mechanics, sword reach and blocked routes', () => {
  const p = player('e', 'red', 0, 0), target = { x: 12, z: 0 };
  const ready = estimateSpaceAttackTime(p, target, 12);
  p.vel.x = 5; assert.ok(estimateSpaceAttackTime(p, target, 12) < ready);
  p.vel.x = -5; assert.ok(estimateSpaceAttackTime(p, target, 12) > ready);
  p.vel.x = 0; p.space = observeGrifballSpace(settings, 'hammer', 'recovering', 0);
  assert.ok(estimateSpaceAttackTime(p, target, 12) > ready);
  p.space = observeGrifballSpace(settings, 'hammer', 'swing_down', 0.1);
  assert.ok(estimateSpaceAttackTime(p, target, 12) < ready);
  p.space = observeGrifballSpace({ ...settings, attackRadius: settings.attackRadius + 3 }, 'hammer', 'ready');
  assert.ok(estimateSpaceAttackTime(p, target, 12) < ready);
  assert.equal(estimateSpaceAttackTime(p, target, Infinity), Infinity);
  p.space = observeGrifballSpace({ ...settings, swordLungeDistance: 15, swordLungeSpeed: 30 }, 'sword', 'ready');
  assert.ok(estimateSpaceAttackTime(p, target, 12) < estimateSpaceAttackTime(p, target, 20));
});

test('support chooses less shared hammer exposure and keeps deterministic stable destinations', () => {
  const s = scene(), plan = createGrifballTeamPlanState();
  s.tactics!.defaults.runnerEnabled = false;
  s.players[0].scripted = false;
  updateGrifballTeamPlan(plan, s, 0.2);
  const a = plan.assignments.get('support')!;
  assert.ok(a.space); assert.ok(a.space.selected);
  assert.ok(a.space.selected.sharedExposure < a.space.candidates[0].sharedExposure);
  assert.ok(a.space.selected.supportETA < 3);
  const destination = { ...a.destination };
  updateGrifballTeamPlan(plan, s, 0.2);
  assert.deepEqual(plan.assignments.get('support')!.destination, destination);
  const reordered = createGrifballTeamPlanState(); updateGrifballTeamPlan(reordered, { ...s, players: [...s.players].reverse() }, 0.2);
  assert.deepEqual(reordered.assignments.get('support')!.destination, destination);
});

test('objective routes never substitute a clamped target; 1v1, team disable and goal approach remain valid', () => {
  const s = scene(), plan = createGrifballTeamPlanState();
  s.tactics!.defaults.runnerEnabled = false;
  s.geometry = buildGrifballSpaceGeometry(court([obstacle(20, 0, 1, 60)]), 52);
  updateGrifballTeamPlan(plan, s, 0.2);
  assert.equal(plan.assignments.get('carrier')!.space!.route.status, 'blocked');
  assert.deepEqual(plan.assignments.get('carrier')!.destination, s.players[0].pos);
  s.tactics!.teams.blue = { spaceEnabled: false }; updateGrifballTeamPlan(plan, s, 0.2);
  assert.equal(plan.assignments.get('carrier')!.space, undefined);
  assert.equal(plan.assignments.get('carrier')!.destination.x, 47);
  s.tactics!.teams.blue = {}; s.geometry = buildGrifballSpaceGeometry(court(), 52);
  s.players = [s.players[0], s.players[2]]; s.players[0].pos.x = 46.9;
  updateGrifballTeamPlan(plan, s, 0.2);
  assert.equal(plan.assignments.get('carrier')!.space!.route.status, 'direct');
  assert.ok(Number.isFinite(plan.assignments.get('carrier')!.space!.selected!.score));
});

test('v1 tactical presets migrate without losing team overrides and still reject incomplete defaults', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 1; delete old.defaults.spaceEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'space') delete old.defaults[key];
  old.teams.blue = { leadForward: 9 };
  const migrated = validateGrifballTactics(old);
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.defaults.spaceEnabled, true); assert.equal(migrated.teams.blue!.leadForward, 9);
  delete old.defaults.enabled; assert.throws(() => validateGrifballTactics(old));
});
