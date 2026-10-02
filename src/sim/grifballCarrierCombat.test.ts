import { canApplyAITacticalWeaponSwap } from '../game/aiTacticalWeaponSwap';
import { getGrifballEnemyGoalPosForMap } from '../components/grifball/grifballObjectiveRuntime';
import { observePlayerHammerAttack } from '../game/aiPlayerModel';
import { createRng } from './rng';
import { hasCoherentSimCarrierState } from './grifballCarrierState';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { deriveAIParams } from '../game/aiTuning';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballActorStepOptions, type SimGrifballActorControl } from './grifballActorOwner';
import { stepSimulation } from './step';
import { setSimCarrier } from './grifball';
import type { ScriptedObjectivePlanner } from './scriptedObjectivePlanner';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import { createOfflineBotCombatant } from '../game/roster';
import { createAISingleEntityUpdaterForState } from '../components/grifball/aiSingleEntityRuntime';
import { createTacticalTargetCallbacksForState } from '../components/grifball/tacticalTargetCallbacks';
import { createPlayerModelObservationCallbacksForState } from '../components/grifball/playerModelObservations';
import { createArenaCollisionCallbacksForState } from '../components/grifball/arenaCollisionCallbacks';
import { triggerCombatantAttackAction } from '../components/grifball/combatantActions';
import { getOptimalGrifballSpawnPoint } from '../components/grifball/arenaSpawns';
import { withSimulationRandom } from '../game/simulationRandom';
import { normalizeYaw } from './physics';

function fixture(id = 'ordinary') {
  const state = createMatch({ map: structuredClone(defaultGrifballMap()), seed: 33, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 50, weaponReadyTime: 0 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = target.weapon = 'hammer';
  actor.pos = { x: 0, y: 0, z: -7 }; target.pos = { x: 0, y: 0, z: 7 }; player.pos = { x: 25, y: 0, z: 25 };
  state.match.phase = 'playing'; state.map.objects = []; state.map.arenaRadius = 30;
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  const initial: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: .1, cooldownMultiplier: 1,
    swayTimer: 0, coordCommitTimer: 0, pendingPostEvasionCharge: false };
  const memories = { [id]: { ...initial }, target: { ...initial } };
  const knobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
    weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 0 };
  const matchContext = createAIMatchContext(), owners = { [id]: 'normal', target: 'normal' };
  return { state, actor, target, player, memories, matchContext, knobs, owners };
}


function controlFor(f: ReturnType<typeof fixture>, random: () => number): SimGrifballActorControl {
  return { scriptedBots: f.owners, configs: Object.fromEntries(Object.keys(f.owners).map(id => [id, {
    knobs: { ...f.knobs }, derived: deriveAIParams(f.state.settings, f.knobs),
    flags: { skipPressure: false, feintBias: 1, spacingBand: 1 },
  }])), memories: f.memories, matchContext: f.matchContext, random,
    getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }), isObserverMode: true,
    navigation: {}, spawnPoints: [{ x: -12, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }] };
}
function plannerFor(c: SimGrifballActorControl): ScriptedObjectivePlanner {
  return { version: 'scripted-objective-planner-v1', scriptedBots: c.scriptedBots, plan: c.matchContext.grifballTeamPlan,
    punchControl: { version: 'scripted-carrier-punch-v1', cooldowns: Object.fromEntries(Object.keys(c.scriptedBots).map(id => [id, 0])) },
    passControl: 'scripted-pass-v1' };
}

function liveFor(f: ReturnType<typeof fixture>, control: SimGrifballActorControl) {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: f.state.settings,
    isMultiplayer: false, multiplayerRole: null });
  state.isObserverMode = true; state.arenaRadius = f.state.map.arenaRadius; state.otherPlayers.clear();
  state.grifball = structuredClone(f.state.match);
  const refs = createInitialGrifballThreeRefs(), point = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
  for (const c of [f.actor, f.target]) {
    const m = f.memories[c.id];
    const bot = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team, spawnPos: point(c.pos),
      yaw: c.yaw + Math.PI, hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(bot, { hp: c.hp, maxHp: c.maxHp, respawnTimer: c.respawnTimer, invulnerabilityTimer: c.invulnerabilityTimer,
      vel: point(c.vel), activeWeapon: c.weapon, weaponState: 'ready', weaponTimer: 0, swapCooldownTimer: c.weaponReadyTimer,
      swapLockoutTimer: c.swapLockoutTimer, isJumping: c.isJumping, isLunging: c.isLunging,
      aiState: m.aiState, aiTimer: m.timer, aiSwayTimer: m.swayTimer, aiCoordCommitTimer: m.coordCommitTimer,
      aiDashRemaining: c.dashRemaining, aiDashCooldownTimer: c.dashCooldownTimer, aiDashDir: { ...c.dashDir },
      aiSlideActive: c.slideActive, aiSlideDistanceTraveled: c.aiSlideDistanceTraveled ?? 0, aiSlideCooldownTimer: c.slideCooldownTimer,
      aiHammerJumpCooldownTimer: c.aiHammerJumpCooldownTimer, aiHammerJumpsInAir: c.hammerJumpsInAir,
      lungeTargetDir: { ...c.lungeDir }, lungeStartPos: { ...c.lungeStartPos },
      aiPendingPostEvasionCharge: m.pendingPostEvasionCharge });
    state.otherPlayers.set(c.id, bot); refs.otherPlayerMeshes.set(c.id, { group: new THREE.Group() } as never);
  }
  const noop = () => {}, mai = () => state.otherPlayers.get('main_ai');
  const common = { getState: () => state, getRefs: () => refs, getActiveCustomMap: () => f.state.map };
  const observations = createPlayerModelObservationCallbacksForState(common);
  const collision = createArenaCollisionCallbacksForState({ ...common, getMainAI: mai, isMultiplayer: false,
    multiplayerRole: null, opponentClientId: '' });
  const targets = createTacticalTargetCallbacksForState({ ...common, getMainAI: mai,
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as never),
    resolveBotKnobs: () => f.knobs, resolveBotDerived: () => control.configs[f.actor.id].derived,
    getMatchScoreContext: () => control.getScoreContext(f.state) });
  const update = createAISingleEntityUpdaterForState({ ...observations, ...collision, ...targets,
    stateRef: { current: state }, threeRef: { current: refs }, mai,
    resolveBotKnobs: () => f.knobs, resolveBotDerived: () => control.configs[f.actor.id].derived,
    resolveBotFlags: () => control.configs[f.actor.id].flags, getMatchScoreContext: () => control.getScoreContext(f.state),
    grifballEnemyGoalPos: (team: string) => getGrifballEnemyGoalPosForMap(team, f.state.map),
    getOptimalSpawnPoint: (exclude: THREE.Vector3[]) => getOptimalGrifballSpawnPoint(f.state.map, control.spawnPoints.map(point), exclude),
    getActiveCustomMap: () => f.state.map, clearPressureTarget: noop,
    triggerCombatantAttack: (self, weapon, melee = false) => triggerCombatantAttackAction({ self, weapon, melee,
      recordHammerAttack: id => observations.recordCombatantObservation(id, observePlayerHammerAttack), playSwing: noop }),
    swapCombatantWeapon: () => assert.fail('carrier cannot swap'),
    triggerCombatantLunge: () => assert.fail('carrier cannot sword-lunge'),
    startAIHammerJump: () => assert.fail('carrier cannot hammer-jump'),
    tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  return { state, bot: state.otherPlayers.get(f.actor.id)!, update };
}
const close = (actual: number, expected: number, field: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${field}: ${actual} != ${expected}`);

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const preference of [0, 50, 100]) for (const roll of [.1, .9])
  for (const motion of ['airborne', 'landing', 'dash', 'slide', 'no-target', 'threat'] as const)
  test(`carrier combat fallback matches the production updater ${id}/${dt}/${preference}/${roll}/${motion}`, () => {
    const f = fixture(id);
    f.state.match.ball.state = 'held'; f.state.match.ball.holderId = id;
    setSimCarrier(f.actor, true, f.state.settings, f.state); f.actor.weaponReadyTimer = 0;
    f.actor.pos = { x: 0, y: 2, z: -7 }; f.actor.vel = { x: 2, y: -1, z: 1 }; f.actor.isJumping = true;
    if (motion === 'landing') { f.actor.pos.y = .01; f.actor.vel.y = -2; f.target.pos = { x: 0, y: 0, z: -5.5 }; }
    if (motion === 'dash' || motion === 'slide') {
      f.actor.pos.y = f.actor.vel.y = 0; f.actor.isJumping = false;
      f.actor.dashRemaining = motion === 'dash' ? .2 : 0; f.actor.dashDir = { x: 1, y: 0, z: 0 };
      f.actor.slideActive = motion === 'slide'; f.actor.aiSlideDistanceTraveled = 0;
    }
    if (motion === 'no-target') { f.target.hp = 0; f.target.alive = false; f.target.respawnTimer = 3; }
    if (motion === 'threat') {
      f.target.weapon = 'sword'; f.target.isLunging = true; f.target.lungeDir = { x: 0, y: 0, z: -1 };
      f.target.pos = { x: 0, y: 0, z: -1 }; f.target.lungeStartPos = { ...f.target.pos };
      f.target.lungeTargetId = id; f.actor.dashCooldownTimer = 2;
    }
    // High swap preference exercises the carrier's swap veto rather than IQ=0 alone.
    f.knobs.weaponSwapIQ = 80; f.knobs.weaponPrioritization = preference; f.knobs.movementComplexity = 80;
    const control = controlFor(f, () => roll); if (motion !== 'landing') control.planner = plannerFor(control);
    const live = liveFor(f, control), options = createSimGrifballActorStepOptions(f.state, control, dt);
    const owner = options.scriptedActorDecisions!, prepare = owner.prepare!, complete = owner.completeTurn!;
    let compared = false;
    owner.prepare = context => {
      if (context.actorId === id) {
        live.state.aiMatchContext.grifballTeamPlan = structuredClone(control.matchContext.grifballTeamPlan);
        withSimulationRandom(() => roll, dt, () => live.update(id, dt));
      }
      return prepare(context);
    };
    owner.completeTurn = context => {
      complete(context);
      if (context.actorId !== id) return;
      compared = true;
      assert.equal(context.record.kind, 'handled');
      for (const axis of ['x', 'y', 'z'] as const) {
        close(f.actor.pos[axis], live.bot.pos[axis], `pos.${axis}`);
        close(f.actor.vel[axis], live.bot.vel[axis], `vel.${axis}`);
      }
      close(normalizeYaw(f.actor.yaw), normalizeYaw(live.bot.yaw - Math.PI), 'yaw');
      close(f.actor.dashRemaining, live.bot.aiDashRemaining!, 'dashRemaining');
      close(f.actor.dashCooldownTimer, live.bot.aiDashCooldownTimer!, 'dashCooldown');
      close(f.memories[id].timer!, live.bot.aiTimer!, 'AI timer');
      close(f.memories[id].swayTimer, live.bot.aiSwayTimer!, 'sway');
      assert.equal(f.memories[id].aiState, live.bot.aiState);
      assert.equal(f.actor.isJumping, live.bot.isJumping); assert.equal(f.actor.slideActive, live.bot.aiSlideActive);
      assert.equal(f.actor.weapon, live.bot.activeWeapon); assert.equal(f.actor.weapon, 'ball');
      assert.equal(f.state.match.ball.holderId, id);
      if (motion === 'landing') {
        assert.equal(f.actor.attackKind, 'punch'); assert.equal(live.bot.weaponState, 'swing_up');
        assert.equal(f.matchContext.playerModels.get(id)?.hammerAttacks, live.state.aiMatchContext.playerModels.get(id)?.hammerAttacks);
      }
    };
    stepSimulation(f.state, {}, options); assert.equal(compared, true);
  });

for (const requestedWeapon of ['hammer', 'sword'] as const) for (const force of [false, true])
  test(`carrier tactical swap is forbidden even with force: ${requestedWeapon}/${force}`, () => {
    assert.equal(canApplyAITacticalWeaponSwap({ activeWeapon: 'ball', requestedWeapon, force,
      weaponState: 'ready', swapLockoutTimer: 0, swordForbidden: false, hammerForbidden: false }), false);
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const motion of ['airborne', 'dash', 'slide', 'no-target'] as const)
  test(`carrier resumes objective running across checkpoints ${id}/${dt}/${motion}`, () => {
    const f = fixture(id);
    f.target.pos = { x: 25, y: 0, z: 25 };
    f.state.match.ball.state = 'held'; f.state.match.ball.holderId = id;
    setSimCarrier(f.actor, true, f.state.settings, f.state); f.actor.weaponReadyTimer = 0;
    f.actor.pos = { x: 0, y: 0, z: -7 };
    if (motion === 'airborne' || motion === 'no-target') {
      f.actor.pos.y = 2; f.actor.vel = { x: 1, y: -1, z: .5 }; f.actor.isJumping = true;
    }
    if (motion === 'dash') { f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 }; }
    if (motion === 'slide') { f.actor.slideActive = true; f.actor.aiSlideDistanceTraveled = 0; }
    if (motion === 'no-target') { f.target.hp = 0; f.target.alive = false; f.target.respawnTimer = 30; }
    const make = () => ({ state: structuredClone(f.state), memories: structuredClone(f.memories),
      matchContext: structuredClone(f.matchContext), randomState: createRng(87).getState(),
      cooldowns: Object.fromEntries(Object.keys(f.owners).map(id => [id, 0])) });
    const run = make(); let restored = structuredClone(run), handled = 0, objective = 0;
    const advance = (r: typeof run) => {
      const random = createRng(0); random.setState(r.randomState);
      const control = controlFor({ ...f, ...r }, random.next); control.planner = plannerFor(control);
      control.planner.punchControl!.cooldowns = r.cooldowns;
      const result = stepSimulation(r.state, {}, createSimGrifballActorStepOptions(r.state, control, dt));
      r.randomState = random.getState(); return result;
    };
    for (let tick = 0; tick < 120; tick++) {
      const events = advance(run); assert.deepEqual(advance(restored), events);
      assert.deepEqual(restored, run, `carrier checkpoint at ${tick}`);
      if ([1, 8, 25, 60].includes(tick)) restored = structuredClone(run);
      const record = events.actorDecisionFrame!.decisions.find(r => r.id === id)!;
      handled += Number(record.kind === 'handled'); objective += Number(record.kind === 'objective');
      const carrier = run.state.combatants[0];
      assert.equal(carrier.weapon, 'ball'); assert.equal(carrier.hasBall, true); assert.equal(run.state.match.ball.holderId, id);
    }
    assert.ok(handled > 0, 'initial movement needs combat or no-target recovery');
    assert.ok(objective > 0, 'recovered carrier must resume objective running');
    assert.ok(Math.hypot(run.state.combatants[0].pos.x, run.state.combatants[0].pos.z + 7) > 1, 'runner must travel');
  });

for (const malformed of ['weapon', 'flag', 'holder', 'loose', 'flight'] as const)
  test(`carrier fallback rejects inconsistent possession: ${malformed}`, () => {
    const f = fixture(); f.actor.hasBall = true; f.actor.weapon = 'ball';
    f.state.match.ball.state = 'held'; f.state.match.ball.holderId = f.actor.id;
    if (malformed === 'weapon') f.actor.weapon = 'hammer';
    if (malformed === 'flag') f.actor.hasBall = false;
    if (malformed === 'holder') f.state.match.ball.holderId = f.target.id;
    if (malformed === 'loose') f.state.match.ball.state = 'loose';
    if (malformed === 'flight') f.actor.isLunging = true;
    assert.equal(hasCoherentSimCarrierState(f.state, f.actor), false);
    f.actor.pos.y = 2; f.actor.isJumping = true;
    assert.throws(() => stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, controlFor(f, () => .9))), /coherent possession/);
  });
