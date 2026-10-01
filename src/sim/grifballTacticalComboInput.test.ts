import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { advanceAIWeaponSwapFeint, tickFeintCooldown } from '../game/aiMatchContext';
import { evaluateTacticalWeaponChoice } from '../game/aiTacticalWeaponChoice';
import { canStartAIWeaponAction } from '../game/aiWeaponTiming';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { resolveSimGrifballComboInput, type SimWeaponFeintMemory, type SimComboWeaponFrame } from './grifballComboInput';
import { resolveSimGrifballTacticalComboInput } from './grifballTacticalComboInput';
import { resolveSimGrifballGroundOpportunityInput } from './grifballGroundOpportunityInput';
import { createRng } from './rng';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { stepSimulation } from './step';
import type { BotComboState } from '../game/aiComboEngine';

function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 8, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 20, weaponReadyTime: .08, weaponSwapLockout: .4 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = 'sword';
  actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 2 }; player.pos = { x: 30, y: 0, z: 30 };
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  state.match.phase = 'playing';
  const plan = createGrifballTeamPlanState(), owners = { [id]: 'normal' };
  const memories: Record<string, TacticalAIMemory> = {
    [id]: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
    target: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 } };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
    playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: 0, pressureAggression: 50, spacingFactor: 1 };
  return { state, actor, target, player, plan, owners, memories, tuning };
}

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const phase of ['idle', 'windup', 'active', 'recovering'] as const)
    for (const priority of [0, 100]) for (const iq of [0, 80])
      test(`feint then tactical then combo matches the live ordering ${id}/${dt}/${phase}/${priority}/${iq}`, () => {
        const f = fixture(id); f.actor.weaponState = phase; f.actor.attackKind = 'slash';
        f.actor.swapLockoutTimer = .4; f.actor.weaponReadyTimer = .06;
        f.tuning.weaponPrioritization = priority; f.tuning.weaponSwapIQ = iq;
        const observation = resolveSimGrifballCombatObservation(f.state, id, f.target.id, f.owners, f.tuning, dt)!;
        const before = structuredClone(f), rng = createRng(19), expectedRng = createRng(19);
        const feints: SimWeaponFeintMemory = { cooldownRemaining: .1, swapRemaining: dt / 2 };
        const liveFeints = { feintCooldowns: new Map([[id, .1]]), weaponSwapFeintTimers: new Map([[id, dt / 2]]) };
        let weapon = f.actor.weapon, weaponState = observeSimTacticalWeaponTarget(f.state, f.actor).weaponState;
        const readiness = canStartAIWeaponAction({ ...f.memories[id], swapCooldownTimer: .06 });
        tickFeintCooldown(liveFeints, id, dt);
        const expiry = advanceAIWeaponSwapFeint(liveFeints, id, dt, weapon, weaponState, priority >= 100);
        if (expiry.revert) { weapon = 'hammer'; weaponState = 'ready'; }
        const actor = (c: typeof f.actor) => ({ id: c.id, team: c.team, pos: c.pos, hp: c.hp, maxHp: c.maxHp,
          respawnTimer: c.respawnTimer, activeWeapon: c.weapon });
        const expected = evaluateTacticalWeaponChoice({ settings: f.state.settings,
          self: { ...actor(f.actor), activeWeapon: weapon }, actors: f.state.combatants.map(actor),
          target: observeSimTacticalWeaponTarget(f.state, f.target, f.memories.target), difficulty: 'normal',
          pressureAggression: 50, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: expectedRng.next,
          context: { distanceToTarget: observation.prediction.distanceToTarget, combatDistanceToTarget: observation.range.combatDistanceToTarget,
            canStartWeaponAction: readiness, weaponState, weaponSwapIQ: iq, weaponPrioritization: priority } });
        const comboContext = { observation, comboState: null, weaponFeintMemory: feints,
          scoreContext: { scorePlayer: 0, scoreEnemy: 0 } };
        const expectedCombo = resolveSimGrifballComboInput(f.state, f.plan, id, f.owners, f.tuning, f.memories,
          { ...comboContext, tacticalWeapon: expected.weapon, swapFeintActive: true, random: expectedRng.next }, dt, 'after-swap-tick')!;
        const result = resolveSimGrifballTacticalComboInput(f.state, f.plan, id, f.owners, f.tuning, f.memories,
          { ...comboContext, random: rng.next }, dt)!;
        assert.deepEqual(result.tactical.decision, expected);
        const { tactical: _, ...combo } = result; assert.deepEqual(combo, expectedCombo);
        assert.equal(rng.getState(), expectedRng.getState()); assert.deepEqual(f, before);
        assert.equal(result.scriptedCombat.commands[id].filter(c => c.kind === 'revert-weapon-feint').length, Number(expiry.revert));
        assert.equal(result.weaponFeintMemory!.cooldownRemaining, .1 - dt);
      });

test('expired forbidden sword no longer bypasses the tactical random gate using its old weapon', () => {
  const f = fixture(); let draws = 0;
  const observation = resolveSimGrifballCombatObservation(f.state, f.actor.id, f.target.id, f.owners, f.tuning)!;
  const result = resolveSimGrifballTacticalComboInput(f.state, f.plan, f.actor.id, f.owners, f.tuning, f.memories,
    { observation, comboState: null, weaponFeintMemory: { swapRemaining: .001 },
      scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: () => { draws++; return .99; } })!;
  assert.equal(result.tactical.decision.weapon, null); assert.equal(result.tactical.decision.bypassedRandomGate, false);
  assert.equal(draws, 1); assert.equal(result.frame.activeWeapon, 'hammer');
  assert.equal(f.actor.weapon, 'sword', 'decision construction cannot change the physical weapon');
});

test('deferred tactical callback sees immutable post-revert clocks and is skipped for unowned actors', () => {
  const f = fixture(); f.actor.swapLockoutTimer = .7; f.actor.weaponReadyTimer = .2; let calls = 0;
  const observation = resolveSimGrifballCombatObservation(f.state, f.actor.id, f.target.id, f.owners, f.tuning)!;
  const context = { observation, comboState: null, swapFeintActive: true, weaponFeintMemory: { swapRemaining: .001 }, random: () => .99,
    tacticalWeapon: (frame: Readonly<SimComboWeaponFrame>) => {
      calls++; assert.equal(Object.isFrozen(frame), true); assert.equal(frame.activeWeapon, 'hammer');
      assert.equal(frame.observedSwapLockout, .7); assert.equal(frame.currentSwapLockout, 0);
      assert.equal(frame.readinessRemaining, .2); assert.equal(frame.canStartWeaponAction, false); return null;
    } };
  assert.ok(resolveSimGrifballComboInput(f.state, f.plan, f.actor.id, f.owners, f.tuning, f.memories, context, 1 / 60, 'after-swap-tick'));
  assert.equal(calls, 1); f.actor.alive = false;
  assert.equal(resolveSimGrifballComboInput(f.state, f.plan, f.actor.id, f.owners, f.tuning, f.memories, context), null);
  assert.equal(calls, 1);
});

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const sign of [-1, 1])
  test(`scheduled tactical-combo decisions reach damage and preserve RNG through checkpoints ${id}/${dt}/${sign}`, () => {
    const f = fixture(id); f.target.pos.z *= sign;
    const initial = { memories: f.memories, feints: { cooldownRemaining: .1, swapRemaining: .001 } as SimWeaponFeintMemory,
      combo: null as BotComboState | null, randomState: 71 };
    let replay = structuredClone({ state: f.state, policy: initial });
    const advance = (state: typeof f.state, policy: typeof initial) => stepSimulation(state, {}, { settings: state.settings, dt,
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners, prepare: () => 'engagement',
        resolve: ({ state: current }) => {
          const rng = createRng(policy.randomState);
          const observation = resolveSimGrifballCombatObservation(current, id, 'target', f.owners, f.tuning, dt)!;
          const result = resolveSimGrifballTacticalComboInput(current, f.plan, id, f.owners, f.tuning, policy.memories,
            { observation, comboState: policy.combo, weaponFeintMemory: policy.feints,
              scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: rng.next }, dt)!;
          policy.combo = result.comboState; policy.feints = result.weaponFeintMemory!;
          Object.assign(policy.memories[id], { aiState: result.frame.aiState, timer: (result.frame.timer ?? 0) - dt });
          const ground = resolveSimGrifballGroundOpportunityInput(current, f.plan, id, f.owners,
            { ...f.tuning, aggressiveLungeMult: 0, feintChance: 0 }, policy.memories[id],
            { observation, targetMemory: policy.memories.target, weaponFrame: result.weaponFrame, comboActive: result.frame.comboActive,
              feints: policy.feints, random: rng.next }, dt)!;
          Object.assign(policy.memories[id], { aiState: ground.frame.aiState, timer: ground.frame.timer });
          policy.feints = ground.feints; policy.randomState = rng.getState();
          return { kind: 'handled', action: ground.action, movement: { x: 0, z: 0 }, commandVersion: 'scripted-combat-v6',
            commands: [...result.scriptedCombat.commands[id], ...ground.scriptedCombat.commands[id]] };
        },
      } });
    for (let tick = 1; tick <= 90; tick++) {
      const events = advance(f.state, initial), restoredEvents = advance(replay.state, replay.policy);
      assert.deepEqual(replay.state, f.state); assert.deepEqual(replay.policy, initial); assert.deepEqual(restoredEvents, events);
      if ([1, 20, 45].includes(tick)) replay = structuredClone(replay);
    }
    assert.equal(f.actor.weapon, 'hammer'); assert.ok(f.target.hp < 20, 'policy must produce an actual landed attack');
    assert.notEqual(initial.randomState, 71);
  });

for (const id of ['main_ai', 'ordinary']) for (const motion of ['standing', 'airborne', 'dash', 'slide'])
  test(`carrier ready-strike preservation requires stationary grounded ownership ${id}/${motion}`, () => {
    const f = fixture(id); f.actor.weapon = 'hammer'; f.tuning.weaponPrioritization = 50;
    f.target.weapon = 'ball'; f.target.hasBall = true; f.state.match.ball.holderId = 'target';
    if (motion === 'airborne') { f.actor.isJumping = true; f.actor.pos.y = f.target.pos.y = .1; }
    if (motion === 'dash') f.actor.dashRemaining = .1;
    if (motion === 'slide') f.actor.slideActive = true;
    f.plan.assignments.set(id, { botId: id, team: 'blue', role: 'safety', slot: 0,
      destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: 'target', reason: 'Immediate carrier interception',
      tuning: defaultGrifballTactics().defaults,
      defense: { mode: 'intercept', targetId: 'target', intercept: { x: 0, z: 0 }, arrivalETA: 0,
        carrierETA: 0, advantage: 0, reinforcementIn: Infinity, emergency: false, transitioning: false } });
    const observation = resolveSimGrifballCombatObservation(f.state, id, 'target', f.owners, f.tuning)!;
    assert.equal(observation.range.enemyInKillRange, true);
    const result = resolveSimGrifballComboInput(f.state, f.plan, id, f.owners, f.tuning, f.memories,
      { observation, comboState: null, tacticalWeapon: 'sword', swapFeintActive: false, random: () => .99 }, 1 / 60, 'after-swap-tick')!;
    assert.equal(result.frame.activeWeapon, motion === 'standing' ? 'hammer' : 'sword');
    assert.equal(result.scriptedCombat.commands[id].some(c => c.kind === 'swap'), motion !== 'standing');
  });
