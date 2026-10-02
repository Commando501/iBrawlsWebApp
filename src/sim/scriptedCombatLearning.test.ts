import { triggerPlayerHammerSwingForState } from '../components/grifball/playerWeaponActions';
import { recordLocalPlayerModelObservation } from '../components/grifball/playerModelObservations';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { stepCombatantWeapons } from './weapons';
import { createAIMatchContext } from '../game/aiMatchContext';
import { deriveAIParams } from '../game/aiTuning';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballActorStepOptions, type SimGrifballActorControl } from './grifballActorOwner';
import { createScriptedCombatLearning, validateScriptedCombatLearning, type ScriptedCombatLearning } from './scriptedCombatLearning';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { triggerCombatantAttackAction, swapCombatantWeaponAction, startAIHammerJumpForCombatant } from '../components/grifball/combatantActions';
import { triggerEnemyHammerSwingForCombatant } from '../components/grifball/enemyWeaponActions';
import { recordCombatantModelObservation, observePlayerHammerAttack, observePlayerWeaponSwap } from '../components/grifball/playerModelObservations';
import { applyBotMeleeImpactForState } from '../components/grifball/botMeleeImpactRuntime';
import { startAISpatialDodgeForCombatant } from '../components/grifball/aiSpatialDodgeRuntime';
import { isSkillCalibrationEnabled } from '../game/aiSkillCalibration';
import { resolveAIBulltrueCounterForCombatant } from '../components/grifball/aiBulltrueCounterRuntime';
const noop = () => {};
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

function learningFor(f: ReturnType<typeof fixture>): ScriptedCombatLearning {
  return { version: 'scripted-combat-learning-v1', scriptedBots: f.owners, matchContext: f.matchContext, isObserverMode: true };
}
function liveFor(f: ReturnType<typeof fixture>) {
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: f.state.settings,
    isMultiplayer: false, multiplayerRole: null });
  live.isObserverMode = true; live.arenaRadius = f.state.map.arenaRadius; live.otherPlayers.clear();
  const actors = [f.actor, f.target].map(c => {
    const bot = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team,
      spawnPos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), yaw: c.yaw - Math.PI, hue: 0,
      difficulty: 'normal', settings: f.state.settings });
    Object.assign(bot, { hp: c.hp, maxHp: c.maxHp, respawnTimer: 0, invulnerabilityTimer: 0,
      activeWeapon: c.weapon, weaponState: 'ready', weaponTimer: 0, swapCooldownTimer: 0,
      aiDashRemaining: 0, aiHammerJumpsInAir: 0 });
    live.otherPlayers.set(bot.id, bot); return bot;
  });
  return { live, bot: actors[0], target: actors[1] };
}
for (const id of ['main_ai', 'ordinary']) for (const attack of ['slam', 'swipe', 'slash', 'punch']) for (const blocked of [false, true])
  test(`accepted ${attack} model matches live callback ${id}/${blocked}`, () => {
    const f = fixture(id); f.actor.weapon = attack === 'slash' ? 'sword' : attack === 'punch' ? 'ball' : 'hammer';
    const { live, bot } = liveFor(f), owner = learningFor(f), learning = createScriptedCombatLearning(f.state, owner, f.state.settings);
    if (blocked) f.actor.weaponReadyTimer = 1;
    const action = { ...idleAction(), attackPrimary: attack !== 'swipe', attackSecondary: attack === 'swipe' };
    stepCombatantWeapons(f.state, f.actor, action, f.state.settings, 1 / 60, [], 'intent', undefined, undefined, undefined, false, undefined, learning);
    if (!blocked) triggerCombatantAttackAction({ self: bot, weapon: attack === 'slash' ? 'sword' : 'hammer', melee: attack === 'swipe',
      recordHammerAttack: actorId => recordCombatantModelObservation(live, actorId, observePlayerHammerAttack), playSwing: noop });
    assert.equal(f.actor.weaponState, blocked ? 'idle' : 'windup');
    assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
    const before = structuredClone(f.matchContext.playerModels);
    stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'animation', undefined, undefined, undefined, false, undefined, learning);
    assert.deepEqual(f.matchContext.playerModels, before, 'animation must not count the same attack again');
  });

for (const id of ['main_ai', 'ordinary']) for (const revert of [false, true]) for (const blocked of [false, true])
  test(`accepted swap/reversion model preserves live ordering ${id}/${revert}/${blocked}`, () => {
    const f = fixture(id); if (revert) f.actor.weapon = 'sword';
    const { live, bot } = liveFor(f), learning = createScriptedCombatLearning(f.state, learningFor(f), f.state.settings);
    if (blocked) f.actor.weaponState = 'windup';
    stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'intent',
      [revert ? { kind: 'revert-weapon-feint' } : { kind: 'swap', weapon: 'sword' }], undefined, undefined, false,
      { sequentialOpportunities: true }, learning);
    if (!blocked) swapCombatantWeaponAction({ self: bot, settings: live.settings, type: revert ? 'hammer' : 'sword',
      recordWeaponSwap: (actorId, weapon) => recordCombatantModelObservation(live, actorId, model => observePlayerWeaponSwap(model, weapon)) });
    assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
    assert.equal(f.matchContext.playerModels.get(id)?.weaponSwaps ?? 0, blocked ? 0 : 1);
  });

for (const id of ['main_ai', 'ordinary']) test(`special hammer jump does not invent a generic attack sample ${id}`, () => {
  const f = fixture(id), { live, bot } = liveFor(f), learning = createScriptedCombatLearning(f.state, learningFor(f), f.state.settings);
  stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'intent',
    [{ kind: 'hammer-jump', jumpType: 'offensive' }], undefined, undefined, false, { sequentialOpportunities: true }, learning);
  assert.equal(startAIHammerJumpForCombatant({ self: bot, settings: live.settings, vel: bot.vel,
    onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop }), true);
  assert.equal(f.actor.weaponState, 'windup'); assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
});

for (const id of ['main_ai', 'ordinary']) for (const weapon of ['hammer', 'sword', 'ball'] as const) for (const hp of [1, 3])
  test(`actual ${weapon} impact learning matches live roster ${id}/${hp}`, () => {
    const f = fixture(id); f.actor.weapon = weapon; f.actor.pos = { x: 0, y: 0, z: 0 }; f.actor.yaw = 0;
    f.target.pos = { x: 0, y: 0, z: weapon === 'hammer' ? 3.2 : 1.5 }; f.target.hp = hp;
    const { live } = liveFor(f), learning = createScriptedCombatLearning(f.state, learningFor(f), f.state.settings);
    f.actor.attackKind = weapon === 'hammer' ? 'strike' : weapon === 'sword' ? 'slash' : 'punch';
    f.actor.weaponState = weapon === 'sword' ? 'windup' : 'active'; f.actor.weaponPhaseElapsed = 1;
    const kills: Parameters<typeof stepCombatantWeapons>[5] = [];
    stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, kills, 'animation', undefined,
      () => assert.equal(f.matchContext.playerModels.get(id)?.damageDealtCount, 1, 'learning must precede surviving-hit combo feedback'),
      undefined, false, undefined, learning);
    applyBotMeleeImpactForState({ state: live, botId: id, renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop,
      playExplosion: noop, playDeath: noop, playSwing: noop, recordBotPsychKill: noop, recordBotCalibrationDeath: noop });
    assert.equal(f.target.hp, hp - 1); assert.equal(kills.length, hp === 1 ? 1 : 0);
    assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
    assert.deepEqual(f.matchContext.coordinator, live.aiMatchContext.coordinator);
  });

for (const difficulty of ['easy', 'normal', 'hard', 'custom']) test(`spatial dodge records its actual direction and calibration ${difficulty}`, () => {
  const f = fixture(), owner = learningFor(f); owner.scriptedBots = { [f.actor.id]: difficulty };
  const { live, bot, target } = liveFor(f);
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedCombatLearning: owner,
    scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: owner.scriptedBots,
      prepare: () => 'engagement', resolve: () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v6', commands: [],
        mobility: { version: 'scripted-ai-mobility-v2', kind: 'spatial-dodge', direction: { x: -1, z: 0 } }, mobilityAfterCommands: 0,
        dash: { version: 'scripted-ai-dash-v1', aiState: 'APPROACHING', pendingPostEvasionCharge: false,
          target: { targetWeaponState: 'ready', attackDistanceToTarget: 14, resolvedAiReach: 3, spatialIQ: 50, targetProtected: false, weaponReady: true } } }) } });
  // Use the live spatial-dodge callback's model/calibration side effects, with
  // the corresponding deterministic incoming direction and random branch.
  startAISpatialDodgeForCombatant({ state: live, botId: bot.id, target: target as any,
    frame: { pos: bot.pos, dashDir: new THREE.Vector3(), dashRemaining: 0, dashCooldownTimer: 0, pendingPostEvasionCharge: false },
    lungeDirX: 0, lungeDirZ: 1, playerModel: null, calibrationEnabled: isSkillCalibrationEnabled(difficulty),
    trackPostEvasion: false, attackDistanceToTarget: 14, resolvedAiReach: 3, targetProtected: false, spatialIQ: 50, weaponReady: true,
    recordCombatantObservation: (actorId, observe) => recordCombatantModelObservation(live, actorId, observe), playDash: noop, random: () => .9 });
  assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
  assert.deepEqual(f.matchContext.skillCalibration, live.aiMatchContext.skillCalibration);
});

for (const fault of ['version', 'legacy', 'local', 'remote', 'neural', 'models', 'calibration', 'coordinator', 'observer'])
  test(`learning rejects ${fault} before simulation mutation`, () => {
    const f = fixture(), owner = learningFor(f);
    if (fault === 'version') owner.version = 'old' as never;
    if (fault === 'legacy') f.state.combatExecution = 'legacy-v1';
    if (fault === 'local') f.state.localPlayerId = f.actor.id;
    if (fault === 'remote') f.actor.controller = 'remote';
    if (fault === 'neural') (owner.scriptedBots as any)[f.actor.id] = 'neural-net';
    if (fault === 'models') owner.matchContext.playerModels = {} as never;
    if (fault === 'calibration') owner.matchContext.skillCalibration = {} as never;
    if (fault === 'coordinator') owner.matchContext.coordinator = {} as never;
    if (fault === 'observer') owner.isObserverMode = 'yes' as never;
    const before = structuredClone(f.state);
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedCombatLearning: owner }), /learning/i);
    assert.deepEqual(f.state, before);
  });

test('composed factory carries the configured mechanics into execution', () => {
  const f = fixture(); f.state.settings.weaponReadyTime = 1.7;
  const control = controlFor(f, () => .9), options = createSimGrifballActorStepOptions(f.state, control);
  assert.equal(options.settings, f.state.settings);
  const original = options.scriptedActorDecisions!.resolve;
  options.scriptedActorDecisions!.resolve = ctx => ctx.actorId === f.actor.id
    ? { kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v6', commands: [{ kind: 'swap', weapon: 'sword' }] }
    : original(ctx);
  stepSimulation(f.state, {}, options);
  assert.equal(f.actor.weaponReadyTimer, 1.7);
  assert.equal(f.matchContext.playerModels.get(f.actor.id)?.weaponSwaps, 1);
});

for (const id of ['main_ai', 'ordinary']) for (const ready of [false, true])
  test(`composed bulltrue calibration records only a started counter ${id}/${ready}`, () => {
    const f = fixture(id); f.knobs.weaponSwapIQ = 100; f.knobs.movementComplexity = 80;
    f.actor.dashCooldownTimer = 2; f.target.pos.z = f.actor.pos.z + 6;
    if (!ready) f.actor.weaponReadyTimer = 1;
    Object.assign(f.target, { weapon: 'sword', isLunging: true, lungeDir: { x: 0, y: 0, z: -1 },
      lungeTargetId: id, lungeStartPos: { ...f.target.pos } });
    const { live } = liveFor(f), control = controlFor(f, () => .9);
    stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
    resolveAIBulltrueCounterForCombatant({ state: live, botId: id, calibrationEnabled: true,
      frame: { activeWeapon: 'hammer', weaponState: 'ready', aiState: 'APPROACHING', timer: .1 },
      bulltrueCounter: 'hammer', canStartWeaponAction: ready, cooldownMultiplier: 1, triggerCombatantAttack: noop });
    assert.deepEqual(f.matchContext.skillCalibration.get(id)?.pendingCounter,
      live.aiMatchContext.skillCalibration.get(id)?.pendingCounter);
    assert.equal(!!f.matchContext.skillCalibration.get(id)?.pendingCounter, ready);
  });

test('accepted action learning is visible before the next actor decides', () => {
  const f = fixture(), control = controlFor(f, () => .9), options = createSimGrifballActorStepOptions(f.state, control);
  const original = options.scriptedActorDecisions!.resolve;
  options.scriptedActorDecisions!.resolve = ctx => {
    if (ctx.actorId === f.actor.id) return { kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v6',
      commands: [{ kind: 'melee', weapon: 'hammer', swipe: false }] };
    assert.equal(f.matchContext.playerModels.get(f.actor.id)?.hammerAttacks, 1);
    return original(ctx);
  };
  stepSimulation(f.state, {}, options);
});

for (const split of ['models', 'coordinator', 'authority']) test(`composed learning rejects split ${split} ownership`, () => {
  const f = fixture(), options = createSimGrifballActorStepOptions(f.state, controlFor(f, () => .9));
  if (split === 'models') options.scriptedLungeFeedback!.models = new Map();
  if (split === 'coordinator') options.scriptedLungeFeedback!.coordinator = createAIMatchContext().coordinator;
  if (split === 'authority') options.scriptedCombatLearning!.scriptedBots = { [f.actor.id]: 'hard' };
  const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, {}, options), /must share/);
  assert.deepEqual(f.state, before);
});

for (const weapon of ['hammer', 'ball'] as const) for (const blocked of [false, true]) for (const observer of [false, true])
  test(`local accepted primary attack learning matches live ${weapon}/${blocked}/${observer}`, () => {
    const f = fixture(), { live } = liveFor(f); f.player.weapon = live.activeWeapon = weapon;
    live.isObserverMode = observer; live.playerHP = 1; live.playerRespawnTimer = 0;
    live.pWeaponState = 'ready'; live.pWeaponReady = true;
    live.swapCooldownTimer = f.player.weaponReadyTimer = blocked ? 1 : 0;
    const learning = createScriptedCombatLearning(f.state, { ...learningFor(f), isObserverMode: observer }, f.state.settings);
    stepCombatantWeapons(f.state, f.player, { ...idleAction(), attackPrimary: true }, f.state.settings, 1 / 60,
      [], 'complete', undefined, undefined, undefined, false, undefined, learning);
    triggerPlayerHammerSwingForState({ state: live, recordHammerAttack: () => recordLocalPlayerModelObservation(live, observePlayerHammerAttack),
      playSwing: noop, sendSync: noop });
    assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels);
    assert.equal(f.matchContext.playerModels.get('player')?.hammerAttacks ?? 0, blocked || observer ? 0 : 1);
    const before = structuredClone(f.matchContext.playerModels);
    stepCombatantWeapons(f.state, f.player, idleAction(), f.state.settings, 1 / 60, [], 'animation',
      undefined, undefined, undefined, false, undefined, learning);
    assert.deepEqual(f.matchContext.playerModels, before, 'later animation must not add another accepted action');
  });
