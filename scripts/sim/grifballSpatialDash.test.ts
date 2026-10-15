import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAILungeEvasionForCombatant } from '../../src/components/grifball/aiLungeEvasionRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { type AILungeEvasionFrame } from '../../src/game/aiLungeEvasionDecision';
import { finishAIHorizontalMotion } from '../../src/game/aiDashMotion';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { type ScriptedAIDashFeedback } from '../../src/sim/scriptedAIMobility';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { resolveSimGrifballEvasionInput } from '../../src/sim/grifballEvasionInput';

const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
const unsupported = () => assert.fail('authored dash/hop sequence selected a weapon action');
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const mode of ['ground', 'rising', 'falling', 'slide', 'wall', 'zero-settings'] as const)
    test(`scheduled spatial dash ${id}/${sign}/${dt}/${mode}`, () => {
      const f = attachLungeRuntime(createBotParityFixture(id, true, mode === 'zero-settings' ? { dashDuration: 0, dashCooldown: 0 } : {}));
      const { bot, target, sim, state, map } = f, [self, rival] = sim.combatants;
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
      bot.activeWeapon = target.activeWeapon = self.weapon = rival.weapon = 'sword';
      bot.hp = bot.maxHp = self.hp = self.maxHp = 20;
      const airborne = mode === 'rising' || mode === 'falling';
      bot.pos.set(mode === 'wall' ? map.arenaRadius - .7 : 0, airborne ? 2 : 0, 0);
      bot.vel.set(0, mode === 'rising' ? 3 : mode === 'falling' ? -3 : 0, 0);
      bot.isJumping = self.isJumping = airborne; self.grounded = !airborne;
      self.pos = { ...bot.pos }; self.vel = { ...bot.vel };
      target.pos.set(bot.pos.x, 0, sign * 6); rival.pos = { ...target.pos };
      target.isLunging = rival.isLunging = true; target.lungeTimer = rival.lungeTimer = 0;
      target.lungeTargetDir = rival.lungeDir = { x: 0, y: 0, z: -sign };
      target.lungeStartPos = rival.lungeStartPos = { ...rival.pos }; rival.lungeTargetId = id;
      self.dashCooldownTimer = 0; self.slideActive = mode === 'slide'; self.isSprinting = true;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = self.swapLockoutTimer = 0;
      sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: self.team,
        isLunging: false, pos: { x: -30, y: 0, z: -30 } });
      const liveMemory: ScriptedAIDashFeedback = { aiState: 'APPROACHING', pendingPostEvasionCharge: false };
      const simMemory = structuredClone(liveMemory), restoredMemory = structuredClone(liveMemory), restored = JSON.parse(JSON.stringify(sim));
      let liveRemaining = 0, liveCooldown = 0, liveSlide = self.slideActive, liveSlideCooldown = 0, liveSprint = true;
      const liveDirection = new THREE.Vector3();
      let liveDraws = 0, simDraws = 0, restoredDraws = 0, dashStarts = 0, deferredFrames = 0, dashFrames = 0, hops = 0;
      for (let tick = 1; tick <= 150; tick++) {
        liveSprint = false; // The live updater initializes this local each turn.
        f.gravityPrelude(bot, dt);
        liveCooldown = Math.max(0, liveCooldown - dt); liveSlideCooldown = Math.max(0, liveSlideCooldown - dt);
        const frame: AILungeEvasionFrame = { ...liveMemory, pos: bot.pos, vel: bot.vel, dashDir: liveDirection, timer: 0,
          dashRemaining: liveRemaining, dashCooldownTimer: liveCooldown, weaponState: 'ready' };
        const distance = bot.pos.distanceTo(target.pos);
        const observation = { targetWeaponState: target.weaponState!, attackDistanceToTarget: distance, resolvedAiReach: 3,
          targetProtected: false, spatialIQ: 80, weaponReady: true };
        const live = withSimulationRandom(() => assert.fail('explicit dash leaked global RNG'), tick * dt, () =>
          resolveAILungeEvasionForCombatant({ state, self: bot, frame, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: !!target.isLunging, isCrouching: false },
            toTarget: target.pos.clone().sub(bot.pos), distanceToTarget: distance, combatDistanceToTarget: distance,
            resolvedAiReach: 3, targetIsProtected: false, targetIsLunging: !!target.isLunging, dt, difficulty: 'normal',
            defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, activeWeapon: 'sword', canStartWeaponAction: false,
            cooldownMultiplier: 1, calibrationEnabled: false, bulltrueCounter: null, getTargetPlayerModel: () => null,
            mainAI: state.otherPlayers.get('main_ai'), triggerCombatantAttack: unsupported, startAIHammerJump: unsupported,
            spawnVoxelShockwaveParticles: unsupported, recordCombatantObservation: () => {}, playDash: () => {}, playJump: () => {},
            tuning: resolveBehaviorTuning(state.settings), random: () => { liveDraws++; return .01; } }));
        liveRemaining = frame.dashRemaining; liveCooldown = frame.dashCooldownTimer;
        liveMemory.aiState = frame.aiState; liveMemory.pendingPostEvasionCharge = frame.pendingPostEvasionCharge;
        const constrain = () => { constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: map, arenaRadius: map.arenaRadius }); };
        const recovered = resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt,
          movementComplexity: 0, swayTimer: 0, toTarget: target.pos.clone().sub(bot.pos), recoverCombatantAltitude: () => false,
          constrainCombatantToArena: constrain }) === 'sync_return';
        let liveFeedback: ScriptedAIDashFeedback | undefined;
        if (!recovered && liveRemaining > 0) {
          const movement = { ...liveMemory, pos: bot.pos, vel: bot.vel, dashDir: liveDirection,
            dashRemaining: liveRemaining, slideActive: liveSlide, slideCooldownTimer: liveSlideCooldown, isSprinting: liveSprint };
          resolveAIDashMovementForCombatant({ state, refs: f.refs, frame: movement, dt, activeWeapon: 'sword', ...observation });
          liveRemaining = movement.dashRemaining; liveSlide = movement.slideActive; liveSlideCooldown = movement.slideCooldownTimer; liveSprint = movement.isSprinting;
          constrain(); finishAIHorizontalMotion(bot, movement);
          liveFeedback = { aiState: movement.aiState, pendingPostEvasionCharge: movement.pendingPostEvasionCharge };
          Object.assign(liveMemory, liveFeedback); dashFrames++;
        } else if (recovered && liveRemaining > 0) deferredFrames++;
        else if (!recovered) bot.vel.set(0, 0, 0);
        f.targetFlight(dt);
        const advance = (current: typeof sim, memory: ScriptedAIDashFeedback, random: () => number) => {
          const events = stepSimulation(current, {}, { settings: current.settings, dt,
            scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' }, prepare: () => 'engagement',
              resolve: ({ state: own }) => {
                const actor = own.combatants.find(c => c.id === id)!, enemy = own.combatants.find(c => c.id === rival.id)!;
                assert.equal(actor.isSprinting, false, 'engagement clears prior sprint state before policy');
                const ownDistance = vec(actor.pos).distanceTo(vec(enemy.pos));
                const evasion = resolveSimGrifballEvasionInput(own, id, { [id]: 'normal' }, {
                  [id]: { aiState: memory.aiState, timer: 0, cooldownMultiplier: 1 },
                  [enemy.id]: { aiState: undefined, timer: 0, cooldownMultiplier: 1 },
                }, { motionPhase: 'after-engagement-gravity', observation: { targetId: enemy.id, distanceToTarget: ownDistance,
                  combatDistanceToTarget: ownDistance, toTarget: { x: enemy.pos.x - actor.pos.x, z: enemy.pos.z - actor.pos.z }, resolvedAiReach: 3 },
                  weaponFrame: { activeWeapon: 'sword', weaponState: 'ready', canStartWeaponAction: false,
                    readinessRemaining: 0, observedSwapLockout: 0, currentSwapLockout: 0 },
                  pendingPostEvasionCharge: memory.pendingPostEvasionCharge, bulltrueCounter: null,
                  defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0, random }, dt)!;
                const result = evasion.frame;
                assert.deepEqual(evasion.commands, []);
                assert.equal(result.isEvadingLunge, live.isEvadingLunge);
                memory.aiState = result.aiState; memory.pendingPostEvasionCharge = result.pendingPostEvasionCharge;
                return { kind: 'handled', action: { ...idleAction(), aim: actor.yaw },
                  ...(evasion.mobility ? { mobility: evasion.mobility } : {}), ...(evasion.dash ? { dash: evasion.dash } : {}) };
              } } });
          const feedback = events.actorDecisionFrame!.decisions[0].dash;
          assert.deepEqual(feedback, liveFeedback, `dash feedback ${tick}`);
          if (feedback) Object.assign(memory, feedback);
          return events;
        };
        const events = advance(sim, simMemory, () => { simDraws++; return .01; });
        const replayEvents = advance(restored, restoredMemory, () => { restoredDraws++; return .01; });
        assert.deepEqual(restored, sim); assert.deepEqual(replayEvents, events); assert.deepEqual(simMemory, liveMemory); assert.deepEqual(restoredMemory, simMemory);
        assert.equal(liveDraws, simDraws); assert.equal(restoredDraws, simDraws);
        const command = events.actorDecisionFrame!.decisions[0].mobility;
        if (command === 'spatial-dodge') dashStarts++; if (command === 'emergency-hop') hops++;
        for (const axis of ['x', 'y', 'z'] as const) {
          assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-8, `position ${tick}/${axis}: ${self.pos[axis]} vs ${bot.pos[axis]}`);
          assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-8, `velocity ${tick}/${axis}`);
        }
        assert.equal(self.hp, bot.hp); assert.equal(self.isJumping, !!bot.isJumping);
        assert.equal(self.dashRemaining, liveRemaining); assert.equal(self.dashCooldownTimer, liveCooldown);
        assert.equal(self.slideActive, liveSlide); assert.equal(self.slideCooldownTimer, liveSlideCooldown); assert.equal(self.isSprinting, liveSprint);
        if (tick === 1) {
          assert.equal(command, 'spatial-dodge'); const duration = state.settings.dashDuration || .25;
          assert.equal(self.dashRemaining, airborne ? duration : Math.max(0, duration - dt));
          assert.equal(self.dashCooldownTimer, state.settings.dashCooldown || 2);
          if (mode === 'slide') { assert.equal(self.slideActive, false); assert.equal(self.slideCooldownTimer, state.settings.slideCooldown); }
          if (mode === 'ground') assert.ok(Math.abs(Math.abs(self.pos.x) - state.settings.dashDistance / duration * dt) < 1e-10);
        }
      }
      assert.ok(dashStarts > 0 && dashFrames > 0 && hops > 0 && deferredFrames > 0, 'dash starts, waits through a hop and resumes');
      assert.equal(self.isJumping, false); assert.equal(self.dashRemaining, 0); assert.equal(rival.isLunging, false);
    });
