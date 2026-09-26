import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { defaultGrifballTactics, validateGrifballTactics, TACTICS_FIELDS } from './grifballTacticsConfig';

const p = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true, space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer', 'ready') });
function scene(): GrifballTacticalSnapshot {
  return { round: 1, playing: true, holderId: 'runner', ball: { x: 0, z: 0 }, spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, tactics: defaultGrifballTactics(),
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    players: [p('runner', 'blue', 0, 0), p('a', 'blue', 3, 4), p('b', 'blue', 1, -4), p('c', 'blue', -3, 0), p('enemy', 'red', 30, 0)] };
}

test('clear lane advances, reachable goal finishes, and escorts advance after breakthrough', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'advance');
  const before = state.assignments.get('a')!.destination.x;
  const runner = s.players[0]; runner.pos.x = 12; s.players[4].pos.x = -15;
  updateGrifballTeamPlan(state, s, 0.8);
  assert.ok(state.assignments.get('a')!.destination.x > before + 5);
  for (const a of state.assignments.values()) if (a.team === 'blue' && a.role !== 'runner') assert.ok(a.escort);
  runner.pos.x = 44; updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'finish');
  assert.deepEqual(state.assignments.get('runner')!.destination, s.goals.red);
});

test('cuts away from forward pressure and commits across small observation changes', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players = [s.players[0], p('enemy', 'red', 5, -2)];
  Object.assign(s.players[1].space!, { reach: 3, speed: 3, attackIn: 0.4 });
  s.tactics!.defaults.runnerCutWidth = 6;
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'cut-left');
  const target = { ...state.runnerPlans.blue.selected.destination };
  s.players[1].pos.z += 0.1; updateGrifballTeamPlan(state, s, 0.2);
  assert.deepEqual(state.runnerPlans.blue.selected.destination, target);
  const reversed = createGrifballTeamPlanState(); updateGrifballTeamPlan(reversed, { ...s, players: [...s.players].reverse() }, 0.2);
  assert.equal(reversed.runnerPlans.blue.selected.action, 'cut-left');
});

test('coverage wait and retreat are bounded by actual progress, even with an immobile carrier', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players = [s.players[0], p('ally', 'blue', -9, 0), p('enemy', 'red', 6, 0)];
  Object.assign(s.players[1].space!, { reach: 2, speed: 5, attackIn: 0.4 });
  Object.assign(s.players[2].space!, { reach: 3, speed: 3, attackIn: 0.4 });
  Object.assign(s.tactics!.defaults, { runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 });
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'wait');
  const actions = new Set<string>();
  for (let i = 0; i < 25; i++) { updateGrifballTeamPlan(state, s, 0.2); actions.add(state.runnerPlans.blue.selected.action); }
  assert.ok(actions.has('retreat'));
  assert.equal(state.runnerPlans.blue.forcedProgress, true);
  assert.equal(state.runnerPlans.blue.selected.action, 'advance');
  assert.ok(state.runnerMemory.blue.waitUsed <= 2.21);
  s.players[0].pos.x = 3; updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerMemory.blue.stalledSeconds, 0);
  assert.equal(state.runnerMemory.blue.waitUsed, 0);
});

test('a solo runner never waits for nonexistent coverage', () => {
  const s = scene(), state = createGrifballTeamPlanState(); s.players = [s.players[0], p('enemy', 'red', 5, 0)];
  updateGrifballTeamPlan(state, s, 0.2);
  assert.notEqual(state.runnerPlans.blue.selected.action, 'wait');
});

test('rear pursuit is assigned to safety and escort screens leave the route corridor clear', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players.push(p('rear', 'red', -7, 0)); updateGrifballTeamPlan(state, s, 0.2);
  const safety = [...state.assignments.values()].find(a => a.team === 'blue' && a.role === 'safety')!;
  assert.equal(safety.escort!.kind, 'rear-guard'); assert.equal(safety.escort!.targetId, 'rear');
  const targets = [...state.assignments.values()].filter(a => a.team === 'blue').flatMap(a => a.escort?.targetId ? [a.escort.targetId] : []);
  assert.equal(new Set(targets).size, targets.length);
  for (const a of state.assignments.values()) if (a.team === 'blue' && ['lead', 'cover'].includes(a.role)) assert.ok(Math.abs(a.destination.z) >= s.tactics!.defaults.escortLaneWidth - 0.001);
});

test('human heading and velocity lead escorts without assigning orders to the human', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players[0].scripted = false; s.players[0].vel = { x: 0, z: 5 };
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.assignments.has('runner'), false);
  assert.equal(state.runnerPlans.blue.selected.action, 'observed');
  assert.ok(state.runnerPlans.blue.selected.destination.z > 0);
  assert.ok(state.assignments.get('a')!.destination.z > 0);
  s.players[0].vel.z = 0; s.players[0].heading = { x: 0, z: -1 }; updateGrifballTeamPlan(state, s, 0.2);
  assert.ok(state.runnerPlans.blue.selected.destination.z < 0);
});

test('new obstacle invalidates a committed push and every replacement route remains reachable', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  const old = state.runnerPlans.blue.selected.destination;
  const map = { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [
    { type: 'box', position: { x: 4, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 8 }, isCollidable: true },
  ] } as CustomMapData;
  s.geometry = buildGrifballSpaceGeometry(map, 52); updateGrifballTeamPlan(state, s, 0.2);
  const route = state.runnerPlans.blue.selected.route;
  assert.notDeepEqual(state.runnerPlans.blue.selected.destination, old);
  assert.notEqual(route.status, 'blocked');
  route.points.forEach((point, i) => assert.ok(isSpaceSegmentOpen(s.geometry!, i ? route.points[i - 1] : s.players[0].pos, point)));
});

test('disable, thrown ball, carrier death and round reset clear runner and escort memory immediately', () => {
  for (const event of ['disable', 'space-off', 'throw', 'death', 'round'] as const) {
    const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
    if (event === 'disable') s.tactics!.teams.blue = { runnerEnabled: false };
    if (event === 'space-off') s.tactics!.teams.blue = { spaceEnabled: false };
    if (event === 'throw') s.holderId = null;
    if (event === 'death') s.players.shift();
    if (event === 'round') s.playing = false;
    updateGrifballTeamPlan(state, s, 0.001);
    assert.equal(state.runnerPlans.blue, undefined); assert.equal(state.runnerMemory.blue, undefined);
    assert.ok([...state.assignments.values()].every(a => !a.runner && !a.escort));
  }
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, scene(), 0.2); resetGrifballTeamPlan(state);
  assert.deepEqual(state.runnerPlans, {}); assert.deepEqual(state.runnerMemory, {});
});

test('v2 presets migrate runner defaults and retain existing explicit overrides', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 2; delete old.defaults.runnerEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'runner') delete old.defaults[key];
  old.teams.red = { spaceEnabled: false, lateralSpacing: 5 };
  const migrated = validateGrifballTactics(old);
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.defaults.runnerEnabled, true);
  assert.deepEqual(migrated.teams.red, old.teams.red);
  assert.throws(() => validateGrifballTactics({ ...migrated, teams: { blue: { runnerMaxWait: -1 } } }));
});


test('short-handed teams still cover rear pursuit without a dedicated safety slot', () => {
  for (const escorts of [1, 2]) {
    const s = scene(), state = createGrifballTeamPlanState();
    s.players = [s.players[0], ...s.players.slice(1, escorts + 1), p('rear', 'red', -7, 0)];
    updateGrifballTeamPlan(state, s, 0.2);
    const rearGuard = [...state.assignments.values()].filter(a => a.escort?.kind === 'rear-guard');
    assert.equal(rearGuard.length, 1);
    assert.equal(rearGuard[0].escort!.targetId, 'rear');
    assert.ok(rearGuard[0].escort!.destination.x < s.players[0].pos.x);
  }
});
