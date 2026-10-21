import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { observeLiveGrifballHammerDefense } from '../../src/components/grifball/grifballHammerDefense';
import { observeSimGrifballHammerDefense } from '../../src/sim/grifballHammerDefense';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { createSimGrifballActorStepOptions } from '../../src/sim/grifballActorOwner';
import { stepSimulation } from '../../src/sim/step';
import { createAIMatchContext } from '../../src/game/aiMatchContext';
import type { SimCombatPriorityMemory } from '../../src/sim/grifballCombatPriorities';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';

const dt = 1 / 60, noop = () => {};
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
function fixture(enabled = true, mirror = false, main = false, tuned = false, style?: GrifballPlayerStyle, edge = false) {
  const id = main ? 'main_ai' : 'hammer', sign = mirror ? -1 : 1;
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', speedForward: 0, weaponReadyTime: 0,
    ...(tuned ? { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04 } : {}) }, 'thrower');
  const { state, sim, bot, target } = f, [actor, thrower] = sim.combatants;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'outside'; sim.localPlayerIsObserver = true;
  sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
  actor.id = id; thrower.id = target.id;
  for (const [i, [c, live]] of ([[actor, bot], [thrower, target]] as const).entries()) {
    c.controller = live.controller = 'ai'; c.team = live.team = (i === 0) !== mirror ? 'blue' : 'red';
    c.pos = { x: i ? 18 * sign : 0, y: 0, z: i ? 10 : 0 }; live.pos.set(c.pos.x, 0, c.pos.z);
    c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    c.yaw = 0; live.yaw = Math.PI; c.hp = c.maxHp = live.hp;
    c.weaponReadyTimer = c.invulnerabilityTimer = c.swapLockoutTimer = 0; c.weaponState = 'idle';
    live.aiState = 'APPROACHING'; live.aiTimer = 0; live.aiSwayTimer = 0; live.aiDashRemaining = 0; live.swapLockoutTimer = 0;
  }
  target.difficulty = 'neural-net'; // Publicly visible thrower, no autonomous inputs.
  sim.combatants.push({ ...structuredClone(actor), id: 'outside', controller: 'remote', alive: false, hp: 0, pos: { x: 40, y: 35, z: 0 } });
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.hammerDefenseEnabled = enabled;
  if (style) {
    state.grifballTactics.defaults.hammerDefenseAgencyStrength = 1;
    state.grifballTactics.botStyles[id] = style;
    state.grifballTactics.botStyles.thrower = style === 'guardian' ? 'enforcer' : 'guardian';
  }
  if (edge) state.grifballTactics.defaults.hammerDefenseReaction = 0;
  const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION,
    scriptedBots: { [id]: 'normal' }, plan: createGrifballTeamPlanState(), tactics: structuredClone(state.grifballTactics),
    punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { [id]: 0 } } };
  const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)!.position;
  const observe = () => {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(planner.plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots: planner.scriptedBots, tactics: planner.tactics }), dt);
  };
  // Earn public throw-origin memory from two physical observations; never seed private pass intent.
  sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = target.id;
  setSimCarrier(thrower, true, sim.settings); setGrifballCarrierForState({ state, id: target.id, carrying: true });
  observe();
  setSimCarrier(thrower, false, sim.settings); setGrifballCarrierForState({ state, id: target.id, carrying: false });
  for (const ball of [sim.match.ball, state.grifball.ball]) Object.assign(ball, { state: 'thrown', holderId: null,
    pos: { x: (edge ? 12.05 : 8) * sign, y: 3, z: 0 }, vel: { x: -10 * sign, y: 0, z: 0 } });
  if (mirror) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  const memory: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: 0, swayTimer: 0, coordCommitTimer: 0,
    cooldownMultiplier: 1, pendingPostEvasionCharge: false };
  return { ...f, actor, thrower, planner, goal, observe, memory, sign };
}

function liveUpdater(f: ReturnType<typeof fixture>, knobs: AIResolvedKnobs) {
  const { state, refs, map } = f, derived = deriveAIParams(state.settings, knobs), getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as any),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  return createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, ...targets,
    grifballEnemyGoalPos: f.goal, getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    constrainCombatantToArena: noop, recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: noop, clearPressureTarget: noop, startAIHammerJump: () => false, isTargetOnCooldown: () => false,
    triggerCombatantAttack: (self, weapon, melee = false) => triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop }),
    triggerCombatantLunge: (self, lungeDir, pos, vel) => triggerCombatantLungeAction({ self, lungeDir, pos, vel, settings: state.settings, playDash: noop }),
    swapCombatantWeapon: () => assert.fail('Unexpected weapon swap'), playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
}

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const cases: { enabled: boolean; mirror: boolean; main: boolean; tuned: boolean; style?: GrifballPlayerStyle; edge?: boolean }[] = [];
for (const enabled of [false, true]) for (const mirror of [false, true]) for (const main of [false, true]) for (const tuned of [false, true])
  cases.push({ enabled, mirror, main, tuned });
for (const style of styles) for (const mirror of [false, true]) {
  cases.push({ enabled: true, mirror, main: mirror, tuned: mirror, style });
  cases.push({ enabled: true, mirror, main: mirror, tuned: false, style, edge: true });
}
for (const { enabled, mirror, main, tuned, style, edge } of cases)
  test(`full live/composed pass defense and physical deflection ${enabled}/${mirror}/${main}/${tuned}/${style ?? 'team'}/${edge ?? false}`, () => {
    const f = fixture(enabled, mirror, main, tuned, style, edge), id = f.bot.id;
    const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
      weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 0 };
    const update = liveUpdater(f, knobs), matchContext = createAIMatchContext(); matchContext.grifballTeamPlan = f.planner.plan;
    const control = { scriptedBots: f.planner.scriptedBots, configs: { [id]: { knobs, derived: deriveAIParams(f.sim.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
      memories: { [id]: f.memory, thrower: { ...f.memory } }, matchContext, random: seededRandom(7), getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }),
      isObserverMode: true, spawnPoints: f.map.spawnPoints, navigation: {}, planner: f.planner };
    const random = seededRandom(7), initialThrowerHp = f.target.hp; let attackTick = 0, deflectionTick = 0;
    for (let tick = 1; tick <= 36; tick++) {
      if (enabled && main && tick === 9) {
        // A live tuning edit does not redirect or cancel an already begun strike.
        f.state.grifballTactics.defaults.hammerDefenseEnabled = false;
        f.planner.tactics!.defaults.hammerDefenseEnabled = false;
        for (const config of [f.state.grifballTactics, f.planner.tactics!]) {
          config.botStyles[id] = 'balanced'; config.defaults.hammerDefenseAgencyStrength = 0;
        }
      }
      f.weaponFrame(dt); f.respawns(dt); updateGrifballTeamPlanForState(f.state, dt, f.goal, f.map);
      withSimulationRandom(random, tick * dt, () => update(id, dt));
      if (!attackTick && f.bot.weaponState === 'swing_up') attackTick = tick;
      updateGrifballObjectiveForState({ state: f.state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('Unexpected reset'), pushStatsUpdate: noop });
      f.visuals(dt);
      stepSimulation(f.sim, {}, createSimGrifballActorStepOptions(f.sim, control));
      const liveDefense = f.state.aiMatchContext.grifballTeamPlan.assignments.get(id)?.hammerDefense;
      const simDefense = f.planner.plan.assignments.get(id)?.hammerDefense;
      assert.deepEqual(liveDefense?.individuality, simDefense?.individuality, `${tick}/style diagnostics`);
      if (style && liveDefense?.action === 'committed') assert.equal(liveDefense.individuality!.style, style, 'Committed style survives edits');
      assert.equal(f.actor.weaponState, ({ ready: 'idle', swing_up: 'windup', swing_down: 'active', recovering: 'recovering' } as Record<string, string>)[f.bot.weaponState!], `tick ${tick}/phase`);
      near(f.memory.timer ?? 0, f.bot.aiTimer ?? 0, `${tick}/AI reload`);
      for (const axis of ['x', 'y', 'z'] as const) {
        near(f.sim.match.ball.pos[axis], f.state.grifball.ball.pos[axis], `${tick}/ball.${axis}`);
        near(f.sim.match.ball.vel[axis], f.state.grifball.ball.vel[axis], `${tick}/velocity.${axis}`);
        near(f.actor.pos[axis], f.bot.pos[axis], `${tick}/actor.${axis}`);
      }
      near(Math.sin(f.actor.yaw), -Math.sin(f.bot.yaw), `${tick}/heading.x`);
      near(Math.cos(f.actor.yaw), -Math.cos(f.bot.yaw), `${tick}/heading.z`);
      if (!deflectionTick && f.state.grifball.ball.vel.x * f.sign > 0) {
        deflectionTick = tick;
        assert.ok(f.state.grifball.ball.pos.x * f.sign > 0, 'Ball redirects away from own goal before reaching the defender');
      }
      assert.equal(f.actor.hp, f.bot.hp); assert.equal(f.thrower.hp, f.target.hp);
      if (attackTick && !deflectionTick) assert.ok((f.memory.timer ?? 0) > 0, 'Composed objective preserves normal reload');
    }
    const expectedAttack = !enabled ? 0 : edge ? ({ balanced: 2, enforcer: 1, opportunist: 3, guardian: 4 })[style!]
      : style === 'enforcer' || style === 'guardian' ? 5 : style === 'opportunist' ? 7 : 6;
    assert.equal(attackTick, expectedAttack, 'Observed timing and required contact cushion determine commitment');
    assert.equal(deflectionTick, enabled ? expectedAttack + (tuned ? 7 : 24) : 0, 'Actual default 17+8 or tuned 5+3 animation ticks');
    assert.equal(f.target.hp, initialThrowerHp, 'This interception does not hit the distant thrower');
  });

for (const gate of ['disabled', 'friendly', 'unknown', 'cooldown', 'attack', 'lunge', 'dash', 'slide', 'airborne', 'shield', 'sword', 'neural', 'nearby', 'mechanics', 'human', 'dead', 'inactive'] as const)
  test(`host observations respect ${gate} without acquiring an attack`, () => {
    const f = fixture(gate !== 'disabled'); f.observe();
    for (const plan of [f.planner.plan, f.state.aiMatchContext.grifballTeamPlan]) plan.observedThrow!.age = .2;
    if (gate === 'friendly') for (const plan of [f.planner.plan, f.state.aiMatchContext.grifballTeamPlan]) plan.observedThrow!.team = 'blue';
    if (gate === 'unknown') for (const plan of [f.planner.plan, f.state.aiMatchContext.grifballTeamPlan]) delete plan.observedThrow;
    if (gate === 'attack') { f.bot.weaponState = 'swing_up'; f.actor.weaponState = 'windup'; }
    if (gate === 'lunge') f.bot.isLunging = f.actor.isLunging = true;
    if (gate === 'dash') f.bot.aiDashRemaining = f.actor.dashRemaining = .2;
    if (gate === 'slide') f.bot.aiSlideActive = f.actor.slideActive = true;
    if (gate === 'airborne') f.bot.pos.y = f.actor.pos.y = 2;
    if (gate === 'shield') f.bot.invulnerabilityTimer = f.actor.invulnerabilityTimer = 1;
    if (gate === 'sword') { f.bot.activeWeapon = f.actor.weapon = 'sword'; }
    if (gate === 'neural') f.state.settings.aiDifficulty = f.sim.settings.aiDifficulty = 'neural-net';
    if (gate === 'nearby') { f.target.pos.set(1, 0, 0); f.thrower.pos = { x: 1, y: 0, z: 0 }; }
    if (gate === 'mechanics') f.state.settings.hammerBallDeflectionEnabled = f.sim.settings.hammerBallDeflectionEnabled = false;
    if (gate === 'human') f.bot.controller = f.actor.controller = 'remote';
    if (gate === 'dead') f.bot.hp = f.actor.hp = 0;
    if (gate === 'inactive') f.state.grifball.phase = f.sim.match.phase = 'countdown';
    const frame = { pos: f.bot.pos, vel: f.bot.vel, yaw: f.bot.yaw, aiState: f.bot.aiState, timer: 0,
      dashRemaining: f.bot.aiDashRemaining ?? 0, slideActive: !!f.bot.aiSlideActive, weaponState: f.bot.weaponState!, pickupRequested: false };
    const live = observeLiveGrifballHammerDefense(f.state, f.bot, frame, gate !== 'cooldown', dt);
    const sim = observeSimGrifballHammerDefense(f.sim, f.planner.plan, f.actor, f.planner.scriptedBots, gate !== 'cooldown', dt);
    assert.equal(live?.action, sim?.action); assert.notEqual(live?.action, 'strike');
    assert.equal(f.planner.plan.hammerDefenseCommitments?.[f.bot.id], undefined);
  });

test('online play and legacy simulator profiles do not acquire pass-defense authority', () => {
  const f = fixture(); f.observe();
  for (const plan of [f.planner.plan, f.state.aiMatchContext.grifballTeamPlan]) plan.observedThrow!.age = .2;
  f.state.isMultiplayer = true;
  const frame = { pos: f.bot.pos, vel: f.bot.vel, yaw: f.bot.yaw, aiState: f.bot.aiState, timer: 0,
    dashRemaining: 0, slideActive: false, weaponState: f.bot.weaponState!, pickupRequested: false };
  assert.equal(observeLiveGrifballHammerDefense(f.state, f.bot, frame, true, dt), null);
  for (const execution of ['legacy-v1', 'live-roster-v2'] as const) {
    f.sim.combatExecution = execution;
    assert.equal(observeSimGrifballHammerDefense(f.sim, f.planner.plan, f.actor, f.planner.scriptedBots, true, dt), null);
  }
});
