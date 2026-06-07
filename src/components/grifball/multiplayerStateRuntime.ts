import { removeMainAIFromRoster } from '../../game/roster';
import { type CustomMapData } from '../../types';
import { getMultiplayerSpawnPoint } from './arenaSpawns';
import { getInwardSpawnYaw } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import * as THREE from 'three';

type MultiplayerRole = GrifballRuntimeState['multiplayerRole'];

export function syncMultiplayerRuntimeModeForState({
  state,
  refs,
  isMultiplayer,
  multiplayerRole,
  multiplayerSpawnSlot,
  activeCustomMap,
  spawnPoints,
  replayActive,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  multiplayerSpawnSlot: number;
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  replayActive: boolean;
}): void {
  state.isObserverMode = multiplayerRole === 'observer' || replayActive;

  if (state.isObserverMode) {
    if (refs.playerHammer) refs.playerHammer.visible = false;
    if (refs.playerSword) refs.playerSword.visible = false;

    state.playerPos.set(0, 6, 17);
    state.yaw = getInwardSpawnYaw(state.playerPos);
    state.pitch = -0.3;
  } else {
    if (refs.playerHammer) refs.playerHammer.visible = state.activeWeapon === 'hammer';
    if (refs.playerSword) refs.playerSword.visible = state.activeWeapon === 'sword';

    const scene = refs.scene;
    if (scene && refs.hostGroup) {
      scene.remove(refs.hostGroup);
      refs.hostGroup = null;
    }
  }

  if (!isMultiplayer) return;

  removeMainAIFromRoster(state.otherPlayers);
  state.multiplayerSpawnSlot = multiplayerSpawnSlot;
  if (multiplayerRole === 'client' || multiplayerRole === 'host') {
    const spawnPos = getMultiplayerSpawnPoint(activeCustomMap, spawnPoints, multiplayerSpawnSlot);
    state.playerPos.copy(spawnPos);
    state.yaw = spawnPos.spawnYaw ?? getInwardSpawnYaw(spawnPos);
  }
}

export function syncMultiplayerPropsForState({
  state,
  isMultiplayer,
  multiplayerRole,
  multiplayerSpawnSlot,
}: {
  state: GrifballRuntimeState;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  multiplayerSpawnSlot: number;
}): void {
  state.isMultiplayer = isMultiplayer;
  state.multiplayerRole = multiplayerRole;
  state.multiplayerSpawnSlot = multiplayerSpawnSlot;
  if (isMultiplayer) {
    removeMainAIFromRoster(state.otherPlayers);
  }
}
