import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { deriveAIParams } from '../game/aiTuning';
import { resolveSimGrifballAdaptiveTuning } from './grifballAdaptiveTuning';
import { beginSimGrifballTargetEngagement, observeSimGrifballTargetEngagement } from './grifballTargetEngagement';
import { resolveSimGrifballCombatPriorities, type SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballGroundOwner, adoptSimGrifballMovementFeedback, isSimGrifballTargetOnCooldown } from './grifballGroundPolicy';
import { stepSimulation } from './step';
import { createRng } from './rng';
import { isTacticalTargetOnCooldown } from '../components/grifball/tacticalTargets';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';
import type { ScriptedActorDecisionOwner } from './scriptedActorDecision';

function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 33, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
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

function policyTurn(f: ReturnType<typeof fixture>, id: string, dt: number, random: () => number,
  navigation: Parameters<typeof createSimGrifballGroundOwner>[3]['navigation'] = {}) {
  const memory = f.memories[id], targetId = id === 'target' ? f.actor.id : 'target';
  const adaptive = resolveSimGrifballAdaptiveTuning(f.state, id, f.owners, { matchContext: f.matchContext, memory,
    knobs: f.knobs, derived: deriveAIParams(f.state.settings, f.knobs), flags: { skipPressure: false, feintBias: 1, spacingBand: 1 },
    score: { scorePlayer: 0, scoreEnemy: 0 } }, dt)!;
  assert.equal(beginSimGrifballTargetEngagement(f.state, id, targetId, f.owners, { memory, matchContext: f.matchContext }, dt), true);
  const resolve = () => {
    const engagement = observeSimGrifballTargetEngagement(f.state, id, targetId, f.owners, adaptive,
      { memory, matchContext: f.matchContext, nowSeconds: (f.state.tick + 1) * dt, isObserverMode: true }, dt)!;
    const priorities = resolveSimGrifballCombatPriorities(f.state, id, f.owners,
      { ...adaptive, spacingFactor: engagement.spacingFactor, pressureAggression: adaptive.derivedParams.pressureAggression }, f.memories, {
        observation: engagement.observation, matchContext: f.matchContext, random, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
        spatialIQ: adaptive.derivedParams.spatialIQ, resolvedDangerZone: engagement.resolvedDangerZone,
        defensiveEvasionMult: 1.5 - Math.abs(adaptive.playstyleFactor - .5) }, dt)!;
    const ground = createSimGrifballGroundOwner(id, f.owners, f.memories,
      { adaptive, priorities, observation: engagement.observation, matchContext: f.matchContext,
        resolvedDangerZone: engagement.resolvedDangerZone, random, navigation });
    return { engagement, priorities, ground, adaptive };
  };
  return { resolve, adaptive };
}

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const complexity of [0, 80])
  test(`composed ground decisions approach and fight without authored actions ${id}/${dt}/${complexity}`, () => {
    const f = fixture(id);
    f.knobs.movementComplexity = complexity;
    let run = { state: f.state, memories: f.memories, matchContext: f.matchContext, randomState: createRng(33).getState() };
    let replay = structuredClone(run), attacks = 0, groundFrames = 0, moved = false;
    const caches = new WeakMap<typeof run, Parameters<typeof createSimGrifballGroundOwner>[3]['navigation']>();
    const advance = (current: typeof run) => {
      const rng = createRng(0); rng.setState(current.randomState);
      if (!caches.has(current)) caches.set(current, {});
      const own = { ...f, ...current, actor: current.state.combatants[0], target: current.state.combatants[1] };
      const turns = new Map<string, ReturnType<typeof policyTurn>>();
      const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        prepare: ({ actorId }) => { turns.set(actorId, policyTurn(own, actorId, dt, rng.next, caches.get(current))); return 'engagement'; },
        resolve: ({ actorId }) => {
          const result = turns.get(actorId)!.resolve();
          assert.equal(result.priorities.mode, 'continue', 'hammer-only encounter cannot start a sword flight');
          return { ...result.priorities.decision, ground: result.ground };
        }, completeTurn: ({ record }) => {
          adoptSimGrifballMovementFeedback(record, current.memories, current.matchContext);
          if (record.ground) {
            groundFrames++; attacks += record.ground.actions.filter(a => a.startsWith('attack-') || a === 'hammer-jump').length;
            assert.equal(current.memories[record.id].timer, record.ground.timer);
          }
        } };
      const events = stepSimulation(current.state, {}, { settings: current.state.settings, dt, scriptedActorDecisions: owner });
      current.randomState = rng.getState(); return events;
    };
    for (let tick = 1; tick <= 180; tick++) {
      const events = advance(run), replayEvents = advance(replay);
      assert.deepEqual(replay, run, `own-state continuation ${tick}`); assert.deepEqual(replayEvents, events);
      moved ||= run.state.combatants[0].pos.z !== -7;
      if ([1, 50, 120].includes(tick)) replay = structuredClone(replay);
    }
    assert.equal(moved, true); assert.ok(groundFrames > 0); assert.ok(attacks > 0);
    assert.ok(run.state.combatants.slice(0, 2).some(c => c.hp < 50), 'autonomous movement and attacks must produce real damage');
  });

for (const branch of ['airborne', 'dash', 'hold'] as const)
  test(`deferred ground navigation does not run during ${branch} ownership`, () => {
    const f = fixture(); const navigation = {};
    if (branch === 'airborne') { f.actor.isJumping = true; f.actor.pos.y = 2; }
    if (branch === 'dash') { f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 }; }
    let turn: ReturnType<typeof policyTurn>;
    stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: {
      version: 'scripted-actor-decision-v1', scriptedBots: { [f.actor.id]: 'normal' },
      prepare: () => { turn = policyTurn(f, f.actor.id, 1 / 60, () => .99, navigation); return 'engagement'; },
      resolve: () => {
        const result = turn.resolve();
        return { ...result.priorities.decision, ground: result.ground, ...(branch === 'hold' ? { holdAfterEvasion: true } : {}) };
      }, completeTurn: ({ record }) => { assert.equal(record.ground, undefined); } } });
    assert.deepEqual(navigation, {});
  });

for (const id of ['main_ai', 'ordinary', 'player']) for (const phase of ['idle', 'windup', 'active', 'recovering'] as const)
  for (const swipe of [false, true]) test(`ground cooldown matches live ${id}/${phase}/${swipe}`, () => {
    const f = fixture(), target = f.target; target.id = id;
    if (id === 'player') { f.player.id = 'spectator'; target.controller = 'remote'; }
    target.weapon = 'hammer'; target.weaponState = phase; target.attackKind = swipe ? 'swipe' : 'strike';
    const memory = { ...f.memories.target, aiState: 'COOLDOWN' as const, timer: .4 }; f.memories[id] = memory;
    const observed = observeSimTacticalWeaponTarget(f.state, target);
    const liveActor = { weaponState: observed.weaponState, activeWeapon: 'hammer', aiState: memory.aiState, aiTimer: memory.timer, isLunging: false };
    const liveState = { activeWeapon: 'hammer', pWeaponState: observed.weaponState, pSwordState: 'ready', isLunging: false,
      otherPlayers: new Map([[id, liveActor]]) };
    assert.equal(isSimGrifballTargetOnCooldown(f.state, id, f.memories),
      isTacticalTargetOnCooldown(liveState as never, id === 'main_ai' ? liveActor as never : undefined, { id }));
  });

test('ground policy rejects a stale turn before navigation or memory effects', () => {
  const f = fixture(), navigation = {}, result = policyTurn(f, f.actor.id, 1 / 60, () => .99, navigation).resolve();
  f.state.tick++;
  const before = structuredClone(f);
  assert.throws(() => result.ground.resolve({ state: f.state, actorId: f.actor.id, dt: 1 / 60, motionPhase: 'after-engagement-recovery' }), /composed engagement/);
  assert.deepEqual(f, before); assert.deepEqual(navigation, {});
});

for (const mismatch of ['actor', 'tick', 'psych'] as const) test(`ground policy rejects mismatched ${mismatch} ownership`, () => {
  const f = fixture(), navigation = {}, result = policyTurn(f, f.actor.id, 1 / 60, () => .99, navigation).resolve();
  if (mismatch === 'actor') result.priorities.actorId = 'another-actor';
  if (mismatch === 'tick') result.priorities.tick--;
  if (mismatch === 'psych') f.matchContext.psychState.set(f.actor.id, structuredClone(result.adaptive.psychState));
  const before = structuredClone(f);
  assert.throws(() => result.ground.resolve({ state: f.state, actorId: f.actor.id, dt: 1 / 60, motionPhase: 'after-engagement-recovery' }), /composed engagement/);
  assert.deepEqual(f, before); assert.deepEqual(navigation, {});
});

for (const phase of ['idle', 'windup', 'active', 'recovering'] as const)
  test(`local sword cooldown retains committed slash phase ${phase}`, () => {
    const f = fixture(); f.player.weapon = 'sword'; f.player.weaponState = phase; f.player.attackKind = 'slash';
    assert.equal(isSimGrifballTargetOnCooldown(f.state, f.player.id, f.memories), phase !== 'idle');
  });

test('movement completion preserves lunge memory and spends no extra timer', () => {
  const f = fixture(), memory = f.memories[f.actor.id];
  policyTurn(f, f.actor.id, 1 / 60, () => .99);
  Object.assign(memory, { lastLungeOutcome: 'hit', postLungeDecisionTimer: .8 });
  adoptSimGrifballMovementFeedback({ id: f.actor.id, kind: 'handled', ground: {
    aiState: 'COOLDOWN', timer: 1.4, weaponState: 'swing_up', standoffTimer: .9, actions: ['attack-hammer'] } }, f.memories, f.matchContext);
  assert.equal(memory.timer, 1.4); assert.equal(memory.lastLungeOutcome, 'hit'); assert.equal(memory.postLungeDecisionTimer, .8);
  assert.equal(f.matchContext.psychState.get(f.actor.id)!.standoffTimer, .9);
});
