import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { tickCalibrationPendingDodge, tickCalibrationPendingCounter } from '../game/aiSkillCalibration';
import { resolveSimGrifballAdaptiveTuning, type SimAdaptiveTuningOwner } from './grifballAdaptiveTuning';
import { beginSimGrifballTargetEngagement, observeSimGrifballTargetEngagement, type SimTargetEngagementMemory } from './grifballTargetEngagement';
import { resolveSimGrifballComboInput } from './grifballComboInput';
import { resolveSimGrifballGroundOpportunityInput } from './grifballGroundOpportunityInput';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import type { ScriptedActorDecisionOwner } from './scriptedActorDecision';

function fixture(id = 'ordinary', difficulty = 'normal') {
  const state = createMatch({ seed: 24, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 20, swordSlashSpeed: .12, weaponReadyTime: 0 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = 'sword';
  actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 2 }; player.pos = { x: 25, y: 0, z: 25 };
  state.match.phase = 'playing';
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  const memory: SimTargetEngagementMemory = { aiState: 'SPAWN_GUARDING', timer: 1.5, cooldownMultiplier: 1,
    swayTimer: 0, coordCommitTimer: .3 };
  const matchContext = createAIMatchContext();
  const config: Omit<SimAdaptiveTuningOwner, 'matchContext' | 'memory'> = {
    knobs: { difficulty, reactionLatency: 0, anticipationFactor: 0, movementComplexity: 0,
      weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 100 },
    derived: { spatialIQ: 50, feintChance: 0, pressureAggression: 50, mechanicAware: true },
    flags: { skipPressure: false, feintBias: 1, spacingBand: 1 }, score: { scorePlayer: 0, scoreEnemy: 0 } };
  const owners = { [id]: difficulty, target: difficulty };
  const adaptive = resolveSimGrifballAdaptiveTuning(state, id, owners, { ...config, matchContext, memory: {} })!;
  const owner = { memory, matchContext, nowSeconds: .5, isObserverMode: false };
  return { state, actor, target, player, owners, adaptive, owner, config,
    begin: (dt = 1 / 60) => beginSimGrifballTargetEngagement(state, id, target.id, owners, owner, dt),
    observe: (dt = 1 / 60) => observeSimGrifballTargetEngagement(state, id, target.id, owners, adaptive, owner, dt) };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('entry clears stale spawn guarding without spending combat or physical clocks', () => {
  const f = fixture(), before = structuredClone(f.state);
  f.owner.matchContext.feintCooldowns.set(f.actor.id, .1);
  f.owner.matchContext.weaponSwapFeintTimers.set(f.actor.id, .2);
  assert.equal(f.begin(), true);
  assert.equal(f.owner.memory.aiState, 'APPROACHING'); assert.equal(f.owner.memory.timer, 0);
  assert.equal(f.owner.matchContext.coordinator.engagements.get(f.actor.id), f.target.id);
  const observed = f.observe()!;
  assert.equal(observed.observation.preparation!.isCrouching, false);
  close(f.owner.memory.coordCommitTimer, .3 + 1 / 60);
  assert.equal(f.owner.memory.swayTimer, 0); assert.equal(f.owner.memory.timer, 0);
  assert.equal(f.owner.matchContext.feintCooldowns.get(f.actor.id), .1);
  assert.equal(f.owner.matchContext.weaponSwapFeintTimers.get(f.actor.id), .2);
  assert.equal(f.owner.matchContext.playerModels.has(f.actor.id), true);
  assert.equal(f.owner.matchContext.playerModels.has(f.target.id), false);
  assert.deepEqual(f.state, before);
});

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const phase of ['flight', 'overhead', 'swipe', 'ready'] as const)
    for (const pending of ['dodge', 'counter'] as const)
      test(`calibration observes live threat semantics ${id}/${dt}/${phase}/${pending}`, () => {
        const f = fixture(id), ctx = f.owner.matchContext;
        f.target.isLunging = phase === 'flight';
        f.target.weaponState = phase === 'overhead' || phase === 'swipe' ? 'windup' : 'idle';
        f.target.attackKind = phase === 'swipe' ? 'swipe' : 'strike';
        const behavior = resolveBehaviorTuning(f.state.settings);
        const delay = pending === 'dodge' ? behavior.dodgeResolveDelay : behavior.counterResolveDelay;
        ctx.skillCalibration.set(id, { snapshots: [], ...(pending === 'dodge'
          ? { pendingDodge: { elapsed: delay - dt / 2 } } : { pendingCounter: { elapsed: delay - dt / 2 } }) });
        // Stationary swings remain weapon threats, but must not extend a
        // pending sword-lunge calibration window.
        const expected = structuredClone(ctx), threat = phase === 'flight';
        tickCalibrationPendingDodge(expected, id, dt, threat, behavior.dodgeResolveDelay, behavior.calibrationWindowSize);
        tickCalibrationPendingCounter(expected, id, dt, threat, behavior.counterResolveDelay, behavior.calibrationWindowSize);
        assert.equal(f.begin(dt), true);
        assert.equal(f.observe(dt)!.targetIsLunging, threat);
        assert.deepEqual(ctx.skillCalibration, expected.skillCalibration);
        const calibration = ctx.skillCalibration.get(id)!;
        assert.equal(calibration.snapshots.length, threat ? 0 : 1);
        if (threat && pending === 'counter') assert.equal(calibration.pendingCounter!.elapsed, 0);
        if (!threat) assert.equal(calibration.snapshots[0][pending === 'dodge' ? 'dodgeSuccesses' : 'counterAttempts'], 1);
      });

test('disabled calibration preserves pending attempts and local models respect observer mode', () => {
  const f = fixture('ordinary', 'easy');
  f.owner.matchContext.skillCalibration.set(f.actor.id, { snapshots: [], pendingDodge: { elapsed: 9 } });
  const before = structuredClone(f.owner.matchContext.skillCalibration);
  f.target.id = f.state.localPlayerId = 'target'; f.target.controller = 'remote'; f.player.id = 'spectator';
  f.owner.isObserverMode = true; f.begin(); f.observe();
  assert.deepEqual(f.owner.matchContext.skillCalibration, before);
  assert.equal(f.owner.matchContext.playerModels.has('target'), false);
  f.owner.isObserverMode = false; f.observe();
  assert.equal(f.owner.matchContext.playerModels.has('target'), true);
});

for (const kind of ['dead', 'respawn', 'paused', 'local', 'remote', 'unowned', 'neural', 'duplicate', 'flight', 'carrier', 'ally', 'dead-target'] as const)
  test(`ineligible ${kind} does not mutate engagement memory`, () => {
    const f = fixture();
    if (kind === 'dead') f.actor.alive = false;
    if (kind === 'respawn') f.actor.respawnTimer = 1;
    if (kind === 'paused') f.state.match.phase = 'countdown';
    if (kind === 'local') f.state.localPlayerId = f.actor.id;
    if (kind === 'remote') f.actor.controller = 'remote';
    if (kind === 'unowned') delete f.owners[f.actor.id];
    if (kind === 'neural') f.owners[f.actor.id] = 'neural-net';
    if (kind === 'duplicate') f.state.combatants.push(structuredClone(f.actor));
    if (kind === 'flight') f.actor.isLunging = true;
    if (kind === 'carrier') f.actor.hasBall = true;
    if (kind === 'ally') f.target.team = f.actor.team;
    if (kind === 'dead-target') f.target.hp = 0;
    const before = structuredClone(f.owner);
    assert.equal(f.begin(), false); assert.equal(f.observe(), null); assert.deepEqual(f.owner, before);
  });

test('observation rejects absent entry, context mismatch and malformed clocks before mutation', () => {
  const f = fixture();
  assert.throws(f.observe, /must begin/);
  f.begin();
  const alternate = structuredClone(f.adaptive); const before = structuredClone(f.owner);
  assert.throws(() => observeSimGrifballTargetEngagement(f.state, f.actor.id, f.target.id, f.owners, alternate, f.owner), /current adaptive context/);
  assert.deepEqual(f.owner, before);
  f.owner.nowSeconds = NaN;
  assert.throws(f.observe, /match clock/);
  f.owner.memory.swayTimer = Infinity;
  assert.throws(f.begin, /Invalid target engagement owner/);
});

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const landing of [false, true])
  test(`scheduled entry composes with adaptive, combo and real attacks through restoration ${id}/${dt}/${landing}`, () => {
    const f = fixture(id); f.owner.matchContext.feintCooldowns.set(id, .5);
    if (landing) { f.actor.pos.y = .01; f.actor.vel.y = -1; f.actor.isJumping = true; }
    let replay = structuredClone({ state: f.state, owner: f.owner });
    let laterObservations = 0, attacks = 0;
    const advance = (state: typeof f.state, owner: typeof f.owner, tick: number) => {
      owner.nowSeconds = tick * dt;
      let adaptive: typeof f.adaptive;
      const decision: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        beginTurn: ({ actorId, state: current }) => {
          if (actorId === id) adaptive = resolveSimGrifballAdaptiveTuning(current, id, f.owners,
            { ...f.config, matchContext: owner.matchContext, memory: {} }, dt)!;
        },
        prepare: ({ actorId, state: current }) => actorId === id && beginSimGrifballTargetEngagement(current, id, 'target', f.owners, owner, dt)
          ? 'engagement' : 'default',
        resolve: ({ actorId, state: current }) => {
          if (actorId !== id) {
            laterObservations++;
            assert.equal(owner.matchContext.coordinator.engagements.get(id), 'target');
            assert.ok(owner.matchContext.playerModels.has(id));
            return { kind: 'handled', action: idleAction() };
          }
          assert.equal(current.combatants[0].pos.y, 0, 'gravity/landing precedes capture');
          const prepared = observeSimGrifballTargetEngagement(current, id, 'target', f.owners, adaptive, owner, dt)!;
          assert.ok(prepared); assert.notEqual(owner.memory.aiState, 'SPAWN_GUARDING');
          const targetMemory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
          const tuning = { ...adaptive, spacingFactor: prepared.spacingFactor, aggressiveLungeMult: 0, feintChance: 0 };
          const combo = resolveSimGrifballComboInput(current, owner.matchContext.grifballTeamPlan, id, f.owners, tuning,
            { [id]: owner.memory, target: targetMemory }, { observation: prepared.observation,
              comboState: null, tacticalWeapon: null, swapFeintActive: false, random: () => .99,
              weaponFeintMemory: { cooldownRemaining: owner.matchContext.feintCooldowns.get(id) } }, dt, 'after-swap-tick')!;
          const feints = combo.weaponFeintMemory!;
          if (feints.cooldownRemaining === undefined) owner.matchContext.feintCooldowns.delete(id);
          else owner.matchContext.feintCooldowns.set(id, feints.cooldownRemaining);
          close(owner.matchContext.feintCooldowns.get(id) ?? 0, Math.max(0, .5 - tick * dt));
          Object.assign(owner.memory, { aiState: combo.frame.aiState, timer: combo.frame.timer });
          // This fixture isolates the entry/attack sequence. Evasion is inactive;
          // its later movement clock boundary is explicitly owned by the caller.
          owner.memory.timer = (owner.memory.timer ?? 0) - dt; owner.memory.swayTimer += dt;
          const ground = resolveSimGrifballGroundOpportunityInput(current, owner.matchContext.grifballTeamPlan, id, f.owners,
            tuning, owner.memory, { observation: prepared.observation, targetMemory, weaponFrame: combo.weaponFrame,
              comboActive: combo.frame.comboActive, feints, random: () => .99 }, dt)!;
          Object.assign(owner.memory, { aiState: ground.frame.aiState, timer: ground.frame.timer });
          attacks += ground.scriptedCombat.commands[id].filter(c => c.kind === 'melee').length;
          return { kind: 'handled', action: ground.action, movement: { x: 0, z: 0 }, commandVersion: 'scripted-combat-v6',
            commands: [...combo.scriptedCombat.commands[id], ...ground.scriptedCombat.commands[id]] };
        },
      };
      return stepSimulation(state, {}, { settings: state.settings, dt, scriptedActorDecisions: decision });
    };
    for (let tick = 1; tick <= 60; tick++) {
      const event = advance(f.state, f.owner, tick), restoredEvent = advance(replay.state, replay.owner, tick);
      assert.deepEqual(replay.state, f.state); assert.deepEqual(replay.owner, f.owner); assert.deepEqual(restoredEvent, event);
      if ([1, 20, 45].includes(tick)) replay = structuredClone(replay);
    }
    assert.ok(attacks > 0); assert.ok(f.target.hp < 20, 'shared decisions must reach actual damage');
    assert.equal(laterObservations, 120);
  });
