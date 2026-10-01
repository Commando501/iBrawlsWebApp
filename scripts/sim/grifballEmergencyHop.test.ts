import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAILungeEvasionForCombatant } from '../../src/components/grifball/aiLungeEvasionRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { resolveAILungeEvasionDecision, type AILungeEvasionFrame } from '../../src/game/aiLungeEvasionDecision';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { createScriptedAIEmergencyHopCommand, type ScriptedAIMobilityCommand } from '../../src/sim/scriptedAIMobility';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const unsupported = () => assert.fail('authored hop case selected another evasion branch');
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const mode of ['ground', 'rising', 'falling'] as const) for (const roll of [.1, .9])
    test(`scheduled emergency hop ${id}/${sign}/${dt}/${mode}/${roll}`, () => {
      const f = attachLungeRuntime(createBotParityFixture(id)), { bot, target, sim, state, map } = f;
      const [self, rival] = sim.combatants;
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
      bot.activeWeapon = target.activeWeapon = self.weapon = rival.weapon = 'sword';
      bot.hp = bot.maxHp = self.hp = self.maxHp = 20;
      bot.pos.set(0, mode === 'ground' ? 0 : 2, 0); bot.vel.set(0, mode === 'rising' ? 3 : mode === 'falling' ? -3 : 0, 0);
      bot.isJumping = self.isJumping = mode !== 'ground'; self.grounded = !self.isJumping;
      self.pos = { ...bot.pos }; self.vel = { ...bot.vel };
      target.pos.set(0, 0, sign * 6); rival.pos = { ...target.pos };
      target.isLunging = rival.isLunging = true; target.lungeTimer = rival.lungeTimer = 0;
      target.lungeTargetDir = rival.lungeDir = { x: 0, y: 0, z: -sign };
      target.lungeStartPos = rival.lungeStartPos = { ...rival.pos }; rival.lungeTargetId = id;
      bot.aiDashCooldownTimer = self.dashCooldownTimer = 10;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = self.swapLockoutTimer = 0;
      sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: self.team,
        isLunging: false, pos: { x: -30, y: 0, z: -30 } });
      const restored = JSON.parse(JSON.stringify(sim)); let hops = 0, liveDraws = 0, simDraws = 0, restoredDraws = 0;
      for (let tick = 1; tick <= 120; tick++) {
        bot.aiDashCooldownTimer = Math.max(0, bot.aiDashCooldownTimer! - dt);
        f.gravityPrelude(bot, dt);
        const frame: AILungeEvasionFrame = { pos: bot.pos, vel: bot.vel, dashDir: new THREE.Vector3(), aiState: 'APPROACHING', timer: 0,
          dashRemaining: 0, dashCooldownTimer: bot.aiDashCooldownTimer!, pendingPostEvasionCharge: false, weaponState: 'ready' };
        const distance = bot.pos.distanceTo(target.pos);
        const live = withSimulationRandom(() => assert.fail('explicit hop leaked global RNG'), tick * dt, () =>
          resolveAILungeEvasionForCombatant({ state, self: bot, frame, botId: id,
            target: { ...target, weaponState: 'ready', isLunging: !!target.isLunging, isCrouching: false },
            toTarget: target.pos.clone().sub(bot.pos), distanceToTarget: distance, combatDistanceToTarget: distance,
            resolvedAiReach: 3, targetIsProtected: false, targetIsLunging: !!target.isLunging, dt, difficulty: 'normal',
            defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, activeWeapon: 'sword', canStartWeaponAction: false,
            cooldownMultiplier: 1, calibrationEnabled: false, bulltrueCounter: null, getTargetPlayerModel: () => null,
            mainAI: state.otherPlayers.get('main_ai'), triggerCombatantAttack: unsupported, startAIHammerJump: unsupported,
            spawnVoxelShockwaveParticles: unsupported, recordCombatantObservation: unsupported, playDash: unsupported, playJump: () => {},
            tuning: resolveBehaviorTuning(state.settings), random: () => { liveDraws++; return roll; } }));
        const beforeRecovery = bot.pos.clone();
        if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt,
          movementComplexity: 0, swayTimer: 0, toTarget: target.pos.clone().sub(bot.pos), recoverCombatantAltitude: () => false,
          constrainCombatantToArena: (pos, vel) => { constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }); } }) === 'continue') bot.vel.set(0, 0, 0);
        f.targetFlight(dt);
        const advance = (current: typeof sim, random: () => number) => stepSimulation(current, {}, { settings: current.settings, dt,
          scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' }, prepare: () => 'engagement',
            resolve: ({ state: own, motionPhase }) => {
              assert.equal(motionPhase, 'after-engagement-gravity');
              const actor = own.combatants.find(c => c.id === id)!, enemy = own.combatants.find(c => c.id === rival.id)!;
              const localFrame: AILungeEvasionFrame = { pos: vec(actor.pos), vel: vec(actor.vel), dashDir: new THREE.Vector3(),
                aiState: 'APPROACHING', timer: 0, dashRemaining: 0, dashCooldownTimer: actor.dashCooldownTimer,
                pendingPostEvasionCharge: false, weaponState: 'ready' };
              let mobility: ScriptedAIMobilityCommand | undefined;
              const ownDistance = localFrame.pos.distanceTo(vec(enemy.pos));
              const result = resolveAILungeEvasionDecision({ settings: own.settings, frame: localFrame, targetWeapon: enemy.weapon,
                distanceToTarget: ownDistance, combatDistanceToTarget: ownDistance, targetIsLunging: enemy.isLunging,
                difficulty: 'normal', defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, activeWeapon: 'sword',
                canStartWeaponAction: false, playerModel: null, tuning: resolveBehaviorTuning(own.settings), random,
                resolveIncomingDirection: () => enemy.lungeDir, startSpatialDodge: unsupported, startHammerJump: unsupported,
                triggerHammerAttack: unsupported, tryBulltrueCounter: () => ({ started: false, aiState: 'APPROACHING', timer: 0, weaponState: 'ready' }),
                startEmergencyHop: (x, z) => { mobility = createScriptedAIEmergencyHopCommand(actor, own.map.arenaRadius, { x, z }, null, random); return true; } });
              assert.equal(result.isEvadingLunge, live.isEvadingLunge);
              return { kind: 'handled', action: { ...idleAction(), aim: actor.yaw }, ...(mobility ? { mobility } : {}) };
            } } });
        const events = advance(sim, () => { simDraws++; return roll; });
        const replayEvents = advance(restored, () => { restoredDraws++; return roll; });
        assert.deepEqual(restored, sim); assert.deepEqual(replayEvents, events);
        assert.equal(liveDraws, simDraws); assert.equal(restoredDraws, simDraws);
        if (events.actorDecisionFrame!.decisions[0].mobility) hops++;
        for (const axis of ['x', 'y', 'z'] as const) {
          assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-8, `position ${tick}/${axis}: ${self.pos[axis]} vs ${bot.pos[axis]}`);
          assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-8, `velocity ${tick}/${axis}`);
        }
        assert.equal(self.hp, bot.hp); assert.equal(self.isJumping, !!bot.isJumping);
        if (tick === 1) {
          assert.ok(live.isEvadingLunge, 'incoming flight must cause a real hop');
          assert.ok(Math.abs(self.pos.x) > 0, 'command must displace the actor');
          assert.ok(Math.abs(self.pos.x - sign * (roll > .5 ? 1 : -1) * 7.5 * dt) < 1e-10,
            'center-arena tie uses the selected perpendicular side');
          const expectedY = mode === 'ground' ? 5.5 * dt : 2 + ((mode === 'rising' ? 3 : -3) - 18 * dt) * dt;
          assert.ok(Math.abs(self.pos.y - expectedY) < 1e-10, 'one vertical displacement; airborne hop never boosts');
          assert.ok(Math.abs(Math.abs(self.vel.x) - 7.5 * (1 - 5 * dt)) < 1e-10, 'AI impulse and one recovery damping');
          assert.equal(self.pos.y, beforeRecovery.y);
        }
      }
      assert.ok(hops > 0); assert.equal(self.isJumping, false, 'hop returns to ground');
      assert.equal(rival.isLunging, false, 'incoming flight resolves through production execution');
    });
