import * as THREE from 'three';
import { getYawForHeading } from '../../game/yaw';
import { type CustomMapData } from '../../types';
import {
  predictCombatantPosition,
  predictLandingPosition,
  type TacticalTargetCandidate,
} from './combatGeometry';
import { clampVectorXZToArenaBounds } from './arenaBounds';

export function resolveAITargetPredictionFrame({
  botPos,
  target,
  effectiveReactionLatency,
  tunedAnticipationFactor,
  predictionAnticipationBonus,
  predictionLandingWeight,
  movementComplexity,
  activeCustomMap,
  arenaRadius,
  aimAtCurrentTarget = false,
}: {
  botPos: THREE.Vector3;
  target: Pick<TacticalTargetCandidate, 'pos' | 'vel'>;
  effectiveReactionLatency: number;
  tunedAnticipationFactor: number;
  predictionAnticipationBonus: number;
  predictionLandingWeight: number;
  movementComplexity: number;
  activeCustomMap: CustomMapData | null;
  arenaRadius: number;
  /** Committed melee follows the current target rather than a movement forecast. */
  aimAtCurrentTarget?: boolean;
}): {
  predictedTargetPos: THREE.Vector3;
  targetAirborne: boolean;
  movementTargetPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  distanceToTarget: number;
  yaw: number;
} {
  const anticipationBonus = tunedAnticipationFactor * predictionAnticipationBonus;
  const predictionLead = tunedAnticipationFactor > 0.1 ? effectiveReactionLatency + anticipationBonus : 0;
  const predictedTargetPos = predictCombatantPosition(target.pos, target.vel, predictionLead);
  const targetAirborne =
    predictedTargetPos.y > 0.35 ||
    target.pos.y > 0.35 ||
    (!!target.vel && Math.abs(target.vel.y) > 1.0);
  const targetLandingPos = predictLandingPosition(
    target.pos,
    target.vel,
    Math.min(1.5, predictionLead + tunedAnticipationFactor * predictionLandingWeight)
  );

  clampVectorXZToArenaBounds({ pos: predictedTargetPos, activeCustomMap, arenaRadius });

  const movementTargetPos = targetAirborne && movementComplexity >= 50
    ? ((target.vel?.y ?? 0) < -0.75 ? targetLandingPos : predictedTargetPos)
    : predictedTargetPos;

  clampVectorXZToArenaBounds({ pos: movementTargetPos, activeCustomMap, arenaRadius });

  // A movement forecast can cross behind the attacker before the actual target.
  // Keep steering prediction while aiming committed melee at the visible target.
  const aimTargetPos = aimAtCurrentTarget ? target.pos : movementTargetPos;
  const toTarget = movementTargetPos.clone().sub(botPos);
  toTarget.y = 0;

  return {
    predictedTargetPos,
    targetAirborne,
    movementTargetPos,
    toTarget,
    distanceToTarget: toTarget.length(),
    yaw: getYawForHeading(aimTargetPos.x - botPos.x, aimTargetPos.z - botPos.z),
  };
}
