import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { resolveSimGrifballCombatObservation, retainSimGrifballCombatObservation } from './grifballCombatObservation';
import { resolveSimGrifballTacticalWeaponChoice } from './grifballTacticalWeaponChoice';
import { resolveSimGrifballComboInput } from './grifballComboInput';
import { resolveSimGrifballGroundOpportunityInput } from './grifballGroundOpportunityInput';
import { resolveSimGrifballEvasionInput } from './grifballEvasionInput';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { NEUTRAL_MATCH_MULTIPLIERS } from '../game/aiTuning';
import { stepSimulation } from './step';
import type { ScriptedAIGroundRequest } from './scriptedAIGround';

function fixture(id = 'ordinary', sign = 1) {
  const state = createMatch({ seed: 7, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', weaponReadyTime: 0, weaponSwapLockout: 0, attackRange: 3.2, attackRadius: 4.5 } });
  const [self, target, player] = state.combatants;
  self.id = id; self.controller = target.controller = 'ai'; target.id = 'target'; target.team = 'red';
  player.id = state.localPlayerId = 'player'; player.controller = 'remote'; player.pos = { x: 30, y: 0, z: 30 };
  state.match.phase = 'playing'; self.weapon = target.weapon = 'hammer';
  self.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: sign * 4 };
  for (const c of [self, target]) { c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 }; }
  const owners = { [id]: 'normal' }, plan = createGrifballTeamPlanState();
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 0, playstyleFactor: 1,
    weaponPrioritization: 50, weaponSwapIQ: 0, spacingFactor: 1, aggressiveLungeMult: 0, feintChance: 0, pressureAggression: 50 };
  const memory = { aiState: 'APPROACHING' as const, timer: .8, cooldownMultiplier: 1 };
  const memories = { [id]: { ...memory }, target: { ...memory } };
  const capture = () => resolveSimGrifballCombatObservation(state, id, target.id, owners, tuning)!;
  return { state, self, target, player, owners, plan, tuning, memories, memory, capture };
}

test('capture retains entry weapon range after a physical swap and target movement', () => {
  const f = fixture(), observation = f.capture(), copy = structuredClone(observation);
  assert.equal(observation.range.enemyInKillRange, true); assert.equal(observation.prediction.distanceToTarget, 4);
  f.self.weapon = 'sword'; f.target.pos.x = 3;
  assert.equal(f.capture().range.enemyInKillRange, false);
  assert.equal(retainSimGrifballCombatObservation(f.state, f.self.id, f.owners, observation), observation);
  assert.deepEqual(observation, copy); assert.deepEqual(JSON.parse(JSON.stringify(observation)), observation);
  observation.prediction.predictedTargetPos.z = 100; assert.equal(f.target.pos.z, 4);
});

for (const state of ['airborne', 'dash', 'slide', 'windup', 'active', 'recovering'] as const)
  test(`observation is available before the ${state} movement/animation owner`, () => {
    const f = fixture();
    if (state === 'airborne') { f.self.isJumping = true; f.self.pos.y = 2; f.self.vel.y = 3; }
    else if (state === 'dash') f.self.dashRemaining = .2;
    else if (state === 'slide') f.self.slideActive = true;
    else f.self.weaponState = state;
    const before = structuredClone(f.state), observation = f.capture(); assert.ok(observation);
    assert.equal(observation.range.selfGrounded, state !== 'airborne'); assert.deepEqual(f.state, before);
  });

for (const invalid of ['remote', 'local', 'neural', 'missing-owner', 'dead', 'respawn', 'carrier', 'flight',
  'paused', 'dead-target', 'respawning-target', 'allied-target', 'duplicate-target', 'missing-target'] as const)
  test(`capture and retained consumers hand off invalid ${invalid} lifecycle`, () => {
    const f = fixture(), observation = f.capture();
    if (invalid === 'remote') f.self.controller = 'remote';
    if (invalid === 'local') f.state.localPlayerId = f.self.id;
    if (invalid === 'neural') f.owners[f.self.id] = 'neural-net';
    if (invalid === 'missing-owner') delete f.owners[f.self.id];
    if (invalid === 'dead') f.self.hp = 0;
    if (invalid === 'respawn') f.self.respawnTimer = 1;
    if (invalid === 'carrier') f.state.match.ball.holderId = f.self.id;
    if (invalid === 'flight') f.self.isLunging = true;
    if (invalid === 'paused') f.state.match.phase = 'countdown';
    if (invalid === 'dead-target') f.target.hp = 0;
    if (invalid === 'respawning-target') f.target.respawnTimer = 1;
    if (invalid === 'allied-target') f.target.team = f.self.team;
    if (invalid === 'duplicate-target') f.state.combatants.push(structuredClone(f.target));
    if (invalid === 'missing-target') f.state.combatants.splice(1, 1);
    assert.equal(f.capture(), null); assert.equal(retainSimGrifballCombatObservation(f.state, f.self.id, f.owners, observation), null);
  });

for (const invalid of ['tick', 'actor', 'version', 'range', 'vector', 'flag', 'weapon'] as const)
  test(`retained ${invalid} mismatch is rejected before any consumer RNG`, () => {
    const f = fixture(), observation = f.capture(); let draws = 0;
    if (invalid === 'tick') observation.tick++;
    if (invalid === 'actor') observation.actorId = 'another-bot';
    if (invalid === 'version') observation.version = 'bad' as never;
    if (invalid === 'range') observation.range.combatDistanceToTarget = NaN;
    if (invalid === 'vector') observation.prediction.toTarget.x = Infinity;
    if (invalid === 'flag') observation.range.selfGrounded = 1 as never;
    if (invalid === 'weapon') observation.observedWeapon = 'ball' as never;
    assert.throws(() => resolveSimGrifballTacticalWeaponChoice(f.state, f.plan, f.self.id, f.owners, f.tuning, f.memories,
      { observation, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: () => { draws++; return 0; } }), /observation/);
    assert.equal(draws, 0);
  });

for (const entryWeapon of ['hammer', 'sword'] as const) test(`ground adapter retains ${entryWeapon} range after a queued swap`, () => {
  const f = fixture(); f.self.weapon = entryWeapon; const observation = f.capture();
  f.self.weapon = entryWeapon === 'hammer' ? 'sword' : 'hammer';
  const result = resolveSimGrifballGroundOpportunityInput(f.state, f.plan, f.self.id, f.owners, f.tuning, f.memory,
    { observation, targetMemory: f.memories.target, weaponFrame: { activeWeapon: f.self.weapon, weaponState: 'ready',
      canStartWeaponAction: true, observedSwapLockout: 0, currentSwapLockout: 0, readinessRemaining: 0 },
      comboActive: false, feints: {}, random: () => .99 })!;
  assert.equal(result.frame.mode, entryWeapon === 'hammer' ? 'sync_return' : 'continue');
  assert.deepEqual(result.scriptedCombat.commands[f.self.id], entryWeapon === 'hammer' ? [{ kind: 'melee', weapon: 'sword', swipe: false }] : []);
});

test('retained ground opportunity respects slides and requires target AI memory', () => {
  const f = fixture(); f.self.slideActive = true; const observation = f.capture();
  const context = { observation, targetMemory: f.memories.target, weaponFrame: { activeWeapon: 'hammer' as const, weaponState: 'ready' as const,
    canStartWeaponAction: true, observedSwapLockout: 0, currentSwapLockout: 0, readinessRemaining: 0 }, comboActive: false, feints: {}, random: () => .99 };
  const decide = () => resolveSimGrifballGroundOpportunityInput(f.state, f.plan, f.self.id, f.owners, f.tuning, f.memory, context);
  assert.deepEqual(decide()!.scriptedCombat.commands[f.self.id], []);
  context.targetMemory = undefined as never; assert.equal(decide(), null);
});

// The complete range path through real scheduled priority consumers. Upstream
// tuning/memory is authored; this does not claim autonomous team opposition.
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const entryWeapon of ['hammer', 'sword'] as const) test(`retained scheduled priority chain ${id}/${sign}/${dt}/${entryWeapon}`, () => {
    const f = fixture(id, sign); f.self.weapon = entryWeapon;
    f.tuning.weaponPrioritization = entryWeapon === 'hammer' ? 100 : 0;
    const snapshot = JSON.parse(JSON.stringify(f.state));
    const run = (state: typeof f.state) => stepSimulation(state, {}, { settings: state.settings, dt,
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners, prepare: () => 'engagement',
        resolve: ({ state: current }) => {
          const observation = resolveSimGrifballCombatObservation(current, id, f.target.id, f.owners, f.tuning, dt)!;
          const choice = resolveSimGrifballTacticalWeaponChoice(current, f.plan, id, f.owners, f.tuning, f.memories,
            { observation, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: () => .99 }, dt, 'after-swap-tick')!;
          const combo = resolveSimGrifballComboInput(current, f.plan, id, f.owners, f.tuning, f.memories,
            { observation, tacticalWeapon: choice.decision.weapon, comboState: null, swapFeintActive: false,
              weaponFeintMemory: {}, random: () => .99 }, dt, 'after-swap-tick')!;
          assert.equal(combo.frame.mode, 'continue');
          assert.equal(combo.weaponFrame.activeWeapon, entryWeapon === 'hammer' ? 'sword' : 'hammer');
          const evasion = resolveSimGrifballEvasionInput(current, id, f.owners, f.memories,
            { motionPhase: 'after-engagement-gravity', observation, weaponFrame: combo.weaponFrame, pendingPostEvasionCharge: false,
              bulltrueCounter: null, defensiveEvasionMult: 1, spatialIQ: 0, swayTimer: 0, random: () => .99 }, dt)!;
          assert.deepEqual(evasion.commands, []);
          return { kind: 'handled', action: combo.action, commands: [...combo.scriptedCombat.commands[id], ...evasion.commands],
            commandVersion: 'scripted-combat-v6', ground: { version: 'scripted-ai-ground-v1', resolve: ({ state: grounded }) => {
              assert.equal(grounded.combatants[0].weapon, combo.weaponFrame.activeWeapon);
              const retained = retainSimGrifballCombatObservation(grounded, id, f.owners, observation, dt)!;
              assert.equal(retained.range.enemyInKillRange, entryWeapon === 'hammer');
              const tuning = resolveBehaviorTuning(grounded.settings), r = retained.range, prediction = retained.prediction;
              const request: ScriptedAIGroundRequest = { targetId: retained.targetId, targetMemory: f.memories.target,
                memory: { aiState: evasion.frame.aiState, timer: (evasion.frame.timer ?? 0) - dt,
                  weaponState: evasion.weaponFrame.weaponState, isSprinting: false },
                policy: { ...r, distanceToTarget: prediction.distanceToTarget, resolvedAiReach: retained.resolvedAiReach,
                  resolvedDangerZone: 3, maxLungeRange: 10, minLungeRange: 4, activeWeapon: combo.weaponFrame.activeWeapon as 'hammer' | 'sword',
                  canStartWeaponAction: combo.weaponFrame.canStartWeaponAction, targetIsProtected: retained.targetProtected,
                  pressureTargetId: undefined, difficulty: 'normal', movementComplexity: 0, playstyleFactor: 1,
                  tunedAnticipationFactor: 0, effectiveReactionLatency: 0, effectivePressureAggression: 50, cooldownMult: 1, swayTimer: 0,
                  lookHeading: new THREE.Vector3(0, 0, sign), spatialLookHeading: new THREE.Vector3(0, 0, sign),
                  sidewayHeading: new THREE.Vector3(-sign, 0, 0), spatialBias: { aggressionMult: 1 }, totalApproachLateral: 0,
                  sprintMult: 1, isCrouching: false, feintChance: 0, feintLungeFakeout: false, psychEnabled: false,
                  psychState: { standoffTimer: 0 }, matchMultipliers: { ...NEUTRAL_MATCH_MULTIPLIERS }, tuning,
                  tryFeintRoll: () => false, commitFeint: () => {}, isTargetOnCooldown: () => false,
                  isCoordAttackBlocked: () => false, clearPressureTarget: () => {}, random: () => .99 },
                opportunity: { targetAirborne: prediction.targetAirborne, enemyInKillRange: r.enemyInKillRange,
                  selfGrounded: r.selfGrounded, swordForbidden: f.tuning.weaponPrioritization === 0,
                  hammerForbidden: f.tuning.weaponPrioritization === 100, swapLockoutRemaining: combo.weaponFrame.observedSwapLockout,
                  swapFeintActive: false, comboActive: combo.frame.comboActive, lungeDistanceToTarget: prediction.distanceToTarget,
                  hasVerticalLungeLine: true, combatDistanceToTarget: r.combatDistanceToTarget, aggressiveLungeMult: 0, tuning,
                  startWeaponSwapFeintTimer: () => {}, getTargetPlayerModel: () => null, recordCombatantObservation: () => {} } };
              return request;
            } } };
        } } });
    const event = run(f.state), replay = run(snapshot);
    assert.deepEqual(snapshot, f.state); assert.deepEqual(replay, event);
    if (entryWeapon === 'hammer') { assert.equal(f.self.weaponState, 'windup'); assert.equal(f.self.pos.z, 0); }
    else { assert.equal(f.self.weaponState, 'idle'); assert.ok(Math.abs(f.self.pos.z) > 0); }
  });
