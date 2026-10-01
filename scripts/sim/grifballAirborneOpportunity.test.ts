import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAILungeEvasionForCombatant } from '../../src/components/grifball/aiLungeEvasionRuntime';
import { resolveAIAirborneHammerOpportunityForCombatant } from '../../src/components/grifball/aiAirborneHammerOpportunityRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { finishAIHorizontalMotion } from '../../src/game/aiDashMotion';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { resolveSimGrifballEvasionInput } from '../../src/sim/grifballEvasionInput';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import type { AIBehaviorState } from '../../src/types';
import type { ScriptedCombatCommand } from '../../src/sim/scriptedCombatInput';

const noop = () => {};
const kinds = ['reach', 'vertical', 'decline-reach-then-jump', 'decline', 'protected', 'easy', 'low-complexity',
  'unready', 'evasion-hop-jump', 'evasion-dash-jump', 'evasion-double-counter', 'exhausted'] as const;
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30]) for (const kind of kinds)
  test(`airborne opportunity execution ${id}/${sign}/${dt}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04,
      swordLungeSpeed: 24, attackRadius: 2, aiTuneHammerWindupSeconds: .32, weaponReadyTime: 0,
      hammerJumpAirLimit: kind === 'exhausted' ? 0 : 1, enableSwordTrade: false, enableHammerSwordTrade: false }));
    const { bot, target, state, sim, map } = f, [actor, enemy] = sim.combatants;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
    actor.id = id; enemy.id = target.id; actor.controller = enemy.controller = 'ai';
    bot.activeWeapon = actor.weapon = 'hammer'; target.activeWeapon = enemy.weapon = 'sword';
    bot.hp = bot.maxHp = actor.hp = actor.maxHp = 20; target.hp = target.maxHp = enemy.hp = enemy.maxHp = 20;
    bot.pos.set(0, 0, 0); bot.vel.set(0, 0, 0); actor.pos = { ...bot.pos }; actor.vel = { ...bot.vel };
    const evading = kind.startsWith('evasion'), doubleCounter = kind === 'evasion-double-counter';
    const distance = doubleCounter ? 8 : kind === 'reach' ? 2 : 4;
    target.pos.set(0, kind === 'reach' ? 1 : doubleCounter ? 2 : 5, sign * distance);
    target.vel.set(0, ['reach', 'decline-reach-then-jump', 'decline'].includes(kind) || doubleCounter ? -1 : 2, 0);
    enemy.pos = { ...target.pos }; enemy.vel = { ...target.vel }; target.isJumping = enemy.isJumping = true; enemy.grounded = false;
    target.isLunging = enemy.isLunging = evading; target.lungeTimer = enemy.lungeTimer = 0;
    target.lungeStartPos = enemy.lungeStartPos = { ...enemy.pos }; enemy.lungeTargetId = id;
    target.lungeTargetDir = enemy.lungeDir = { x: 0, y: 0, z: -sign };
    bot.yaw = sign > 0 ? Math.PI : 0; actor.yaw = sign > 0 ? 0 : Math.PI;
    actor.invulnerabilityTimer = actor.weaponReadyTimer = actor.swapLockoutTimer = 0;
    target.invulnerabilityTimer = enemy.invulnerabilityTimer = kind === 'protected' ? 10 : 0;
    actor.dashCooldownTimer = kind === 'evasion-dash-jump' || doubleCounter ? 0 : 10;
    sim.combatants.push({ ...structuredClone(enemy), id: 'player', controller: 'remote', team: actor.team,
      isLunging: false, isJumping: false, pos: { x: -30, y: 0, z: -30 }, vel: { x: 0, y: 0, z: 0 } });
    const difficulty = kind === 'easy' ? 'easy' : 'normal';
    const airContext = { targetAirborne: true, movementComplexity: kind === 'low-complexity' ? 49 : 80,
      resolvedDangerZone: doubleCounter ? 6 : 3, tunedAnticipationFactor: 0, enemyInKillRange: kind === 'reach',
      verticalDeltaToTarget: target.pos.y };
    const randomFor = (draw: number) => kind === 'decline' ? .99 : ['decline-reach-then-jump', 'evasion-hop-jump'].includes(kind) && draw === 1 ? .99 : .01;
    let liveDraws = 0, simDraws = 0, replayDraws = 0, attacks = 0, jumps = 0;
    let remaining = 0, cooldown = actor.dashCooldownTimer;
    const direction = new THREE.Vector3();
    const liveMemory = { aiState: 'APPROACHING' as AIBehaviorState | undefined, timer: 0 as number | undefined, pendingPostEvasionCharge: false };
    const simMemory = { ...liveMemory }, replayMemory = { ...liveMemory };
    let restored = JSON.parse(JSON.stringify(sim)), firstCommands: ScriptedCombatCommand[] = [];
    let liveFirst: { aiState: AIBehaviorState | undefined; timer: number | undefined; weaponState: string };
    for (let tick = 1; tick <= 180; tick++) {
      withSimulationRandom(() => assert.fail('explicit airborne stream leaked global RNG'), tick * dt, () => {
        f.weaponFrame(dt); f.gravityPrelude(bot, dt); cooldown = Math.max(0, cooldown - dt);
        if (tick === 1) {
          bot.aiDashRemaining = remaining;
          const frame = { ...liveMemory, pos: bot.pos, vel: bot.vel, dashDir: direction,
            dashRemaining: remaining, dashCooldownTimer: cooldown, weaponState: 'ready' as const };
          const common = { state, self: bot, target: { ...target, weaponState: 'ready' as const, isLunging: evading, isCrouching: false },
            toTarget: target.pos.clone().sub(bot.pos).setY(0), distanceToTarget: distance,
            combatDistanceToTarget: bot.pos.distanceTo(target.pos), resolvedAiReach: 3, difficulty,
            activeWeapon: 'hammer' as const, canStartWeaponAction: kind !== 'unready', cooldownMultiplier: .75,
            tuning: resolveBehaviorTuning(state.settings), random: () => randomFor(++liveDraws),
            triggerCombatantAttack: () => { attacks++; f.attack(); },
            startAIHammerJump: (self: typeof bot, _pos: THREE.Vector3, vel: THREE.Vector3, heading?: THREE.Vector3, jumpType?: 'offensive' | 'defensive') => {
              jumps++; return startAIHammerJumpForCombatant({ self, settings: state.settings, vel, horizontalHeading: heading, jumpType,
                onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(self), playSwing: noop, playJump: noop });
            } };
          const evasion = resolveAILungeEvasionForCombatant({ ...common, frame, botId: id, dt, targetIsProtected: target.invulnerabilityTimer! > 0,
            targetIsLunging: evading, defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, calibrationEnabled: false, bulltrueCounter: null,
            getTargetPlayerModel: () => null, mainAI: state.otherPlayers.get('main_ai'), spawnVoxelShockwaveParticles: noop,
            recordCombatantObservation: noop, playDash: noop, playJump: noop });
          const airborne = resolveAIAirborneHammerOpportunityForCombatant({ ...common, ...airContext,
            targetProtected: target.invulnerabilityTimer! > 0, frame: { pos: bot.pos, vel: bot.vel,
              aiState: evasion.aiState, timer: evasion.timer, weaponState: evasion.weaponState } });
          liveFirst = airborne; Object.assign(liveMemory, { aiState: airborne.aiState, timer: airborne.timer,
            pendingPostEvasionCharge: evasion.pendingPostEvasionCharge }); remaining = frame.dashRemaining; cooldown = frame.dashCooldownTimer;
        }
        const constrain = () => constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
        if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt, movementComplexity: 0, swayTimer: 0,
          toTarget: target.pos.clone().sub(bot.pos), recoverCombatantAltitude: () => false, constrainCombatantToArena: constrain }) === 'continue') {
          if (remaining > 0) {
            const motion = { ...liveMemory, pos: bot.pos, vel: bot.vel, dashDir: direction, dashRemaining: remaining,
              slideActive: false, slideCooldownTimer: 0, isSprinting: false };
            resolveAIDashMovementForCombatant({ state, refs: f.refs, frame: motion, dt, activeWeapon: bot.activeWeapon,
              targetWeaponState: target.weaponState!, attackDistanceToTarget: bot.pos.distanceTo(target.pos), resolvedAiReach: 3,
              targetProtected: target.invulnerabilityTimer! > 0, spatialIQ: 80, weaponReady: bot.weaponState === 'ready' });
            remaining = motion.dashRemaining; liveMemory.aiState = motion.aiState; liveMemory.pendingPostEvasionCharge = motion.pendingPostEvasionCharge;
            constrain(); finishAIHorizontalMotion(bot, motion);
          } else bot.vel.set(0, 0, 0);
        }
        if (target.isLunging) f.targetFlight(dt); else f.gravityPrelude(target, dt);
        f.visuals(dt);
      });
      const advance = (own: typeof sim, memory: typeof simMemory, random: () => number) => {
        const events = stepSimulation(own, {}, { settings: own.settings, dt, scriptedActorDecisions: {
          version: 'scripted-actor-decision-v1', scriptedBots: { [id]: difficulty }, prepare: () => 'engagement',
          resolve: ({ state: current }) => {
            const self = current.combatants[0], rival = current.combatants[1];
            if (tick === 1) {
              const before = structuredClone(current);
              const decision = resolveSimGrifballEvasionInput(current, id, { [id]: difficulty }, {
                [id]: { aiState: memory.aiState, timer: memory.timer, cooldownMultiplier: .75 },
                [rival.id]: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
              }, { motionPhase: 'after-engagement-gravity', observation: { targetId: rival.id,
                distanceToTarget: Math.hypot(rival.pos.x - self.pos.x, rival.pos.z - self.pos.z),
                combatDistanceToTarget: Math.hypot(rival.pos.x - self.pos.x, rival.pos.y - self.pos.y, rival.pos.z - self.pos.z),
                toTarget: { x: rival.pos.x - self.pos.x, z: rival.pos.z - self.pos.z }, resolvedAiReach: 3 },
                weaponFrame: { activeWeapon: 'hammer', weaponState: 'ready', canStartWeaponAction: kind !== 'unready',
                  readinessRemaining: 0, observedSwapLockout: 0, currentSwapLockout: 0 }, pendingPostEvasionCharge: memory.pendingPostEvasionCharge,
                bulltrueCounter: null, defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, random, airborneOpportunity: airContext }, dt)!;
              assert.deepEqual(current, before);
              for (const key of ['aiState', 'timer', 'weaponState'] as const) assert.equal(decision.frame[key], liveFirst[key]);
              firstCommands = decision.commands; memory.aiState = decision.frame.aiState; memory.timer = decision.frame.timer;
              memory.pendingPostEvasionCharge = decision.frame.pendingPostEvasionCharge;
              return { kind: 'handled', action: { ...idleAction(), aim: self.yaw }, ...decision };
            }
            return { kind: 'handled', action: { ...idleAction(), aim: self.yaw }, ...(self.dashRemaining > 0 ? {
              dash: { version: 'scripted-ai-dash-v1', aiState: memory.aiState, pendingPostEvasionCharge: memory.pendingPostEvasionCharge,
                target: { targetWeaponState: 'ready', attackDistanceToTarget: Math.hypot(rival.pos.x - self.pos.x, rival.pos.z - self.pos.z),
                  resolvedAiReach: 3, targetProtected: rival.invulnerabilityTimer > 0, spatialIQ: 80, weaponReady: self.weaponState === 'idle' } } } : {}) };
          } } });
        if (events.actorDecisionFrame!.decisions[0].dash) Object.assign(memory, events.actorDecisionFrame!.decisions[0].dash);
        return events;
      };
      const events = advance(sim, simMemory, () => randomFor(++simDraws)), replay = advance(restored, replayMemory, () => randomFor(++replayDraws));
      assert.deepEqual(restored, sim); assert.deepEqual(replay, events); assert.deepEqual(replayMemory, simMemory);
      if ([4, 12, 100].includes(tick)) restored = JSON.parse(JSON.stringify(restored));
      assert.deepEqual(simMemory, liveMemory); assert.equal(simDraws, liveDraws); assert.equal(replayDraws, simDraws);
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(actor.pos[axis] - bot.pos[axis]) < 1e-7, `position ${tick}/${axis}: ${actor.pos[axis]} vs ${bot.pos[axis]}`);
        assert.ok(Math.abs(actor.vel[axis] - bot.vel[axis]) < 1e-7, `velocity ${tick}/${axis}: ${actor.vel[axis]} vs ${bot.vel[axis]}`);
      }
      assert.equal(actor.hp, bot.hp); assert.equal(enemy.hp, target.hp); assert.equal(actor.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0);
      assert.equal(!!actor.hammerJumpPlanned, !!bot.hammerJumpPlanned); assert.equal(actor.hammerJumpType, bot.hammerJumpType);
      assert.equal(actor.dashRemaining, remaining);
      if (tick === 1) {
        assert.equal(firstCommands.filter(c => c.kind === 'melee').length, attacks);
        assert.equal(firstCommands.filter(c => c.kind === 'hammer-jump').length, jumps);
        if (doubleCounter) assert.equal(attacks, 2, 'both live priorities trigger a hammer counter');
      }
    }
    if (kind === 'reach') { assert.equal(attacks, 1); assert.equal(target.hp, 19, 'selected opportunity must produce real damage'); }
    if (['vertical', 'decline-reach-then-jump', 'evasion-hop-jump', 'evasion-dash-jump'].includes(kind)) assert.equal(jumps, 1);
    if (['decline', 'protected', 'easy', 'low-complexity', 'unready'].includes(kind)) assert.equal(attacks + jumps, 0);
    assert.equal(actor.pos.y, 0); assert.equal(actor.isJumping, false); assert.equal(actor.hammerJumpsInAir, 0);
  });
