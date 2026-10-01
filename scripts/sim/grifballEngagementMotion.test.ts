import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { integrateTargetEngagementGravityForCombatant } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { recoverCombatantAltitude } from '../../src/components/grifball/altitudeRecovery';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';

for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const kind of ['rising', 'falling', 'landing', 'altitude', 'wall', 'flight'] as const)
    test(`scheduled engagement motion ${id}/${sign}/${dt}/${kind}`, () => {
      const f = attachLungeRuntime(createBotParityFixture(id)), { bot, target, sim, state, map } = f;
      const [self, rival] = sim.combatants;
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      self.id = id; self.controller = rival.controller = 'ai'; rival.id = target.id;
      bot.pos.set(kind === 'wall' ? map.arenaRadius - .65 : 0, kind === 'landing' ? .01 : kind === 'altitude' ? 20 : 2, 0);
      bot.vel.set(sign * 2, kind === 'rising' || kind === 'altitude' ? 5.5 : -3, sign * 1.5);
      bot.isJumping = true; bot.aiHammerJumpsInAir = 1;
      self.pos = { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z }; self.vel = { x: bot.vel.x, y: bot.vel.y, z: bot.vel.z };
      self.isJumping = true; self.grounded = false; self.hammerJumpsInAir = 1;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = self.swapLockoutTimer = bot.swapCooldownTimer = bot.swapLockoutTimer = 0;
      target.pos.set(30, 0, 30); rival.pos = { x: 30, y: 0, z: 30 };
      if (kind === 'flight') {
        bot.activeWeapon = self.weapon = 'sword'; bot.isLunging = self.isLunging = true;
        bot.lungeTimer = self.lungeTimer = 0;
        bot.lungeTargetDir = self.lungeDir = { x: 0, y: 0, z: sign };
        bot.lungeStartPos = self.lungeStartPos = { ...self.pos }; self.lungeTargetId = target.id;
      }
      sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: self.team, pos: { x: -30, y: 0, z: -30 } });
      const restored = JSON.parse(JSON.stringify(sim));
      let beforeDecision!: { pos: number[]; vel: number[]; jumping: boolean; budget: number };
      for (let tick = 1; tick <= 45; tick++) {
        // Same production boundaries as target engagement, with idle ground
        // movement after landing. Flight retains its separate movement owner.
        if ((bot.aiHammerJumpCooldownTimer ?? 0) > 0) bot.aiHammerJumpCooldownTimer = Math.max(0, bot.aiHammerJumpCooldownTimer! - dt);
        const recover = () => recoverCombatantAltitude(state.settings, bot, bot.pos, bot.vel);
        const constrain = () => constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
        integrateTargetEngagementGravityForCombatant({ self: bot,
          frame: { pos: bot.pos, vel: bot.vel, aiState: bot.aiState, timer: bot.aiTimer, dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 },
          dt, gravityAcceleration: 18, recoverCombatantAltitude: recover, constrainCombatantToArena: constrain });
        beforeDecision = { pos: bot.pos.toArray(), vel: bot.vel.toArray(), jumping: !!bot.isJumping, budget: bot.aiHammerJumpsInAir ?? 0 };
        if (bot.isLunging) f.flight(dt);
        else if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt,
          movementComplexity: 0, swayTimer: 0, toTarget: target.pos.clone().sub(bot.pos),
          recoverCombatantAltitude: recover, constrainCombatantToArena: constrain }) === 'continue') bot.vel.set(0, 0, 0);
        const advance = (current: typeof sim) => stepSimulation(current, {}, { settings: current.settings, dt,
          scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' }, prepare: () => 'engagement',
            resolve: ({ state: own, motionPhase }) => {
              assert.equal(motionPhase, 'after-engagement-gravity'); const actor = own.combatants.find(c => c.id === id)!;
              const actual = { pos: Object.values(actor.pos), vel: Object.values(actor.vel), jumping: actor.isJumping, budget: actor.hammerJumpsInAir };
              assert.deepEqual(actual, beforeDecision, `observation ${tick}`);
              return { kind: 'handled', action: { ...idleAction(), aim: actor.yaw, crouch: true } };
            } } });
        const events = advance(sim), restoredEvents = advance(restored);
        assert.deepEqual(restored, sim); assert.deepEqual(restoredEvents, events);
        for (const axis of ['x', 'y', 'z'] as const) {
          assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-8, `position ${tick}/${axis}`);
          assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-8, `velocity ${tick}/${axis}`);
        }
        assert.equal(self.aiHammerJumpCooldownTimer ?? 0, bot.aiHammerJumpCooldownTimer ?? 0);
        assert.equal(self.isJumping, !!bot.isJumping); assert.equal(self.hammerJumpsInAir, bot.aiHammerJumpsInAir);
        if (kind !== 'flight') assert.equal(self.isCrouching, true, 'prepared policy owns airborne stance');
        if (tick === 1 && kind === 'rising') {
          assert.ok(Math.abs(self.pos.y - (2 + (5.5 - 18 * dt) * dt)) < 1e-10, 'gravity integrated exactly once');
          assert.ok(Math.abs(self.vel.x - sign * 2 * (1 - 5 * dt)) < 1e-10, 'recovery applies one damping step');
        }
        if (tick === 1 && kind === 'landing') assert.equal(self.hammerJumpsInAir, 0, 'landing replenishes jump budget before policy');
        if (tick === 1 && kind === 'altitude') {
          assert.equal(self.pos.y, 14); assert.equal(self.vel.y, -12); assert.equal(self.weaponState, 'idle');
          assert.equal(self.aiHammerJumpCooldownTimer ?? 0, bot.aiHammerJumpCooldownTimer ?? 0);
        }
      }
    });
