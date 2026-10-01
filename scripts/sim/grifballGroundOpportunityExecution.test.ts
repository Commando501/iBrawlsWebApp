import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { triggerCombatantLungeAction, swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { resolveAIGroundState } from '../../src/game/aiGroundState';
import { finishAIHorizontalMotion } from '../../src/game/aiDashMotion';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { canApplyAITacticalWeaponSwap } from '../../src/game/aiTacticalWeaponSwap';
import { NEUTRAL_MATCH_MULTIPLIERS } from '../../src/game/aiTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { observeSimTacticalWeaponTarget } from '../../src/sim/grifballTacticalWeaponChoice';
import type { ScriptedAIGroundRequest } from '../../src/sim/scriptedAIGround';

const noop = () => {};
const kinds = ['stationary-hammer', 'stationary-sword', 'lunge', 'vertical-lunge', 'zero-lunge',
  'fakeout', 'swap-lunge', 'swap-delay', 'refused-swap', 'declined', 'sliding'] as const;
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const kind of kinds) test(`ground opportunity composition ${id}/${sign}/${dt}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { maxHP: 20, enableSlide: true,
      weaponReadyTime: kind === 'swap-delay' ? .3 : 0, weaponSwapLockout: .4,
      hammerSlamWindupTime: .08, hammerSlamAttackTime: .04, swordSlashSpeed: .12, attackRadius: 2,
      enableSwordTrade: false, enableHammerSwordTrade: false }));
    const { bot, target, sim, state: live, map } = f;
    const weapon = kind.includes('sword') || ['lunge', 'vertical-lunge', 'zero-lunge', 'fakeout'].includes(kind) ? 'sword' : 'hammer';
    const near = kind.startsWith('stationary') || kind === 'sliding';
    const distance = near ? 2 : 6;
    bot.activeWeapon = weapon; bot.pos.set(0, 0, 0); bot.vel.set(0, 0, 0); bot.yaw = sign > 0 ? Math.PI : 0;
    target.pos.set(0, kind === 'vertical-lunge' ? 2 : 0, kind === 'zero-lunge' ? 0 : sign * distance);
    target.isJumping = kind === 'vertical-lunge'; target.vel.set(0, 0, 0); bot.hp = bot.maxHp = target.hp = target.maxHp = 20;
    bot.swapLockoutTimer = kind === 'refused-swap' ? .5 : 0;
    const [actor, enemy] = sim.combatants;
    Object.assign(actor, { id, controller: 'ai', weapon, pos: { ...bot.pos }, vel: { ...bot.vel }, yaw: sign > 0 ? 0 : Math.PI,
      hp: 20, maxHp: 20, invulnerabilityTimer: 0, swapLockoutTimer: bot.swapLockoutTimer, weaponReadyTimer: 0,
      slideActive: kind === 'sliding', dashCooldownTimer: 2 });
    Object.assign(enemy, { id: target.id, controller: 'ai', pos: { ...target.pos }, vel: { ...target.vel }, hp: 20,
      maxHp: 20, invulnerabilityTimer: 0, weaponReadyTimer: 0, weapon: 'hammer', isJumping: target.isJumping });
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'absent'; sim.match.phase = 'playing';
    sim.combatants.push({ ...structuredClone(enemy), id: 'absent', controller: 'remote', team: actor.team,
      pos: { x: 40, y: 0, z: 0 }, alive: false, hp: 0, respawnTimer: 100 });
    const memory = () => ({ draws: 0, feints: 0, swapStarts: 0, observations: 0 });
    const lm = memory(), sm = memory(), rm = memory();
    const makeRequest = (m: typeof lm, own: typeof actor, other: typeof enemy, settings: typeof sim.settings): ScriptedAIGroundRequest => {
      const tuning = resolveBehaviorTuning(settings);
      return { targetId: other.id, targetMemory: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
        memory: { aiState: 'APPROACHING', timer: .8, weaponState: 'ready', isSprinting: false },
        policy: { activeWeapon: weapon, canStartWeaponAction: true, targetIsProtected: false,
          pressureTargetId: other.id, distanceToTarget: distance, attackDistanceToTarget: distance,
          resolvedDangerZone: 3, resolvedAiReach: 3, guaranteedKillRange: 3, minLungeRange: 4, maxLungeRange: 10,
          stationarySwingReach: 3, difficulty: 'hard', movementComplexity: 80, playstyleFactor: 1,
          tunedAnticipationFactor: .5, effectiveReactionLatency: .1, effectivePressureAggression: 50,
          cooldownMult: 1, swayTimer: 0, lookHeading: new THREE.Vector3(0, 0, sign),
          spatialLookHeading: new THREE.Vector3(0, 0, sign), sidewayHeading: new THREE.Vector3(-sign, 0, 0),
          spatialBias: { aggressionMult: 1 }, totalApproachLateral: 0, sprintMult: 1, isCrouching: false,
          feintChance: kind.includes('swap') || kind === 'fakeout' ? 1 : 0, feintLungeFakeout: false,
          psychEnabled: false, psychState: { standoffTimer: 1 }, matchMultipliers: { ...NEUTRAL_MATCH_MULTIPLIERS }, tuning,
          random: () => { m.draws++; return kind === 'declined' || kind === 'sliding' || kind === 'refused-swap' ? .99 : 0; },
          tryFeintRoll: scale => scale === .5 && kind.includes('swap') || scale === .55 && kind === 'fakeout',
          commitFeint: () => { m.feints++; }, isTargetOnCooldown: () => false, isCoordAttackBlocked: () => false, clearPressureTarget: noop },
        opportunity: { targetAirborne: kind === 'vertical-lunge', enemyInKillRange: near, selfGrounded: true,
          swordForbidden: false, hammerForbidden: false, swapLockoutRemaining: 0, swapFeintActive: false, comboActive: false,
          lungeDistanceToTarget: distance, hasVerticalLungeLine: true, combatDistanceToTarget: distance, aggressiveLungeMult: 1, tuning,
          startWeaponSwapFeintTimer: () => { m.swapStarts++; }, getTargetPlayerModel: () => null,
          recordCombatantObservation: () => { m.observations++; } } };
    };
    const request = makeRequest(lm, actor, enemy, live.settings), p = request.policy, o = request.opportunity!;
    const frame = { ...request.memory, pos: bot.pos, vel: bot.vel, dashDir: new THREE.Vector3(), dashRemaining: 0,
      dashCooldownTimer: 2 - dt, slideActive: kind === 'sliding', slideDistanceTraveled: 0, slideCooldownTimer: 0 };
    let liveOpportunity: ReturnType<typeof resolveAIGroundAttackOpportunityForCombatant>;
    const constrain = () => constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
    const advance = (state: typeof sim, m: typeof sm, tick: number) => stepSimulation(state, {}, { settings: state.settings, dt,
      ...(tick === 1 ? { scriptedActorDecisions: { version: 'scripted-actor-decision-v1' as const, scriptedBots: { [id]: 'hard' },
        prepare: () => 'engagement' as const, resolve: () => ({ kind: 'handled' as const,
          action: { ...idleAction(), aim: sign > 0 ? 0 : Math.PI }, ground: { version: 'scripted-ai-ground-v1' as const,
            resolve: () => makeRequest(m, state.combatants[0], state.combatants[1], state.settings) } }) } } : {}) });
    let restored = JSON.parse(JSON.stringify(sim));
    for (let tick = 1; tick <= 90; tick++) {
      withSimulationRandom(() => assert.fail('unexpected global RNG'), tick * dt, () => {
        f.weaponFrame(dt); f.gravityPrelude(bot, dt);
        if (tick === 1) {
          if (id !== 'main_ai') bot.swapLockoutTimer = Math.max(0, bot.swapLockoutTimer! - dt);
          liveOpportunity = resolveAIGroundAttackOpportunityForCombatant({ ...o, state: live, self: bot, frame, botId: id,
            target: { ...target, weaponState: target.weaponState!, isCrouching: false, activeWeapon: 'hammer', isLunging: false }, activeWeapon: p.activeWeapon,
            canStartWeaponAction: p.canStartWeaponAction, targetProtected: false, slideActive: frame.slideActive,
            cooldownMultiplier: 1, feintChance: p.feintChance, minLungeRange: 4, maxLungeRange: 10,
            distanceToTarget: distance, resolvedAiReach: 3, tunedAnticipationFactor: .5, playstyleFactor: 1,
            random: p.random, tryFeintRoll: p.tryFeintRoll, commitFeint: p.commitFeint,
            constrainCombatantToArena: constrain, triggerCombatantAttack: () => f.attack(),
            applyTacticalWeapon: requestedWeapon => {
              if (canApplyAITacticalWeaponSwap({ activeWeapon: p.activeWeapon, requestedWeapon, weaponState: frame.weaponState,
                swapLockoutTimer: bot.swapLockoutTimer!, swordForbidden: false, hammerForbidden: false })) {
                swapCombatantWeaponAction({ self: bot, settings: live.settings, type: requestedWeapon, setLockout: true, recordWeaponSwap: noop });
                p.activeWeapon = requestedWeapon; frame.weaponState = 'ready';
                if (live.settings.weaponReadyTime > 0) p.canStartWeaponAction = false;
              }
              return { activeWeapon: p.activeWeapon, weaponState: frame.weaponState, canStartWeaponAction: p.canStartWeaponAction };
            }, triggerCombatantLunge: (_self, dir) => triggerCombatantLungeAction({ self: bot, settings: live.settings,
              lungeDir: dir, pos: bot.pos, vel: bot.vel, playDash: noop }) });
          if (liveOpportunity.mode === 'continue') {
            assert.notEqual(liveOpportunity.activeWeapon, 'ball');
            resolveAIGroundState({ ...p, activeWeapon: liveOpportunity.activeWeapon as 'hammer' | 'sword',
              canStartWeaponAction: liveOpportunity.canStartWeaponAction, feintLungeFakeout: liveOpportunity.feintLungeFakeout,
              settings: live.settings, frame, target: { ...target, weaponState: target.weaponState! }, botId: id, botHP: bot.hp, dt, savedVelY: 0,
              startOffensiveHammerJump: () => assert.fail('unexpected jump'), playDash: noop, triggerCombatantAttack: () => f.attack() });
            constrain(); finishAIHorizontalMotion(bot, frame);
          }
        } else if (bot.isLunging) f.flight(dt);
        else { bot.vel.x = bot.vel.z = 0; }
        f.gravityPrelude(target, dt);
        f.visuals(dt);
      });
      const events = advance(sim, sm, tick), replay = advance(restored, rm, tick);
      assert.deepEqual(restored, sim); assert.deepEqual(replay, events); assert.deepEqual(rm, sm);
      if ([1, 4, 12].includes(tick)) restored = JSON.parse(JSON.stringify(restored));
      if (tick === 1) {
        const ground = events.actorDecisionFrame!.decisions[0].ground!;
        assert.deepEqual(ground.opportunity, liveOpportunity!); assert.deepEqual(sm, lm);
        assert.equal(ground.aiState, frame.aiState); assert.equal(ground.timer, frame.timer);
        assert.equal(actor.swapLockoutTimer, bot.swapLockoutTimer);
        assert.equal(actor.weaponReadyTimer, bot.swapCooldownTimer);
        if (['lunge', 'vertical-lunge', 'swap-lunge'].includes(kind)) {
          assert.equal(actor.isLunging, true); assert.equal(actor.lungeTimer, 0); assert.equal(actor.pos.z, 0);
          assert.equal(sm.observations, 1);
        }
        if (kind.startsWith('stationary')) assert.equal(actor.pos.z, 0, 'stationary attack must stop ground travel');
        if (kind === 'zero-lunge') { assert.equal(actor.isLunging, false); assert.equal(actor.pos.z, 0); assert.equal(sm.observations, 0); }
        if (kind === 'fakeout') { assert.equal(actor.isLunging, false); assert.ok(Math.abs(actor.pos.z) > 6 * dt); }
        if (kind === 'sliding') assert.ok(Math.abs(actor.pos.z) > 0, 'slide must continue without stationary attack');
      }
      for (const axis of ['x', 'y', 'z'] as const) for (const field of ['pos', 'vel'] as const)
        assert.ok(Math.abs(actor[field][axis] - bot[field][axis]) < 1e-7, `${tick}/${field}/${axis}: ${actor[field][axis]} vs ${bot[field][axis]}`);
      assert.equal(actor.weapon, bot.activeWeapon); assert.equal(actor.isLunging, !!bot.isLunging);
      assert.equal(enemy.hp, target.hp, `health at ${tick}`);
      assert.equal(observeSimTacticalWeaponTarget(sim, actor).weaponState, bot.weaponState, `phase at ${tick}`);
    }
    if (kind.startsWith('stationary') || ['lunge', 'vertical-lunge', 'swap-lunge'].includes(kind))
      assert.ok(enemy.hp < 20, 'chosen attack must cause real damage within the original 90-frame window');
  });
