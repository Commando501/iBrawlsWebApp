import * as THREE from 'three';
import { resolveAILungeEvasionDecision, type AILungeEvasionFrame } from '../game/aiLungeEvasionDecision';
import { resolveAIBulltrueCounterDecision } from '../game/aiBulltrueCounterDecision';
import { startAIHammerJumpAction } from '../game/aiHammerJump';
import { applyAIEmergencyHopMotion } from '../game/aiEmergencyHop';
import { startAISpatialDodgeMotion } from '../game/aiDashMotion';
import { resolveTargetLungeDirection, shouldCommitChargeAfterEvasion } from '../game/aiSpatialStrategy';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { AICombatWeapon, PlayerModelSnapshot } from '../game/aiCombatDecision';
import type { GroundOpportunityWeaponFrame } from './grifballGroundOpportunityInput';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { createScriptedAIEmergencyHopCommand, createScriptedAISpatialDodgeCommand,
  type ScriptedAIMobilityCommand, type ScriptedAIDashDecision } from './scriptedAIMobility';
import type { ScriptedCombatCommand } from './scriptedCombatInput';
import type { SimState } from './simState';
import { isMixedPlayer } from './simState';

/** Observations retained from this turn's target prediction/range priority.
 * Evasion runs after combo swaps, but must not re-predict range using the new
 * weapon or substitute observations from a different host or earlier frame. */
export interface SimEvasionObservation {
  targetId: string;
  distanceToTarget: number;
  combatDistanceToTarget: number;
  toTarget: { x: number; z: number };
  resolvedAiReach: number;
}

/** Shared lunge-evasion policy at the prepared engagement boundary. Does not
 * advance AI clocks, mutate the simulation/memory, or claim ground movement.
 * Compose its commands after the preceding combo/feint prefix; adopt returned
 * decision memory and merge dash feedback after actual movement. */
export function resolveSimGrifballEvasionInput(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, memories: Readonly<Record<string, TacticalAIMemory>>,
  context: {
    motionPhase: 'after-engagement-gravity'; observation: SimEvasionObservation;
    weaponFrame: GroundOpportunityWeaponFrame; pendingPostEvasionCharge: boolean;
    bulltrueCounter: AICombatWeapon | null; defensiveEvasionMult: number; spatialIQ: number; swayTimer: number;
    random: () => number; playerModel?: PlayerModelSnapshot | null;
  }, dt = 1 / 60) {
  if (context.motionPhase !== 'after-engagement-gravity' || typeof context.random !== 'function' || !Number.isFinite(dt) || dt <= 0)
    throw new Error('Evasion requires prepared engagement and caller-owned randomness');
  const { observation, weaponFrame } = context;
  if (![observation.distanceToTarget, observation.combatDistanceToTarget, observation.resolvedAiReach,
    weaponFrame.readinessRemaining, weaponFrame.currentSwapLockout, weaponFrame.observedSwapLockout].every(n => Number.isFinite(n) && n >= 0) ||
    ![observation.toTarget.x, observation.toTarget.z, context.swayTimer, context.defensiveEvasionMult, context.spatialIQ].every(Number.isFinite) ||
    context.spatialIQ < 0 || context.spatialIQ > 100 || typeof context.pendingPostEvasionCharge !== 'boolean' ||
    typeof weaponFrame.canStartWeaponAction !== 'boolean' || !['hammer', 'sword'].includes(weaponFrame.activeWeapon) ||
    ![null, 'hammer', 'sword'].includes(context.bulltrueCounter)) throw new Error('Invalid evasion observation');
  const actors = state.combatants.filter(c => c.id === botId), self = actors[0];
  const targets = state.combatants.filter(c => c.id === observation.targetId), target = targets[0];
  if (state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1' || state.match.phase !== 'playing' ||
    actors.length !== 1 || isMixedPlayer(state, self) || self.controller !== 'ai' || !Object.hasOwn(scriptedBots, botId) || typeof scriptedBots[botId] !== 'string' ||
    isNeuralNetDifficulty(scriptedBots[botId]) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    !self.alive || self.hp <= 0 || self.respawnTimer > 0 || self.isLunging || self.hasBall || self.weapon === 'ball' || state.match.ball.holderId === botId ||
    targets.length !== 1 || target.id === botId || target.team === self.team || !target.alive || target.hp <= 0 || target.respawnTimer > 0 ||
    !Object.hasOwn(memories, botId) || target.controller === 'ai' && !isMixedPlayer(state, target) && !Object.hasOwn(memories, target.id)) return null;
  const memory = memories[botId], observed = observeSimTacticalWeaponTarget(state, target, memories[target.id]);
  const point = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
  const frame: AILungeEvasionFrame = { pos: point(self.pos), vel: point(self.vel), dashDir: point(self.dashDir),
    aiState: memory.aiState, timer: memory.timer, dashRemaining: self.dashRemaining, dashCooldownTimer: self.dashCooldownTimer,
    pendingPostEvasionCharge: context.pendingPostEvasionCharge, weaponState: weaponFrame.weaponState };
  // Action ports mutate only this projection, so later priorities can see a new
  // hop's pose and physical swing independently of the cached decision locals.
  const projected = { id: self.id, weaponState: weaponFrame.weaponState, weaponTimer: self.weaponPhaseElapsed ?? 0,
    isJumping: self.isJumping, aiHammerJumpsInAir: self.hammerJumpsInAir,
    hammerJumpPlanned: self.hammerJumpPlanned, hammerJumpType: self.hammerJumpType };
  const commands: ScriptedCombatCommand[] = [];
  let mobility: ScriptedAIMobilityCommand | undefined;
  const attack = (weapon: AICombatWeapon) => {
    commands.push({ kind: 'melee', weapon, swipe: false }); projected.weaponState = 'swing_up'; projected.weaponTimer = 0;
  };
  const dashTarget = () => ({ targetWeaponState: observed.weaponState,
    attackDistanceToTarget: observation.combatDistanceToTarget, resolvedAiReach: observation.resolvedAiReach,
    targetProtected: target.invulnerabilityTimer > 0, spatialIQ: context.spatialIQ, weaponReady: frame.weaponState === 'ready' });
  const result = resolveAILungeEvasionDecision({ settings: state.settings, frame, targetWeapon: target.weapon,
    distanceToTarget: observation.distanceToTarget, combatDistanceToTarget: observation.combatDistanceToTarget,
    targetIsLunging: observed.isLunging, difficulty: scriptedBots[botId], defensiveEvasionMult: context.defensiveEvasionMult,
    spatialIQ: context.spatialIQ, swayTimer: context.swayTimer, activeWeapon: weaponFrame.activeWeapon,
    canStartWeaponAction: weaponFrame.canStartWeaponAction, playerModel: context.playerModel ?? null,
    tuning: resolveBehaviorTuning(state.settings), random: context.random,
    resolveIncomingDirection: () => resolveTargetLungeDirection({ targetId: isMixedPlayer(state, target) ? 'player' : target.id, toTargetX: observation.toTarget.x, toTargetZ: observation.toTarget.z,
      targetVelX: target.vel.x, targetVelZ: target.vel.z,
      playerIsLunging: isMixedPlayer(state, target) && target.isLunging, playerLungeDirX: target.lungeDir.x, playerLungeDirZ: target.lungeDir.z,
      mainAiIsLunging: target.id === 'main_ai' && target.isLunging, mainAiLungeDirX: target.lungeDir.x, mainAiLungeDirZ: target.lungeDir.z,
      botIsLunging: target.id !== 'main_ai' && !isMixedPlayer(state, target) && target.isLunging,
      botLungeDirX: target.lungeDir.x, botLungeDirZ: target.lungeDir.z }),
    tryBulltrueCounter: () => resolveAIBulltrueCounterDecision({ settings: state.settings,
      frame: { activeWeapon: weaponFrame.activeWeapon, aiState: frame.aiState, timer: frame.timer, weaponState: frame.weaponState },
      bulltrueCounter: context.bulltrueCounter, canStartWeaponAction: weaponFrame.canStartWeaponAction,
      cooldownMultiplier: memory.cooldownMultiplier, triggerCombatantAttack: attack }),
    startSpatialDodge: (x, z, track = true) => {
      mobility = createScriptedAISpatialDodgeCommand(self, state.map.arenaRadius, { x, z }, context.playerModel ?? null, context.random);
      startAISpatialDodgeMotion(state.settings, frame, mobility.direction);
      if (track) frame.pendingPostEvasionCharge = shouldCommitChargeAfterEvasion(dashTarget());
      return true;
    },
    startEmergencyHop: (x, z) => {
      mobility = createScriptedAIEmergencyHopCommand(self, state.map.arenaRadius, { x, z }, context.playerModel ?? null, context.random);
      applyAIEmergencyHopMotion(projected, frame.pos, frame.vel, mobility.direction, dt); return true;
    },
    startHammerJump: () => {
      const started = startAIHammerJumpAction({ self: projected, settings: state.settings, vel: frame.vel, jumpType: 'defensive',
        playJump: () => {}, playSwing: () => {}, onMainAIHammerSwing: () => {
          if (weaponFrame.readinessRemaining <= 0 && self.dashRemaining <= 0) {
            projected.weaponState = 'swing_up'; projected.weaponTimer = 0;
          }
        } });
      // Keep failed attempts: main AI clears a queued plan when its weapon
      // callback refuses, before the final timed-counter priority runs.
      commands.push({ kind: 'hammer-jump', jumpType: 'defensive' });
      return started;
    },
    triggerHammerAttack: () => attack('hammer'),
  });
  const dash: ScriptedAIDashDecision | undefined = frame.dashRemaining > 0 ? { version: 'scripted-ai-dash-v1',
    aiState: result.aiState, pendingPostEvasionCharge: result.pendingPostEvasionCharge, target: dashTarget() } : undefined;
  return { targetId: target.id, frame: result, commands, commandVersion: 'scripted-combat-v5' as const,
    ...(mobility ? { mobility } : {}), ...(dash ? { dash } : {}),
    weaponFrame: { ...weaponFrame, weaponState: result.weaponState },
    motion: { pos: { ...frame.pos }, vel: { ...frame.vel }, dashDir: { ...frame.dashDir }, ...projected },
    needsMovement: true as const };
}
