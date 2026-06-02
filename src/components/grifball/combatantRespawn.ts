import * as THREE from 'three';
import { clearBotComboState, type AIMatchContext } from '../../game/aiMatchContext';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type UniversalSettings } from '../../types';
import { getInwardSpawnYaw } from './combatGeometry';

type RespawnSettings = Pick<UniversalSettings, 'respawnInvulnerabilityDuration'>;

export const respawnAICombatant = ({
  combatant,
  mesh,
  settings,
  aiMatchContext,
  playerPos,
  rosterAI,
  getOptimalSpawnPoint,
  playRespawn,
}: {
  combatant: Combatant;
  mesh: THREE.Object3D;
  settings: RespawnSettings;
  aiMatchContext: AIMatchContext;
  playerPos: THREE.Vector3;
  rosterAI: Combatant[];
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  playRespawn: () => void;
}): void => {
  const c = combatant;
  c.hp = c.maxHp;

  const exclude: THREE.Vector3[] = [playerPos];
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
  c.spawnTime = Date.now();

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

  if (c.id === MAIN_AI_ID) {
    c.isJumping = false;
    c.hammerJumpPlanned = false;
    c.hammerJumpType = undefined;
    c.swapCooldownTimer = 0;
  }

  mesh.visible = true;
  playRespawn();
};
