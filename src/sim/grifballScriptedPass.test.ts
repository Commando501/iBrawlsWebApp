import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { setSimCarrier, tickGrifballObjective } from './grifball';
import { stepSimulation, SIM_DT } from './step';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { resolveSimScriptedGrifballPass } from './grifballScriptedPass';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, SCRIPTED_PASS_VERSION, type ScriptedObjectivePlanner } from './scriptedObjectivePlanner';

function fixture() {
  const state = createMatch({ seed: 7, teamSizes: { blue: 2, red: 1 }, combatExecution: 'live-roster-v2', settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const [carrier, receiver, enemy] = state.combatants;
  for (const [i, c] of state.combatants.entries()) {
    c.id = ['carrier', 'receiver', 'enemy'][i]; c.controller = 'ai'; c.invulnerabilityTimer = c.weaponReadyTimer = 0;
    c.team = i < 2 ? 'blue' : 'red';
    c.pos = { x: [-20, -8, -45][i], y: 0, z: i === 2 ? 18 : 0 }; c.vel = { x: 0, y: 0, z: 0 };
  }
  setSimCarrier(carrier, true, state.settings); state.match.ball.state = 'held'; state.match.ball.holderId = carrier.id;
  const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION,
    scriptedBots: { carrier: 'normal', receiver: 'normal' }, plan: createGrifballTeamPlanState(), tactics: defaultGrifballTactics(),
    punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { carrier: 0, receiver: 0 } }, passControl: SCRIPTED_PASS_VERSION };
  updateGrifballTeamPlan(planner.plan, createSimGrifballTacticalSnapshot(state, { scriptedBots: planner.scriptedBots, tactics: planner.tactics }), SIM_DT);
  const pass = planner.plan.assignments.get(carrier.id)!.pass!;
  assert.ok(pass.selected, 'fixture must independently earn a pass');
  return { state, carrier, receiver, enemy, planner, pass };
}

test('charged pass waits until its selected duration and recomputes heading after receiver movement', () => {
  const f = fixture(), selected = f.pass.candidates.find(c => c.viable && c.chargeSeconds > 0)!;
  assert.ok(selected); f.pass.selected = selected;
  const first = resolveSimScriptedGrifballPass(f.state, f.planner, selected.chargeSeconds / 2);
  assert.equal(first.kind, 'charging'); assert.equal(f.state.match.ball.state, 'held');
  f.receiver.pos.z = 1;
  const release = resolveSimScriptedGrifballPass(f.state, f.planner, selected.chargeSeconds / 2);
  assert.equal(release.kind, 'release');
  if (release.kind !== 'release') assert.fail();
  assert.ok(Math.abs(release.direction.x - 12 / Math.hypot(12, 1)) < 1e-12);
  assert.ok(Math.abs(release.direction.z - 1 / Math.hypot(12, 1)) < 1e-12);
  assert.equal(release.speed, selected.speed); assert.equal(f.planner.plan.passCharge, null);
  assert.equal(f.state.match.ball.state, 'held', 'decision helper must not mutate ball physics');
});

for (const reason of ['receiver-dead', 'receiver-remote', 'receiver-unowned', 'receiver-airborne', 'pressure',
  'reload', 'swap', 'ready', 'weapon', 'airborne', 'vertical', 'dash', 'dead', 'module', 'throwing', 'phase'] as const)
  test(`release cancels stale intent after ${reason}`, () => {
    const f = fixture();
    // The same independently planned state is releasable before the perturbation.
    assert.equal(resolveSimScriptedGrifballPass(structuredClone(f.state), structuredClone(f.planner), 2).kind, 'release');
    f.planner.plan.passCharge = { carrierId: 'carrier', receiverId: 'receiver', speed: f.pass.selected!.speed, elapsed: 1 };
    if (reason === 'receiver-dead') { f.receiver.hp = 0; f.receiver.alive = false; }
    if (reason === 'receiver-remote') f.receiver.controller = 'remote';
    if (reason === 'receiver-unowned') f.planner.scriptedBots = { carrier: 'normal' };
    if (reason === 'receiver-airborne') f.receiver.pos.y = 1;
    if (reason === 'pressure') f.enemy.pos = { ...f.carrier.pos };
    if (reason === 'reload') f.planner.punchControl!.cooldowns.carrier = .1;
    if (reason === 'swap') f.carrier.swapLockoutTimer = .1;
    if (reason === 'ready') f.carrier.weaponReadyTimer = .1;
    if (reason === 'weapon') f.carrier.weaponState = 'windup';
    if (reason === 'airborne') f.carrier.pos.y = 1;
    if (reason === 'vertical') f.carrier.vel.y = 1;
    if (reason === 'dash') f.carrier.dashRemaining = .1;
    if (reason === 'dead') f.carrier.alive = false;
    if (reason === 'module') f.planner.tactics!.defaults.passingEnabled = false;
    if (reason === 'throwing') f.state.settings.grifballAllowThrowing = false;
    if (reason === 'phase') f.state.match.phase = 'countdown';
    const outcome = resolveSimScriptedGrifballPass(f.state, f.planner, 2);
    assert.equal(outcome.kind, 'cancelled'); assert.equal(f.planner.plan.passCharge, null);
    assert.equal(f.state.match.ball.state, 'held');
    if (reason === 'pressure' || reason === 'receiver-airborne') {
      assert.deepEqual(outcome, { kind: 'cancelled', reason: 'release-no-longer-safe' });
      assert.ok(!f.pass.selected?.viable || f.planner.plan.assignments.get('carrier')!.pass !== f.pass);
    }
  });

test('changing the selected throw speed restarts charge instead of borrowing a previous throw clock', () => {
  const f = fixture(), selected = f.pass.candidates.find(c => c.viable && c.chargeSeconds > 0)!;
  assert.ok(selected); f.pass.selected = selected;
  f.planner.plan.passCharge = { carrierId: 'carrier', receiverId: 'receiver', speed: selected.speed + 1, elapsed: 10 };
  assert.equal(resolveSimScriptedGrifballPass(f.state, f.planner, SIM_DT).kind, 'charging');
  assert.equal(f.planner.plan.passCharge!.elapsed, SIM_DT);
  assert.equal(f.planner.plan.passCharge!.speed, selected.speed);
});

for (const enabled of [false, true]) test(`release rechecks a changed hammer-deflection rule: ${enabled}`, () => {
  const f = fixture();
  f.state.settings.hammerBallDeflectionEnabled = false;
  f.enemy.pos = { x: -20, y: 0, z: 8 };
  f.planner.tactics!.defaults.passAgencyStrength = 1;
  f.planner.tactics!.botStyles.carrier = 'enforcer';
  updateGrifballTeamPlan(f.planner.plan, createSimGrifballTacticalSnapshot(f.state,
    { scriptedBots: f.planner.scriptedBots, tactics: f.planner.tactics }), 1);
  const pass = f.planner.plan.assignments.get('carrier')!.pass!;
  pass.selected = pass.candidates.find(c => c.viable && c.speed === 13.25)!;
  assert.ok(pass.selected, 'the pass must be independently eligible before deflection is enabled');
  f.planner.plan.passCharge = { carrierId: 'carrier', receiverId: 'receiver', speed: 13.25, elapsed: .15 };
  f.state.settings.hammerBallDeflectionEnabled = enabled;
  const outcome = resolveSimScriptedGrifballPass(f.state, f.planner, .2);
  assert.equal(outcome.kind, enabled ? 'cancelled' : 'release');
  assert.equal(f.planner.plan.passCharge, null);
  if (enabled) assert.deepEqual(outcome, { kind: 'cancelled', reason: 'release-no-longer-safe' });
});

for (const reason of ['version', 'reload-owner'] as const) test(`pass opt-in rejects ${reason} before mutation`, () => {
  const f = fixture();
  if (reason === 'version') (f.planner as { passControl: string }).passControl = 'unknown';
  else delete f.planner.punchControl;
  const state = structuredClone(f.state), planner = structuredClone(f.planner);
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedPlanner: f.planner }));
  assert.deepEqual(f.state, state); assert.deepEqual(f.planner, planner);
});

test('objective phase commits a zero-charge pass once and advances its ball during that same frame', () => {
  const f = fixture(); f.pass.selected = f.pass.candidates.find(c => c.viable && c.chargeSeconds === 0)!;
  assert.ok(f.pass.selected);
  const speed = f.pass.selected.speed;
  const first = tickGrifballObjective(f.state, f.state.settings, SIM_DT, {}, f.planner);
  assert.equal(first.scriptedPass?.kind, 'release'); assert.equal(f.state.match.ball.state, 'thrown');
  assert.equal(f.carrier.hasBall, false); assert.equal(f.carrier.weapon, 'hammer');
  assert.ok(Math.abs(f.state.match.ball.pos.x - (-20 + speed * SIM_DT)) < 1e-9);
  assert.deepEqual(f.planner.plan.passFlight, { team: 'blue', carrierId: 'carrier', receiverId: 'receiver' });
  assert.equal(tickGrifballObjective(f.state, f.state.settings, SIM_DT, {}, f.planner).scriptedPass?.kind, 'cancelled');
});
