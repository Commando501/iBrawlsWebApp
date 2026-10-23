import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, type GrifballAssignment } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from '../../src/game/grifballSpaceGeometry';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { resolveSimGrifballCarrierInput } from '../../src/sim/grifballCarrierInput';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { idleAction } from '../../src/sim/actions';
import { getYawForHeading } from '../../src/game/yaw';
import type { PassCandidate } from '../../src/game/aiGrifballPassing';
import type { GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';

const dt = 1 / 60;
/** Authored stationary coverage job and incoming slash; counter timing is decided
 * each frame by the production carrier owners, then real weapon owners resolve it. */
function fixture(enabled: boolean, mirror: boolean, reverse: boolean, reaction = .06, slash = .4,
  style: GrifballPlayerStyle = 'balanced', strength = 0) {
  const f = createBotParityFixture('sword', true, { swordSlashSpeed: slash, grifballRunnerHealth: 7,
    grifballRunnerHealRate: 0, enableSwordTrade: false, enableHammerSwordTrade: false }, 'runner');
  const { sim, state, bot, target } = f, [enemy, runner] = sim.combatants;
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
  enemy.id = 'sword'; runner.id = 'runner'; runner.controller = 'ai';
  const sign = mirror ? -1 : 1;
  bot.pos.set(2.1 * sign, 0, 0); target.pos.set(0, 0, 0);
  bot.yaw = getYawForHeading(-sign, 0); target.yaw = getYawForHeading(sign, 0);
  bot.activeWeapon = 'sword'; bot.hp = bot.maxHp = 2;
  for (const [c, live] of [[enemy, bot], [runner, target]] as const) {
    c.pos = { x: live.pos.x, y: 0, z: live.pos.z }; c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    c.yaw = live.yaw - Math.PI; c.weapon = live.activeWeapon; c.hp = c.maxHp = live.hp;
    c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    if (mirror) { c.team = c.team === 'blue' ? 'red' : 'blue'; live.team = c.team; }
  }
  sim.match.ball.state = state.grifball.ball.state = 'held';
  sim.match.ball.holderId = state.grifball.ball.holderId = 'runner';
  setSimCarrier(runner, true, sim.settings); setGrifballCarrierForState({ state, id: 'runner', carrying: true });
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, { runnerClashEnabled: enabled, runnerClashReaction: reaction, runnerClashAgencyStrength: strength });
  config.botStyles.runner = style;
  state.grifballTactics = config;
  const assignment: GrifballAssignment = { botId: 'runner', team: runner.team, role: 'runner', slot: 0,
    carrierId: 'runner', destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, reason: 'Authored coverage pause',
    tuning: config.defaults, geometry: buildGrifballSpaceGeometry(f.map, f.map.arenaRadius),
    runner: { selected: { action: 'wait' } } as GrifballAssignment['runner'] };
  const plan = createGrifballTeamPlanState(); plan.assignments.set('runner', structuredClone(assignment));
  state.aiMatchContext.grifballTeamPlan.assignments.set('runner', structuredClone(assignment));
  plan.snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots: { runner: 'normal' }, tactics: config });
  state.aiMatchContext.grifballTeamPlan.snapshot = structuredClone(plan.snapshot);
  if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  f.attack();
  stepCombatantWeapons(sim, enemy, { ...idleAction(), attackPrimary: true }, sim.settings, 0, []);
  return { ...f, enemy, runner, plan };
}

function runEncounter(f: ReturnType<typeof fixture>) {
    const { sim, state, bot, target, runner, enemy, plan } = f;
    let livePunchTick = 0, simPunchTick = 0;
    for (let tick = 1; tick <= 25; tick++) {
      const frame = { pos: target.pos, vel: target.vel, yaw: target.yaw, aiState: target.aiState, timer: target.aiTimer ?? 0,
        dashRemaining: 0, slideActive: false, weaponState: target.weaponState!, pickupRequested: false };
      if (target.hp > 0) resolvePrimaryGrifballAIObjectiveMovementForCombatant({
        state, botId: target.id, self: target, frame, alliesList: [], enemiesList: [bot.pos], dt,
        canStartWeaponAction: frame.timer <= 0, getEnemyGoalPos: () => ({ x: 47, z: 0 }),
        constrainCombatantToArena: () => {},
        triggerCombatantAttack: (self, weapon) => {
          if (!livePunchTick) livePunchTick = tick;
          triggerCombatantAttackAction({ self, weapon, recordHammerAttack: () => {}, playSwing: () => {} });
        },
      });
      target.yaw = frame.yaw; target.aiState = frame.aiState; target.aiTimer = frame.timer;
      const decision = resolveSimGrifballCarrierInput(sim, plan, 'runner', { runner: 'normal' }, true, dt, { punch: true });
      if (decision?.input?.action.attackPrimary) {
        if (!simPunchTick) simPunchTick = tick;
        runner.yaw = decision.input.action.aim;
        stepCombatantWeapons(sim, runner, decision.input.action, sim.settings, 0, []);
      }
      // Production hit resolvers, including reciprocal punch contact and lethal sword damage.
      f.visuals(dt);
      for (const c of sim.combatants) stepCombatantWeapons(sim, c, idleAction(), sim.settings, dt, []);
      assert.equal(runner.hp, target.hp, `tick ${tick}: runner HP`);
      assert.equal(enemy.hp, bot.hp, `tick ${tick}: attacker HP`);
    }
    assert.equal(livePunchTick, simPunchTick);
    return { punchTick: livePunchTick, runnerHP: target.hp, swordHP: bot.hp };
}

for (const enabled of [false, true]) for (const mirror of [false, true]) for (const reverse of [false, true])
  test(`slash outcome agrees through both owners enabled=${enabled}/mirror=${mirror}/reverse=${reverse}`, () => {
    const result = runEncounter(fixture(enabled, mirror, reverse));
    if (enabled) {
      assert.ok(result.punchTick >= 8 && result.punchTick <= 10, `counter tick ${result.punchTick}`);
      assert.equal(result.runnerHP, 7); assert.equal(result.swordHP, 1, 'counter deals normal one-point damage');
    } else {
      assert.equal(result.punchTick, 1); assert.equal(result.runnerHP, 7);
      assert.equal(result.swordHP, 1, 'ordinary lunge punch reaches the model without the timing module');
    }
  });

for (const mirror of [false, true]) for (const reverse of [false, true])
  test(`individual counters produce distinct real timing in both hosts mirror=${mirror}/reverse=${reverse}`, () => {
    const long = {} as Record<GrifballPlayerStyle, number>, short = {} as Record<GrifballPlayerStyle, number>;
    for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const) {
      for (const [slash, results] of [[.4, long], [.22, short]] as const) {
        const result = runEncounter(fixture(true, mirror, reverse, .06, slash, style, 1));
        results[style] = result.punchTick;
        assert.ok(result.punchTick > 0); assert.equal(result.runnerHP, 7); assert.equal(result.swordHP, 1);
      }
    }
    assert.ok(long.enforcer < long.balanced); assert.ok(long.opportunist > long.balanced);
    assert.ok(short.guardian < short.balanced);
  });

test('zero individuality repeats the same physical encounter across styles', () => {
  const baseline = runEncounter(fixture(true, false, false));
  for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
    assert.deepEqual(runEncounter(fixture(true, false, false, .06, .4, style, 0)), baseline);
});

function decideLive(f: ReturnType<typeof fixture>, ready = true) {
  const { state, target, bot } = f;
  const frame = { pos: target.pos, vel: target.vel, yaw: target.yaw, aiState: target.aiState, timer: 0,
    dashRemaining: 0, slideActive: false, weaponState: target.weaponState!, pickupRequested: false };
  let punched = false;
  resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: 'runner', self: target, frame,
    alliesList: [], enemiesList: [bot.pos], dt, canStartWeaponAction: ready, getEnemyGoalPos: () => ({ x: 47, z: 0 }),
    constrainCombatantToArena: () => {}, triggerCombatantAttack: () => { punched = true; } });
  return { frame, punched, clash: state.aiMatchContext.grifballTeamPlan.assignments.get('runner')!.runnerClash };
}

for (const age of [.03, .07]) test(`fresh sword at ${age}s cancels a previously planned charge in both owners`, () => {
  const f = fixture(true, false, false, .06, .22);
  f.bot.weaponTimer = age; f.enemy.weaponTimer = .11 - age;
  const pass: PassCandidate = { receiverId: 'receiver', direction: { x: 0, z: 1 }, point: { x: 0, z: 10 },
    seconds: 1, path: [], settled: true, speed: 9, chargeSeconds: .5, receiverETA: .5, opponentETA: 3,
    attackETA: 4, progress: 10, score: 20, viable: true, reason: 'Previously safe pass' };
  for (const plan of [f.plan, f.state.aiMatchContext.grifballTeamPlan]) {
    plan.assignments.get('runner')!.pass = { carrierId: 'runner', selected: structuredClone(pass), candidates: [pass], reason: pass.reason };
    plan.passCharge = { carrierId: 'runner', receiverId: 'receiver', speed: 9, elapsed: .45 };
  }
  const before = structuredClone(f.plan);
  const preview = resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt)!;
  assert.notEqual(preview.decision.kind, 'pass');
  assert.deepEqual(f.plan, before, 'a preview without execution authority cannot cancel or publish anything');
  const live = decideLive(f);
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt, { punch: true, pass: true })!;
  assert.equal(live.punched, age === .07);
  assert.equal(result.input!.action.attackPrimary, live.punched);
  for (const plan of [f.plan, f.state.aiMatchContext.grifballTeamPlan]) {
    assert.equal(plan.assignments.get('runner')!.pass!.selected, null);
    assert.equal(plan.passCharge, null);
  }
});

test('readiness, committed punch heading and expired observations remain authoritative', () => {
  const f = fixture(true, false, false, .06, .22);
  f.bot.weaponTimer = .07; f.enemy.weaponTimer = .04;
  assert.equal(decideLive(f, false).clash!.action, 'unavailable');
  const unavailable = resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, false, dt, { punch: true })!;
  assert.equal(unavailable.decision.clash!.action, 'unavailable');
  assert.equal(unavailable.input!.action.attackPrimary, false);
  assert.equal(decideLive(f).punched, true);
  resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt, { punch: true });
  f.target.weaponState = 'swing_up'; f.runner.weaponState = 'windup';
  const yaw = f.target.yaw, simYaw = f.runner.yaw;
  f.bot.pos.x = -2.5; f.enemy.pos.x = -2.5;
  const live = decideLive(f);
  const committed = resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt, { punch: true })!;
  assert.equal(live.punched, false); assert.equal(live.frame.yaw, yaw);
  assert.equal(committed.decision.kind, 'committed-punch'); assert.equal(committed.input!.action.aim, simYaw);
  f.target.weaponState = 'ready'; f.runner.weaponState = 'idle';
  f.bot.weaponState = 'recovering'; f.enemy.weaponState = 'recovering';
  assert.equal(decideLive(f).clash!.action, 'none');
  assert.equal(resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt, { punch: true })!.decision.clash!.action, 'none');
});

test('an approaching lunge uses the same fresh elapsed clock and travel estimate in both owners', () => {
  const f = fixture(true, false, false);
  f.bot.isLunging = f.enemy.isLunging = true;
  f.bot.lungeTimer = f.enemy.lungeTimer = .1;
  f.bot.vel.x = f.enemy.vel.x = -24;
  const live = decideLive(f);
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, 'runner', { runner: 'normal' }, true, dt, { punch: true })!;
  assert.equal(live.punched, true);
  assert.equal(result.input!.action.attackPrimary, true);
  assert.deepEqual(result.decision.clash, live.clash);
});

test('a deliberately slow reaction misses the short slash instead of granting immunity', () => {
  const f = fixture(true, false, false, .3, .22);
  let punched = false;
  for (let tick = 0; tick < 12; tick++) {
    const { target, bot, state } = f;
    if (target.hp <= 0) break;
    const frame = { pos: target.pos, vel: target.vel, yaw: target.yaw, aiState: target.aiState, timer: 0,
      dashRemaining: 0, slideActive: false, weaponState: target.weaponState!, pickupRequested: false };
    resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: 'runner', self: target, frame,
      alliesList: [], enemiesList: [bot.pos], dt, canStartWeaponAction: true, getEnemyGoalPos: () => ({ x: 47, z: 0 }),
      constrainCombatantToArena: () => {}, triggerCombatantAttack: () => { punched = true; } });
    f.visuals(dt);
  }
  assert.equal(punched, true, 'ordinary proximity punch can still be attempted after the counter window is missed');
  assert.equal(f.target.hp, 0, 'an attempted punch grants no immunity without model contact');
});

for (const player of [false, true]) for (const age of [.03, .07, .12])
  test(`fresh clocks agree for ${player ? 'human' : 'AI'} sword at ${age}s`, () => {
    const f = fixture(true, false, false, .06, .22);
    const { state, sim, bot, target, enemy, plan } = f;
    bot.weaponTimer = age; bot.weaponState = age < .11 ? 'swing_up' : 'swing_down';
    enemy.weaponTimer = age < .11 ? .11 - age : .22 - age;
    enemy.weaponState = age < .11 ? 'windup' : 'active';
    if (player) {
      state.otherPlayers.delete('sword'); state.isObserverMode = false;
      state.localPlayerTeam = enemy.team; state.playerPos.copy(bot.pos); state.playerVel.copy(bot.vel);
      state.activeWeapon = 'sword'; state.pSwordState = 'slashing'; state.pSwordTimer = age;
      state.playerInvulnerabilityTimer = 0;
      enemy.id = 'player'; enemy.controller = 'remote';
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
      enemy.weaponState = 'windup'; enemy.weaponPhaseElapsed = age; enemy.weaponTimer = .22 - age;
    }
    const frame = { pos: target.pos, vel: target.vel, yaw: target.yaw, aiState: target.aiState, timer: 0,
      dashRemaining: 0, slideActive: false, weaponState: target.weaponState!, pickupRequested: false };
    let punch = false;
    resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: 'runner', self: target, frame,
      alliesList: [], enemiesList: [bot.pos], dt, canStartWeaponAction: true, getEnemyGoalPos: () => ({ x: 47, z: 0 }),
      constrainCombatantToArena: () => {}, triggerCombatantAttack: () => { punch = true; } });
    const result = resolveSimGrifballCarrierInput(sim, plan, 'runner', { runner: 'normal' }, true, dt, { punch: true })!;
    assert.equal(punch, age >= .07, 'a spent sword observation still permits an ordinary nearby punch');
    assert.equal(result.decision.kind === 'punch', punch);
    const live = state.aiMatchContext.grifballTeamPlan.assignments.get('runner')!.runnerClash!;
    assert.equal(result.decision.clash!.action, live.action);
    assert.equal(live.action, age === .03 ? 'track' : age === .07 ? 'punch' : 'none');
  });
