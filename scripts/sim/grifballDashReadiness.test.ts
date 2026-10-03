import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { integrateTargetEngagementGravityForCombatant } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { prepareSimAIEngagementMotion } from '../../src/sim/aiEngagementMotion';
import { stepCombatantMovement } from '../../src/sim/physics';
import { idleAction } from '../../src/sim/actions';

const noop = () => {};
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
for (const owner of ['player', 'main_ai', 'bot_2'] as const)
for (const dt of [1 / 60, 1 / 30])
for (const pose of ['ground', 'rising', 'falling', 'landing-before-dash'] as const)
test(`dash readiness follows physical release ${owner}/${dt}/${pose}`, () => {
  const local = owner === 'player', f = createBotParityFixture(owner, !local);
  const { state, sim, bot, refs } = f, actor = sim.combatants[0];
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  actor.id = owner; actor.controller = local ? 'remote' : 'ai';
  if (local) state.otherPlayers.delete(owner);
  const height = pose === 'ground' ? 0 : pose === 'landing-before-dash' ? .08 : 1;
  const vy = pose === 'rising' ? 3 : pose === 'ground' ? 0 : -3;
  const pos = local ? state.playerPos : bot.pos, vel = local ? state.playerVel : bot.vel;
  pos.set(0, height, 0); vel.set(0, vy, 0);
  actor.pos = { ...pos }; actor.vel = { ...vel }; actor.isJumping = height > 0;
  state.isJumping = bot.isJumping = actor.isJumping;
  actor.weapon = bot.activeWeapon = state.activeWeapon = 'sword';
  actor.weaponState = 'idle'; actor.weaponReadyTimer = actor.attackCooldown = 0;
  state.pSwordState = bot.weaponState = 'ready'; state.pSwordTimer = bot.weaponTimer = state.swapCooldownTimer = 0;
  // A committed dash, with a long reuse cooldown that must not extend the movement lock.
  actor.dashRemaining = state.playerDashRemaining = bot.aiDashRemaining = .25;
  actor.dashCooldownTimer = state.playerDashCooldownTimer = bot.aiDashCooldownTimer = 10;
  actor.dashDir = bot.aiDashDir = { x: 1, y: 0, z: 0 }; state.playerDashDir.set(1, 0, 0);
  const scriptedBots = local ? {} : { [owner]: 'normal' };
  const observations: { seconds: number; delay: number }[] = [];
  const target = { targetWeaponState: 'ready', attackDistanceToTarget: 20,
    resolvedAiReach: 3, targetProtected: false, spatialIQ: 0, weaponReady: true };
  let releasedAt: number | undefined, airborneDashFrames = 0;
  for (let tick = 0; tick < 90; tick++) {
    const live = createLiveGrifballTacticalSnapshot(state, () => null, f.map).players.find(p => p.id === owner)!.space!;
    const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots }).players.find(p => p.id === owner)!.space!;
    near(live.mobileIn, headless.mobileIn, 'independently observed movement delay');
    near(live.attackIn, headless.attackIn, 'weapon timing remains independent');
    const remaining = local ? state.playerDashRemaining : bot.aiDashRemaining!;
    if (remaining > 0) assert.ok(live.mobileIn >= remaining, 'committed dash cannot report immediate movement freedom');
    observations.push({ seconds: tick * dt, delay: live.mobileIn });
    if (remaining <= 0 && pos.y === 0) { releasedAt = tick * dt; break; }
    const previousRemaining = remaining;
    if (local) {
      updatePlayerHorizontalMovementForState({ state, refs, dt, keysPressed: {},
        movementKeybindings: DEFAULT_KEYBINDINGS, actionKeybindings: DEFAULT_KEYBINDINGS,
        gamepad: null, mobileJoystick: null, mobileControlsActive: false,
        sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
      updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 18, constrainCombatantToArena: noop });
    } else {
      integrateTargetEngagementGravityForCombatant({ self: bot, dt, gravityAcceleration: 18,
        frame: { pos, vel, aiState: 'SIDE_STEPPING', timer: 0, dashCooldownTimer: 10, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 },
        recoverCombatantAltitude: () => false, constrainCombatantToArena: noop });
      if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos, vel, dt, movementComplexity: 0, swayTimer: 0,
        toTarget: new THREE.Vector3(), recoverCombatantAltitude: () => false, constrainCombatantToArena: noop }) === 'continue') {
        if (remaining > 0) {
          const frame = { pos, vel, dashDir: new THREE.Vector3(1, 0, 0), aiState: bot.aiState, dashRemaining: remaining,
            slideActive: false, slideCooldownTimer: 0, pendingPostEvasionCharge: false, isSprinting: false };
          resolveAIDashMovementForCombatant({ state, refs, frame, dt, activeWeapon: 'sword', ...target });
          bot.aiDashRemaining = frame.dashRemaining;
        }
      }
      prepareSimAIEngagementMotion(sim, actor, sim.settings, dt);
    }
    stepCombatantMovement(sim, actor, idleAction(), sim.settings, dt, undefined, false, !local,
      local ? undefined : { version: 'scripted-ai-dash-v1', aiState: 'SIDE_STEPPING', pendingPostEvasionCharge: false, target });
    for (const axis of ['x', 'y', 'z'] as const) {
      near(pos[axis], actor.pos[axis], `physical position ${axis}`); near(vel[axis], actor.vel[axis], `physical velocity ${axis}`);
    }
    near(local ? state.playerDashRemaining : bot.aiDashRemaining!, actor.dashRemaining, 'physical dash countdown');
    if (pos.y > .05 && previousRemaining > 0) {
      airborneDashFrames++;
      if (local) assert.ok(actor.dashRemaining < previousRemaining, 'player dash continues in flight');
      else assert.equal(actor.dashRemaining, previousRemaining, 'scripted dash waits for landing');
    }
  }
  assert.notEqual(releasedAt, undefined, 'physical movement must release in the bounded trace');
  for (const sample of observations) assert.ok(Math.abs(sample.seconds + sample.delay - releasedAt!) <= 3 * dt + 1e-8,
    `readiness must predict actual release within integration quantization: ${JSON.stringify(sample)} vs ${releasedAt}`);
  if (pose === 'rising' || pose === 'falling') assert.ok(airborneDashFrames > 0);
  assert.equal(observations.at(-1)!.delay, 0, 'reuse cooldown does not hold movement after release');
});

for (const kind of ['scripted', 'neural-slot', 'neural-global', 'remote'] as const)
test(`dash observation follows movement ownership without granting control: ${kind}`, () => {
  const f = createBotParityFixture('bot_2', true), { state, bot, sim } = f, actor = sim.combatants[0];
  sim.combatExecution = 'live-roster-v2'; actor.id = bot.id; actor.controller = 'ai';
  bot.pos.set(0, 1, 0); bot.vel.set(0, 3, 0); actor.pos = { ...bot.pos }; actor.vel = { ...bot.vel };
  actor.dashRemaining = bot.aiDashRemaining = .25;
  const difficulty = kind === 'neural-slot' ? 'neural-net' : 'normal';
  bot.difficulty = difficulty;
  if (kind === 'neural-global') state.settings.aiDifficulty = sim.settings.aiDifficulty = 'neural-net';
  if (kind === 'remote') bot.controller = actor.controller = 'remote';
  const observe = () => [
    createLiveGrifballTacticalSnapshot(state, () => null, f.map).players.find(p => p.id === bot.id)!,
    createSimGrifballTacticalSnapshot(sim, { scriptedBots: { [bot.id]: difficulty } }).players.find(p => p.id === bot.id)!,
  ];
  const before = observe();
  actor.dashRemaining = bot.aiDashRemaining = 0;
  const after = observe();
  near(before[0].space!.mobileIn, before[1].space!.mobileIn, 'host ownership agreement');
  for (let i = 0; i < 2; i++) {
    assert.equal(before[i].scripted, kind === 'scripted');
    near(before[i].space!.mobileIn - after[i].space!.mobileIn, kind === 'scripted' ? .25 : 0,
      'only scripted movement adds the suspended dash after landing');
  }
});
