import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, validateGrifballTactics, TACTICS_FIELDS } from './grifballTacticsConfig';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { createBotCoordinator, setTacticalBotEngagements, clearBotEngagements, registerBotEngagement, getBotCoordRole, getEngagingBotIds, resetBotCoordinator } from './aiBotCoordinator';

const p = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer'), reach: 3, blastRadius: 1.5, attackIn: 0.4, speed: 5 } });
const geometry = () => buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52);
function scene(): GrifballTacticalSnapshot {
  const tactics = defaultGrifballTactics(); tactics.defaults.tankDoubleThreshold = 1.5; tactics.defaults.defenseEnabled = false;
  return { round: 1, playing: true, holderId: 'runner', ball: { x: 0, z: 0 }, spacing: 4, geometry: geometry(), tactics,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('runner', 'blue', 0, 0), p('a', 'blue', 4, -4), p('b', 'blue', 4, 4), p('c', 'blue', -4, 0), p('enemy', 'red', 5, 0)] };
}
const blue = (state: ReturnType<typeof createGrifballTeamPlanState>) => [...state.assignments.values()].filter(a => a.team === 'blue' && a.tanking);
const run = (s = scene()) => { const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2); return state; };

function defaultScene(): GrifballTacticalSnapshot {
  const s = scene(); s.tactics = defaultGrifballTactics();
  s.players[1].pos = { x: 5, z: -7 }; s.players[2].pos = { x: 5, z: 7 }; s.players[3].pos = { x: -10, z: 0 };
  for (const player of s.players) player.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS,
    player.id === 'runner' ? 'ball' : 'hammer', player.id === 'enemy' ? 'recovering' : 'ready');
  return s;
}

function reserveHandoffScene(team: 'blue' | 'red'): GrifballTacticalSnapshot {
  const s = scene(), sign = team === 'blue' ? 1 : -1;
  s.players = [p('runner', team, 0, 0), p('near', team, 2 * sign, -2 * sign),
    p('far', team, -38 * sign, 15 * sign), p('enemy', team === 'blue' ? 'red' : 'blue', 5 * sign, 0)];
  s.tactics!.defaults.stylesEnabled = false;
  return s;
}

for (const team of ['blue', 'red'] as const) for (const reverse of [false, true])
  test(`the only nearby escort protects the runner while a distant teammate recovers: ${team}/${reverse}`, () => {
    const s = reserveHandoffScene(team);
    if (reverse) s.players.reverse();
    const state = run(s), near = state.assignments.get('near')!, far = state.assignments.get('far')!;
    assert.equal(near.tanking?.mode, 'engage', 'reserving the only useful protector must not leave both escorts passive');
    assert.equal(near.tanking.targetId, 'enemy');
    assert.equal(near.tanking.attack, true);
    assert.equal(near.tanking.recoveryId, 'far');
    assert.equal(far.tanking?.attack, false);
    assert.ok([...state.assignments.values()].every(a => !a.tanking?.doubleCommit), 'distant recovery is not ready double-team coverage');
    assert.equal(selectGrifballAssignmentThreat(near, s.players.find(p => p.id === 'near')!.pos, s.players), 'enemy');
  });

for (const team of ['blue', 'red'] as const)
  for (const boundary of ['recovering', 'airborne', 'release', 'low-value', 'slow-opening', 'other-attacker', 'blocked-recovery', 'observed-teammate'] as const)
    test(`runner-protection reserve handoff respects ${boundary}: ${team}`, () => {
      const s = reserveHandoffScene(team), sign = team === 'blue' ? 1 : -1;
      const near = s.players[1], far = s.players[2], state = createGrifballTeamPlanState();
      if (boundary === 'recovering') Object.assign(near.space!, { phase: 'recovering', attackIn: 5 });
      if (boundary === 'airborne') near.space!.mobileIn = 5;
      if (boundary === 'low-value') s.tactics!.defaults.tankMinimumScore = 10;
      if (boundary === 'slow-opening') s.tactics!.defaults.supportSeconds = .25;
      if (boundary === 'other-attacker') far.pos = { x: 4 * sign, z: 4 * sign };
      if (boundary === 'observed-teammate') far.scripted = false;
      if (boundary === 'blocked-recovery') s.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
        arenaHalfExtents: { x: 52, z: 23 }, objects: [{ type: 'box', position: { x: -20 * sign, y: 2, z: 0 },
          scale: { x: 1, y: 4, z: 46 }, isCollidable: true }] } as CustomMapData, 52);
      if (boundary === 'release') {
        updateGrifballTeamPlan(state, s, .2);
        state.tankingMemory[team].releaseRemaining.near = 1;
      }
      updateGrifballTeamPlan(state, s, .2);
      const order = state.assignments.get('near')!.tanking!;
      if (boundary === 'observed-teammate') {
        assert.equal(order.recoveryId, null, 'a human/neural teammate cannot be assigned scripted recovery');
        assert.equal(state.assignments.has('far'), false);
      } else {
        assert.equal(order.attack, false, boundary);
        assert.equal(order.recoveryId, 'near', 'retain the reserve when the handoff is unavailable');
      }
      assert.ok([...state.assignments.values()].every(a => !a.tanking?.doubleCommit));
    });

for (const team of ['blue', 'red'] as const) for (const reverse of [false, true]) for (const main of [false, true]) {
  test(`default hammer pair preserves spacing and coverage: ${team}, reverse=${reverse}, main=${main}`, () => {
    const s = defaultScene();
    if (main) s.players[1].id = 'main_ai';
    if (team === 'red') for (const player of s.players) {
      player.team = player.team === 'blue' ? 'red' : 'blue';
      player.pos = { x: -player.pos.x, z: -player.pos.z };
    }
    if (reverse) s.players.reverse();
    const orders = [...run(s).assignments.values()].filter(a => a.team === team && a.tanking);
    const pair = orders.filter(a => a.tanking!.doubleCommit);
    assert.equal(pair.length, 2, JSON.stringify(orders.map(a => a.tanking)));
    assert.ok(Math.hypot(pair[0].destination.x - pair[1].destination.x, pair[0].destination.z - pair[1].destination.z) > DEFAULT_ADMIN_SETTINGS.attackRadius * 2 + .5);
    assert.equal(pair[0].tanking!.partnerId, pair[1].botId);
    assert.equal(pair[1].tanking!.partnerId, pair[0].botId);
    assert.ok(pair.every(a => a.tanking!.attack && a.tanking!.targetId === 'enemy'));
    if (main) assert.ok(pair.some(a => a.botId === 'main_ai'));
    const reserve = orders.find(a => a.botId === pair[0].tanking!.recoveryId)!;
    assert.ok(reserve && !reserve.tanking!.attack && !pair.includes(reserve));
  });
}

for (const unsafe of ['ready', 'closing-recovery', 'shared-blast', 'late-cover', 'blocked-primary', 'blocked-partner'] as const) {
  test(`default hammer double commit still rejects ${unsafe}`, () => {
    const s = defaultScene(), initial = blue(run(s));
    assert.equal(initial.filter(a => a.tanking!.doubleCommit).length, 2, 'control must earn a commitment');
    if (unsafe === 'ready') s.players[4].space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer');
    if (unsafe === 'closing-recovery') s.players[4].space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer', 'recovering', .59);
    if (unsafe === 'shared-blast') { s.players[1].pos.z = -2; s.players[2].pos.z = 2; }
    if (unsafe === 'late-cover') s.players[3].pos.x = -30;
    if (unsafe.startsWith('blocked-')) {
      const destination = initial.find(a => a.tanking!.mode === (unsafe === 'blocked-primary' ? 'engage' : 'punish'))!.destination;
      s.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
        arenaHalfExtents: { x: 52, z: 23 }, objects: [{ type: 'box', position: { ...destination, y: 1 }, scale: { x: .1, y: 2, z: .1 }, isCollidable: true }],
      } as CustomMapData, 52);
    }
    const orders = blue(run(s));
    assert.ok(orders.every(a => !a.tanking!.doubleCommit));
    if (unsafe === 'ready') {
      const primary = orders.find(a => a.tanking!.mode === 'engage')!;
      assert.ok(Math.abs(Math.hypot(primary.destination.x - 5, primary.destination.z) - 3) < 1e-8);
    }
  });
}

test('a default-timing punisher rechecks the remaining recovery window between plan refreshes', () => {
  const s = defaultScene();
  const assignment = blue(run(s)).find(a => a.tanking!.mode === 'punish')!;
  const actor = s.players.find(p => p.id === assignment.botId)!;
  // Move into the engagement boundary without rebuilding the cached order.
  actor.pos.z *= .75;
  assert.equal(selectGrifballAssignmentThreat(assignment, actor.pos, s.players), 'enemy');
  s.players[4].space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer', 'recovering', .59);
  assert.equal(selectGrifballAssignmentThreat(assignment, actor.pos, s.players), null);
  s.players[4].pos = { ...actor.pos, x: actor.pos.x + 1 };
  assert.equal(selectGrifballAssignmentThreat(assignment, actor.pos, s.players), 'enemy', 'immediate self-defense remains available');
});

test('one primary tank, a waiting punisher and explicit recovery coverage are stable across roster order', () => {
  const s = scene(), state = run(s), orders = blue(state);
  assert.equal(orders.filter(a => a.tanking!.attack).length, 1);
  assert.ok(orders.every(a => !a.escort));
  assert.equal(orders.filter(a => a.tanking!.mode === 'punish' && !a.tanking!.attack).length, 1);
  const recovery = orders.find(a => a.botId === a.tanking!.recoveryId)!;
  assert.equal(recovery.tanking!.mode, 'cover'); assert.ok(recovery.destination.x < 0);
  const reverse = run({ ...s, players: [...s.players].reverse() });
  assert.deepEqual(blue(reverse), orders);
});

test('two-player commit requires value, a visible opening and a spare recovery bot', () => {
  const s = scene(); Object.assign(s.players[4].space!, { phase: 'recovering', attackIn: 2 });
  const state = run(s), commits = blue(state).filter(a => a.tanking!.attack);
  assert.equal(commits.length, 2, JSON.stringify(blue(state).map(a => a.tanking)));
  assert.ok(commits.every(a => a.tanking!.doubleCommit));
  assert.ok(blue(state).some(a => a.botId === commits[0].tanking!.recoveryId && !a.tanking!.attack));
  s.tactics!.defaults.tankDoubleThreshold = 15; assert.equal(blue(run(s)).filter(a => a.tanking!.attack).length, 1);
  s.tactics!.defaults.tankDoubleThreshold = 0; s.players = s.players.filter(p => p.id !== 'c');
  assert.equal(blue(run(s)).filter(a => a.tanking!.attack).length, 1);
});

test('a ready partner rotates into a recovering primary without skipping cooldowns', () => {
  const s = scene(), state = run(s);
  const primary = blue(state).find(a => a.tanking!.mode === 'engage')!;
  Object.assign(s.players.find(p => p.id === primary.botId)!.space!, { phase: 'recovering', attackIn: 2 });
  updateGrifballTeamPlan(state, s, 0.2);
  const replacement = blue(state).find(a => a.tanking!.mode === 'engage')!;
  assert.notEqual(replacement.botId, primary.botId); assert.match(replacement.tanking!.reason, /Rotate/);
  assert.equal(s.players.find(p => p.id === primary.botId)!.space!.attackIn, 2);
});

test('carrier breakthrough releases a no-longer-useful duel despite commitment', () => {
  const s = scene(), state = run(s); s.tactics!.defaults.tankCommitSeconds = 3;
  s.players[0].pos.x = 25; updateGrifballTeamPlan(state, s, 0.01);
  assert.ok(blue(state).every(a => !a.tanking!.attack));
  assert.ok(blue(state).some(a => a.tanking!.mode === 'release'));
  assert.equal(state.tankingMemory.blue.targetId, null);
});

test('outnumbered defenders delay on the goal side but contest imminent scoring', () => {
  const s = scene(); s.holderId = 'enemy';
  s.players = [p('a', 'blue', -8, 0), p('enemy', 'red', 0, 0), p('e2', 'red', 3, 4), p('e3', 'red', 3, -4)];
  const state = run(s); const a = state.assignments.get('a')!;
  assert.equal(a.tanking!.mode, 'delay'); assert.ok(a.destination.x < 0); assert.equal(a.tanking!.attack, false);
  assert.equal(selectGrifballAssignmentThreat(a, s.players[0].pos, s.players), null);
  s.players[0].pos.x = -44; s.players[1].pos.x = -42; updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.assignments.get('a')!.tanking!.mode, 'engage');
});

test('shared hammer exposure prevents a second commit even at a zero double-team threshold', () => {
  const s = scene(); s.tactics!.defaults.tankDoubleThreshold = 0;
  Object.assign(s.players[4].space!, { phase: 'recovering', attackIn: 1.5, blastRadius: 10 });
  assert.equal(blue(run(s)).filter(a => a.tanking!.doubleCommit).length, 0);
});

test('blocked routes and irrelevant side duels are not engagement candidates', () => {
  const s = scene(); s.players[4].pos = { x: 35, z: 20 }; assert.equal(blue(run(s)).filter(a => a.tanking!.attack).length, 0);
  s.players[4].pos = { x: 8, z: 0 }; s.players.filter(p => p.team === 'blue').forEach(p => p.pos.x = -5);
  s.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [
    { type: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 60 }, isCollidable: true },
  ] } as CustomMapData, 52);
  assert.equal(blue(run(s)).filter(a => a.tanking!.attack).length, 0);
});

test('a stale punish opening closes immediately; cover still permits immediate self-defense', () => {
  const s = scene(); Object.assign(s.players[4].space!, { phase: 'recovering', attackIn: 2 });
  const state = run(s), punisher = blue(state).find(a => a.tanking!.mode === 'punish')!;
  const self = s.players.find(p => p.id === punisher.botId)!;
  self.pos = { x: 1, z: 3 }; // Now within the normal combat engagement range.
  assert.equal(selectGrifballAssignmentThreat(punisher, self.pos, s.players), 'enemy');
  s.players[4].space!.phase = 'ready'; assert.equal(selectGrifballAssignmentThreat(punisher, self.pos, s.players), null);
  s.players[4].pos = { ...self.pos, x: self.pos.x + 1 }; assert.equal(selectGrifballAssignmentThreat(punisher, self.pos, s.players), 'enemy');
});

test('disable, possession changes, death and phase reset clear or invalidate tank commitments', () => {
  for (const event of ['disable', 'space', 'coordination', 'death', 'throw', 'phase'] as const) {
    const s = scene(), state = run(s);
    if (event === 'disable') s.tactics!.teams.blue = { tankingEnabled: false };
    if (event === 'space') s.tactics!.teams.blue = { spaceEnabled: false };
    if (event === 'coordination') s.tactics!.teams.blue = { enabled: false };
    if (event === 'death') s.players = s.players.filter(p => p.id !== 'enemy');
    if (event === 'throw') s.holderId = null;
    if (event === 'phase') s.playing = false;
    updateGrifballTeamPlan(state, s, 0.001);
    if (['disable', 'space', 'coordination', 'phase'].includes(event)) { assert.equal(state.tankingMemory.blue, undefined); assert.equal(blue(state).length, 0); }
    if (event === 'death') assert.ok(blue(state).every(a => a.tanking!.targetId !== 'enemy'));
    if (event === 'throw') assert.ok([...state.assignments.values()].some(a => a.team === 'blue' && a.role === 'retriever'));
  }
  const state = run(); resetGrifballTeamPlan(state); assert.deepEqual(state.tankingMemory, {});
});

test('tactical roles seed the existing coordinator before roster updates and clear cleanly', () => {
  const coordinator = createBotCoordinator();
  setTacticalBotEngagements(coordinator, [['z', { targetId: 'enemy', role: 'pressure' }], ['a', { targetId: 'enemy', role: 'flanker' }]]);
  clearBotEngagements(coordinator); registerBotEngagement(coordinator, 'a', 'enemy');
  assert.deepEqual(getEngagingBotIds(coordinator, 'enemy'), ['a', 'z']);
  assert.equal(getBotCoordRole({ coordinator, botId: 'z', targetId: 'enemy', difficulty: 'normal' }), 'pressure');
  assert.equal(getBotCoordRole({ coordinator, botId: 'a', targetId: 'enemy', difficulty: 'normal' }), 'flanker');
  setTacticalBotEngagements(coordinator, []); assert.deepEqual(getEngagingBotIds(coordinator, 'enemy'), []);
  resetBotCoordinator(coordinator); assert.equal(coordinator.tacticalEngagements.size, 0);
});

test('schema v3 migrates tanking defaults and preserves explicit existing settings', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 3; delete old.defaults.tankingEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'tanking') delete old.defaults[key];
  old.teams.blue = { runnerEnabled: false, runnerCutWidth: 6 };
  const current = validateGrifballTactics(old); assert.equal(current.schemaVersion, 39); assert.equal(current.defaults.tankingEnabled, true);
  assert.deepEqual(current.teams.blue, old.teams.blue);
  assert.throws(() => validateGrifballTactics({ ...current, teams: { blue: { tankCommitSeconds: -1 } } }));
});


test('a distant reserve does not authorize a double commit until recovery can arrive', () => {
  const s = scene(); Object.assign(s.players[4].space!, { phase: 'recovering', attackIn: 2 });
  const state = run(s), reserveId = blue(state)[0].tanking!.recoveryId!;
  s.players.find(p => p.id === reserveId)!.pos = { x: -40, z: 15 };
  updateGrifballTeamPlan(state, s, 0.2);
  assert.ok(blue(state).every(a => !a.tanking!.doubleCommit));
  assert.ok(blue(state).some(a => /coverage to arrive/.test(a.tanking!.reason)));
});


test('uneven defenders retain distinct delay positions and a 1v1 contest needs no partner', () => {
  const s = scene(); s.holderId = 'enemy';
  s.players = [p('a', 'blue', -8, 3), p('b', 'blue', -8, -3), p('enemy', 'red', 0, 0), p('e2', 'red', 3, 4), p('e3', 'red', 3, -4)];
  const state = run(s), delaying = blue(state);
  assert.ok(delaying.every(a => a.tanking!.mode === 'delay'));
  assert.notDeepEqual(delaying[0].destination, delaying[1].destination);
  s.players = [s.players[0], s.players[2]]; s.players[0].pos = { x: -3, z: 0 };
  const solo = blue(run(s))[0]; assert.equal(solo.tanking!.mode, 'engage'); assert.equal(solo.tanking!.doubleCommit, false);
});


test('delay spacing respects the whole push, including escorts with greater reach than the carrier', () => {
  const s = scene(); s.holderId = 'enemy';
  s.players = [p('a', 'blue', -12, 0), p('enemy', 'red', 0, 0), p('escort', 'red', -1, 2)];
  s.players[1].space!.reach = 1.5; s.players[2].space!.reach = 8;
  const a = run(s).assignments.get('a')!; assert.equal(a.tanking!.mode, 'delay');
  for (const enemy of s.players.slice(1)) assert.ok(Math.hypot(a.destination.x - enemy.pos.x, a.destination.z - enemy.pos.z) >= enemy.space!.reach + s.tactics!.defaults.tankDelayMargin - 0.001);
});
