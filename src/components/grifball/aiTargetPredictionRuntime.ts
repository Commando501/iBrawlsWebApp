import * as THREE from 'three';
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

  const toTarget = movementTargetPos.clone().sub(botPos);
  toTarget.y = 0;

  return {
    predictedTargetPos,
    targetAirborne,
    movementTargetPos,
    toTarget,
    distanceToTarget: toTarget.length(),
    yaw: Math.atan2(toTarget.x, toTarget.z),
  };
}
