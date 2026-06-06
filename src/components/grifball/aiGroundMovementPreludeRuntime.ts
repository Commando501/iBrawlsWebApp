import * as THREE from 'three';
import { getSprintSpeedMultiplier, getTargetRecedingSpeed, shouldAISprint } from '../../game/aiMovementMechanics';
import { blendSpatialHeading, getSpatialMovementBias, type SpatialMovementBias } from '../../game/aiSpatialStrategy';
import { bakeNavMesh, findShortestPath } from '../../game/mapNavigation';
import { type AIBehaviorState, type CustomMapData } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export interface AIGroundMovementPreludeFrame {
  lookHeading: THREE.Vector3;
  spatialBias: SpatialMovementBias;
  spatialLookHeading: THREE.Vector3;
  sidewayHeading: THREE.Vector3;
  isSprinting: boolean;
  sprintMult: number;
}

export function resolveAIGroundMovementPreludeForCombatant({
  state,
  refs,
  pos,
  movementTargetPos,
  target,
  predictedTargetPos,
  activeCustomMap,
  spatialIQ,
  edgeInset,
  aiState,
  distanceToTarget,
  resolvedDangerZone,
  isCrouching,
  slideActive,
  sprintEngageGap,
  sprintChaseTargetSpeed,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  pos: THREE.Vector3;
  movementTargetPos: THREE.Vector3;
  target: TacticalTargetCandidate;
  predictedTargetPos: THREE.Vector3;
  activeCustomMap: CustomMapData | null;
  spatialIQ: number;
  edgeInset: number;
  aiState: AIBehaviorState | undefined;
  distanceToTarget: number;
  resolvedDangerZone: number;
  isCrouching: boolean;
  slideActive: boolean;
  sprintEngageGap: number;
  sprintChaseTargetSpeed: number;
}): AIGroundMovementPreludeFrame {
  const lookHeading = target.pos.clone().sub(pos).normalize();

  if (activeCustomMap) {
    if (!refs.navMesh) {
      refs.navMesh = bakeNavMesh(activeCustomMap);
    }
    const path = findShortestPath(pos, movementTargetPos, refs.navMesh, activeCustomMap.objects);
    if (path && path.length > 0) {
      lookHeading.copy(path[0]).sub(pos);
      lookHeading.y = 0;
      lookHeading.normalize();
    }
  }

  const spatialBias = getSpatialMovementBias({
    botX: pos.x,
    botZ: pos.z,
    targetX: movementTargetPos.x,
    targetZ: movementTargetPos.z,
    targetVelX: target.vel?.x,
    targetVelZ: target.vel?.z,
    predictedTargetX: predictedTargetPos.x,
    predictedTargetZ: predictedTargetPos.z,
    arenaRadius: activeCustomMap ? activeCustomMap.arenaRadius : state.arenaRadius,
    spatialIQ,
    mapShape: activeCustomMap?.mapShape,
    edgeInset,
  });
  const blendedHeading = blendSpatialHeading(lookHeading.x, lookHeading.z, spatialBias);
  const spatialLookHeading = new THREE.Vector3(blendedHeading.x, 0, blendedHeading.z);
  const sidewayHeading = new THREE.Vector3(-spatialLookHeading.z, 0, spatialLookHeading.x);

  const targetRecedingSpeed = getTargetRecedingSpeed(
    pos.x,
    pos.z,
    target.pos.x,
    target.pos.z,
    target.vel?.x ?? 0,
    target.vel?.z ?? 0
  );
  const isSprinting = shouldAISprint({
    enableSprint: state.settings.enableSprint,
    state: aiState,
    distanceToTarget,
    engageRange: resolvedDangerZone,
    isCrouching,
    isDashing: false,
    isSliding: slideActive,
    targetRecedingSpeed,
    engageGap: sprintEngageGap,
    chaseTargetSpeed: sprintChaseTargetSpeed,
  });

  return {
    lookHeading,
    spatialBias,
    spatialLookHeading,
    sidewayHeading,
    isSprinting,
    sprintMult: isSprinting ? getSprintSpeedMultiplier(state.settings.speedSprint) : 1,
  };
}
