import * as THREE from 'three';
import {
  tickAIOrchestrator,
  type AIOrchestratorEvents,
  type AIOrchestratorSpawnCallbacks,
} from '../../game/aiOrchestrator';
import { MAIN_AI_ID } from '../../game/roster';
import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type Combatant } from '../../types';
import { getInwardSpawnYaw } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function createGrifballAIOrchestratorSpawnCallbacks(
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3
): AIOrchestratorSpawnCallbacks {
  return {
    getOptimalSpawnPoint,
    getInwardSpawnYaw,
  };
}

export function createGrifballAIOrchestratorEvents({
  refs,
  createOrUpdateRemotePlayer,
  resizeArena,
  pushStatsUpdate,
  playRespawn,
  silentSpawn,
}: {
  refs: GrifballThreeRefs;
  createOrUpdateRemotePlayer: (clientId: string, data: Combatant) => void;
  resizeArena: (playerCount: number) => void;
  pushStatsUpdate: () => void;
  playRespawn: () => void;
  silentSpawn?: boolean;
}): AIOrchestratorEvents {
  const scene = refs.scene;
  return {
    onBotSpawned: (botId, bot) => {
      createOrUpdateRemotePlayer(botId, bot);
      if (!silentSpawn) {
        playRespawn();
      }
    },
    onBotDespawned: (botId) => {
      if (!scene) return;
      const meshes = refs.otherPlayerMeshes.get(botId);
      if (meshes) {
        if (meshes.group) scene.remove(meshes.group);
        refs.otherPlayerMeshes.delete(botId);
      }
    },
    onMainAICreated: (mainAi) => {
      createOrUpdateRemotePlayer(MAIN_AI_ID, mainAi);
    },
    onHueChanged: (combatantId, combatant) => {
      if (!scene) return;
      const oldMeshes = refs.otherPlayerMeshes.get(combatantId);
      if (oldMeshes?.group) scene.remove(oldMeshes.group);
      refs.otherPlayerMeshes.delete(combatantId);
      createOrUpdateRemotePlayer(combatantId, combatant);
    },
    onRosterLayoutChanged: (totalCombatants) => {
      resizeArena(totalCombatants);
      pushStatsUpdate();
    },
  };
}

export function runGrifballAIOrchestratorForState({
  state,
  dt,
  isPlaying,
  legacy,
  offlineBotCount,
  spawnCallbacks,
  events,
}: {
  state: GrifballRuntimeState;
  dt: number;
  isPlaying: boolean;
  legacy: LegacyRosterProps;
  offlineBotCount: number;
  spawnCallbacks: AIOrchestratorSpawnCallbacks;
  events: AIOrchestratorEvents;
}): void {
  if (state.isMultiplayer) return;

  tickAIOrchestrator(
    {
      roster: state.otherPlayers,
      settings: state.settings,
      legacy,
      offlineBotCount,
      playerPos: state.playerPos,
      isPlaying,
      coordinator: state.aiMatchContext.coordinator,
    },
    dt,
    spawnCallbacks,
    events
  );
}
