import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAIGroundState } from '../../src/game/aiGroundState';
import { resolveAIGroundMovementPrelude } from '../../src/game/aiGroundMovementPrelude';
import { resolveAIGroundMovementPreludeForCombatant } from '../../src/components/grifball/aiGroundMovementPreludeRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { finishAIHorizontalMotion } from '../../src/game/aiDashMotion';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { NEUTRAL_MATCH_MULTIPLIERS } from '../../src/game/aiTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { observeSimTacticalWeaponTarget } from '../../src/sim/grifballTacticalWeaponChoice';
import type { ScriptedAIGroundPolicy } from '../../src/sim/scriptedAIGround';
import type { AIBehaviorState } from '../../src/types';

const noop = () => {};
const referencePath = '../../output/ground-navigation-reference';
const livePrelude = process.env.M7_GROUND_NAV_REFERENCE
  ? (await import(referencePath)).resolveAIGroundMovementPreludeForCombatant : resolveAIGroundMovementPreludeForCombatant;
const kinds = ['approach', 'slide', 'sidestep', 'forward', 'backward', 'charge', 'pressure', 'blocked-pressure',
  'cooldown', 'ground-jump', 'pending-dash', 'airborne', 'wall-approach', 'wall-slide'] as const;
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const weapon of ['hammer', 'sword'] as const) for (const kind of kinds)
  test(`scheduled ground execution ${id}/${sign}/${dt}/${weapon}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { maxHP: 20, weaponReadyTime: 0,
      enableSlide: kind.endsWith('slide'), slideDistance: 1.25, slideCooldown: .3, aiTuneSlideTriggerChance: 1,
      hammerSlamWindupTime: .08, hammerSlamAttackTime: .04, swordSlashSpeed: .12, attackRadius: 2 }));
    const { bot, target, sim, state: live, map } = f;
    if (kind.startsWith('wall')) {
      map.objects.push({ id: 'ground-route-wall', name: 'Ground route wall', type: 'box', position: { x: 0, y: 1.5, z: sign * 6 },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 1 }, color: '#888888', metalness: 0,
        roughness: 1, opacity: 1, transparent: false, emissive: '#000000', emissiveIntensity: 0, isCollidable: true, texture: 'none' });
      sim.map = structuredClone(map);
    }
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'absent'; sim.match.phase = 'playing';
    const actor = sim.combatants[0], enemy = sim.combatants[1];
    actor.id = bot.id; enemy.id = target.id; actor.controller = enemy.controller = 'ai';
    actor.weapon = bot.activeWeapon = weapon; enemy.weapon = target.activeWeapon = 'hammer';
    actor.hp = actor.maxHp = bot.hp = bot.maxHp = enemy.hp = enemy.maxHp = target.hp = target.maxHp = 20;
    bot.pos.set(0, kind === 'airborne' ? 2 : 0, 0); bot.vel.set(0, kind === 'airborne' ? 3 : 0, 0);
    const startingDistance = ['charge', 'pressure', 'blocked-pressure'].includes(kind) ? 2 : kind === 'ground-jump' ? 7 : 12;
    target.pos.set(0, 0, sign * startingDistance); target.vel.set(0, 0, 0);
    actor.pos = { ...bot.pos }; actor.vel = { ...bot.vel }; enemy.pos = { ...target.pos }; enemy.vel = { ...target.vel };
    actor.yaw = sign > 0 ? 0 : Math.PI; bot.yaw = sign > 0 ? Math.PI : 0;
    actor.invulnerabilityTimer = enemy.invulnerabilityTimer = 0;
    actor.isJumping = bot.isJumping = kind === 'airborne'; actor.grounded = !actor.isJumping;
    sim.combatants.push({ ...structuredClone(enemy), id: 'absent', controller: 'remote', team: actor.team,
      pos: { x: 40, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, alive: false, hp: 0, respawnTimer: 100 });
    bot.aiDashRemaining = actor.dashRemaining = kind === 'pending-dash' ? .1 : 0;
    bot.aiDashDir = { x: 0, y: 0, z: sign }; actor.dashDir = { ...bot.aiDashDir };
    bot.aiDashCooldownTimer = actor.dashCooldownTimer = 2;
    const initial: AIBehaviorState = kind.includes('pressure') ? 'PRESSURING' : kind === 'charge' ? 'CHARGE_ATTACK'
      : kind === 'sidestep' ? 'SIDE_STEPPING' : kind === 'forward' ? 'DANCING_FORWARD'
      : kind === 'backward' ? 'DANCING_BACKWARD' : kind === 'cooldown' ? 'COOLDOWN' : 'APPROACHING';
    const memory = () => ({ aiState: initial as AIBehaviorState | undefined, timer: .8 as number | undefined,
      sway: 0, standoff: 1, pendingPostEvasionCharge: false, draws: 0 });
    const lm = memory(), sm = memory(), rm = memory();
    const nav = {}, replayNav = {};
    let restored = JSON.parse(JSON.stringify(sim)), attacks = 0, jumps = 0, groundCalls = 0, maximumSide = 0;
    const liveFrame = { pos: bot.pos, vel: bot.vel, dashDir: new THREE.Vector3(0, 0, sign), aiState: lm.aiState,
      timer: lm.timer, weaponState: bot.weaponState!, dashRemaining: actor.dashRemaining, dashCooldownTimer: actor.dashCooldownTimer,
      slideActive: false, slideDistanceTraveled: 0, slideCooldownTimer: 0, isSprinting: false };
    const buildPolicy = (m: typeof lm, own: { pos: THREE.Vector3; vel: THREE.Vector3 }, other: typeof own,
      settings: typeof sim.settings, phase: string, crouch: boolean, sliding: boolean, navigation: object, liveHost = false, sourceMap = map) => {
      const distance = Math.hypot(other.pos.x - own.pos.x, other.pos.z - own.pos.z), tuning = resolveBehaviorTuning(settings);
      const parameters = { pos: own.pos, movementTargetPos: other.pos, predictedTargetPos: other.pos,
        target: other, activeCustomMap: sourceMap, spatialIQ: 80, edgeInset: tuning.arenaEdgeInset, aiState: m.aiState,
        distanceToTarget: distance, resolvedDangerZone: 3, isCrouching: crouch, slideActive: sliding,
        sprintEngageGap: tuning.sprintEngageGap, sprintChaseTargetSpeed: tuning.sprintChaseTargetSpeed };
      const prelude = liveHost ? livePrelude({ ...parameters, state: live, refs: f.refs })
        : resolveAIGroundMovementPrelude({ ...parameters, settings, arenaRadius: sourceMap.arenaRadius, navigation });
      const policy: ScriptedAIGroundPolicy = { pressureTargetId: target.id, distanceToTarget: distance, attackDistanceToTarget: own.pos.distanceTo(other.pos),
        resolvedDangerZone: 3, resolvedAiReach: 3, guaranteedKillRange: 3, maxLungeRange: 10, minLungeRange: 4,
        stationarySwingReach: 3, activeWeapon: weapon, canStartWeaponAction: phase === 'ready' && !(m.aiState === 'COOLDOWN' && m.timer! > 0),
        targetIsProtected: false, difficulty: 'hard', movementComplexity: 80, playstyleFactor: 1,
        tunedAnticipationFactor: .5, effectiveReactionLatency: .1, effectivePressureAggression: 50,
        cooldownMult: 1, swayTimer: m.sway, lookHeading: prelude.lookHeading, spatialLookHeading: prelude.spatialLookHeading,
        sidewayHeading: prelude.sidewayHeading, spatialBias: prelude.spatialBias, totalApproachLateral: 0,
        sprintMult: prelude.sprintMult, isCrouching: crouch, feintChance: 0, feintLungeFakeout: false,
        psychEnabled: false, psychState: { standoffTimer: m.standoff }, matchMultipliers: { ...NEUTRAL_MATCH_MULTIPLIERS }, tuning,
        tryFeintRoll: () => false, commitFeint: noop, isTargetOnCooldown: () => false,
        isCoordAttackBlocked: () => kind === 'blocked-pressure', clearPressureTarget: noop,
        random: () => { m.draws++; return kind === 'ground-jump' && m.draws === 1 || kind.endsWith('slide') ? 0 : .99; } };
      return { policy, isSprinting: prelude.isSprinting };
    };
    for (let tick = 1; tick <= 180; tick++) {
      withSimulationRandom(() => assert.fail('ground owner leaked global randomness'), tick * dt, () => {
        f.weaponFrame(dt); f.gravityPrelude(bot, dt);
        bot.yaw = Math.atan2(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z) + Math.PI;
        liveFrame.dashCooldownTimer = Math.max(0, liveFrame.dashCooldownTimer! - dt);
        liveFrame.slideCooldownTimer = Math.max(0, liveFrame.slideCooldownTimer - dt); liveFrame.isSprinting = false;
        lm.timer! -= dt; lm.sway += dt;
        liveFrame.aiState = lm.aiState; liveFrame.timer = lm.timer; liveFrame.weaponState = bot.weaponState!;
        const savedY = bot.vel.y;
        const constrain = () => constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
        if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt, movementComplexity: 80, swayTimer: lm.sway,
          toTarget: target.pos.clone().sub(bot.pos), recoverCombatantAltitude: () => false, constrainCombatantToArena: constrain }) === 'continue') {
          if (liveFrame.dashRemaining! > 0) {
            const dashFrame = { ...liveFrame, pendingPostEvasionCharge: lm.pendingPostEvasionCharge };
            resolveAIDashMovementForCombatant({ state: live, refs: f.refs, frame: dashFrame, dt, activeWeapon: weapon,
              targetWeaponState: target.weaponState!, attackDistanceToTarget: bot.pos.distanceTo(target.pos), resolvedAiReach: 3,
              targetProtected: false, spatialIQ: 80, weaponReady: bot.weaponState === 'ready' });
            Object.assign(liveFrame, dashFrame); lm.pendingPostEvasionCharge = dashFrame.pendingPostEvasionCharge;
          } else {
            const built = buildPolicy(lm, bot, target, live.settings, bot.weaponState!, false, liveFrame.slideActive, f.refs, true);
            liveFrame.isSprinting = built.isSprinting;
            resolveAIGroundState({ ...built.policy, settings: live.settings, frame: liveFrame, botId: id, botHP: bot.hp, dt, savedVelY: savedY,
              target: { id: target.id, hp: target.hp, weaponState: target.weaponState, invulnerabilityTimer: 0 },
              startOffensiveHammerJump: heading => { jumps++; return startAIHammerJumpForCombatant({ self: bot, settings: live.settings, vel: bot.vel,
                horizontalHeading: heading, jumpType: 'offensive', playJump: noop, playSwing: noop,
                onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot) }); },
              playDash: noop, triggerCombatantAttack: () => { attacks++; f.attack(); } });
            lm.standoff = built.policy.psychState.standoffTimer;
          }
          constrain(); finishAIHorizontalMotion(bot, liveFrame);
        }
        lm.aiState = liveFrame.aiState; lm.timer = liveFrame.timer;
        bot.aiDashRemaining = liveFrame.dashRemaining; bot.aiDashCooldownTimer = liveFrame.dashCooldownTimer;
        bot.aiSlideActive = liveFrame.slideActive; bot.aiSlideDistanceTraveled = liveFrame.slideDistanceTraveled;
        f.visuals(dt);
      });
      const advance = (own: typeof sim, m: typeof sm, navigation: object) => {
        const events = stepSimulation(own, {}, { settings: own.settings, dt, scriptedActorDecisions: {
          version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'hard' }, prepare: () => 'engagement',
          resolve: ({ state: current }) => {
            m.timer! -= dt; m.sway += dt;
            const self = current.combatants[0], rival = current.combatants[1];
            return { kind: 'handled', action: { ...idleAction(), aim: Math.atan2(rival.pos.x - self.pos.x, rival.pos.z - self.pos.z) },
              ...(self.dashRemaining > 0 ? { dash: { version: 'scripted-ai-dash-v1' as const, aiState: m.aiState,
                pendingPostEvasionCharge: m.pendingPostEvasionCharge, target: { targetWeaponState: 'ready',
                  attackDistanceToTarget: Math.hypot(rival.pos.x - self.pos.x, rival.pos.y - self.pos.y, rival.pos.z - self.pos.z),
                  resolvedAiReach: 3, targetProtected: false, spatialIQ: 80, weaponReady: self.weaponState === 'idle' } } } : {}),
              ground: { version: 'scripted-ai-ground-v1', resolve: ({ state: grounded, motionPhase }) => {
                assert.equal(motionPhase, 'after-engagement-recovery'); groundCalls++;
                const actor = grounded.combatants[0], enemy = grounded.combatants[1], toVec = (c: typeof actor) => ({
                  pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), vel: new THREE.Vector3(c.vel.x, c.vel.y, c.vel.z) });
                const phase = observeSimTacticalWeaponTarget(grounded, actor).weaponState;
                const built = buildPolicy(m, toVec(actor), toVec(enemy), grounded.settings, phase, actor.isCrouching, actor.slideActive, navigation, false, grounded.map);
                return { targetId: enemy.id, targetMemory: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
                  memory: { aiState: m.aiState, timer: m.timer, weaponState: phase as typeof liveFrame.weaponState, isSprinting: built.isSprinting }, policy: built.policy };
              } },
            };
          },
        } });
        const record = events.actorDecisionFrame!.decisions[0];
        if (record.ground) { m.aiState = record.ground.aiState; m.timer = record.ground.timer; m.standoff = record.ground.standoffTimer; }
        if (record.dash) Object.assign(m, record.dash);
        return events;
      };
      const events = advance(sim, sm, nav), replay = advance(restored, rm, replayNav);
      assert.deepEqual(restored, sim); assert.deepEqual(replay, events); assert.deepEqual(rm, sm);
      if ([4, 12, 100].includes(tick)) {
        restored = JSON.parse(JSON.stringify(restored));
        for (const key of Object.keys(replayNav)) delete replayNav[key as keyof typeof replayNav];
      }
      assert.deepEqual(sm, lm, `memory at ${tick}`);
      for (const axis of ['x', 'y', 'z'] as const) for (const field of ['pos', 'vel'] as const)
        assert.ok(Math.abs(actor[field][axis] - bot[field][axis]) < 1e-7, `${tick}/${field}/${axis}: ${actor[field][axis]} vs ${bot[field][axis]}`);
      assert.equal(actor.hp, bot.hp); assert.equal(enemy.hp, target.hp, `target health ${tick}`);
      assert.equal(observeSimTacticalWeaponTarget(sim, actor).weaponState, bot.weaponState, `weapon phase ${tick}`);
      for (const weapon of ['Hammer', 'Sword'] as const) {
        const stamp = bot[`last${weapon}AttackTime`] ?? 0;
        if (stamp > 0) assert.ok(Math.abs((actor[`last${weapon}AttackTimeMs`] ?? -1) - (stamp - 1_000_000)) < 1e-7, `attack timestamp ${tick}/${weapon}`);
      }
      assert.equal(actor.dashRemaining, liveFrame.dashRemaining); assert.equal(actor.slideActive, liveFrame.slideActive);
      assert.equal(actor.aiSlideDistanceTraveled ?? 0, liveFrame.slideDistanceTraveled);
      assert.equal(actor.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0);
      maximumSide = Math.max(maximumSide, Math.abs(actor.pos.x));
      if (kind.startsWith('wall') && actor.pos.y < 3)
        assert.ok(!(Math.abs(actor.pos.x) < 1.5 && Math.abs(actor.pos.z - sign * 6) < .5), 'ground route must not enter the wall');
      if (tick === 1 && ['airborne', 'pending-dash'].includes(kind)) assert.equal(groundCalls, 0, 'recovery/dash must skip ground policy');
    }
    if (['charge', 'pressure'].includes(kind)) { assert.ok(attacks > 0); assert.ok(target.hp < 20, 'ground attacks must cause actual damage'); }
    if (kind === 'ground-jump') assert.ok(jumps > 0);
    assert.ok(groundCalls > 0);
    if (kind.startsWith('wall')) assert.ok(maximumSide > 1.5, 'route must actually go around the wall');
  });
