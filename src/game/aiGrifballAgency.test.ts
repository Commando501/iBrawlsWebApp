import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { createSnapshotRouters } from './aiGrifballRunner';
import { applyGrifballSupportInitiative } from './aiGrifballAgency';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat,
  type GrifballAssignment, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { tickTankingMemory } from './aiGrifballTanking';

function setup(style: GrifballPlayerStyle = 'enforcer') {
  const player = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({
    id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true, difficulty: 'normal',
    space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer'),
      reach: 3, blastRadius: 1, attackIn: .4, mobileIn: 0, speed: 5 },
  });
  const tactics = defaultGrifballTactics(); tactics.defaults.agencyStrength = 1; tactics.defaults.stylesEnabled = false;
  tactics.defaults.passingEnabled = false; tactics.botStyles.b = style;
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: 'runner', ball: { x: 0, z: 0 }, spacing: 4, tactics,
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [player('runner', 'blue', 0, 0), player('a', 'blue', 3, -5), player('b', 'blue', 3, 5),
      player('cover', 'blue', -3, 0), player('enemy-a', 'red', 5, -5), player('enemy-b', 'red', 5, 5)] };
  const assignments: GrifballAssignment[] = ['a', 'b', 'cover'].map((id, i) => ({
    botId: id, team: 'blue', role: i === 2 ? 'safety' : 'cover', slot: i,
    destination: { ...snapshot.players.find(p => p.id === id)!.pos }, anchor: { x: 0, z: 0 }, carrierId: 'runner', reason: 'Cover',
    geometry: snapshot.geometry, tuning: tactics.defaults,
    tanking: { mode: i === 0 ? 'engage' : 'cover', targetId: i === 0 ? 'enemy-a' : null, attack: i === 0, recoveryId: 'cover',
      partnerId: null, doubleCommit: false, reason: i === 0 ? 'Primary engagement' : 'Cover', candidates: [
        { targetId: 'enemy-b', score: 3.5, protection: .3, opening: 1, delay: 0, trade: .3, coverageLost: .2, attackETA: .4, opponentETA: .7, purpose: 4 },
      ] },
  }));
  const memory = tickTankingMemory(undefined, 0), previous = new Map<string, GrifballAssignment>();
  const run = () => applyGrifballSupportInitiative(snapshot, assignments, tactics.defaults, memory, createSnapshotRouters(snapshot), previous);
  return { snapshot, assignments, tactics, memory, previous, run, b: assignments[1] };
}

test('styles migrate independently of combat settings; invalid styles and strength fail atomically', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 6; delete old.botStyles; delete old.defaults.agencyStrength;
  const migrated = validateGrifballTactics(old); assert.equal(migrated.schemaVersion, 17);
  assert.equal(migrated.defaults.agencyStrength, 0); assert.deepEqual(migrated.botStyles, {});
  const config = defaultGrifballTactics(); config.botStyles = { main_ai: 'enforcer', blue2: 'guardian' };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const botStyles of [null, [], { a: 'berserker' }, { a: 'toString' }, { '': 'guardian' }])
    assert.throws(() => validateGrifballTactics({ ...config, botStyles }));
  assert.throws(() => validateGrifballTactics({ ...old, botStyles: null }));
  for (const agencyStrength of [-1, 1.01, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { blue: { agencyStrength } } }));
  assert.equal(resolveGrifballPlayerStyle({}, 'toString'), 'balanced');
});

test('an enforcer engages a separate defender while the primary and recovery keep their jobs', () => {
  const s = setup(); s.run();
  assert.equal(s.b.agency?.choice, 'initiative'); assert.equal(s.b.tanking!.targetId, 'enemy-b');
  assert.equal(s.assignments[0].tanking!.targetId, 'enemy-a'); assert.equal(s.assignments[2].tanking!.attack, false);
  assert.equal(selectGrifballAssignmentThreat(s.b, s.snapshot.players[2].pos, s.snapshot.players), 'enemy-b');
  assert.equal(s.b.agency!.alternatives[0].reason, 'Selected');
});

test('the same opportunity produces distinct Grifball style choices', () => {
  const enforcer = setup('enforcer'), guardian = setup('guardian'), opportunist = setup('opportunist');
  enforcer.run(); guardian.run(); opportunist.run();
  assert.equal(enforcer.b.tanking!.attack, true); assert.equal(guardian.b.tanking!.attack, false);
  assert.equal(opportunist.b.tanking!.attack, false);
  Object.assign(opportunist.snapshot.players.find(p => p.id === 'enemy-b')!.space!, { phase: 'recovering', attackIn: 1.2 });
  opportunist.run(); assert.equal(opportunist.b.tanking!.attack, true);
});

for (const constraint of ['no-cover', 'late-cover', 'receiving-cover', 'receiving-bot', 'release', 'airborne', 'recovery', 'claimed', 'shared-blast', 'blocked', 'weak', 'outside-push', 'coordination-off', 'tanking-off', 'space-off', 'opposing-carrier', 'disabled'] as const)
  test(`individual initiative respects ${constraint}`, () => {
    const s = setup(), target = s.snapshot.players.find(p => p.id === 'enemy-b')!;
    if (constraint === 'no-cover') s.assignments.pop();
    if (constraint === 'late-cover') s.snapshot.players.find(p => p.id === 'cover')!.pos.x = -40;
    if (constraint === 'receiving-cover') s.assignments[2].receive = { carrierId: 'runner', point: { x: 10, z: 0 }, seconds: 1 };
    if (constraint === 'receiving-bot') s.b.receive = { carrierId: 'runner', point: { x: 10, z: 0 }, seconds: 1 };
    if (constraint === 'release') s.memory.releaseRemaining.b = .5;
    if (constraint === 'airborne') s.snapshot.players[2].space!.mobileIn = 1;
    if (constraint === 'recovery') s.snapshot.players[2].space!.phase = 'recovering';
    if (constraint === 'claimed') s.assignments[0].tanking!.targetId = 'enemy-b';
    if (constraint === 'shared-blast') { s.assignments[0].destination = { x: 4, z: 5 }; s.snapshot.players[1].pos = { x: 3, z: 4 }; }
    if (constraint === 'blocked') s.snapshot.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 }, objects: [{ type: 'box', position: { x: 4, y: 2, z: 5 }, scale: { x: 1, y: 4, z: 4 }, isCollidable: true }] } as CustomMapData, 52);
    if (constraint === 'weak') s.b.tanking!.candidates[0].score = 1;
    if (constraint === 'outside-push') {
      s.snapshot.players[2].pos = { x: 9, z: 5 }; target.pos = { x: 11, z: 5 }; target.space!.attackIn = 4;
    }
    if (constraint === 'coordination-off') s.tactics.defaults.enabled = false;
    if (constraint === 'tanking-off') s.tactics.defaults.tankingEnabled = false;
    if (constraint === 'space-off') s.tactics.defaults.spaceEnabled = false;
    if (constraint === 'opposing-carrier') s.snapshot.holderId = target.id;
    if (constraint === 'disabled') s.tactics.defaults.agencyStrength = 0;
    s.run(); assert.equal(s.b.tanking!.attack, false, JSON.stringify(s.b.agency));
  });

test('fresh target and coverage observations revoke initiative before a plan refresh', () => {
  const s = setup('opportunist'); const target = s.snapshot.players.find(p => p.id === 'enemy-b')!;
  target.pos.x = 7; Object.assign(target.space!, { phase: 'recovering', attackIn: 2 }); s.run();
  assert.equal(s.b.agency?.choice, 'initiative');
  const self = s.snapshot.players[2].pos;
  assert.equal(selectGrifballAssignmentThreat(s.b, self, s.snapshot.players), target.id);
  target.space!.phase = 'ready'; assert.equal(selectGrifballAssignmentThreat(s.b, self, s.snapshot.players), null);
  target.space!.phase = 'recovering';
  const cover = s.snapshot.players.find(p => p.id === 'cover')!;
  cover.pos.x = -40; assert.equal(selectGrifballAssignmentThreat(s.b, self, s.snapshot.players), null);
  cover.pos.x = -3;
  assert.equal(selectGrifballAssignmentThreat(s.b, self, s.snapshot.players.filter(p => p.id !== 'cover')), null);
  assert.equal(selectGrifballAssignmentThreat(s.b, self, s.snapshot.players.filter(p => p.id !== target.id)), null);
});

test('planner initiative is deterministic across roster order, mirrored sides, and continuation', () => {
  const s = setup(); s.tactics.defaults.safetyFirst = true; s.tactics.botStyles.a = 'enforcer';
  for (const enemy of s.snapshot.players.filter(p => p.team === 'red')) { enemy.pos.x = 3; enemy.pos.z = Math.sign(enemy.pos.z) * 4; }
  const make = (reverse: boolean, mirror: boolean) => {
    const snapshot = structuredClone(s.snapshot);
    if (mirror) for (const p of snapshot.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.pos.z *= -1; }
    if (reverse) snapshot.players.reverse();
    const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, snapshot, .2);
    return { state, snapshot };
  };
  const first = make(false, false), reversed = make(true, false), mirrored = make(false, true);
  assert.deepEqual(first.state.assignments, reversed.state.assignments);
  const choices = (state: typeof first.state) => ['a', 'b', 'cover'].map(id => [id, state.assignments.get(id)!.agency?.choice, state.assignments.get(id)!.tanking?.targetId]);
  assert.deepEqual(choices(first.state), choices(mirrored.state));
  assert.ok(choices(first.state).some(c => c[1] === 'initiative'), JSON.stringify([...first.state.assignments.values()].filter(a => a.team === "blue").map(a => ({ id: a.botId, role: a.role, destination: a.destination, agency: a.agency, tanking: a.tanking }))));
  const restored = structuredClone(first.state);
  updateGrifballTeamPlan(first.state, first.snapshot, .2); updateGrifballTeamPlan(restored, first.snapshot, .2);
  assert.deepEqual(first.state, restored);
  first.snapshot.holderId = null; updateGrifballTeamPlan(first.state, first.snapshot, .01);
  assert.ok([...first.state.assignments.values()].every(a => !a.agency));
});

test('zero agency strength preserves the established assignments regardless of chosen styles', () => {
  const s = setup(); s.tactics.defaults.agencyStrength = 0;
  const a = createGrifballTeamPlanState(), b = createGrifballTeamPlanState();
  updateGrifballTeamPlan(a, s.snapshot, .2); s.tactics.botStyles = { a: 'opportunist', b: 'guardian', cover: 'enforcer' };
  updateGrifballTeamPlan(b, s.snapshot, .2); assert.deepEqual(a.assignments, b.assignments);
});

test('lost opportunities release to coverage and respect the return interval', () => {
  const s = setup(); s.run(); assert.equal(s.b.agency?.choice, 'initiative');
  s.previous.set('b', structuredClone(s.b));
  s.b.tanking!.attack = false; s.b.tanking!.mode = 'cover'; s.b.tanking!.candidates[0].score = -Infinity;
  s.run(); assert.equal(s.b.tanking!.mode, 'release'); assert.equal(s.memory.releaseRemaining.b, s.tactics.defaults.tankReleaseSeconds);
  s.previous.set('b', structuredClone(s.b)); s.b.tanking!.candidates[0].score = 10;
  s.run(); assert.equal(s.b.tanking!.attack, false);
});

test('bots keep a still-useful individual target through a small score fluctuation', () => {
  const s = setup(); s.snapshot.players.push({ ...structuredClone(s.snapshot.players[5]), id: 'enemy-c', pos: { x: 6, z: 5 } });
  s.b.tanking!.candidates.push({ ...s.b.tanking!.candidates[0], targetId: 'enemy-c', score: 3.7 });
  s.previous.set('b', { ...structuredClone(s.b), agency: { style: 'enforcer', choice: 'initiative', reason: '', alternatives: [] },
    tanking: { ...structuredClone(s.b.tanking!), targetId: 'enemy-b', attack: true } });
  s.run(); assert.equal(s.b.tanking!.targetId, 'enemy-b');
});
