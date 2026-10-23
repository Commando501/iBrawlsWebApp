import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { stepCombatantWeapons } from './weapons';
import { createAIMatchContext, resetAIMatchContext } from '../game/aiMatchContext';
import { deriveAIParams } from '../game/aiTuning';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballActorStepOptions, type SimGrifballActorControl } from './grifballActorOwner';
import { createScriptedCombatLearning, validateScriptedCombatLearning, type ScriptedCombatLearning } from './scriptedCombatLearning';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { applyBotMeleeImpactForState } from '../components/grifball/botMeleeImpactRuntime';
import { recordBotPostKillPressure } from '../components/grifball/postKillPressure';
import { getOptimalGrifballSpawnPoint } from '../components/grifball/arenaSpawns';
import { recordBotCalibrationDeathForState } from '../components/grifball/aiBookkeeping';
import { applyAISwordLungeHitForState } from '../components/grifball/aiSwordLungeHitRuntime';
import { executeCustomBotTradeForState } from '../components/grifball/tradeRuntime';
import { respawnAICombatant } from '../components/grifball/combatantRespawn';
import { resolveMixedPlayerLunge } from './weapons';
import { resetSimGrifballActorSession } from './scriptedActorLifecycle';
import { createRng } from './rng';
import { recordCalibrationDodgeAttempt } from '../game/aiSkillCalibration';
import { updatePlayerSwordLungeForState } from '../components/grifball/playerSwordLungeRuntime';
import { recordLocalPlayerLungeEndObservation, recordLocalPlayerDamageDealtObservation, recordLocalPlayerModelObservation, observePlayerCounter } from '../components/grifball/playerModelObservations';
import { executePlayerCombatantTradeForState } from '../components/grifball/tradeRuntime';
import { recordPlayerMeleeKillForState } from '../components/grifball/playerMeleeDeathRuntime';
import { tickGrifballObjective } from './grifball';
import { withSimulationRandom } from '../game/simulationRandom';
import { recordDeathEvent } from '../components/grifball/deathFeed';
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

function lifecycleFor(f: ReturnType<typeof fixture>, observer = true, aggression = 80) {
  const owner = learningFor(f); owner.isObserverMode = observer;
  owner.lifecycle = { memories: f.memories,
    pressure: Object.fromEntries(Object.keys(f.owners).map(id => [id, { aggression }])),
    spawnPoints: [{ x: -12, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }] };
  return owner;
}
function liveCallbacks(f: ReturnType<typeof fixture>, l: ReturnType<typeof liveFor>, owner: ScriptedCombatLearning) {
  l.live.isObserverMode = owner.isObserverMode;
  l.live.playerHP = f.player.hp; l.live.playerRespawnTimer = f.player.respawnTimer;
  l.live.playerPos.set(f.player.pos.x, f.player.pos.y, f.player.pos.z);
  const recordBotCalibrationDeath = (botId: string) => recordBotCalibrationDeathForState({ state: l.live,
    botId, difficulty: f.owners[botId], nowSeconds: (f.state.combatTimeMs ?? 0) / 1000 });
  const recordBotPsychKill = (botId: string, victimId: string, wasLungeKill: boolean) => recordBotPostKillPressure({
    state: l.live, bot: l.live.otherPlayers.get(botId), botId, victimId, difficulty: f.owners[botId],
    pressureAggression: owner.lifecycle!.pressure[botId].aggression, wasLungeKill, rosterAI: [l.bot, l.target],
    nowSeconds: (f.state.combatTimeMs ?? 0) / 1000,
    getOptimalSpawnPoint: excluded => getOptimalGrifballSpawnPoint(f.state.map,
      owner.lifecycle!.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z)), excluded),
  });
  return { recordBotCalibrationDeath, recordBotPsychKill };
}
function compareFeedback(f: ReturnType<typeof fixture>, l: ReturnType<typeof liveFor>) {
  assert.deepEqual(f.matchContext.skillCalibration, l.live.aiMatchContext.skillCalibration);
  assert.deepEqual(f.matchContext.psychState, l.live.aiMatchContext.psychState);
  for (const bot of [l.bot, l.target]) {
    assert.equal(f.memories[bot.id].aiState, bot.aiState, `${bot.id} AI state`);
    assert.equal(f.memories[bot.id].pressureTargetId, bot.aiPressureTargetId, `${bot.id} pressure target`);
  }
}
function renameTargetMain(f: ReturnType<typeof fixture>) {
  f.target.id = 'main_ai'; f.memories.main_ai = f.memories.target; delete f.memories.target;
  f.owners.main_ai = f.owners.target; delete f.owners.target;
}
function flight(f: ReturnType<typeof fixture>) {
  Object.assign(f.actor, { weapon: 'sword', isLunging: true, lungeTargetId: f.target.id,
    lungeStartPos: { ...f.actor.pos }, lungeDir: { x: 0, y: 0, z: 1 }, lungeTimer: 0 });
}

for (const main of ['attacker', 'victim', 'neither']) for (const difficulty of ['easy', 'normal', 'custom'])
  for (const hp of [1, 3]) for (const aggression of [0, 80])
    test(`melee lifecycle matches live ${main}/${difficulty}/${hp}/${aggression}`, () => {
      const f = fixture(main === 'attacker' ? 'main_ai' : 'ordinary'); if (main === 'victim') renameTargetMain(f);
      for (const id of Object.keys(f.owners)) f.owners[id] = difficulty;
      f.actor.pos = { x: 0, y: 0, z: 0 }; f.actor.yaw = 0; f.target.pos = { x: 0, y: 0, z: 3.2 }; f.target.hp = hp;
      f.state.combatTimeMs = 7300;
      const owner = lifecycleFor(f, true, aggression), l = liveFor(f), callbacks = liveCallbacks(f, l, owner);
      for (const bot of [l.bot, l.target]) { bot.aiState = f.memories[bot.id].aiState; bot.aiPressureTargetId = 'stale'; f.memories[bot.id].pressureTargetId = 'stale'; }
      f.actor.attackKind = 'strike'; f.actor.weaponState = 'active'; f.actor.weaponPhaseElapsed = 1;
      stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'animation', undefined,
        undefined, undefined, false, undefined, createScriptedCombatLearning(f.state, owner, f.state.settings));
      applyBotMeleeImpactForState({ state: l.live, botId: f.actor.id, renderHammerSplashVfx: noop,
        spawnVoxelShockwaveParticles: noop, playExplosion: noop, playDeath: noop, playSwing: noop, ...callbacks });
      assert.equal(f.target.hp, hp - 1); compareFeedback(f, l);
    });

for (const main of ['attacker', 'victim', 'neither']) for (const hp of [1, 3]) for (const trade of [false, true])
  test(`lunge lifecycle preserves finish/kill/trade order ${main}/${hp}/${trade}`, () => {
    const f = fixture(main === 'attacker' ? 'main_ai' : 'ordinary'); if (main === 'victim') renameTargetMain(f);
    f.actor.pos = { x: 0, y: 0, z: 0 }; f.target.pos = { x: 0, y: 0, z: 1 }; f.actor.hp = f.target.hp = hp;
    f.state.settings.enableSwordTrade = trade; f.state.settings.enableHammerSwordTrade = false; flight(f);
    if (trade) { f.target.weapon = 'sword'; f.target.weaponState = 'windup'; f.target.attackKind = 'slash'; }
    const owner = lifecycleFor(f), l = liveFor(f), callbacks = liveCallbacks(f, l, owner);
    for (const bot of [l.bot, l.target]) bot.aiState = f.memories[bot.id].aiState;
    const finish = () => { f.memories[f.actor.id].aiState = 'COOLDOWN'; };
    const kills: Parameters<typeof stepCombatantWeapons>[5] = [];
    stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, kills, 'flight', undefined, undefined,
      { impact: noop, finish }, false, undefined, createScriptedCombatLearning(f.state, owner, f.state.settings));
    if (trade) {
      executeCustomBotTradeForState({ state: l.live, attackerBot: l.bot, target: l.target,
        rosterCombatant: id => l.live.otherPlayers.get(id), evaluatePlayerKillMedals: () => [],
        recordDeathEvent: () => ({ id: 'test', attacker: 'a', victim: 'v' }), getLocalPlayerFeedName: () => 'Player',
        playExplosion: noop, playDeath: noop, spawnVoxelShockwaveParticles: noop, pushStatsUpdate: noop, ...callbacks });
      if (l.bot.hp > 0) l.bot.aiState = 'COOLDOWN';
    } else {
      applyAISwordLungeHitForState({ state: l.live, attackerBot: l.bot, target: { id: l.target.id } as any,
        mainAi: l.live.otherPlayers.get('main_ai'), cooldownMult: 1,
        finishSwordLunge: () => { l.bot.aiState = 'COOLDOWN'; }, recordPlayerDamageTaken: noop,
        playExplosion: noop, playDeath: noop, spawnVoxelShockwaveParticles: noop,
        recordDeathEvent: () => ({ id: 'test', attacker: 'a', victim: 'v' }), ...callbacks });
    }
    // The complete live updater now synchronizes its finish frame after impact callbacks.
    if (!trade && l.bot.hp > 0) l.bot.aiState = 'COOLDOWN';
    assert.equal(f.target.hp, hp - 1); assert.equal(kills.length, hp === 1 ? trade ? 2 : 1 : 0);
    compareFeedback(f, l);
  });

for (const main of [false, true]) for (const hp of [1, 3]) for (const trade of [false, true])
  test(`local lunge updates AI death and surviving trade reload ${main}/${hp}/${trade}`, () => {
    const f = fixture(); if (main) renameTargetMain(f);
    const owner = lifecycleFor(f, false), learning = createScriptedCombatLearning(f.state, owner, f.state.settings);
    f.actor.pos.z = -20; f.player.team = 'blue'; f.player.pos = { x: 0, y: 0, z: 0 };
    f.target.pos = { x: 0, y: 0, z: 1 }; f.target.hp = hp; f.target.weapon = 'sword'; f.target.isLunging = trade;
    Object.assign(f.player, { weapon: 'sword', isLunging: true, lungeStartPos: { ...f.player.pos }, lungeTimer: 0 });
    f.state.settings.enableSwordTrade = trade;
    resolveMixedPlayerLunge(f.state, f.player, f.state.settings, 1 / 60, [], learning);
    const memory = f.memories[f.target.id];
    assert.equal(f.target.hp, hp - 1);
    assert.equal(memory.aiState, hp === 1 ? 'RESPAWNING' : trade ? 'COOLDOWN' : 'APPROACHING');
    if (hp > 1 && trade) assert.equal(memory.timer, f.state.settings.swordLungeReload);
    assert.equal(f.matchContext.skillCalibration.get(f.target.id)?.snapshots.length ?? 0, main && hp === 1 ? 1 : 0);
    assert.equal(f.matchContext.psychState.size, 0, 'local/trade kills must not invent bot post-kill pressure');
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  test(`respawn clears live transient memory before the next decision ${id}/${dt}`, () => {
    const f = fixture(id), l = liveFor(f), memory = f.memories[id];
    Object.assign(memory, { aiState: 'RESPAWNING', timer: 4, swayTimer: 7, coordCommitTimer: 2,
      lastLungeOutcome: 'hit', lastLungeTargetId: 'target', postLungeDecisionTimer: .8,
      pendingPostEvasionCharge: true, pressureTargetId: 'target' });
    Object.assign(l.bot, { aiState: memory.aiState, aiTimer: memory.timer, aiSwayTimer: memory.swayTimer,
      aiCoordCommitTimer: memory.coordCommitTimer, aiLastLungeOutcome: memory.lastLungeOutcome,
      aiLastLungeTargetId: memory.lastLungeTargetId, aiPostLungeDecisionTimer: memory.postLungeDecisionTimer,
      aiPendingPostEvasionCharge: true, aiPressureTargetId: 'target' });
    // A pending combo and feint must be treated differently on revival.
    f.matchContext.comboState.set(id, { marker: 'combo' } as any);
    f.matchContext.feintCooldowns.set(id, .7); l.live.aiMatchContext = structuredClone(f.matchContext);
    f.actor.alive = false; f.actor.hp = 0; f.actor.respawnTimer = dt;
    respawnAICombatant({ combatant: l.bot, mesh: new THREE.Group(), settings: f.state.settings,
      aiMatchContext: l.live.aiMatchContext, playerPos: l.live.playerPos, excludePlayer: false,
      rosterAI: [l.bot, l.target], getOptimalSpawnPoint: () => new THREE.Vector3(), playRespawn: noop });
    let seen = false;
    stepSimulation(f.state, {}, { settings: f.state.settings, dt, scriptedCombatLearning: lifecycleFor(f),
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        beginTurn: ({ actorId }) => { if (actorId !== id) return; seen = true;
          assert.equal(memory.aiState, l.bot.aiState); assert.equal(memory.timer, l.bot.aiTimer);
          assert.equal(memory.swayTimer, l.bot.aiSwayTimer); assert.equal(memory.coordCommitTimer, l.bot.aiCoordCommitTimer);
          assert.equal(memory.lastLungeOutcome, l.bot.aiLastLungeOutcome); assert.equal(memory.lastLungeTargetId, l.bot.aiLastLungeTargetId);
          assert.equal(memory.postLungeDecisionTimer, l.bot.aiPostLungeDecisionTimer);
          assert.equal(memory.pendingPostEvasionCharge, l.bot.aiPendingPostEvasionCharge);
          assert.equal(memory.pressureTargetId, l.bot.aiPressureTargetId);
          assert.deepEqual(f.matchContext, l.live.aiMatchContext);
        }, resolve: () => ({ kind: 'handled', action: idleAction() }) } });
    assert.ok(seen, 'revived actor must enter a decision during this frame');
  });

test('round reset retains learning and memory; fresh session clears them in place', () => {
  const f = fixture(), control = controlFor(f, () => .5);
  f.memories.ordinary.timer = 4; f.matchContext.feintCooldowns.set('ordinary', 2);
  createScriptedCombatLearning(f.state, lifecycleFor(f), f.state.settings).hammerAttack(f.actor);
  const before = structuredClone({ memories: f.memories, context: f.matchContext });
  f.state.match.phase = 'scored'; f.state.match.phaseTimer = 99;
  assert.equal(tickGrifballObjective(f.state, f.state.settings, 1 / 60, {}).roundReset, true);
  assert.deepEqual({ memories: f.memories, context: f.matchContext }, before);
  const memory = f.memories.ordinary, context = f.matchContext, models = context.playerModels;
  const cooldowns = { ordinary: 2, target: 3 };
  resetSimGrifballActorSession({ ...control, planner: { punchControl: { cooldowns } } });
  assert.equal(f.memories.ordinary, memory); assert.equal(f.matchContext, context); assert.equal(context.playerModels, models);
  const fresh = createAIMatchContext(); resetAIMatchContext(fresh);
  assert.deepEqual(f.matchContext, fresh); assert.equal(memory.timer, 0); assert.equal(memory.swayTimer, 0);
  assert.deepEqual(cooldowns, { ordinary: 0, target: 0 });
});

for (const fault of ['memory', 'pressure', 'spawn', 'split-memory']) test(`invalid lifecycle ${fault} rejects before mutation`, () => {
  const f = fixture(), options = createSimGrifballActorStepOptions(f.state, controlFor(f, () => .5));
  const lifecycle = options.scriptedCombatLearning!.lifecycle!;
  if (fault === 'memory') delete lifecycle.memories.ordinary;
  if (fault === 'pressure') lifecycle.pressure = {};
  if (fault === 'spawn') lifecycle.spawnPoints = [{ x: NaN, y: 0, z: 0 }];
  if (fault === 'split-memory') lifecycle.memories = structuredClone(lifecycle.memories);
  const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, {}, options), /lifecycle|Lifecycle/);
  assert.deepEqual(f.state, before);
});

for (const main of [false, true]) for (const weapon of ['hammer', 'sword', 'ball'] as const)
  test(`local ${weapon} animation delivers lethal lifecycle feedback ${main}`, () => {
    const f = fixture(); if (main) renameTargetMain(f);
    f.actor.pos.z = -20; f.player.pos = { x: 0, y: 0, z: 0 }; f.player.team = 'blue'; f.player.yaw = 0;
    f.target.hp = 1; f.target.pos = { x: 0, y: 0, z: weapon === 'hammer' ? 3.2 : 1.5 };
    f.player.weapon = weapon; f.player.attackKind = weapon === 'hammer' ? 'strike' : weapon === 'sword' ? 'slash' : 'punch';
    f.player.weaponState = weapon === 'sword' ? 'windup' : 'active'; f.player.weaponPhaseElapsed = 0;
    f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = false;
    const owner = lifecycleFor(f, false), l = liveFor(f), callbacks = liveCallbacks(f, l, owner);
    l.target.aiState = 'APPROACHING';
    // Advance animation through a real impact while AI is phase-paused.
    f.state.match.phase = 'countdown'; f.state.settings.grifballCountdownDuration = 100;
    let kills = 0;
    for (let frame = 0; frame < 60 && f.target.hp > 0; frame++) kills += stepSimulation(f.state, {}, {
      settings: f.state.settings, scriptedCombatLearning: owner,
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        resolve: () => ({ kind: 'handled', action: idleAction() }) },
    }).kills.length;
    assert.equal(kills, 1, 'local animation must resolve an actual lethal contact');
    recordPlayerMeleeKillForState(l.live, l.target, callbacks.recordBotCalibrationDeath);
    assert.equal(f.memories[f.target.id].aiState, l.target.aiState);
    assert.deepEqual(f.matchContext.skillCalibration, l.live.aiMatchContext.skillCalibration);
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const sword of [false, true])
  test(`checkpoint continuation crosses lethal impact, revival and round reset ${id}/${dt}/${sword}`, () => {
    const f = fixture(id); f.target.hp = 1; f.actor.pos = { x: 0, y: 0, z: 0 }; f.actor.yaw = 0;
    f.target.pos = { x: 0, y: 0, z: sword ? 1 : 3.2 };
    f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = false;
    if (sword) flight(f);
    else { f.actor.weaponState = 'active'; f.actor.attackKind = 'strike'; f.actor.weaponPhaseElapsed = 1; }
    let run = { state: f.state, memories: f.memories, matchContext: f.matchContext, rng: createRng(77).getState() };
    let restored = structuredClone(run), kills = 0, revived = false, resets = 0;
    const advance = (r: typeof run, initial: boolean) => {
      const rng = createRng(0); rng.setState(r.rng);
      const own = { ...f, ...r, actor: r.state.combatants[0], target: r.state.combatants[1], player: r.state.combatants[2] };
      const control = controlFor(own, rng.next), options = createSimGrifballActorStepOptions(r.state, control, dt);
      // Only the initial contact is authored; subsequent turns use the composed
      // policy. This is lifecycle continuation, not full-match quality evidence.
      if (initial) delete options.scriptedActorDecisions;
      const events = stepSimulation(r.state, {}, options); r.rng = rng.getState(); return events;
    };
    const resetFrame = Math.ceil(3.5 / dt);
    for (let frame = 0; frame < resetFrame + 40; frame++) {
      if (frame === resetFrame) for (const r of [run, restored]) { r.state.match.phase = 'scored'; r.state.match.phaseTimer = 99; }
      const events = advance(run, frame === 0), replay = advance(restored, frame === 0);
      assert.deepEqual(replay, events, `events at frame ${frame}`);
      assert.deepEqual(restored, run, `restored state, memory, models and RNG at frame ${frame}`);
      kills += events.kills.length; resets += Number(events.roundReset);
      if (frame > 0 && kills && run.state.combatants[1].alive) revived = true;
      if ([0, 1, Math.ceil(3 / dt), resetFrame].includes(frame)) restored = structuredClone(run);
    }
    assert.ok(kills > 0, 'continuation requires an actual kill');
    assert.ok(revived, 'continuation must cross actual revival'); assert.equal(resets, 1);
  });

for (const main of [false, true]) for (const outcome of ['hit', 'trade', 'miss']) for (const hp of [1, 3])
  test(`local flight learning matches production callbacks ${main}/${outcome}/${hp}`, () => {
    const f = fixture(); if (main) renameTargetMain(f);
    f.actor.pos.z = -20; f.player.team = 'blue'; f.player.pos = { x: 0, y: 0, z: 0 };
    f.target.pos = { x: 0, y: 0, z: outcome === 'miss' ? 10 : 1 }; f.target.hp = hp;
    f.target.weapon = 'sword'; f.target.isLunging = outcome === 'trade';
    f.state.settings.swordLungeSpeed = 0; f.state.settings.enableSwordTrade = outcome === 'trade';
    f.state.settings.enableHammerSwordTrade = false;
    Object.assign(f.player, { weapon: 'sword', isLunging: true, lungeStartPos: { x: 0, y: 0, z: -.5 },
      lungeTimer: outcome === 'miss' ? 1 : 0 });
    const owner = lifecycleFor(f, false), l = liveFor(f), callbacks = liveCallbacks(f, l, owner);
    l.live.localPlayerTeam = 'blue'; l.live.activeWeapon = 'sword'; l.live.isLunging = true;
    l.live.lungeStartPos.set(0, 0, -.5); l.live.lungeTargetDir.set(0, 0, 1); l.live.lungeTimer = f.player.lungeTimer;
    l.target.isLunging = f.target.isLunging;
    recordCalibrationDodgeAttempt(f.matchContext, f.target.id);
    recordCalibrationDodgeAttempt(l.live.aiMatchContext, f.target.id);
    const executeTrade = (reason: 'sword_vs_sword' | 'sword_lunge_vs_hammer') => executePlayerCombatantTradeForState({
      state: l.live, combatant: l.target, reason, evaluatePlayerKillMedals: () => [], ...callbacks,
      playExplosion: noop, playDeath: noop, spawnVoxelShockwaveParticles: noop, pushStatsUpdate: noop });
    updatePlayerSwordLungeForState({ state: l.live, dt: 1 / 60, isMultiplayer: false, activeCustomMap: f.state.map,
      multiplayerSocket: null, getMainAi: () => l.live.otherPlayers.get('main_ai'),
      canCombatantsDamage: (_, victimId) => victimId === f.target.id, constrainCombatantToArena: noop,
      renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: hit => recordLocalPlayerLungeEndObservation(l.live, hit),
      recordPlayerCounterSuccess: () => recordLocalPlayerModelObservation(l.live, model => observePlayerCounter(model, true)),
      recordPlayerDamageDealt: counter => recordLocalPlayerDamageDealtObservation(l.live, counter), ...callbacks,
      evaluatePlayerKillMedals: () => [], executeTrade, applyOutgoingMultiplayerHitLocally: noop,
      playExplosion: noop, playDeath: noop, playSwing: noop, spawnVoxelShockwaveParticles: noop, pushStatsUpdate: noop });
    resolveMixedPlayerLunge(f.state, f.player, f.state.settings, 1 / 60, [], createScriptedCombatLearning(f.state, owner, f.state.settings));
    assert.equal(f.target.hp, l.target.hp); assert.equal(f.player.lungeOutcome, outcome === 'miss' ? 'miss_timeout' : 'hit');
    assert.deepEqual(f.matchContext.playerModels, l.live.aiMatchContext.playerModels);
    assert.deepEqual(f.matchContext.skillCalibration, l.live.aiMatchContext.skillCalibration);
  });

for (const hp of [1, 3]) test(`AI lunge against local player keeps cosmetic IDs outside gameplay RNG ${hp}`, () => {
  const f = fixture(), { live, bot } = liveFor(f);
  live.localPlayerTeam = bot.team === 'blue' ? 'red' : 'blue';
  live.playerHP = hp; live.settings.playerName = 'Local runner';
  let draws = 0, feeds = 0, kills = 0;
  withSimulationRandom(() => { draws++; return .5; }, 10, () => {
    applyAISwordLungeHitForState({ state: live, attackerBot: bot, target: { id: 'player' } as any,
      mainAi: undefined, cooldownMult: 1, finishSwordLunge: noop, recordPlayerDamageTaken: noop,
      playExplosion: noop, playDeath: noop, spawnVoxelShockwaveParticles: noop,
      recordBotCalibrationDeath: noop, recordBotPsychKill: () => { kills++; },
      recordDeathEvent: (...args) => { feeds++; return recordDeathEvent(live, ...args); },
    });
  });
  assert.equal(live.playerHP, hp - 1);
  assert.equal(draws, 0, 'cosmetic death IDs must not alter later AI choices');
  assert.equal(feeds, hp === 1 ? 1 : 0); assert.equal(kills, feeds);
  if (hp === 1) {
    assert.equal(live.lastDeaths[0].attacker, bot.playerName);
    assert.equal(live.lastDeaths[0].victim, 'Local runner');
    assert.equal(live.lastDeaths[0].weapon, 'sword');
  }
});
