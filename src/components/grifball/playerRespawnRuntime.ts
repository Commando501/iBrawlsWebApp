import * as THREE from 'three';
import { type Combatant, type CustomMapData } from '../../types';
import { getGrifballTeamSpawn, getMultiplayerSpawnPoint, resolveActiveSpawnPoints } from './arenaSpawns';
import { getOptimalSpawnPointForArena } from './arenaRuntime';
import { getInwardSpawnYaw } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

export function updatePlayerRespawnForState({
  state,
  dt,
  isMultiplayer,
  getMainAi,
  activeCustomMap,
  spawnPoints,
  playRespawn,
}: {
  state: GrifballRuntimeState;
  dt: number;
  isMultiplayer: boolean;
  getMainAi: () => Combatant | undefined;
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  playRespawn: () => void;
}): boolean {
  const playerIsDead = state.playerHP <= 0;
  if (!playerIsDead) return false;

  state.playerSpreeCount = 0;
  state.playerRespawnTimer -= dt;
  if (state.playerRespawnTimer > 0) return true;

  state.playerHP = state.playerMaxHP;
  const exclude: THREE.Vector3[] = [];
  state.otherPlayers.forEach((other) => {
    if (other.hp > 0 && other.respawnTimer <= 0) {
      exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
    }
  });

  const mainAi = getMainAi();
  if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING') {
    exclude.push(mainAi.pos);
  }

  const spawnPos =
    isMultiplayer
      ? state.settings.gameMode === 'grifball'
        ? getGrifballTeamSpawn(
            activeCustomMap,
            state.localPlayerTeam,
            resolveActiveSpawnPoints(activeCustomMap, spawnPoints),
            exclude,
            state.multiplayerSpawnSlot
          )
        : getMultiplayerSpawnPoint(activeCustomMap, spawnPoints, state.multiplayerSpawnSlot, exclude)
    : state.settings.gameMode === 'grifball'
      ? getGrifballTeamSpawn(
          activeCustomMap,
          state.localPlayerTeam,
          resolveActiveSpawnPoints(activeCustomMap, spawnPoints),
          exclude
        )
      : getOptimalSpawnPointForArena({
          activeCustomMap,
          spawnPoints,
          excludePositions: exclude,
        });

  state.playerPos.copy(spawnPos);
  state.yaw = getInwardSpawnYaw(spawnPos);
  state.playerVel.set(0, 0, 0);
  state.pitch = 0;
  state.playerInvulnerabilityTimer = state.settings.respawnInvulnerabilityDuration;
  state.playerSpawnTime = Date.now();
  state.swapLockoutTimer = 0;
  state.swapCooldownTimer = 0;
  playRespawn();

  return true;
}
