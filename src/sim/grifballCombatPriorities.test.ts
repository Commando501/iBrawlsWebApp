import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { resolveSimGrifballCombatPriorities, type SimCombatPriorityMemory } from './grifballCombatPriorities';
import { resolveSimGrifballTacticalComboInput } from './grifballTacticalComboInput';
import { resolveSimGrifballEvasionInput } from './grifballEvasionInput';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import { createRng } from './rng';
import { validateScriptedActorDecision } from './scriptedActorDecision';
import { stepCombatantWeapons } from './weapons';

function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 8, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 20, weaponReadyTime: 0, weaponSwapLockout: .4 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = 'sword';
  actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 2 }; player.pos = { x: 30, y: 0, z: 30 };
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  state.match.phase = 'playing';
  const memory: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: .3, cooldownMultiplier: 1,
    swayTimer: .4, coordCommitTimer: 0, pendingPostEvasionCharge: false };
  const memories = { [id]: { ...memory }, target: { ...memory } }, owners = { [id]: 'normal' };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
    playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: 100, pressureAggression: 50, spacingFactor: 1 };
  const matchContext = createAIMatchContext();
  return { state, actor, target, player, memories, owners, tuning, matchContext };
}
const contextFor = (f: ReturnType<typeof fixture>, dt: number, random: () => number) => ({
  observation: resolveSimGrifballCombatObservation(f.state, f.actor.id, f.target.id, f.owners, f.tuning, dt)!,
  matchContext: f.matchContext, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random,
  spatialIQ: 80, defensiveEvasionMult: 1, resolvedDangerZone: 3,
});

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const kind of ['idle', 'feint-reversion', 'combo-counter-hop', 'dash', 'hammer-jump'] as const)
    test(`combat priorities preserve ordered policy results and clocks ${id}/${dt}/${kind}`, () => {
      const f = fixture(id), memory = f.memories[id];
      if (kind === 'feint-reversion') { f.tuning.weaponPrioritization = 0; f.matchContext.weaponSwapFeintTimers.set(id, dt / 2); }
      if (kind === 'combo-counter-hop') {
        f.matchContext.comboState.set(id, { comboId: 'safe_finish', targetId: 'target', stepIndex: 1, stepTimer: 0 });
        f.actor.dashCooldownTimer = 2;
      }
      if (kind === 'hammer-jump') {
        f.actor.weapon = 'hammer'; f.tuning.weaponPrioritization = 0; f.actor.dashCooldownTimer = 2; f.target.pos.z = 8;
      }
      if (['combo-counter-hop', 'dash', 'hammer-jump'].includes(kind)) {
        f.target.weapon = 'sword'; f.target.isLunging = true; f.target.lungeDir = { x: 0, y: 0, z: -1 };
      }
      f.matchContext.feintCooldowns.set(id, .5);
      const rng = createRng(5), referenceRng = createRng(5), context = contextFor(f, dt, rng.next);
      const before = structuredClone(f.state), beforeMemory = structuredClone(f.memories), beforeContext = structuredClone(f.matchContext);
      const combo = resolveSimGrifballTacticalComboInput(f.state, f.matchContext.grifballTeamPlan, id, f.owners, f.tuning,
        beforeMemory, { ...context, random: referenceRng.next, comboState: beforeContext.comboState.get(id) ?? null,
          weaponFeintMemory: { cooldownRemaining: .5, swapRemaining: beforeContext.weaponSwapFeintTimers.get(id) } }, dt)!;
      const evasion = resolveSimGrifballEvasionInput(f.state, id, f.owners,
        { ...beforeMemory, [id]: { ...beforeMemory[id], aiState: combo.frame.aiState, timer: combo.frame.timer } }, {
          motionPhase: 'after-engagement-gravity', observation: context.observation, weaponFrame: combo.weaponFrame,
          pendingPostEvasionCharge: false, bulltrueCounter: combo.tactical.decision.bulltrueCounter,
          defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: memory.swayTimer, random: referenceRng.next,
          airborneOpportunity: { targetAirborne: context.observation.prediction.targetAirborne,
            movementComplexity: 80, resolvedDangerZone: 3, tunedAnticipationFactor: 0,
            enemyInKillRange: context.observation.range.enemyInKillRange,
            verticalDeltaToTarget: context.observation.range.verticalDeltaToTarget } }, dt)!;
      const result = resolveSimGrifballCombatPriorities(f.state, id, f.owners, f.tuning, f.memories, context, dt)!;
      assert.equal(result.mode, 'continue'); assert.deepEqual(result.combo, combo); assert.deepEqual(result.evasion, evasion);
      assert.deepEqual(f.state, before); assert.equal(rng.getState(), referenceRng.getState());
      assert.equal(memory.timer, evasion.frame.timer! - dt); assert.equal(memory.swayTimer, .4 + dt);
      assert.equal(memory.pendingPostEvasionCharge, evasion.frame.pendingPostEvasionCharge);
      assert.equal(f.matchContext.feintCooldowns.get(id), .5 - dt);
      assert.deepEqual(f.matchContext.comboState.get(id) ?? null, combo.comboState);
      assert.deepEqual(f.memories.target, beforeMemory.target);
      assert.deepEqual(result.decision.commands, [...combo.scriptedCombat.commands[id], ...evasion.commands]);
      if (result.decision.mobility) assert.equal(result.decision.mobilityAfterCommands, combo.scriptedCombat.commands[id].length);
    });

for (const id of ['main_ai', 'ordinary']) test(`combo lunge returns without evasion or movement clocks ${id}`, () => {
  const f = fixture(id); f.target.pos.z = 10;
  f.matchContext.comboState.set(id, { comboId: 'mixup', targetId: 'target', stepIndex: 2, stepTimer: 0 });
  f.matchContext.feintCooldowns.set(id, .5);
  const memory = f.memories[id], before = structuredClone(memory), dt = 1 / 60;
  const events = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: {
    version: 'scripted-actor-decision-v1', scriptedBots: f.owners, prepare: () => 'engagement',
    resolve: () => {
      const result = resolveSimGrifballCombatPriorities(f.state, id, f.owners, f.tuning, f.memories, contextFor(f, dt, () => .99), dt)!;
      assert.equal(result.mode, 'sync_return'); assert.equal(result.evasion, null);
      assert.equal(memory.swayTimer, before.swayTimer); assert.equal(memory.timer, before.timer);
      assert.equal(f.matchContext.feintCooldowns.get(id), .5 - dt);
      assert.equal(f.matchContext.comboState.has(id), false);
      return result.decision;
    } } });
  assert.equal(f.actor.isLunging, true); assert.equal(f.actor.lungeTimer, 0);
  assert.deepEqual(f.actor.pos, { x: 0, y: 0, z: 0 }); assert.equal(events.actorDecisionFrame!.decisions[0].kind, 'handled');
});

test('composed combo slash commits before the emergency hop', () => {
  const f = fixture(); f.target.weapon = 'sword'; f.target.isLunging = true; f.target.lungeDir = { x: 0, y: 0, z: -1 };
  f.target.lungeTargetId = f.actor.id; f.target.lungeStartPos = { ...f.target.pos };
  f.actor.dashCooldownTimer = 2;
  f.matchContext.comboState.set(f.actor.id, { comboId: 'safe_finish', targetId: 'target', stepIndex: 1, stepTimer: 0 });
  let jumped = false, jumping = false;
  Object.defineProperty(f.actor, 'isJumping', { enumerable: true, configurable: true,
    get: () => jumping, set: (value: boolean) => {
      if (value && !jumping) {
        jumped = true; assert.equal(f.actor.weaponState, 'windup', 'earlier combo attack must already be physical');
        assert.equal(f.actor.attackKind, 'slash'); assert.equal(f.actor.lastAttackTick, f.state.tick);
      }
      jumping = value;
    } });
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: {
    version: 'scripted-actor-decision-v1', scriptedBots: f.owners, prepare: () => 'engagement',
    resolve: () => {
      const result = resolveSimGrifballCombatPriorities(f.state, f.actor.id, f.owners, f.tuning, f.memories,
        contextFor(f, 1 / 60, () => .99))!;
      assert.equal(result.decision.mobility?.kind, 'emergency-hop'); assert.equal(result.decision.mobilityAfterCommands, 1);
      return result.decision;
    } } });
  assert.equal(jumped, true); assert.equal(f.actor.isJumping, true);
});

for (const boundary of [0, 1, 2]) test(`weapon execution applies mobility at command boundary ${boundary}`, () => {
  const f = fixture(); f.actor.weapon = 'hammer';
  const phases: string[] = [];
  stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'intent',
    [{ kind: 'swap', weapon: 'sword' }, { kind: 'melee', weapon: 'sword', swipe: false }], undefined, undefined, false,
    { mobilityAfterCommands: boundary, sequentialOpportunities: true,
      beforeAttack: () => phases.push(`${f.actor.weapon}/${f.actor.weaponState}`) });
  assert.deepEqual(phases, [boundary === 0 ? 'hammer/idle' : boundary === 1 ? 'sword/idle' : 'sword/windup']);
});

for (const invalid of [-1, .5, 2, NaN, Infinity]) test(`scheduler rejects invalid mobility boundary ${invalid}`, () => {
  const f = fixture();
  assert.throws(() => validateScriptedActorDecision(f.state,
    { version: 'scripted-actor-decision-v1', scriptedBots: f.owners, resolve: () => ({ kind: 'handoff', reason: 'unused' }) },
    f.actor.id, { kind: 'handled', action: idleAction(), commands: [{ kind: 'melee', weapon: 'sword', swipe: false }],
      commandVersion: 'scripted-combat-v6', mobility: { kind: 'emergency-hop', direction: { x: 1, z: 0 } } as never,
      mobilityAfterCommands: invalid }, f.state.settings, true), /command boundary/);
});

for (const reason of ['dead', 'carrier', 'flight', 'paused', 'target-dead'] as const)
  test(`unowned ${reason} priority turn preserves clocks and random stream`, () => {
    const f = fixture(), context = contextFor(f, 1 / 60, () => assert.fail('ineligible turn consumed RNG'));
    if (reason === 'dead') f.actor.alive = false;
    if (reason === 'carrier') f.actor.hasBall = true;
    if (reason === 'flight') f.actor.isLunging = true;
    if (reason === 'paused') f.state.match.phase = 'countdown';
    if (reason === 'target-dead') f.target.hp = 0;
    const before = structuredClone(f);
    assert.equal(resolveSimGrifballCombatPriorities(f.state, f.actor.id, f.owners, f.tuning, f.memories, context), null);
    assert.deepEqual(f, before);
  });

for (const aiState of ['APPROACHING', 'COOLDOWN', 'PRESSURING'] as const)
  test(`post-miss spacing respects ${aiState} before spending the state clock`, () => {
    const f = fixture(), memory = f.memories[f.actor.id];
    f.tuning.weaponSwapIQ = 80; f.target.pos.z = 6;
    Object.assign(memory, { aiState, lastLungeOutcome: 'miss_timeout', lastLungeTargetId: 'target', postLungeDecisionTimer: .5 });
    const result = resolveSimGrifballCombatPriorities(f.state, f.actor.id, f.owners, f.tuning, f.memories,
      contextFor(f, 1 / 60, () => .99))!;
    assert.equal(result.combo.tactical.decision.postMissSpacing, true);
    assert.equal(memory.aiState, aiState === 'APPROACHING' ? 'DANCING_BACKWARD' : aiState);
    assert.equal(memory.timer, (aiState === 'APPROACHING' ? .45 : .3) - 1 / 60);
  });

for (const field of ['sway', 'pending', 'danger', 'spatial', 'context'] as const)
  test(`invalid ${field} rejects before policy clocks or randomness`, () => {
    const f = fixture(), context = contextFor(f, 1 / 60, () => assert.fail('invalid context consumed randomness'));
    if (field === 'sway') f.memories[f.actor.id].swayTimer = Infinity;
    if (field === 'pending') (f.memories[f.actor.id] as any).pendingPostEvasionCharge = undefined;
    if (field === 'danger') context.resolvedDangerZone = -1;
    if (field === 'spatial') context.spatialIQ = 101;
    if (field === 'context') (context.matchContext as any).comboState = {};
    const before = structuredClone(f);
    assert.throws(() => resolveSimGrifballCombatPriorities(f.state, f.actor.id, f.owners, f.tuning, f.memories, context), /priority|priorities/);
    assert.deepEqual(f, before);
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const sign of [-1, 1])
  test(`composed attack and evasion resume from own-state checkpoints ${id}/${dt}/${sign}`, () => {
    const f = fixture(id); f.actor.dashCooldownTimer = 2;
    f.target.weapon = 'sword'; f.target.pos.z *= sign;
    f.target.weaponState = 'windup'; f.target.attackKind = 'slash'; f.target.weaponPhaseElapsed = 0;
    f.target.weaponTimer = f.state.settings.swordSlashSpeed / 2;
    f.matchContext.comboState.set(id, { comboId: 'safe_finish', targetId: 'target', stepIndex: 1, stepTimer: 0 });
    f.matchContext.feintCooldowns.set(id, .5);
    let current = { state: f.state, memories: f.memories, matchContext: f.matchContext, randomState: createRng(25).getState() };
    let restored = structuredClone(current), sawHop = false, sawAttack = false;
    const advance = (run: typeof current) => {
      const rng = createRng(0); rng.setState(run.randomState);
      const events = stepSimulation(run.state, {}, { settings: run.state.settings, dt, scriptedActorDecisions: {
        version: 'scripted-actor-decision-v1', scriptedBots: f.owners, prepare: () => 'engagement',
        resolve: ({ state }) => {
          const observation = resolveSimGrifballCombatObservation(state, id, 'target', f.owners, f.tuning, dt)!;
          const result = resolveSimGrifballCombatPriorities(state, id, f.owners, f.tuning, run.memories, {
            observation, matchContext: run.matchContext, random: rng.next, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
            spatialIQ: 80, defensiveEvasionMult: 1, resolvedDangerZone: 3 }, dt)!;
          assert.equal(result.mode, 'continue', 'this fixture isolates stationary attacks with evasion');
          sawHop ||= result.decision.mobility?.kind === 'emergency-hop';
          sawAttack ||= result.decision.commands!.some(c => c.kind === 'melee');
          return result.decision;
        }, completeTurn: ({ record }) => {
          if (record.dash) Object.assign(run.memories[id], record.dash);
        } } });
      run.randomState = rng.getState();
      return events;
    };
    for (let frame = 1; frame <= 90; frame++) {
      const events = advance(current), replayEvents = advance(restored);
      assert.deepEqual(restored, current, `state and owned memory at ${frame}`); assert.deepEqual(replayEvents, events);
      if ([1, 20, 45].includes(frame)) restored = structuredClone(restored);
    }
    assert.equal(sawHop, true); assert.equal(sawAttack, true);
    assert.ok(current.state.combatants.find(c => c.id === 'target')!.hp < 20, 'composed command must produce actual damage');
    assert.equal(current.matchContext.feintCooldowns.has(id), false);
    assert.ok(Math.abs(current.memories[id].swayTimer - (.4 + 90 * dt)) < 1e-10);
  });
