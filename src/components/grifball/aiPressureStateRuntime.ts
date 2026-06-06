import * as THREE from 'three';
import { type AICombatWeapon } from '../../game/aiCombatDecision';
import {
  getPressureApproachSpeed,
  getPressureMaxRange,
  shouldExitPressure,
  shouldPressurePreferLunge,
  shouldPressureReSwing,
} from '../../game/aiPressure';
import { type AIBehaviorState, type WeaponState } from '../../types';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTimingRuntime';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

export interface AIPressureStateFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dashDir: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  dashRemaining: number | undefined;
  dashCooldownTimer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export interface AIPressureStateResult {
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  dashRemaining: number | undefined;
  dashCooldownTimer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export function resolveAIPressureLungeChance({
  aiState,
  baseLungeChance,
  activeWeapon,
  lungeDistanceToTarget,
  resolvedAiReach,
  minLungeRange,
  maxLungeRange,
  targetProtected,
  playstyleFactor,
}: {
  aiState: AIBehaviorState | undefined;
  baseLungeChance: number;
  activeWeapon: AICombatWeapon;
  lungeDistanceToTarget: number;
  resolvedAiReach: number;
  minLungeRange: number;
  maxLungeRange: number;
  targetProtected: boolean;
  playstyleFactor: number;
}): number {
  if (
    aiState === 'PRESSURING' &&
    shouldPressurePreferLunge({
      activeWeapon,
      distanceToTarget: lungeDistanceToTarget,
      aiReach: resolvedAiReach,
      minLungeRange,
      maxLungeRange,
      weaponReady: true,
      targetProtected,
    })
  ) {
    return Math.max(baseLungeChance, 0.72 + playstyleFactor * 0.2);
  }

  return baseLungeChance;
}

export function resolveAIPressureStateForCombatant({
  state,
  frame,
  botId,
  target,
  pressureTargetId,
  attackDistanceToTarget,
  resolvedAiReach,
  maxLungeRange,
  effectivePressureAggression,
  lookHeading,
  sidewayHeading,
  totalApproachLateral,
  dt,
  sprintMult,
  activeWeapon,
  stationarySwingReach,
  minLungeRange,
  targetProtected,
  canStartWeaponAction,
  cooldownMultiplier,
  playstyleFactor,
  clearPressureTarget,
  isCoordAttackBlocked,
  triggerCombatantAttack,
  playDash,
}: {
  state: GrifballRuntimeState;
  frame: AIPressureStateFrame;
  botId: string;
  target: TacticalTargetCandidate;
  pressureTargetId: string | undefined;
  attackDistanceToTarget: number;
  resolvedAiReach: number;
  maxLungeRange: number;
  effectivePressureAggression: number;
  lookHeading: THREE.Vector3;
  sidewayHeading: THREE.Vector3;
  totalApproachLateral: number;
  dt: number;
  sprintMult: number;
  activeWeapon: AICombatWeapon;
  stationarySwingReach: number;
  minLungeRange: number;
  targetProtected: boolean;
  canStartWeaponAction: boolean;
  cooldownMultiplier: number;
  playstyleFactor: number;
  clearPressureTarget: (botId: string) => void;
  isCoordAttackBlocked: () => boolean;
  triggerCombatantAttack: (weapon: AICombatWeapon) => void;
  playDash: () => void;
}): AIPressureStateResult {
  const maxPressureRange = getPressureMaxRange(resolvedAiReach, maxLungeRange);
  const targetMatchesLock = !pressureTargetId || target.id === pressureTargetId;

  if (shouldExitPressure({
    targetHp: target.hp,
    targetInvuln: target.invulnerabilityTimer,
    distanceToTarget: attackDistanceToTarget,
    maxPressureRange,
    timerRemaining: frame.timer as number,
    targetMatchesLock,
  })) {
    frame.aiState = 'SIDE_STEPPING';
    frame.timer = 0.35;
    clearPressureTarget(botId);
    return {
      aiState: frame.aiState,
      timer: frame.timer,
      dashRemaining: frame.dashRemaining,
      dashCooldownTimer: frame.dashCooldownTimer,
      weaponState: frame.weaponState,
    };
  }

  const pressureSpeed = getPressureApproachSpeed(effectivePressureAggression);
  const approachScale = frame.weaponState === 'ready' ? 1 : 0.55;
  frame.vel.copy(lookHeading).multiplyScalar(
    pressureSpeed * approachScale * (state.settings.speedForward / 100) * sprintMult
  );
  if (totalApproachLateral !== 0 && frame.weaponState === 'ready') {
    frame.vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.4);
  }
  frame.pos.addScaledVector(frame.vel, dt);

  if (
    (frame.dashCooldownTimer as number) <= 0 &&
    attackDistanceToTarget > resolvedAiReach + 0.8 &&
    Math.random() < 0.06 * playstyleFactor
  ) {
    frame.dashDir.copy(lookHeading).normalize();
    frame.dashRemaining = state.settings.dashDuration || 0.25;
    frame.dashCooldownTimer = state.settings.dashCooldown || 2.0;
    playDash();
  }

  const pressureAttack = {
    activeWeapon,
    distanceToTarget: attackDistanceToTarget,
    aiReach: stationarySwingReach,
    minLungeRange,
    maxLungeRange,
    weaponReady: frame.weaponState === 'ready',
    targetProtected,
  };

  if (
    canStartWeaponAction &&
    shouldPressureReSwing(pressureAttack) &&
    !isCoordAttackBlocked()
  ) {
    const baseCooldown = resolveScaledAIWeaponReloadTime(state.settings, activeWeapon, cooldownMultiplier);
    frame.timer = Math.max(frame.timer as number, baseCooldown);
    triggerCombatantAttack(activeWeapon);
    frame.weaponState = 'swing_up';
  }

  return {
    aiState: frame.aiState,
    timer: frame.timer,
    dashRemaining: frame.dashRemaining,
    dashCooldownTimer: frame.dashCooldownTimer,
    weaponState: frame.weaponState,
  };
}
