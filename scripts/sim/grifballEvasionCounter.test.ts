import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAILungeEvasionForCombatant } from '../../src/components/grifball/aiLungeEvasionRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { startAIHammerJumpForCombatant, swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { resolveAILungeEvasionDecision, type AILungeEvasionFrame } from '../../src/game/aiLungeEvasionDecision';
import { resolveSimGrifballEvasionInput } from '../../src/sim/grifballEvasionInput';
import { finishAIHorizontalMotion } from '../../src/game/aiDashMotion';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { type ScriptedAIMobilityCommand } from '../../src/sim/scriptedAIMobility';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import type { ScriptedCombatCommand } from '../../src/sim/scriptedCombatInput';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';

const noop = () => {};
const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const cases = ['hammer', 'sword', 'air-counter', 'air-falling-counter', 'hop-counter', 'air-hop-counter', 'dash-counter', 'moving-counter', 'revert-hop-counter', 'swap-counter', 'hammer-jump', 'jump-rejected-counter'] as const;
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30]) for (const kind of cases)
  test(`evasion counter execution ${id}/${sign}/${dt}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { swordLungeSpeed: 24, attackRadius: 2, aiTuneHammerWindupSeconds: .32,
      hammerJumpAirLimit: kind === 'jump-rejected-counter' ? 0 : 1, weaponReadyTime: 0, weaponSwapLockout: 0, enableSwordTrade: false, enableHammerSwordTrade: false }));
    const { bot, target, sim, state, map } = f, [self, rival] = sim.combatants;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
    self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
    const airVelocity = kind === 'air-falling-counter' ? -3 : 3;
    const airborne = kind.startsWith('air'), timed = kind.includes('hop') || kind === 'dash-counter' || kind === 'hammer-jump' || kind === 'jump-rejected-counter';
    const weapon = kind === 'sword' ? 'sword' : 'hammer';
    bot.activeWeapon = self.weapon = kind.startsWith('revert') || kind.startsWith('swap') ? 'sword' : weapon;
    target.activeWeapon = rival.weapon = 'sword'; bot.hp = bot.maxHp = self.hp = self.maxHp = rival.hp = rival.maxHp = 20;
    bot.pos.set(0, airborne ? 1 : 0, 0); bot.vel.set(0, airborne ? airVelocity : 0, 0);
    bot.isJumping = self.isJumping = airborne; self.grounded = !airborne;
    self.pos = { ...bot.pos }; self.vel = { ...bot.vel };
    bot.yaw = sign > 0 ? Math.PI : 0; self.yaw = sign > 0 ? 0 : Math.PI;
    target.pos.set(0, airborne ? 1 : 0, sign * (timed ? 8 : kind === 'sword' ? 2 : 3)); rival.pos = { ...target.pos };
    target.vel.set(0, airborne ? airVelocity : 0, 0); rival.vel = { ...target.vel };
    target.isJumping = rival.isJumping = airborne;
    target.isLunging = rival.isLunging = true; target.lungeTimer = rival.lungeTimer = 0;
    target.lungeTargetDir = rival.lungeDir = { x: 0, y: 0, z: -sign };
    target.lungeStartPos = rival.lungeStartPos = { ...rival.pos }; rival.lungeTargetId = id;
    self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = self.swapLockoutTimer = 0;
    self.dashCooldownTimer = timed && kind !== 'dash-counter' ? 10 : 0;
    self.dashRemaining = kind === 'moving-counter' ? .2 : 0; self.dashDir = { x: sign, y: 0, z: 0 };
    sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: self.team,
      isLunging: false, isJumping: false, pos: { x: -30, y: 0, z: -30 } });
    const restored = JSON.parse(JSON.stringify(sim));
    const simMemory = { aiState: 'APPROACHING' as import('../../src/types').AIBehaviorState | undefined }, replayMemory = { ...simMemory };
    let liveRemaining = self.dashRemaining, liveCooldown = self.dashCooldownTimer;
    const liveDirection = vec(self.dashDir); let liveDecision: ReturnType<typeof resolveAILungeEvasionDecision>;
    let liveDraws = 0, simDraws = 0, replayDraws = 0, selectedCommands: ScriptedCombatCommand[] = [];
    for (let tick = 1; tick <= (kind === 'hammer-jump' ? 180 : 120); tick++) {
      withSimulationRandom(() => { liveDraws++; return ['dash-counter', 'hammer-jump', 'jump-rejected-counter'].includes(kind) ? .01 : .99; }, tick * dt, () => {
        f.weaponFrame(dt); f.gravityPrelude(bot, dt); liveCooldown = Math.max(0, liveCooldown - dt);
        if (tick === 1) {
          if (kind.startsWith('revert') || kind.startsWith('swap')) {
            swapCombatantWeaponAction({ self: bot, settings: state.settings, type: 'hammer', setLockout: kind.startsWith('swap'), recordWeaponSwap: noop });
            if (kind.startsWith('revert')) bot.swapLockoutTimer = 0;
          }
          const frame: AILungeEvasionFrame = { pos: bot.pos, vel: bot.vel, dashDir: liveDirection, aiState: 'APPROACHING', timer: 0,
            dashRemaining: liveRemaining, dashCooldownTimer: liveCooldown, pendingPostEvasionCharge: false, weaponState: 'ready' };
          const distance = bot.pos.distanceTo(target.pos);
          liveDecision = resolveAILungeEvasionForCombatant({ state, self: bot, frame, botId: id,
            target: { ...target, weaponState: 'ready', isLunging: true, isCrouching: false }, toTarget: target.pos.clone().sub(bot.pos),
            distanceToTarget: distance, combatDistanceToTarget: distance, resolvedAiReach: 3, targetIsProtected: false, targetIsLunging: true,
            dt, difficulty: 'normal', defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, activeWeapon: weapon, canStartWeaponAction: true,
            cooldownMultiplier: .75, calibrationEnabled: false, bulltrueCounter: timed ? null : weapon,
            getTargetPlayerModel: () => null, mainAI: state.otherPlayers.get('main_ai'), triggerCombatantAttack: () => f.attack(),
            startAIHammerJump: (jumpSelf, _pos, vel, heading, jumpType) => startAIHammerJumpForCombatant({ self: jumpSelf,
              settings: state.settings, vel, horizontalHeading: heading, jumpType,
              onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(jumpSelf), playSwing: noop, playJump: noop }), spawnVoxelShockwaveParticles: noop, recordCombatantObservation: noop, playDash: noop, playJump: noop,
            tuning: resolveBehaviorTuning(state.settings) });
          liveRemaining = frame.dashRemaining; liveCooldown = frame.dashCooldownTimer;
        }
        const constrain = () => { constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius }); };
        if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt, movementComplexity: 0, swayTimer: 0,
          toTarget: target.pos.clone().sub(bot.pos), recoverCombatantAltitude: () => false, constrainCombatantToArena: constrain }) === 'continue') {
          if (liveRemaining > 0) {
            const movement = { pos: bot.pos, vel: bot.vel, dashDir: liveDirection, aiState: liveDecision!.aiState,
              dashRemaining: liveRemaining, slideActive: false, slideCooldownTimer: 0, isSprinting: false, pendingPostEvasionCharge: false };
            resolveAIDashMovementForCombatant({ state, refs: f.refs, frame: movement, dt, activeWeapon: bot.activeWeapon,
              targetWeaponState: target.weaponState!, attackDistanceToTarget: bot.pos.distanceTo(target.pos), resolvedAiReach: 3,
              targetProtected: false, spatialIQ: 80, weaponReady: bot.weaponState === 'ready' });
            liveRemaining = movement.dashRemaining; constrain(); finishAIHorizontalMotion(bot, movement);
          } else bot.vel.set(0, 0, 0);
        }
        if (target.isLunging) f.targetFlight(dt); else { f.gravityPrelude(target, dt); target.vel.x = target.vel.z = 0; }
        f.visuals(dt);
      });
      const advance = (current: typeof sim, memory: typeof simMemory, random: () => number) => stepSimulation(current, {}, { settings: current.settings, dt,
        scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' }, prepare: () => 'engagement',
          resolve: ({ state: own }) => {
            const actor = own.combatants.find(c => c.id === id)!, enemy = own.combatants.find(c => c.id === rival.id)!;
            const frame: AILungeEvasionFrame = { pos: vec(actor.pos), vel: vec(actor.vel), dashDir: vec(actor.dashDir), aiState: 'APPROACHING', timer: 0,
              dashRemaining: actor.dashRemaining, dashCooldownTimer: actor.dashCooldownTimer, pendingPostEvasionCharge: false, weaponState: 'ready' };
            let mobility: ScriptedAIMobilityCommand | undefined; const commands: ScriptedCombatCommand[] = [];
            if (tick === 1) {
              if (kind.startsWith('revert')) commands.push({ kind: 'revert-weapon-feint' });
              if (kind.startsWith('swap')) commands.push({ kind: 'swap', weapon: 'hammer' });
              const distance = frame.pos.distanceTo(vec(enemy.pos));
              const evasion = resolveSimGrifballEvasionInput(own, id, { [id]: 'normal' }, {
                [id]: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: .75 },
                [enemy.id]: { aiState: 'LUNGING', timer: 0, cooldownMultiplier: 1 },
              }, { motionPhase: 'after-engagement-gravity', observation: { targetId: enemy.id, distanceToTarget: distance,
                combatDistanceToTarget: distance, toTarget: { x: enemy.pos.x - actor.pos.x, z: enemy.pos.z - actor.pos.z }, resolvedAiReach: 3 },
                weaponFrame: { activeWeapon: weapon, weaponState: 'ready', canStartWeaponAction: true,
                  readinessRemaining: 0, observedSwapLockout: 0, currentSwapLockout: 0 },
                pendingPostEvasionCharge: false, bulltrueCounter: timed ? null : weapon,
                defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, random }, dt)!;
              const result = evasion.frame; commands.push(...evasion.commands); mobility = evasion.mobility;
              frame.dashRemaining = result.dashRemaining;
              assert.deepEqual(result, liveDecision!); selectedCommands = commands; memory.aiState = result.aiState;
            }
            return { kind: 'handled', action: { ...idleAction(), aim: actor.yaw }, ...(mobility ? { mobility } : {}),
              ...(commands.length ? { commands, commandVersion: 'scripted-combat-v5' } : {}),
              ...(frame.dashRemaining > 0 ? { dash: { version: 'scripted-ai-dash-v1', aiState: memory.aiState, pendingPostEvasionCharge: false,
                target: { targetWeaponState: 'ready', attackDistanceToTarget: frame.pos.distanceTo(vec(enemy.pos)), resolvedAiReach: 3,
                  targetProtected: false, spatialIQ: 80, weaponReady: false } } } : {}) };
          } } });
      const events = advance(sim, simMemory, () => { simDraws++; return ['dash-counter', 'hammer-jump', 'jump-rejected-counter'].includes(kind) ? .01 : .99; });
      const replayEvents = advance(restored, replayMemory, () => { replayDraws++; return ['dash-counter', 'hammer-jump', 'jump-rejected-counter'].includes(kind) ? .01 : .99; });
      assert.deepEqual(restored, sim); assert.deepEqual(replayMemory, simMemory); assert.deepEqual(replayEvents, events); assert.equal(simDraws, liveDraws); assert.equal(replayDraws, simDraws);
      assert.equal(self.hp, bot.hp, `own damage ${tick}`); assert.equal(rival.hp, target.hp, `target damage ${tick}`); assert.equal(self.weapon, bot.activeWeapon);
      assert.equal(!!self.hammerJumpPlanned, !!bot.hammerJumpPlanned);
      assert.equal(self.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0);
      assert.equal(self.dashRemaining, liveRemaining); assert.equal(self.dashCooldownTimer, liveCooldown);
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-7, `position ${tick}/${axis}: ${self.pos[axis]} vs ${bot.pos[axis]}`);
        assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-7, `velocity ${tick}/${axis}`);
      }
      if (tick === 1) {
        assert.equal(selectedCommands.at(-1)?.kind, kind === 'hammer-jump' ? 'hammer-jump' : 'melee'); assert.equal(self.weaponState, 'windup', 'moving/airborne counter actually commits');
        assert.equal(self.lastHammerAttackTimeMs ?? self.lastSwordAttackTimeMs, kind === 'hammer-jump' && id !== 'main_ai' ? undefined : dt * 1000);
        if (kind.includes('hop')) assert.equal(events.actorDecisionFrame!.decisions[0].mobility, 'emergency-hop');
        if (kind === 'dash-counter') assert.equal(events.actorDecisionFrame!.decisions[0].mobility, 'spatial-dodge');
      }
    }
    // Flight finish clears the incoming actor's vertical velocity. In this
    // rising case its changed height produces a real 60 Hz miss; preserve that
    // observed outcome rather than treating parity as a quality improvement.
    if (kind === 'air-counter') assert.equal(target.hp, dt === 1 / 60 ? 20 : 19);
    if (['hammer', 'sword', 'air-falling-counter', 'swap-counter'].includes(kind)) assert.equal(target.hp, 19, 'counter must reach actual melee contact');
  });
