import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { observeGrifballStyle, resolveGrifballStyle, chooseTacticalAlternative, type GrifballStyleMemory } from './aiGrifballStyle';
import { defaultGrifballTactics, TACTICS_FIELDS, validateGrifballTactics, type TacticalNumber } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { createGrifballTeamPlanState, resetGrifballTeamPlan, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const player = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer'), speed: 5, reach: 3, attackIn: 0.4 } });
function scene(): GrifballTacticalSnapshot {
  const tactics = defaultGrifballTactics(); tactics.defaults.passingEnabled = false;
  return { round: 1, playing: true, rosterKey: 'stable-roster', ball: { x: 0, z: 0 }, holderId: 'runner', spacing: 4, tactics,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    players: [player('runner', 'blue', 0, 0), player('a', 'blue', 3, 4), player('b', 'blue', 1, -4), player('c', 'blue', -3, 0), player('enemy', 'red', 20, 0)] };
}
const run = (s: GrifballTacticalSnapshot, seed = 1) => { const state = createGrifballTeamPlanState(); state.styleSeed = seed; updateGrifballTeamPlan(state, s, 0); return state; };

test('neutral style preserves numeric module settings; extremes remain within validated ranges without mutation', () => {
  const base = defaultGrifballTactics().defaults, saved = structuredClone(base);
  assert.deepEqual(resolveGrifballStyle(base, undefined, 'blue', 1).tuning, base);
  for (const extreme of [0, 1]) {
    const input = { ...base, styleAggression: extreme, stylePatience: extreme, styleWidth: extreme, styleSupportDistance: extreme, styleRunnerRisk: extreme };
    for (const difficulty of [0, 1, 2, 3]) {
      const result = resolveGrifballStyle(input, undefined, 'blue', difficulty);
      for (const [key, field] of Object.entries(TACTICS_FIELDS)) assert.ok(result.tuning[key as TacticalNumber] >= field.min && result.tuning[key as TacticalNumber] <= field.max, key);
      for (const [key, value] of Object.entries(input)) if (typeof value === 'boolean') assert.equal(result.tuning[key as keyof typeof input], value);
    }
  }
  assert.deepEqual(base, saved);
});

test('styles visibly change escort width, support distance, tank utility and runner patience with team isolation', () => {
  const compact = scene(); compact.tactics!.teams.blue = { styleWidth: 0, styleSupportDistance: 0, styleAggression: 0, stylePatience: 0, styleRunnerRisk: 0, tankingEnabled: false };
  const wide = structuredClone(compact); wide.tactics!.teams.blue = { styleWidth: 1, styleSupportDistance: 1, styleAggression: 1, stylePatience: 1, styleRunnerRisk: 1, tankingEnabled: false };
  const a = run(compact), b = run(wide);
  const first = a.assignments.get('a')!, second = b.assignments.get('a')!;
  assert.ok(Math.abs(second.destination.z) > Math.abs(first.destination.z)); assert.ok(second.destination.x > first.destination.x);
  assert.ok(second.tuning!.tankMinimumScore < first.tuning!.tankMinimumScore);
  assert.ok(second.tuning!.runnerMaxWait > first.tuning!.runnerMaxWait); assert.ok(second.tuning!.runnerRiskWeight < first.tuning!.runnerRiskWeight);
  assert.deepEqual(a.stylePlans.red, b.stylePlans.red);
  assert.deepEqual([...a.assignments.values()].filter(p => p.team === 'red'), [...b.assignments.values()].filter(p => p.team === 'red'));
});

test('seeded near-tie choices repeat across order and never select nonfinite or lower-quality options', () => {
  const choices = [{ id: 'a', score: 10 }, { id: 'b', score: 9.8 }, { id: 'bad', score: 8 }, { id: 'blocked', score: -Infinity }, { id: 'invalid', score: NaN }];
  const results = new Set<string>();
  for (let seed = 0; seed < 30; seed++) {
    const context = { seed, key: 'play', window: 0.3 };
    const a = chooseTacticalAlternative(choices, c => c.score, c => c.id, context)!;
    const b = chooseTacticalAlternative([...choices].reverse(), c => c.score, c => c.id, context)!;
    assert.equal(a.id, b.id); assert.ok(a.score >= 9.7); results.add(a.id);
  }
  assert.deepEqual(results, new Set(['a', 'b']));
  assert.equal(chooseTacticalAlternative(choices, c => c.score, c => c.id, { seed: 5, key: 'play', window: 0 })!.id, 'a');
});

test('runner variations are stable across frames and roster order; goal finishes and progress timeout take precedence', () => {
  const actions = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const s = scene(); s.players = [s.players[0], player('enemy', 'red', 5, 0)]; Object.assign(s.players[1].space!, { speed: 3, reach: 1.5, attackIn: 0.8 });
    Object.assign(s.tactics!.defaults, { styleVariation: 1, runnerCutWidth: 6 });
    const state = run(s, seed), reverse = run({ ...s, players: [...s.players].reverse() }, seed);
    const action = state.runnerPlans.blue.selected.action; actions.add(action);
    assert.deepEqual(state.runnerPlans.blue, reverse.runnerPlans.blue);
    for (let frame = 0; frame < 30; frame++) updateGrifballTeamPlan(state, s, 1 / 60);
    assert.equal(state.runnerPlans.blue.selected.action, action);
    state.runnerMemory.blue.stalledSeconds = 9; updateGrifballTeamPlan(state, s, 0.4);
    assert.equal(state.runnerPlans.blue.selected.action, 'advance');
    s.players[0].pos.x = 44; updateGrifballTeamPlan(state, s, 0.01);
    assert.equal(state.runnerPlans.blue.selected.action, 'finish');
  }
  assert.ok(actions.has('cut-left') && actions.has('cut-right'));
});

test('observation count depends on elapsed sampling time, not render rate or roster size', () => {
  const observe = (hz: number) => {
    const s = scene(); s.players[4].vel.x = -5; let memory: GrifballStyleMemory | undefined;
    for (let i = 0; i < hz * 6; i++) memory = observeGrifballStyle(memory, s, 'blue', 1 / hz);
    return memory!;
  };
  assert.deepEqual(observe(30).samples, observe(120).samples); assert.equal(observe(60).samples.length, 12);
  const s = scene(); s.players[4].vel.x = -5;
  assert.equal(observeGrifballStyle(undefined, s, 'blue', 60).samples.length, 1);
  assert.equal(observeGrifballStyle(undefined, scene(), 'blue', 1).samples.length, 0);
});

test('adaptation needs evidence and confidence; inconsistent, stale or disabled evidence does not change style', () => {
  const s = scene(), base = s.tactics!.defaults; s.players[4].vel.x = -5;
  let memory: GrifballStyleMemory | undefined;
  for (let i = 0; i < 8; i++) memory = observeGrifballStyle(memory, s, 'blue', 0.5);
  assert.equal(resolveGrifballStyle(base, memory, 'blue', 1).plan.adapting, false);
  for (let i = 0; i < 4; i++) memory = observeGrifballStyle(memory, s, 'blue', 0.5);
  const adapted = resolveGrifballStyle(base, memory, 'blue', 1);
  assert.equal(adapted.plan.confidence, 1); assert.equal(adapted.plan.adapting, true);
  assert.ok(adapted.plan.preferences.width > 0.5 && adapted.plan.preferences.runnerRisk < 0.5 && adapted.plan.preferences.supportDistance < 0.5);
  for (const patch of [{ adaptationEnabled: false }, { adaptationStrength: 0 }]) assert.deepEqual(resolveGrifballStyle({ ...base, ...patch }, memory, 'blue', 1).plan.preferences, resolveGrifballStyle(base, undefined, 'blue', 1).plan.preferences);
  memory!.samples = Array.from({ length: 24 }, (_, i) => ({ pressure: i % 2, width: i % 2 }));
  assert.equal(resolveGrifballStyle(base, memory, 'blue', 1).plan.adapting, false);
  s.players[4].vel.x = 0; observeGrifballStyle(memory, s, 'blue', 4);
  assert.equal(memory!.samples.length, 0);
});

test('learner survives possession/death observations, but round, roster, disable and match reset clear it', () => {
  const s = scene(); s.players[4].vel.x = -5; const state = run(s);
  for (let i = 0; i < 12; i++) updateGrifballTeamPlan(state, s, 0.5);
  assert.equal(state.stylePlans.blue.adapting, true);
  s.holderId = null; s.players = s.players.filter(p => p.id !== 'c'); updateGrifballTeamPlan(state, s, 0);
  assert.equal(state.styleMemory.blue.samples.length, 12);
  s.round++; updateGrifballTeamPlan(state, s, 0); assert.equal(state.styleMemory.blue.samples.length, 0);
  updateGrifballTeamPlan(state, s, 0.5); s.rosterKey = 'new-roster'; updateGrifballTeamPlan(state, s, 0); assert.equal(state.styleMemory.blue.samples.length, 0);
  s.tactics!.teams.blue = { adaptationEnabled: false }; updateGrifballTeamPlan(state, s, 0);
  assert.equal(state.styleMemory.blue, undefined); assert.equal(state.stylePlans.blue.adapting, false);
  s.tactics!.teams.blue = { stylesEnabled: false, styleWidth: 1 }; updateGrifballTeamPlan(state, s, 0);
  assert.equal(state.stylePlans.blue, undefined); assert.equal(state.assignments.get('a')!.tuning!.lateralSpacing, 4);
  resetGrifballTeamPlan(state); assert.deepEqual(state.styleMemory, {}); assert.deepEqual(state.stylePlans, {}); assert.equal(state.stylePlay, 0);
});

test('easy decisions refresh later and project less; urgent events still replan without changing mechanics', () => {
  const easy = scene(); easy.teamDifficulty = { blue: 0, red: 3 };
  const before = structuredClone(easy.players.map(p => p.space)); const state = run(easy);
  assert.ok(Math.abs(state.stylePlans.blue.refreshSeconds - 0.35) < 1e-9); assert.equal(state.stylePlans.blue.predictionScale, 0.6);
  assert.ok(state.stylePlans.red.refreshSeconds < state.stylePlans.blue.refreshSeconds);
  const assignment = state.assignments.get('a'); updateGrifballTeamPlan(state, easy, 0.15);
  assert.equal(state.assignments.get('a'), assignment);
  easy.players[0].pos.x = 44; updateGrifballTeamPlan(state, easy, 0.01);
  assert.equal(state.runnerPlans.blue.selected.action, 'finish');
  easy.holderId = 'enemy'; easy.players[4].pos.x = -44; updateGrifballTeamPlan(state, easy, 0.01);
  assert.ok([...state.assignments.values()].some(a => a.team === 'blue' && a.defense?.emergency));
  assert.deepEqual(easy.players.map(p => p.space), before);
});

test('humans and neural observers receive no assignments regardless of style or difficulty', () => {
  const s = scene(); s.players[0].scripted = false; s.players[1].scripted = false; s.players[1].difficulty = 'neural-net';
  const state = run(s); assert.equal(state.assignments.has('runner'), false); assert.equal(state.assignments.has('a'), false);
  assert.equal(state.runnerPlans.blue.selected.action, 'observed');
});

test('v5 migration supplies style defaults, keeps team overrides and rejects invalid style controls atomically', () => {
  const old = JSON.parse(JSON.stringify(defaultGrifballTactics())); old.schemaVersion = 5; old.teams.red = { styleWidth: 0.8 };
  delete old.defaults.stylesEnabled; delete old.defaults.adaptationEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'styles') delete old.defaults[key];
  const config = validateGrifballTactics(old); assert.equal(config.schemaVersion, 24); assert.equal(config.defaults.stylesEnabled, true); assert.equal(config.teams.red!.styleWidth, 0.8);
  for (const patch of [{ styleAggression: 1.01 }, { adaptationMinSamples: NaN }, { adaptationConfidence: 0.4 }, { stylesEnabled: 1 }]) assert.throws(() => validateGrifballTactics({ ...config, teams: { blue: patch } }));
});


test('tank variation keeps recovery reserved and holds a chosen near-equal engagement', () => {
  const owners = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const s = scene(); s.players[1].pos = { x: 4, z: 4 }; s.players[2].pos = { x: 4, z: -4 }; s.players[3].pos.x = -4; s.players[4].pos.x = 5;
    Object.assign(s.tactics!.defaults, { styleVariation: 1, tankCoverageWeight: 0 });
    const state = run(s, seed), primary = state.tankingMemory.blue.primaryId;
    assert.ok(primary); owners.add(primary);
    const tank = state.assignments.get(primary)!.tanking!;
    assert.notEqual(primary, tank.recoveryId); assert.ok(tank.recoveryId);
    assert.equal(state.assignments.get(tank.recoveryId)!.tanking!.attack, false);
    updateGrifballTeamPlan(state, s, 0.21); assert.equal(state.tankingMemory.blue.primaryId, primary);
    const reversed = run({ ...s, players: [...s.players].reverse() }, seed);
    assert.equal(reversed.tankingMemory.blue.primaryId, primary);
  }
  assert.equal(owners.size, 2);
});

test('each urgent distance interrupts easy-team cadence independently', () => {
  const s = scene(); s.teamDifficulty = { blue: 0, red: 0 }; s.players[0].pos.x = 38.5;
  const state = run(s); const revision = state.revision; // Tank emergency is 9 m, defense 8 m, finish 7 m.
  s.players[0].pos.x = 39.5; updateGrifballTeamPlan(state, s, 0.01); assert.equal(state.revision, revision + 1);
  s.players[0].pos.x = 40.5; updateGrifballTeamPlan(state, s, 0.01); assert.equal(state.revision, revision + 2);
  assert.equal(state.runnerPlans.blue.selected.action, 'finish');
});
