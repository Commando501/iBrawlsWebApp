import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { chooseGrifballRunnerPursuit, runnerPursuitRules } from './aiGrifballRunnerPursuit';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createGrifballTeamPlanState, selectGrifballAssignmentThreat, updateGrifballTeamPlan,
  type GrifballAssignment, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { evaluateTacticalWeaponChoice } from './aiTacticalWeaponChoice';

function fixture() {
  const settings = { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' as const };
  const config = defaultGrifballTactics(); config.defaults.runnerPursuitEnabled = true;
  const players: GrifballTacticalPlayer[] = [
    { id: 'defender', team: 'blue', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, scripted: true, difficulty: 'normal',
      space: observeGrifballSpace(settings, 'hammer'), height: 0 },
    { id: 'runner', team: 'red', pos: { x: 8, z: 0 }, vel: { x: 5.8, z: 0 }, scripted: false,
      heading: { x: 1, z: 0 }, space: observeGrifballSpace(settings, 'ball'), height: 0 },
  ];
  const assignment: GrifballAssignment = { botId: 'defender', team: 'blue', role: 'chaser', slot: 0,
    carrierId: 'runner', anchor: { x: 8, z: 0 }, destination: { x: 16.7, z: 0 }, reason: '', tuning: config.defaults,
    geometry: { key: 'court', shape: 'rectangular', x: 60, z: 30, blockers: [] },
    defense: { mode: 'intercept', targetId: 'runner', intercept: { x: 16.7, z: 0 }, arrivalETA: 3, carrierETA: 1.5,
      advantage: 0, reinforcementIn: Infinity, emergency: false, transitioning: false,
      pursuit: { rules: runnerPursuitRules(settings), goal: { x: 50, z: 0 }, weapon: null, reason: '',
        hammerETA: null, swordETA: null, horizon: 1.5, intercept: null } } };
  return { settings, config, players, assignment, run: () => chooseGrifballRunnerPursuit(assignment, players) };
}

test('escaping runner releases an unreachable hammer cut for a finite sword interception', () => {
  const f = fixture(), before = structuredClone(f.assignment), result = f.run()!;
  assert.equal(result.weapon, 'sword'); assert.equal(result.hammerETA, null);
  assert.ok(result.swordETA! > f.settings.weaponReadyTime); assert.ok(result.intercept!.x > 8);
  assert.equal(selectGrifballAssignmentThreat(f.assignment, f.players[0].pos, f.players), 'runner');
  assert.deepEqual(f.assignment, before, 'assessment and target selection stay read-only');
  f.config.defaults.runnerPursuitEnabled = false;
  assert.equal(f.run(), null);
  assert.equal(selectGrifballAssignmentThreat(f.assignment, f.players[0].pos, f.players), null);
});

test('approaching and slower runners retain feasible hammer cuts, including sprint capability', () => {
  const f = fixture(); f.players[1].vel.x = -5.8;
  assert.equal(f.run()!.weapon, null); assert.notEqual(f.run()!.hammerETA, null);
  f.players[1].vel.x = 1; f.config.defaults.defenseLookahead = 3;
  assert.notEqual(f.run()!.hammerETA, null);
  f.players[1].vel.x = 5.8; f.assignment.defense!.pursuit!.rules = runnerPursuitRules({ ...f.settings, enableSprint: true, speedSprint: 250 });
  assert.notEqual(f.run()!.hammerETA, null); assert.equal(f.run()!.weapon, null);
});

test('finite sword travel, swap preparation, and goal deadline reject impossible catches', () => {
  for (const variant of ['too-fast', 'too-far', 'swap', 'goal', 'zero-speed'] as const) {
    const f = fixture();
    if (variant === 'too-fast') f.players[1].vel.x = 20;
    if (variant === 'too-far') f.players[1].pos.x = 20;
    if (variant === 'swap') f.assignment.defense!.pursuit!.rules.swapReady = 1.5;
    if (variant === 'goal') f.assignment.defense!.pursuit!.goal.x = 10;
    if (variant === 'zero-speed') f.assignment.defense!.pursuit!.rules.lungeSpeed = 0;
    assert.equal(f.run()!.weapon, null, variant);
  }
});

test('swords cannot shortcut a wall or pursue a forecast through a blocker', () => {
  const f = fixture();
  f.assignment.geometry!.blockers.push({ kind: 'box', x: 4, z: 0, hx: .1, hz: 4 });
  assert.equal(f.run()!.weapon, null); assert.match(f.run()!.reason, /No open sword approach/);
  f.assignment.geometry!.blockers[0].x = 10;
  assert.equal(f.run()!.weapon, null); assert.equal(f.run()!.swordETA, null);
});

test('coverage and containment remain reserved; an imminent goal emergency may release the last defender', () => {
  const f = fixture();
  f.players[0].pos = { x: 12, z: 8 };
  for (const mode of ['last-defender', 'contain', 'mark', 'recover'] as const) {
    f.assignment.defense!.mode = mode;
    assert.equal(f.run()!.weapon, null, mode);
  }
  f.assignment.defense!.mode = 'last-defender'; f.assignment.defense!.emergency = true;
  f.players[0].pos = { x: 0, z: 0 };
  assert.equal(f.run()!.weapon, 'sword');
  f.assignment.defense!.emergency = false;
  assert.equal(f.run()!.weapon, 'sword', 'a beaten last defender has no goal-side line left to preserve');
});

test('visible forward punches delay new sword pursuit without claiming a free kill', () => {
  const f = fixture(); f.players[1].space!.phase = 'swing_up'; f.players[1].heading = { x: -1, z: 0 };
  assert.equal(f.run()!.weapon, null); assert.match(f.run()!.reason, /punch/);
  f.players[1].heading.x = 1; assert.equal(f.run()!.weapon, 'sword');
  f.players[1].heading.x = -1; f.players[1].space!.phase = 'recovering'; assert.equal(f.run()!.weapon, 'sword');
});

test('ownership, protection, current mobility and locked swaps prevent new pursuit', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.players[0].scripted = false; },
    f => { f.players[0].difficulty = 'easy'; }, f => { f.players[0].space!.mobileIn = .1; },
    f => { f.players[0].space!.phase = 'recovering'; }, f => { f.players[1].height = 1; },
    f => { f.players[1].invulnerabilityTimer = 1; }, f => { f.players[0].swapLockoutRemaining = 1; },
    f => { f.players[1].space!.weapon = 'hammer'; }, f => { f.players[1].team = 'blue'; },
    f => { f.players[1].vel.x = 0; }, f => { f.players[0].space!.weapon = 'ball'; },
  ]) { const f = fixture(); change(f); assert.equal(f.run()!.weapon, null); }
});

test('dependency switches remove pursuit and mirrored teams produce mirrored cuts', () => {
  for (const key of ['runnerPursuitEnabled', 'enabled', 'spaceEnabled', 'defenseEnabled'] as const) {
    const f = fixture(); f.config.defaults[key] = false; assert.equal(f.run(), null);
  }
  const f = fixture(), original = f.run()!;
  f.assignment.team = 'red'; f.assignment.defense!.pursuit!.goal.x *= -1;
  for (const p of f.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.vel.x *= -1; if (p.heading) p.heading.x *= -1; }
  const mirror = f.run()!; assert.equal(mirror.weapon, 'sword'); assert.equal(mirror.swordETA, original.swordETA);
  assert.equal(mirror.intercept!.x, -original.intercept!.x);
});

test('shared tactical choice prioritizes feasible runner pursuit and respects weapon and action restrictions', () => {
  const f = fixture(), input: Parameters<typeof evaluateTacticalWeaponChoice>[0] = {
    settings: f.settings, self: { id: 'defender', hp: 2, maxHp: 2, activeWeapon: 'hammer', pos: { x: 0, y: 0, z: 0 } }, actors: [],
    target: { id: 'runner', pos: { x: 8, y: 0, z: 0 }, hp: 2, activeWeapon: 'ball', isLunging: false, weaponState: 'ready' },
    difficulty: 'normal', context: { runnerPursuit: f.run(), canStartWeaponAction: true, weaponState: 'ready', weaponSwapIQ: 0, weaponPrioritization: 50 },
    pressureAggression: 50, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: () => 1,
  };
  assert.equal(evaluateTacticalWeaponChoice(input).weapon, 'sword');
  for (const patch of [{ weaponPrioritization: 0 }, { canStartWeaponAction: false }, { weaponState: 'swing_up' },
    { recentLungeMemory: { outcome: 'miss_timeout' as const, targetId: 'runner', timeRemaining: 1 } }]) {
    assert.notEqual(evaluateTacticalWeaponChoice({ ...input, context: { ...input.context, ...patch } }).weapon, 'sword');
  }
  assert.notEqual(evaluateTacticalWeaponChoice({ ...input, difficulty: 'easy' }).weapon, 'sword');
  assert.notEqual(evaluateTacticalWeaponChoice({ ...input, target: { ...input.target, invulnerabilityTimer: 1 } }).weapon, 'sword');
  assert.equal(evaluateTacticalWeaponChoice({ ...input, self: { ...input.self, activeWeapon: 'sword' },
    context: { ...input.context, canStartWeaponAction: false } }).weapon, 'sword', 'retain the prepared sword while normal readiness blocks attacks');
});

test('production planner creates diagnostics, releases the unreachable cut, and clears on possession change', () => {
  const f = fixture(), plan = createGrifballTeamPlanState();
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: 'runner', ball: { x: 8, z: 0 },
    players: [...f.players, { ...structuredClone(f.players[0]), id: 'safety', pos: { x: 35, z: 0 } }],
    goals: { blue: { x: 50, z: 0 }, red: { x: -50, z: 0 } }, spacing: 4, geometry: f.assignment.geometry,
    tactics: f.config, runnerPursuitRules: runnerPursuitRules(f.settings) };
  updateGrifballTeamPlan(plan, snapshot, .1);
  const a = plan.assignments.get('defender')!;
  assert.equal(a.defense?.mode, 'intercept'); assert.equal(a.defense.pursuit?.weapon, 'sword');
  assert.equal(selectGrifballAssignmentThreat(a, f.players[0].pos, snapshot.players), 'runner');
  assert.equal(plan.assignments.get('safety')!.defense!.pursuit!.weapon, null);
  snapshot.holderId = null; updateGrifballTeamPlan(plan, snapshot, .1);
  assert.ok([...plan.assignments.values()].every(a => !a.defense?.pursuit));
});

test('schema 45 preserves overrides, rejects invalid switches and migrates prior versions with pursuit off', () => {
  const config = defaultGrifballTactics(); assert.equal(config.defaults.runnerPursuitEnabled, false);
  config.defaults.runnerPursuitEnabled = true; config.teams.red = { runnerPursuitEnabled: false };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'blue').runnerPursuitEnabled, true);
  assert.equal(resolveTeamTactics(config, 'red').runnerPursuitEnabled, false);
  for (let version = 1; version < 45; version++) {
    const old: any = structuredClone(config); old.schemaVersion = version; delete old.defaults.runnerPursuitEnabled; old.teams = {};
    const restored = validateGrifballTactics(old); assert.equal(restored.schemaVersion, 45);
    assert.equal(restored.defaults.runnerPursuitEnabled, false); assert.equal(restored.defaults.defenseLookahead, config.defaults.defenseLookahead);
  }
  const invalid: any = structuredClone(config); invalid.defaults.runnerPursuitEnabled = 1;
  assert.throws(() => validateGrifballTactics(invalid), /boolean/);
  delete invalid.defaults.runnerPursuitEnabled; assert.throws(() => validateGrifballTactics(invalid), /incomplete/);
});
