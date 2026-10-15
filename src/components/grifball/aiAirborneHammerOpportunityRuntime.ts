import { simulationRandom } from '../../game/simulationRandom';
import * as THREE from 'three';
import { type Combatant } from '../../types';
import { type CombatantWeapon } from './combatantActions';
import { type TacticalTargetCandidate } from './combatGeometry';
import { resolveAIAirborneHammerOpportunity, type AIAirborneHammerOpportunityFrame, type AIAirborneHammerOpportunityTuning, type AIAirborneHammerOpportunityResult } from '../../game/aiAirborneHammerOpportunity';
export type { AIAirborneHammerOpportunityFrame, AIAirborneHammerOpportunityTuning, AIAirborneHammerOpportunityResult } from '../../game/aiAirborneHammerOpportunity';
import { type GrifballRuntimeState } from './runtimeState';

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
  random = simulationRandom,
}: {
  random?: () => number;
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
  return resolveAIAirborneHammerOpportunity({ settings: state.settings, frame, targetHp: target.hp,
    targetVerticalVelocity: target.vel?.y ?? 0, targetAirborne, targetProtected, difficulty, movementComplexity,
    canStartWeaponAction, activeWeapon, distanceToTarget, resolvedDangerZone, combatDistanceToTarget, resolvedAiReach,
    tunedAnticipationFactor, enemyInKillRange, verticalDeltaToTarget, cooldownMultiplier, tuning, random,
    triggerHammerAttack: () => triggerCombatantAttack(self, 'hammer'),
    startHammerJump: () => startAIHammerJump(self, frame.pos, frame.vel, toTarget, 'offensive') });
}
