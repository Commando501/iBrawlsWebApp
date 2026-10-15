import type * as THREE from 'three';
import { simulationRandom } from './simulationRandom';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTiming';
import type { AIBehaviorState, Combatant, UniversalSettings, WeaponState } from '../types';

export interface AIAirborneHammerOpportunityFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export interface AIAirborneHammerOpportunityTuning {
  hammerJumpReachBase: number;
  hammerJumpReachAnticipation: number;
  hammerJumpVerticalBase: number;
  hammerJumpVerticalAnticipation: number;
}

export interface AIAirborneHammerOpportunityResult {
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

/** Airborne-target opportunities after evasion, using the caller's retained
 * readiness/range locals. It does not spend clocks or integrate motion. */
export function resolveAIAirborneHammerOpportunity({ settings, frame, targetHp, targetVerticalVelocity,
  targetAirborne, targetProtected, difficulty, movementComplexity, canStartWeaponAction, activeWeapon,
  distanceToTarget, resolvedDangerZone, combatDistanceToTarget, resolvedAiReach, tunedAnticipationFactor,
  enemyInKillRange, verticalDeltaToTarget, cooldownMultiplier, tuning, triggerHammerAttack, startHammerJump,
  random = simulationRandom }: {
  settings: UniversalSettings; frame: AIAirborneHammerOpportunityFrame; targetHp: number; targetVerticalVelocity: number;
  targetAirborne: boolean; targetProtected: boolean; difficulty: string; movementComplexity: number;
  canStartWeaponAction: boolean; activeWeapon: Combatant['activeWeapon']; distanceToTarget: number;
  resolvedDangerZone: number; combatDistanceToTarget: number; resolvedAiReach: number; tunedAnticipationFactor: number;
  enemyInKillRange: boolean; verticalDeltaToTarget: number; cooldownMultiplier: number; tuning: AIAirborneHammerOpportunityTuning;
  triggerHammerAttack: () => void; startHammerJump: () => boolean; random?: () => number;
}): AIAirborneHammerOpportunityResult {
  const canConsiderHammerOpportunity =
    targetAirborne &&
    difficulty !== 'easy' &&
    movementComplexity >= 50 &&
    canStartWeaponAction &&
    activeWeapon === 'hammer' &&
    frame.weaponState === 'ready' &&
    targetHp > 0 &&
    !targetProtected;

  if (!canConsiderHammerOpportunity) {
    return frame;
  }

  const fallingIntoHammer = targetVerticalVelocity <= 0.75 && distanceToTarget <= resolvedDangerZone + 2.5;
  const canReachBody = combatDistanceToTarget <= resolvedAiReach + tunedAnticipationFactor * 1.5;

  if (
    (fallingIntoHammer || canReachBody) &&
    random() < tuning.hammerJumpReachBase + tunedAnticipationFactor * tuning.hammerJumpReachAnticipation
  ) {
    frame.aiState = 'COOLDOWN';
    frame.timer = resolveScaledAIWeaponReloadTime(settings, 'hammer', cooldownMultiplier);
    triggerHammerAttack();
  } else if (
    !enemyInKillRange &&
    verticalDeltaToTarget > 2.0 &&
    distanceToTarget <= resolvedDangerZone + 4.5 &&
    random() < tuning.hammerJumpVerticalBase + tunedAnticipationFactor * tuning.hammerJumpVerticalAnticipation
  ) {
    if (startHammerJump()) {
      frame.weaponState = 'swing_up';
    }
  }

  return frame;
}
