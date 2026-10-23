import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { observeLiveGrifballSwordGuard } from '../../src/components/grifball/grifballSwordGuard';
import { observeSimGrifballSwordGuard } from '../../src/sim/grifballSwordGuard';
import { createGrifballTeamPlanState, type GrifballAssignment } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from '../../src/game/grifballSpaceGeometry';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import type { SimCombatPriorityMemory } from '../../src/sim/grifballCombatPriorities';
import { createAIMatchContext } from '../../src/game/aiMatchContext';
import { createSimGrifballActorStepOptions } from '../../src/sim/grifballActorOwner';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { withSimulationRandom, seededRandom } from '../../src/game/simulationRandom';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';

const dt = 1 / 60, noop = () => {};
function fixture(enabled = true, mirror = false, reverse = false, main = false, style?: GrifballPlayerStyle) {
  const id = main ? 'main_ai' : 'sword';
  const f = createBotParityFixture(id, true, { speedBackward: 0, maxHP: 3, grifballRunnerHealth: 7,
    grifballRunnerHealRate: 0, weaponReadyTime: 0, enableSwordTrade: false, enableHammerSwordTrade: false }, 'runner');
  const { state, sim, bot, target } = f, [sword, runner] = sim.combatants, sign = mirror ? -1 : 1;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'outside'; sim.localPlayerIsObserver = true;
  sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
  sword.id = id; runner.id = 'runner'; sword.controller = runner.controller = 'ai';
  sim.combatants.push({ ...structuredClone(sword), id: 'outside', controller: 'remote', alive: false, hp: 0,
    pos: { x: 40, y: 35, z: 0 } });
  bot.pos.set(0, 0, -1.9 * sign); target.pos.set(0, 0, 0);
  bot.yaw = sign === 1 ? Math.PI : 0; target.yaw = bot.yaw + Math.PI;
  bot.activeWeapon = 'sword'; bot.hp = bot.maxHp = 3; bot.aiState = 'APPROACHING'; bot.aiTimer = 0;
  bot.aiSwayTimer = 0; bot.aiDashRemaining = 0; bot.swapLockoutTimer = 0;
  for (const [c, live] of [[sword, bot], [runner, target]] as const) {
    c.pos = { x: live.pos.x, y: 0, z: live.pos.z }; c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    c.yaw = live.yaw - Math.PI; c.weapon = live.activeWeapon; c.hp = c.maxHp = live.hp;
    c.modelType = live.modelType; c.weaponReadyTimer = c.invulnerabilityTimer = c.swapLockoutTimer = 0;
    c.weaponState = 'idle';
    if (mirror) { c.team = c.team === 'blue' ? 'red' : 'blue'; live.team = c.team; }
  }
  sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = 'runner';
  setSimCarrier(runner, true, sim.settings); setGrifballCarrierForState({ state, id: 'runner', carrying: true });
  target.weaponState = 'swing_up'; target.weaponTimer = .07; runner.weaponState = 'windup'; runner.attackKind = 'punch'; runner.weaponTimer = .17; runner.weaponPhaseElapsed = .07;
  const config = defaultGrifballTactics(); config.defaults.swordGuardEnabled = enabled; state.grifballTactics = config;
  if (style) {
    config.defaults.swordGuardAgencyStrength = 1; config.botStyles[id] = style;
    // The carrier deliberately has a different style: the defender owns this choice.
    config.botStyles.runner = style === 'guardian' ? 'enforcer' : 'guardian';
  }
  const assignment: GrifballAssignment = { botId: id, team: sword.team, role: 'chaser', slot: 0,
    carrierId: 'runner', destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, reason: 'Authored runner confrontation',
    tuning: config.defaults, geometry: buildGrifballSpaceGeometry(f.map, f.map.arenaRadius),
    defense: { targetId: 'runner', mode: 'intercept', emergency: false, intercept: { x: bot.pos.x, z: bot.pos.z },
      arrivalETA: 0, carrierETA: 0, advantage: 0, reinforcementIn: Infinity, transitioning: false } };
  const plan = createGrifballTeamPlanState(); plan.assignments.set(id, structuredClone(assignment));
  plan.snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots: { [id]: 'normal' }, tactics: config });
  state.aiMatchContext.grifballTeamPlan = structuredClone(plan);
  const memory: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: 0, swayTimer: 0,
    coordCommitTimer: 0, cooldownMultiplier: 1, pendingPostEvasionCharge: false };
  if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  const liveDecision = () => observeLiveGrifballSwordGuard(state, bot, 'runner', true, dt, f.map);
  const simDecision = () => observeSimGrifballSwordGuard(sim, plan, id, 'runner', { [id]: 'normal' }, memory, dt);
  return { ...f, sword, runner, plan, memory, liveDecision, simDecision };
}

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const main of [false, true])
  test(`fresh AI punch phases agree across hosts ${mirror}/${reverse}/${main}`, () => {
    const f = fixture(true, mirror, reverse, main);
    assert.equal(f.liveDecision()?.action, 'space'); assert.equal(f.simDecision()?.action, 'space');
    for (const [livePhase, simPhase, age, remaining] of [['swing_up', 'windup', .02, .22], ['swing_down', 'active', .05, .07], ['recovering', 'recovering', 0, .5]] as const) {
      f.target.weaponState = livePhase; f.target.weaponTimer = age; f.runner.weaponState = simPhase; f.runner.weaponTimer = remaining;
      const live = f.liveDecision()!, sim = f.simDecision()!;
      assert.equal(sim.action, live.action); assert.equal(sim.reason, live.reason);
      assert.ok(Math.abs(sim.punchRemaining - live.punchRemaining) < 1e-9);
      assert.ok(Math.abs(sim.punchAge - live.punchAge) < 1e-9);
    }
  });

test('crouched sword guard retreats at reduced walking speed in both hosts', () => {
  const f = fixture();
  f.state.settings.speedBackward = f.sim.settings.speedBackward = 100;
  f.state.settings.speedForward = f.sim.settings.speedForward = 100;
  // Keep the punch a threat in both postures so this checks walking speed.
  f.bot.modelType = f.sword.modelType = 'large';
  const standing = f.liveDecision()!;
  assert.equal(standing.action, 'space'); assert.ok(Math.abs(standing.velocity!.z) > 0);
  f.bot.isCrouching = f.sword.isCrouching = true;
  const live = f.liveDecision()!, sim = f.simDecision()!;
  assert.equal(live.action, 'space'); assert.equal(sim.action, 'space');
  assert.ok(Math.abs(live.velocity!.z - standing.velocity!.z * .45) < 1e-9);
  assert.ok(Math.abs(sim.velocity!.z - live.velocity!.z) < 1e-9);

  const id = f.bot.id;
  f.bot.aiState = f.memory.aiState = 'SIDE_STEPPING'; f.bot.aiTimer = f.memory.timer = 1;
  const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 80,
    weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 100 };
  const update = liveUpdater(f, knobs), matchContext = createAIMatchContext(); matchContext.grifballTeamPlan = f.plan;
  const control = { scriptedBots: { [id]: 'normal' }, configs: { [id]: { knobs, derived: deriveAIParams(f.sim.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
    memories: { [id]: f.memory, runner: { ...f.memory } }, matchContext, random: seededRandom(7),
    getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }), isObserverMode: true, spawnPoints: f.map.spawnPoints, navigation: {} };
  const startZ = f.bot.pos.z;
  withSimulationRandom(seededRandom(7), dt, () => update(id, dt));
  stepSimulation(f.sim, { runner: { ...idleAction(), aim: f.runner.yaw } }, createSimGrifballActorStepOptions(f.sim, control));
  assert.equal(f.bot.isCrouching, true); assert.equal(f.sword.isCrouching, true);
  assert.ok(Math.abs(f.bot.pos.z - startZ - live.velocity!.z * dt) < 1e-9);
  assert.ok(Math.abs(f.bot.pos.z - f.sword.pos.z) < 1e-9, 'both hosts apply crouch slowdown exactly once');
});

test('local human pitch/crouch observations use fresh human punch geometry in both hosts', () => {
  const f = fixture(); f.state.grifball.ball.holderId = f.sim.match.ball.holderId = 'player';
  f.state.isObserverMode = f.sim.localPlayerIsObserver = false; f.sim.localPlayerId = f.runner.id = 'player';
  f.state.playerPos.copy(f.target.pos); f.state.yaw = f.target.yaw; f.state.localPlayerTeam = 'red';
  f.state.activeWeapon = 'ball'; f.state.pWeaponState = 'swing_up'; f.state.pWeaponTimer = .07;
  f.state.pitch = f.runner.pitch = 0; f.state.crouchAmount = f.runner.crouchAmount = .5;
  const run = () => [observeLiveGrifballSwordGuard(f.state, f.bot, 'player', true, dt, f.map),
    observeSimGrifballSwordGuard(f.sim, f.plan, 'sword', 'player', { sword: 'normal' }, f.memory, dt)];
  assert.deepEqual(run().map(d => d?.action), ['space', 'space']);
  f.state.pitch = f.runner.pitch = Math.PI / 2;
  assert.deepEqual(run().map(d => d?.action), ['continue', 'continue']);
});

for (const gate of ['disabled', 'cooldown', 'attack', 'lunge', 'dash', 'slide', 'airborne', 'shield', 'hammer', 'friendly', 'released', 'neural'] as const)
  test(`both hosts preserve ${gate} ownership`, () => {
    const f = fixture(gate !== 'disabled', false, false, false, 'guardian');
    if (gate === 'cooldown') { f.bot.aiState = 'COOLDOWN'; f.bot.aiTimer = 1; f.memory.aiState = 'COOLDOWN'; f.memory.timer = 1; }
    if (gate === 'attack') { f.bot.weaponState = 'swing_up'; f.sword.weaponState = 'windup'; }
    if (gate === 'lunge') f.bot.isLunging = f.sword.isLunging = true;
    if (gate === 'dash') f.bot.aiDashRemaining = f.sword.dashRemaining = .2;
    if (gate === 'slide') f.bot.aiSlideActive = f.sword.slideActive = true;
    if (gate === 'airborne') f.bot.pos.y = f.sword.pos.y = 2;
    if (gate === 'shield') f.bot.invulnerabilityTimer = f.sword.invulnerabilityTimer = 1;
    if (gate === 'hammer') { f.bot.activeWeapon = 'hammer'; f.sword.weapon = 'hammer'; }
    if (gate === 'friendly') f.target.team = f.runner.team = 'blue';
    if (gate === 'released') f.state.grifball.ball.holderId = f.sim.match.ball.holderId = null;
    if (gate === 'neural') f.state.settings.aiDifficulty = f.sim.settings.aiDifficulty = 'neural-net';
    const live = observeLiveGrifballSwordGuard(f.state, f.bot, 'runner', gate !== 'cooldown', dt, f.map);
    assert.equal(live, null); assert.equal(f.simDecision(), null);
  });

function liveUpdater(f: ReturnType<typeof fixture>, knobs: AIResolvedKnobs) {
  const { state, refs, map } = f, derived = deriveAIParams(state.settings, knobs), getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as any),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  return createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, ...targets,
    grifballEnemyGoalPos: () => ({ x: 20, z: 0 }), getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    constrainCombatantToArena: noop, recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: noop, clearPressureTarget: noop, startAIHammerJump: () => false, isTargetOnCooldown: () => false,
    triggerCombatantAttack: (self, weapon, melee = false) => triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop }),
    triggerCombatantLunge: (self, lungeDir, pos, vel) => triggerCombatantLungeAction({ self, lungeDir, pos, vel, settings: state.settings, playDash: noop }),
    swapCombatantWeapon: () => { throw Error('Sword-only fixture unexpectedly swapped'); },
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
}

for (const enabled of [false, true]) for (const mirror of [false, true]) for (const main of [false, true])
  test(`production live and composed simulator defer attack then release on recovery ${enabled}/${mirror}/${main}`, () => {
    const f = fixture(enabled, mirror, false, main), id = f.bot.id;
    f.state.settings.speedBackward = f.sim.settings.speedBackward = 60;
    const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
      weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 100 };
    const update = liveUpdater(f, knobs), random = seededRandom(7);
    const matchContext = createAIMatchContext(); matchContext.grifballTeamPlan = f.plan;
    const memories = { [id]: f.memory, runner: { ...f.memory } };
    const control = { scriptedBots: { [id]: 'normal' }, configs: { [id]: { knobs, derived: deriveAIParams(f.sim.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
      memories, matchContext, random: seededRandom(7), getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }),
      isObserverMode: true, spawnPoints: f.map.spawnPoints, navigation: {} };
    withSimulationRandom(random, dt, () => update(id, dt));
    const events = stepSimulation(f.sim, {}, createSimGrifballActorStepOptions(f.sim, control));
    assert.equal(f.bot.weaponState, enabled ? 'ready' : 'swing_up');
    assert.equal(f.sword.weaponState, enabled ? 'idle' : 'windup');
    assert.ok(Math.abs(f.bot.pos.z - f.sword.pos.z) < 1e-9, 'physical spacing agrees');
    if (enabled) assert.ok(Math.abs(f.bot.pos.z) > 1.9, 'defender actually steps backward');
    assert.equal(!!events.actorDecisionFrame!.decisions.find(d => d.id === id)!.ground, !enabled);
    if (enabled) {
      f.target.weaponState = 'recovering'; f.runner.weaponState = 'recovering'; f.runner.weaponTimer = .5;
      withSimulationRandom(random, dt * 2, () => update(id, dt));
      stepSimulation(f.sim, {}, createSimGrifballActorStepOptions(f.sim, control));
      assert.equal(f.bot.weaponState, 'swing_up'); assert.equal(f.sword.weaponState, 'windup');
    }
  });

for (const style of [undefined, 'enforcer', 'opportunist', 'guardian'] as const)
  for (const enabled of [false, true]) for (const reverse of [false, true])
  test(`real punch and sword outcomes after the full decision path ${enabled}/${reverse}/${style ?? 'team'}`, () => {
    const f = fixture(enabled, false, reverse, reverse, style), id = f.bot.id;
    const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
      weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 100 };
    const update = liveUpdater(f, knobs), random = seededRandom(7);
    const matchContext = createAIMatchContext(); matchContext.grifballTeamPlan = f.plan;
    const memories = { [id]: f.memory, runner: { ...f.memory } };
    const control = { scriptedBots: { [id]: 'normal' }, configs: { [id]: { knobs, derived: deriveAIParams(f.sim.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
      memories, matchContext, random: seededRandom(7), getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }),
      isObserverMode: true, spawnPoints: f.map.spawnPoints, navigation: {} };
    let liveAttack = 0, simAttack = 0;
    for (let tick = 1; tick <= 29; tick++) {
      if (f.target.hp > 0) withSimulationRandom(random, tick * dt, () => update(id, dt));
      if (!liveAttack && f.bot.weaponState === 'swing_up') liveAttack = tick;
      f.visuals(dt);
      if (f.runner.hp > 0) stepSimulation(f.sim, { runner: { ...idleAction(), aim: f.runner.yaw } }, createSimGrifballActorStepOptions(f.sim, control));
      if (!simAttack && f.sword.weaponState === 'windup') simAttack = tick;
    }
    assert.equal(liveAttack, simAttack);
    assert.equal(f.bot.hp, f.sword.hp); assert.equal(f.target.hp, f.runner.hp);
    assert.equal(f.bot.hp, 2, 'ordinary runner punch still deals one damage; patience grants no immunity');
    if (enabled && style !== 'enforcer') { assert.ok(liveAttack > 12); assert.equal(f.target.hp, 0, 'sword hits during runner recovery'); }
    else { assert.equal(liveAttack, 1); assert.equal(f.target.hp, 7, 'immediate slash loses the punch clash'); }
  });

for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[]) for (const mirror of [false, true])
  test(`both production hosts execute ${style} spacing with stable defender identity, mirror=${mirror}`, () => {
    const f = fixture(true, mirror, mirror, mirror, style), id = f.bot.id, sign = mirror ? -1 : 1;
    f.bot.pos.z = f.sword.pos.z = -2.22 * sign;
    f.target.weaponTimer = .1; f.runner.weaponTimer = .14; f.runner.weaponPhaseElapsed = .1;
    f.state.settings.speedBackward = f.sim.settings.speedBackward = 60;
    const live = f.liveDecision()!, sim = f.simDecision()!;
    assert.equal(live.individuality!.style, style); assert.deepEqual(live.individuality, sim.individuality);
    assert.equal(live.action, 'space'); assert.equal(sim.action, 'space');
    const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
      weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 100 };
    const update = liveUpdater(f, knobs), matchContext = createAIMatchContext(); matchContext.grifballTeamPlan = f.plan;
    const control = { scriptedBots: { [id]: 'normal' }, configs: { [id]: { knobs, derived: deriveAIParams(f.sim.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
      memories: { [id]: f.memory, runner: { ...f.memory } }, matchContext, random: seededRandom(7),
      getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }), isObserverMode: true, spawnPoints: f.map.spawnPoints, navigation: {} };
    withSimulationRandom(seededRandom(7), dt, () => update(id, dt));
    stepSimulation(f.sim, { runner: { ...idleAction(), aim: f.runner.yaw } }, createSimGrifballActorStepOptions(f.sim, control));
    const expected = style === 'opportunist' ? 2.22 : style === 'guardian' ? 2.272 : 2.25;
    assert.ok(Math.abs(Math.abs(f.bot.pos.z) - expected) < 1e-9, 'live movement follows the style clearance');
    assert.ok(Math.abs(f.bot.pos.z - f.sword.pos.z) < 1e-9, 'sim executes identical movement');
    assert.equal(f.bot.weaponState, 'ready'); assert.equal(f.sword.weaponState, 'idle');
    // A style edit changes the next free decision; disabling the strength removes stale diagnostics.
    for (const plan of [f.plan, f.state.aiMatchContext.grifballTeamPlan]) {
      plan.snapshot!.tactics!.botStyles[id] = 'balanced';
      plan.assignments.get(id)!.tuning!.swordGuardAgencyStrength = 0;
    }
    assert.equal(f.liveDecision()!.individuality, undefined); assert.equal(f.simDecision()!.individuality, undefined);
  });
