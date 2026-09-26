import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const p = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5.2, reach: 3, blastRadius: 2, attackIn: 0.3, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 } });
function scene(): GrifballTacticalSnapshot {
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, holderId: 'runner', spacing: 4, tactics: defaultGrifballTactics(),
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('a', 'blue', -8, 2), p('b', 'blue', -20), p('c', 'blue', -6, -6), p('runner', 'red', 0), p('escort', 'red', 2, -6)] };
}
const run = (s: GrifballTacticalSnapshot) => { const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2); return state; };
const blue = (state: ReturnType<typeof run>) => [...state.assignments.values()].filter(a => a.team === 'blue');
test('defenders intercept a visible cut, reserve one safety and assign distinct marks deterministically', () => {
  const s = scene(); s.players[3].vel = { x: -3, z: 3 };
  const state = run(s), orders = blue(state);
  assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
  assert.equal(orders.filter(a => a.role === 'safety').length, 1);
  const intercept = orders.find(a => a.defense?.mode === 'intercept')!;
  assert.ok(intercept.destination.x < 0 && intercept.destination.z > 0);
  assert.ok(orders.some(a => a.defense?.mode === 'mark' && a.defense.targetId === 'escort'));
  assert.ok(orders.every(a => !a.tanking && !a.escort));
  assert.deepEqual(blue(run({ ...s, players: [...s.players].reverse() })), orders);
  const safety = orders.find(a => a.defense?.mode === 'last-defender')!;
  assert.equal(selectGrifballAssignmentThreat(safety, { x: -10, z: 0 }, [p('side', 'red', -10, 5)]), null);
});
test('1v1 last defender holds coverage then contests a goal emergency', () => {
  const s = scene(); s.players = [p('a', 'blue', -20), p('runner', 'red', 0)];
  assert.equal(blue(run(s))[0].defense?.mode, 'last-defender');
  s.players[1].pos.x = -43; s.players[0].pos.x = -46;
  const a = blue(run(s))[0]; assert.equal(a.defense?.emergency, true);
  assert.equal(selectGrifballAssignmentThreat(a, s.players[0].pos, s.players), 'runner');
});
test('numbers, pressure preference and reachable reinforcements control containment', () => {
  const s = scene(); s.players.push(p('extra1', 'red', 4), p('extra2', 'red', 5));
  assert.ok(blue(run(s)).some(a => a.defense?.mode === 'contain'));
  s.players = s.players.filter(p => !p.id.startsWith('extra')); s.tactics!.defaults.defensePressure = 0;
  assert.ok(blue(run(s)).some(a => a.defense?.mode === 'contain'));
  s.tactics!.defaults.defensePressure = 1; s.players.push(p('extra1', 'red', 4));
  s.respawns = [{ id: 'returning', team: 'blue', seconds: 1, pos: { x: -2, z: 0 }, speed: 5.2 }];
  const state = run(s); assert.ok(blue(state).some(a => a.defense?.mode === 'contain'));
  assert.ok(blue(state).every(a => a.defense!.reinforcementIn < 2));
  assert.equal(state.assignments.has('returning'), false);
  s.respawns[0].seconds = 10; assert.ok(blue(run(s)).some(a => a.defense?.mode === 'intercept'));
});
test('turnover immediately recovers shape, losing a safety replaces it, and round reset clears memory', () => {
  const s = scene(); const state = run({ ...s, holderId: 'a' });
  updateGrifballTeamPlan(state, s, 0.01);
  assert.ok(blue(state).every(a => a.defense?.transitioning));
  const safety = blue(state).find(a => a.defense?.mode === 'last-defender')!;
  updateGrifballTeamPlan(state, { ...s, players: s.players.filter(p => p.id !== safety.botId) }, 0.01);
  assert.ok(blue(state).some(a => a.defense?.mode === 'last-defender'));
  updateGrifballTeamPlan(state, { ...s, round: 2 }, 0.01); assert.equal(state.transition.blue, 0);
  resetGrifballTeamPlan(state); assert.deepEqual(state.transition, {});
});
test('loose-ball recovery preserves retriever and safety; observed players and disabled module receive no defense orders', () => {
  const s = scene(); s.holderId = null; const state = run(s);
  assert.equal(blue(state).filter(a => a.role === 'retriever').length, 1);
  assert.equal(blue(state).filter(a => a.defense?.mode === 'last-defender').length, 1);
  s.players[0].scripted = false; assert.equal(run(s).assignments.has('a'), false);
  s.tactics!.defaults.defenseEnabled = false; assert.ok(blue(run(s)).every(a => !a.defense));
  s.tactics!.defaults.defenseEnabled = true; s.tactics!.defaults.spaceEnabled = false; assert.ok(blue(run(s)).every(a => !a.defense));
});
