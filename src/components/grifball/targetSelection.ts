import * as THREE from 'three';
import { type CharacterModelType, type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { adjustRangeForTargetModel } from './modelHitbox';
import { type GrifballRuntimeState } from './runtimeState';

const SWORD_LOCK_BODY_CENTER_HEIGHT = 0.825;
const SWORD_LOCK_MAX_ANGLE = 0.12;

export interface PlayerSwordLockTarget {
  pos: THREE.Vector3;
  dist: number;
  angle: number;
}

export interface EnemyAITarget {
  id: string;
  pos: THREE.Vector3;
  hp: number;
  invuln: number;
  isLunging: boolean;
  weaponState: string;
  respawnTimer: number;
  vel: THREE.Vector3;
  isCrouching: boolean;
  isObserver: boolean;
  playerName: string;
  modelType?: CharacterModelType;
}

const cloneTargetPosition = (pos: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 => {
  return pos instanceof THREE.Vector3
    ? pos.clone()
    : new THREE.Vector3(pos.x, pos.y, pos.z);
};

export const getPlayerSwordLockTarget = (
  state: GrifballRuntimeState,
  mainAI: Combatant | undefined,
  isMultiplayer: boolean
): PlayerSwordLockTarget | null => {
  const s = state;
  if (s.playerHP <= 0) return null;

  const eyePos = new THREE.Vector3(
    s.playerPos.x,
    1.65 - s.crouchAmount + s.playerPos.y,
    s.playerPos.z
  );
  const cameraLookDir = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
    .normalize();
  const maxDistance = s.settings.swordLungeDistance ?? 14.5;
  let bestTarget: PlayerSwordLockTarget | null = null;

  const considerTarget = (pos: THREE.Vector3, modelType?: CharacterModelType) => {
    const center = new THREE.Vector3(pos.x, pos.y + SWORD_LOCK_BODY_CENTER_HEIGHT, pos.z);
    const toTarget = center.clone().sub(eyePos);
    const dist = toTarget.length();
    if (dist <= 0.001 || dist > adjustRangeForTargetModel(maxDistance, modelType)) return;

    const dot = cameraLookDir.dot(toTarget.normalize());
    const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
    if (angle > SWORD_LOCK_MAX_ANGLE) return;

    if (!bestTarget || angle < bestTarget.angle || (Math.abs(angle - bestTarget.angle) < 0.01 && dist < bestTarget.dist)) {
      bestTarget = { pos: pos.clone(), dist, angle };
    }
  };

  if ((!isMultiplayer || s.otherPlayers.size === 0) && mainAI && mainAI.hp > 0 && mainAI.aiState !== 'RESPAWNING') {
    considerTarget(mainAI.pos, mainAI.modelType);
  }

  s.otherPlayers.forEach((other) => {
    if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
      considerTarget(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), other.modelType);
    }
  });

  return bestTarget;
};

export const getEnemyAITargetFromTacticalTarget = (
  best: TacticalTargetCandidate | null
): EnemyAITarget | null => {
  if (!best) {
    return null;
  }

  return {
    id: best.id,
    pos: cloneTargetPosition(best.pos),
    hp: best.hp,
    invuln: best.invulnerabilityTimer ?? 0,
    isLunging: best.isLunging,
    weaponState: best.weaponState,
    respawnTimer: 0,
    vel: best.vel,
    isCrouching: best.isCrouching,
    isObserver: false,
    playerName: best.playerName,
    modelType: best.modelType,
  };
};
