import * as THREE from 'three';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
import { type CombatantWeapon } from './combatantActions';
import { type TacticalTargetCandidate } from './combatGeometry';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTimingRuntime';
import { type GrifballRuntimeState } from './runtimeState';

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

export function resolveAIAirborneHammerOpportunityForCombatant({
  state,
  self,
  frame,
  target,
  toTarget,
  targetAirborne,
  targetProtected,
  difficulty,
  movementComplexity,
  canStartWeaponAction,
  activeWeapon,
  distanceToTarget,
  resolvedDangerZone,
  combatDistanceToTarget,
  resolvedAiReach,
  tunedAnticipationFactor,
  enemyInKillRange,
  verticalDeltaToTarget,
  cooldownMultiplier,
  tuning,
  triggerCombatantAttack,
  startAIHammerJump,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  frame: AIAirborneHammerOpportunityFrame;
  target: TacticalTargetCandidate;
  toTarget: THREE.Vector3;
  targetAirborne: boolean;
  targetProtected: boolean;
  difficulty: string;
  movementComplexity: number;
  canStartWeaponAction: boolean;
  activeWeapon: Combatant['activeWeapon'];
  distanceToTarget: number;
  resolvedDangerZone: number;
  combatDistanceToTarget: number;
  resolvedAiReach: number;
  tunedAnticipationFactor: number;
  enemyInKillRange: boolean;
  verticalDeltaToTarget: number;
  cooldownMultiplier: number;
  tuning: AIAirborneHammerOpportunityTuning;
  triggerCombatantAttack: (self: Combatant, weapon: CombatantWeapon) => void;
  startAIHammerJump: (
    self: Combatant,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType?: 'offensive' | 'defensive'
  ) => boolean;
}): AIAirborneHammerOpportunityResult {
  const canConsiderHammerOpportunity =
    targetAirborne &&
    difficulty !== 'easy' &&
    movementComplexity >= 50 &&
    canStartWeaponAction &&
    activeWeapon === 'hammer' &&
    frame.weaponState === 'ready' &&
    target.hp > 0 &&
    !targetProtected;

  if (!canConsiderHammerOpportunity) {
    return frame;
  }

  const fallingIntoHammer = (target.vel?.y ?? 0) <= 0.75 && distanceToTarget <= resolvedDangerZone + 2.5;
  const canReachBody = combatDistanceToTarget <= resolvedAiReach + tunedAnticipationFactor * 1.5;

  if (
    (fallingIntoHammer || canReachBody) &&
    Math.random() < tuning.hammerJumpReachBase + tunedAnticipationFactor * tuning.hammerJumpReachAnticipation
  ) {
    frame.aiState = 'COOLDOWN';
    frame.timer = resolveScaledAIWeaponReloadTime(state.settings, 'hammer', cooldownMultiplier);
    triggerCombatantAttack(self, 'hammer');
  } else if (
    !enemyInKillRange &&
    verticalDeltaToTarget > 2.0 &&
    distanceToTarget <= resolvedDangerZone + 4.5 &&
    Math.random() < tuning.hammerJumpVerticalBase + tunedAnticipationFactor * tuning.hammerJumpVerticalAnticipation
  ) {
    if (startAIHammerJump(self, frame.pos, frame.vel, toTarget, 'offensive')) {
      frame.weaponState = 'swing_up';
    }
  }

  return frame;
}
