import { simulationTimestamp } from '../../game/simulationRandom';
import * as THREE from 'three';
import { clearBotComboState, type AIMatchContext } from '../../game/aiMatchContext';
import { type Combatant, type UniversalSettings } from '../../types';
import { getInwardSpawnYaw } from './combatGeometry';

type RespawnSettings = Pick<UniversalSettings, 'respawnInvulnerabilityDuration'>;

export const respawnAICombatant = ({
  combatant,
  mesh,
  settings,
  aiMatchContext,
  playerPos,
  excludePlayer = true,
  rosterAI,
  getOptimalSpawnPoint,
  playRespawn,
}: {
  combatant: Combatant;
  mesh: THREE.Object3D;
  settings: RespawnSettings;
  aiMatchContext: AIMatchContext;
  playerPos: THREE.Vector3;
  /** Observer cameras and dead players do not occupy a spawn. */
  excludePlayer?: boolean;
  rosterAI: Combatant[];
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  playRespawn: () => void;
}): void => {
  const c = combatant;
  c.hp = c.maxHp;

  const exclude: THREE.Vector3[] = excludePlayer ? [playerPos] : [];
  rosterAI.forEach((other) => {
    if (other.id !== c.id && other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
      exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
    }
  });

  const spawnPos = getOptimalSpawnPoint(exclude);
  c.pos.copy(spawnPos);
  c.vel.set(0, 0, 0);
  c.yaw = getInwardSpawnYaw(spawnPos);

  c.weaponState = 'ready';
  c.weaponTimer = 0;
  c.aiHammerJumpCooldownTimer = 0;
  c.invulnerabilityTimer = settings.respawnInvulnerabilityDuration;
  c.spawnTime = simulationTimestamp();

  c.lastSwordAttackTime = c.lastHammerAttackTime = 0;
  c.isLunging = false;
  c.aiState = 'APPROACHING';
  c.aiTimer = 0;
  c.aiDashRemaining = 0;
  c.aiLastLungeOutcome = undefined;
  c.aiLastLungeTargetId = undefined;
  c.aiPostLungeDecisionTimer = 0;
  c.aiPendingPostEvasionCharge = false;
  c.aiCoordCommitTimer = 0;
  c.swapLockoutTimer = 0;
  c.aiPressureTargetId = undefined;
  clearBotComboState(aiMatchContext, c.id);

  // Every roster bot starts a new grounded life, including ordinary bots killed
  // during a jump. Carrying airborne state into revival delays objective control.
  c.isJumping = false;
  c.aiHammerJumpsInAir = 0;
  c.hammerJumpPlanned = false;
  c.hammerJumpType = undefined;
  c.hammerJumpWindowTimer = 0;
  c.swapCooldownTimer = 0;

  mesh.visible = true;
  playRespawn();
};
