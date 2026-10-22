import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics, validateGrifballTactics, TACTICS_FIELDS } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { planGrifballPass, predictBallRecovery } from './aiGrifballPassing';
import { createSnapshotRouters } from './aiGrifballRunner';
import { createInitialBall, throwBall, tickBallPhysics, isBallGrabbable } from './grifballBall';
const p = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: id === 'runner' ? 'ball' : 'hammer', phase: 'ready', speed: 5.2, reach: 3, blastRadius: 2, attackIn: 0.3, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 } });
function scene(): GrifballTacticalSnapshot {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  return { round: 1, playing: true, ball: { x: -20, z: 0 }, holderId: 'runner', spacing: 4, tactics: defaultGrifballTactics(),
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('runner', 'blue', -20), p('receiver', 'blue', -8), p('enemy', 'red', -44, 15)] };
}
const plan = (s: GrifballTacticalSnapshot) => planGrifballPass(s, s.players[0], s.tactics!.defaults, createSnapshotRouters(s));
test('passing uses actual settling physics and gives a reachable receiver a rendezvous', () => {
  const s = scene(), pass = plan(s); assert.ok(pass.selected, JSON.stringify(pass.candidates));
  const c = pass.selected!, ball = createInitialBall({ x: -20, y: 0, z: 0 });
  throwBall(ball, { x: -20, y: 1.1, z: 0 }, { ...c.direction, y: 0 }, c.speed);
  assert.equal(isBallGrabbable(ball), false);
  for (let i = 0; i < Math.round(c.seconds * 60); i++) tickBallPhysics(ball, 1 / 60, 8, s.passing!.bounds);
  assert.equal(ball.state, 'loose'); assert.equal(ball.pos.x, c.point.x); assert.equal(ball.pos.z, c.point.z);
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  const receiver = state.assignments.get(c.receiverId)!;
  assert.ok(receiver.receive); assert.equal(receiver.tanking, undefined); assert.deepEqual(receiver.destination, c.point);
  assert.deepEqual(plan({ ...s, players: [s.players[0], ...s.players.slice(1).reverse()] }), pass);
});
test('reject contested pickups, exposed receivers, absent receivers and unavailable or observed participants', () => {
  const s = scene(), point = plan(s).selected!.point;
  s.players[2].pos = { ...point };
  const contested = plan(s); assert.ok(contested.candidates.filter(c => c.point.x === point.x).every(c => !c.viable));
  assert.ok(!contested.selected || contested.selected.opponentETA > contested.selected.seconds + contested.selected.chargeSeconds + s.tactics!.defaults.passSafetyMargin);
  s.players = s.players.slice(0, 1); assert.equal(plan(s).selected, null);
  const s2 = scene(); s2.players[1].scripted = false; assert.equal(plan(s2).selected, null);
  s2.players[1].scripted = true; s2.players[1].space!.phase = 'recovering'; assert.equal(plan(s2).selected, null);
  const s3 = scene(); s3.players[0].height = 2; assert.equal(plan(s3).selected, null);
  s3.players[0].height = 0; s3.players[0].scripted = false; assert.equal(plan(s3).selected, null);
});
test('throwing disabled, blocked geometry, imminent respawns and tuning reject unsafe passes', () => {
  const s = scene(); s.passing!.allowed = false; assert.equal(plan(s).selected, null);
  s.passing!.allowed = true; s.tactics!.defaults.passingEnabled = false; assert.equal(plan(s).selected, null);
  s.tactics!.defaults.passingEnabled = true; s.tactics!.defaults.passMaxReceiveSeconds = 0.5;
  assert.ok(plan(s).candidates.every(c => !c.viable || c.receiverETA <= 0.5));
  const s2 = scene(), point = plan(s2).selected!.point;
  s2.respawns = [{ id: 'returning', team: 'red', pos: point, seconds: 0.1, speed: 10 }]; assert.equal(plan(s2).selected, null);
  const s3 = scene(); s3.geometry!.blockers.push({ kind: 'box', x: -15, z: 0, hx: 0.1, hz: 23 });
  assert.equal(plan(s3).selected, null);
});
test('in-flight receivers target the predicted settled ball and replace a dead receiver', () => {
  const s = scene(), c = plan(s).selected!, ball = createInitialBall({ x: -20, y: 0, z: 0 });
  throwBall(ball, { x: -20, y: 1.1, z: 0 }, { ...c.direction, y: 0 }, c.speed);
  s.holderId = null; s.ballPhysics = ball;
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  const receiver = [...state.assignments.values()].find(a => a.team === 'blue' && a.role === 'retriever')!;
  assert.deepEqual(receiver.destination, predictBallRecovery(ball, s.passing!.bounds).point);
  updateGrifballTeamPlan(state, { ...s, players: s.players.filter(p => p.id !== receiver.botId) }, 0.01);
  assert.ok([...state.assignments.values()].some(a => a.team === 'blue' && a.role === 'retriever' && a.receive));
});
test('schema v5 migrates older presets and validates new fields and partial overrides', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 41);
  const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = 4;
  delete old.defaults.defenseEnabled; delete old.defaults.passingEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'defense') delete old.defaults[key];
  assert.deepEqual(validateGrifballTactics(old), current);
  current.teams.blue = { passingEnabled: false, defensePressure: 1 }; assert.deepEqual(validateGrifballTactics(current), current);
  assert.throws(() => validateGrifballTactics({ ...current, defaults: { ...current.defaults, passSafetyMargin: -1 } }));
  assert.throws(() => validateGrifballTactics({ ...current, defaults: { ...current.defaults, defensePressure: NaN } }));
});

test('a still-safe charged pass keeps its receiver and power across planning refreshes', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  const pass = state.passPlans.blue, alternative = pass.candidates.find(c => c.viable && c.speed !== pass.selected!.speed)!;
  assert.ok(alternative);
  state.passCharge = { carrierId: 'runner', receiverId: alternative.receiverId, speed: alternative.speed, elapsed: 0.1 };
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.passPlans.blue.selected!.speed, alternative.speed);
  s.tactics!.defaults.passingEnabled = false; updateGrifballTeamPlan(state, s, 0.01);
  assert.equal(state.passPlans.blue, undefined); assert.equal(state.passCharge, null);
});
