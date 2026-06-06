import * as THREE from 'three';
import {
  getSpawnGuardAimAngle,
  scorePosition,
} from '../../game/aiSpatialStrategy';
import { type AIBehaviorState, type Combatant, type CustomMapData } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export interface AISpawnGuardFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number;
}

export function resolveNoTargetSpawnGuardForCombatant({
  state,
  botId,
  mainAI,
  frame,
  spatialIQ,
  edgeInset,
  dt,
  activeCustomMap,
  getOptimalSpawnPoint,
  constrainCombatantToArena,
}: {
  state: GrifballRuntimeState;
  botId: string;
  mainAI: Combatant | undefined;
  frame: AISpawnGuardFrame;
  spatialIQ: number;
  edgeInset: number;
  dt: number;
  activeCustomMap: CustomMapData | null;
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
}): void {
  const livingPositions: THREE.Vector3[] = [];
  if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode) {
    livingPositions.push(state.playerPos);
  }
  if (mainAI && mainAI.hp > 0 && botId !== 'main_ai' && mainAI.aiState !== 'RESPAWNING') {
    livingPositions.push(mainAI.pos);
  }
  state.otherPlayers.forEach((other) => {
    if (other.id !== botId && other.hp > 0 && other.respawnTimer <= 0) {
      livingPositions.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
    }
  });

  const anticipatedSpawn = getOptimalSpawnPoint(livingPositions);
  const toSpawn = anticipatedSpawn.clone().sub(frame.pos);
  toSpawn.y = 0;
  const spawnDist = toSpawn.length();

  if (spawnDist > 0.1) {
    frame.yaw = getSpawnGuardAimAngle({
      botX: frame.pos.x,
      botZ: frame.pos.z,
      spawnX: anticipatedSpawn.x,
      spawnZ: anticipatedSpawn.z,
      spatialIQ,
    });
  }

  frame.aiState = 'SPAWN_GUARDING';
  frame.timer = 0;

  const spawnPosScore = scorePosition({
    botX: frame.pos.x,
    botZ: frame.pos.z,
    targetX: anticipatedSpawn.x,
    targetZ: anticipatedSpawn.z,
    arenaRadius: activeCustomMap ? activeCustomMap.arenaRadius : state.arenaRadius,
    mapShape: activeCustomMap?.mapShape,
    edgeInset,
  });

  if (spawnDist > 6.0) {
    const moveHeading = toSpawn.clone().normalize();
    if (spawnPosScore.centerRepositionStrength > 0.3 && spatialIQ >= 25) {
      const centerBlend = spawnPosScore.centerRepositionStrength * (spatialIQ / 100) * 0.4;
      const toCenter = new THREE.Vector3(-frame.pos.x, 0, -frame.pos.z).normalize();
      moveHeading.lerp(toCenter, centerBlend).normalize();
    }
    frame.vel.copy(moveHeading).multiplyScalar(3.5 * (state.settings.speedForward / 100));
    frame.pos.addScaledVector(frame.vel, dt);
  } else if (spawnDist < 5.0) {
    const moveHeading = toSpawn.clone().normalize();
    frame.vel.copy(moveHeading).multiplyScalar(-2.5 * (state.settings.speedBackward / 100));
    frame.pos.addScaledVector(frame.vel, dt);
  } else {
    frame.vel.set(0, 0, 0);
  }

  constrainCombatantToArena(frame.pos, frame.vel);
}
