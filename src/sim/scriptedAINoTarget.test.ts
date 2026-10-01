import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import { createAIMatchContext } from '../game/aiMatchContext';
import { getOrCreatePlayerModel } from '../game/aiPlayerModel';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { updateGrifballTeamPlan } from '../game/aiGrifballTeamPlan';
import { createOfflineBotCombatant } from '../game/roster';
import { resolveNoTargetAIFrameForCombatant } from '../components/grifball/aiNoTargetRuntime';
import { finishAISwordLungeWithVitals } from '../components/grifball/aiSwordLungeFinishRuntime';
import { getOptimalGrifballSpawnPoint } from '../components/grifball/arenaSpawns';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { recoverCombatantAltitude } from '../components/grifball/altitudeRecovery';
import type { GrifballAIObjectiveFrame } from '../components/grifball/grifballAIObjectiveMovement';
import type { ScriptedAINoTargetRequest } from './scriptedAINoTarget';
import type { ScriptedActorDecisionOwner, ScriptedActorDecision } from './scriptedActorDecision';

const vector = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 21, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 20, swordLungeReload: 1.7 } });
  const [actor, ally, player] = state.combatants;
  actor.id = id; ally.id = 'ally'; player.id = state.localPlayerId = 'player';
  actor.team = ally.team = 'blue'; player.team = 'red'; actor.controller = ally.controller = 'ai'; player.controller = 'remote';
  state.match.phase = 'playing';
  for (const [i, c] of state.combatants.entries()) {
    c.pos = { x: i * 10 - 5, y: 0, z: 0 }; c.vel = { x: 0, y: 0, z: 0 }; c.yaw = 0;
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  }
  const request: ScriptedAINoTargetRequest = { memories: {
    [id]: { aiState: 'APPROACHING', timer: .4, cooldownMultiplier: 1.8 },
    ally: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 } },
    matchContext: createAIMatchContext(), spawnPoints: [{ x: -12, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }],
    isObserverMode: false, spatialIQ: 80, edgeInset: 2 };
  const decision: Extract<ScriptedActorDecision, { kind: 'handled' }> = { kind: 'handled', action: idleAction(),
    noTarget: { version: 'scripted-ai-no-target-v1', resolve: () => request } };
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' },
    resolve: () => decision,
    completeTurn: ({ record }) => { Object.assign(request.memories[id], record.noTarget!.memory); } };
  return { state, actor, ally, player, request, owner, decision };
}

/** Invoke the live no-target runtime with a real live combatant. This oracle
 * deliberately does not use the simulator's physical projection or executor. */
function reference(f: ReturnType<typeof fixture>, dt: number) {
  const { state, actor, request } = f, memory = request.memories[actor.id], context = structuredClone(request.matchContext);
  const bot = createOfflineBotCombatant({ id: actor.id, playerName: actor.id, team: actor.team,
    spawnPos: vector(actor.pos), yaw: actor.yaw + Math.PI, hue: 0, difficulty: 'normal', settings: state.settings });
  Object.assign(bot, { vel: vector(actor.vel), activeWeapon: actor.weapon, weaponState: 'ready', isLunging: actor.isLunging,
    isJumping: actor.isJumping, aiHammerJumpsInAir: actor.hammerJumpsInAir, aiDashRemaining: actor.dashRemaining,
    aiHammerJumpCooldownTimer: actor.aiHammerJumpCooldownTimer, hammerJumpWindowTimer: Math.max(0, actor.hammerJumpWindowTimer - dt),
    aiLastLungeOutcome: memory.lastLungeOutcome, aiLastLungeTargetId: memory.lastLungeTargetId,
    aiPostLungeDecisionTimer: memory.postLungeDecisionTimer, lungeStartPos: actor.lungeStartPos, aiTimer: memory.timer,
    hammerJumpPlanned: actor.hammerJumpPlanned, hammerJumpType: actor.hammerJumpType });
  const frame: GrifballAIObjectiveFrame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: memory.aiState,
    timer: memory.timer ?? 0, dashRemaining: actor.dashRemaining, slideActive: actor.slideActive, weaponState: 'ready', pickupRequested: false };
  const player = state.combatants.find(c => c.id === state.localPlayerId)!;
  const others = new Map(state.combatants.filter(c => c !== player).map(c => [c.id, { id: c.id, hp: c.hp, respawnTimer: c.respawnTimer,
    team: c.team, pos: vector(c.pos), invulnerabilityTimer: c.invulnerabilityTimer }]));
  const runtime = { settings: state.settings, grifball: state.match, aiMatchContext: context, arenaRadius: state.map.arenaRadius,
    playerHP: player.hp, playerRespawnTimer: player.respawnTimer, isObserverMode: request.isObserverMode, localPlayerTeam: player.team,
    playerPos: vector(player.pos), playerInvulnerabilityTimer: player.invulnerabilityTimer, otherPlayers: others };
  const main = others.get('main_ai'), tuning = resolveBehaviorTuning(state.settings);
  const mode = resolveNoTargetAIFrameForCombatant({ state: runtime, botId: actor.id, self: bot, frame,
    mainAI: main ? { ...main, aiState: request.memories.main_ai.aiState } : undefined,
    alliesList: state.combatants.filter(c => c !== actor && (c !== player || !request.isObserverMode) && c.hp > 0 && c.respawnTimer <= 0 && c.team === actor.team).map(c => c.pos),
    spatialIQ: request.spatialIQ, edgeInset: request.edgeInset, dt, activeCustomMap: state.map, gravityAcceleration: 18,
    finishSwordLungeTargetDead: () => {
      const finishFrame = { ...frame, weaponState: 'ready' as const };
      finishAISwordLungeWithVitals({ state: runtime, self: bot, frame: finishFrame, botId: bot.id, outcome: 'target_dead',
        targetVitals: { hp: 0, invulnerabilityTimer: 0 }, cooldownMultiplier: 1,
        recordCombatantObservation: (id, observe) => observe(getOrCreatePlayerModel(context, id, { emaAlpha: tuning.playerModelEmaAlpha,
          defaultLungeDistance: tuning.defaultLungeDistance, defaultReactionTime: tuning.defaultReactionTime })),
        recordBotDamageTag: () => assert.fail('cancellation cannot tag'), tryEnterPressureState: () => assert.fail('cancellation cannot pressure'),
        tryStartComboOnHit: () => assert.fail('cancellation cannot combo') });
      Object.assign(frame, finishFrame);
    },
    recoverCombatantAltitude: (self, pos, vel) => recoverCombatantAltitude(state.settings, self, pos, vel),
    constrainCombatantToArena: (pos, vel) => { constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius }); },
    getOptimalSpawnPoint: exclude => getOptimalGrifballSpawnPoint(state.map, request.spawnPoints.map(vector), exclude),
    getCombatantTeam: id => state.combatants.find(c => c.id === id)?.team,
    getCombatantRef: () => null, getEnemyGoalPos: team => state.goalPlates.find(p => p.team !== team)?.position ?? null,
  });
  return { bot, frame, mode, context };
}

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const branch of ['dash', 'airborne', 'landing-lunge', 'airborne-lunge', 'runaway', 'support'] as const)
    test(`no-target live parity and restored turns ${id}/${dt}/${branch}`, () => {
      const f = fixture(id); f.actor.dashRemaining = .2; f.actor.slideCooldownTimer = .7; f.actor.dashCooldownTimer = 1;
      if (branch === 'airborne' || branch === 'runaway') { f.actor.pos.y = branch === 'runaway' ? 30 : 2; f.actor.isJumping = true; f.actor.vel = { x: 3, y: 1, z: -2 }; }
      if (branch.includes('lunge')) {
        f.actor.weapon = 'sword'; f.actor.isLunging = true; f.actor.isJumping = true;
        f.actor.pos.y = branch === 'landing-lunge' ? .001 : 2;
        f.actor.vel = { x: 10, y: -1, z: 0 }; f.actor.lungeTargetId = 'lost'; f.actor.lungeStartPos = { x: -8, y: 0, z: 0 };
        f.request.memories[id].aiState = 'LUNGING'; f.request.memories[id].timer = 0; f.request.memories[id].lastLungeTargetId = 'old';
      }
      if (branch === 'support') {
        f.state.match.ball.state = 'held'; f.state.match.ball.holderId = f.ally.id; f.ally.hasBall = true; f.ally.weapon = 'ball';
        f.player.pos.x = 28;
        updateGrifballTeamPlan(f.request.matchContext.grifballTeamPlan,
          createSimGrifballTacticalSnapshot(f.state, { scriptedBots: { [id]: 'normal', ally: 'normal' } }), dt);
      }
      // Exercise authored spawn precedence and a physical obstacle in each trace.
      f.state.map.spawnPoints = [{ x: -15, y: 0, z: 3 }, { x: 15, y: 0, z: -3 }];
      f.state.map.objects.push({ type: 'box', position: { x: -10, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 3 }, isCollidable: true } as never);
      let restored = structuredClone({ state: f.state, request: f.request });
      const modes = new Set<string>();
      const run = (state: typeof f.state, request: typeof f.request) => {
        const actor = state.combatants.find(c => c.id === id)!;
        let expected: ReturnType<typeof reference>;
        const events = stepSimulation(state, {}, { settings: state.settings, dt, scriptedActorDecisions: {
          version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' },
          resolve: () => {
            expected = reference({ ...f, state, actor, request }, dt);
            return { kind: 'handled', action: idleAction(), noTarget: { version: 'scripted-ai-no-target-v1', resolve: () => request } };
          },
          completeTurn: ({ record }) => {
            const feedback = record.noTarget!; assert.ok(feedback, 'no-target feedback must complete before later actors');
            modes.add(feedback.mode); assert.equal(feedback.mode, expected.mode);
            for (const axis of ['x', 'y', 'z'] as const) {
              assert.ok(Math.abs(actor.pos[axis] - expected.frame.pos[axis]) < 1e-10, `position ${axis}`);
              assert.ok(Math.abs(actor.vel[axis] - expected.frame.vel[axis]) < 1e-10, `velocity ${axis}`);
            }
            assert.ok(Math.abs(Math.sin(actor.yaw - (expected.frame.yaw - Math.PI))) < 1e-10, 'yaw parity');
            assert.equal(actor.isLunging, !!expected.bot.isLunging); assert.equal(actor.isJumping, !!expected.bot.isJumping);
            assert.equal(actor.hammerJumpsInAir, expected.bot.aiHammerJumpsInAir);
            assert.equal(actor.aiHammerJumpCooldownTimer, expected.bot.aiHammerJumpCooldownTimer);
            assert.equal(actor.hammerJumpWindowTimer, expected.bot.hammerJumpWindowTimer);
            assert.equal(actor.dashRemaining, expected.frame.dashRemaining);
            assert.equal(feedback.memory.aiState, expected.frame.aiState); assert.equal(feedback.memory.timer, expected.frame.timer);
            assert.deepEqual(request.matchContext.playerModels, expected.context.playerModels);
            Object.assign(request.memories[id], feedback.memory);
          },
        } });
        return events;
      };
      for (let frame = 0; frame < 90; frame++) {
        assert.deepEqual(run(f.state, f.request), run(restored.state, restored.request));
        assert.deepEqual({ state: f.state, request: f.request }, restored);
        if ([1, 20, 45].includes(frame)) restored = structuredClone(restored);
      }
      assert.equal(f.actor.dashRemaining, 0); assert.equal(f.actor.isLunging, false);
      if (branch === 'support') assert.ok(modes.has('support_objective'), 'support retry must execute');
      else assert.ok(modes.has('spawn_guard'), 'recovered actors eventually guard');
      if (branch.includes('lunge')) { assert.equal(f.request.memories[id].lastLungeOutcome, 'target_dead'); assert.equal(f.request.memories[id].lastLungeTargetId, undefined); }
    });

test('no-target cancellation happens before contact, travel and a second reload tick', () => {
  const f = fixture(); f.actor.weapon = 'sword'; f.actor.isLunging = true; f.actor.lungeTargetId = f.player.id;
  f.actor.pos.y = 2; f.actor.vel = { x: 10, y: 1, z: 0 }; f.actor.lungeDir = { x: 1, y: 0, z: 0 };
  f.actor.lungeStartPos = { ...f.actor.pos }; f.player.pos = { ...f.actor.pos };
  f.player.isJumping = true;
  f.actor.hammerJumpWindowTimer = .6; f.request.memories.ordinary.aiState = 'LUNGING';
  const beforeX = f.actor.pos.x;
  const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.equal(f.actor.pos.x, beforeX); assert.equal(f.actor.lungeTimer, 0); assert.equal(f.player.hp, 20); assert.equal(event.kills.length, 0);
  assert.equal(f.actor.attackCooldown, 1.7); assert.equal(f.request.memories.ordinary.timer, 1.7);
  assert.equal(f.request.memories.ordinary.aiState, 'COOLDOWN'); assert.equal(f.actor.hammerJumpWindowTimer, .6 - 1 / 60);
});

for (const conflict of ['gravity', 'move', 'dash', 'attack', 'commands', 'mobility', 'ground', 'version'] as const)
  test(`no-target refuses conflicting ${conflict} before callback`, () => {
    const f = fixture(); let called = false; f.decision.noTarget!.resolve = () => { called = true; return f.request; };
    if (conflict === 'gravity') f.owner.prepare = () => 'engagement';
    if (conflict === 'move') f.decision.action.moveX = 1;
    if (conflict === 'dash') f.decision.action.dash = true;
    if (conflict === 'attack') f.decision.action.attackPrimary = true;
    if (conflict === 'commands') f.decision.commands = [{ kind: 'swap', weapon: 'sword' }];
    if (conflict === 'mobility') f.decision.mobility = {} as never;
    if (conflict === 'ground') f.decision.ground = {} as never;
    if (conflict === 'version') f.decision.noTarget!.version = 'wrong' as never;
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /No-target/);
    assert.equal(called, false);
  });

for (const defect of ['memory', 'timer', 'models', 'plan', 'spawn', 'observer', 'spatial', 'duplicate', 'carrier'] as const)
  test(`no-target rejects invalid ${defect}`, () => {
    const f = fixture(); const pos = { ...f.actor.pos };
    if (defect === 'memory') delete (f.request.memories as Record<string, unknown>).ordinary;
    if (defect === 'timer') f.request.memories.ordinary.timer = NaN;
    if (defect === 'models') f.request.matchContext.playerModels = {} as never;
    if (defect === 'plan') f.request.matchContext.grifballTeamPlan = {} as never;
    if (defect === 'spawn') f.request.spawnPoints = [{ x: NaN, y: 0, z: 0 }];
    if (defect === 'observer') f.request.isObserverMode = 1 as never;
    if (defect === 'spatial') f.request.spatialIQ = Infinity;
    if (defect === 'duplicate') f.state.combatants.push(structuredClone(f.ally));
    if (defect === 'carrier') f.actor.hasBall = true;
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /No-target|no-target/);
    assert.deepEqual(f.actor.pos, pos);
  });

test('inactive actors never enter no-target recovery', () => {
  const f = fixture(); f.state.match.phase = 'scored';
  f.owner.resolve = () => assert.fail('inactive decision'); f.owner.completeTurn = () => assert.fail('inactive completion');
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
});

test('no-target completion reaches the next actor with effective settings and preserved caller input', () => {
  const f = fixture(); f.actor.isLunging = true; f.actor.weapon = 'sword'; f.actor.pos.y = 2;
  f.actor.lungeStartPos = { ...f.actor.pos }; f.request.memories.ordinary.aiState = 'LUNGING';
  const settings = { ...f.state.settings, swordLungeReload: 2.6 };
  let calls = 0, observed = false;
  f.owner.scriptedBots = { ordinary: 'normal', ally: 'normal' };
  f.decision.noTarget!.resolve = ({ state }) => { calls++; assert.equal(state.settings, settings); return f.request; };
  f.owner.resolve = ({ actorId }) => {
    if (actorId === 'ordinary') return f.decision;
    assert.equal(f.request.memories.ordinary.aiState, 'COOLDOWN'); assert.equal(f.request.memories.ordinary.timer, 2.6);
    assert.equal(f.actor.isLunging, false); observed = true;
    return { kind: 'handoff', reason: 'later observer' };
  };
  f.owner.completeTurn = ({ actorId, record, state }) => {
    assert.equal(state.settings, settings);
    if (actorId === 'ordinary') Object.assign(f.request.memories.ordinary, record.noTarget!.memory);
  };
  const actions = { ordinary: { ...idleAction(), attackPrimary: true, moveZ: 1 } }, before = structuredClone(actions);
  stepSimulation(f.state, actions, { settings, scriptedActorDecisions: f.owner });
  assert.equal(calls, 1); assert.equal(observed, true); assert.deepEqual(actions, before); assert.equal(f.state.settings.swordLungeReload, 1.7);
});
