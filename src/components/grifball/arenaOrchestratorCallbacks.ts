import * as THREE from 'three';
import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type CustomMapData } from '../../types';
import {
  createGrifballAIOrchestratorEvents,
  createGrifballAIOrchestratorSpawnCallbacks,
  runGrifballAIOrchestratorForState,
} from './aiOrchestratorBridge';
import {
  getOptimalSpawnPointForArena,
  resizeArenaForPlayerCount,
} from './arenaRuntime';
import {
  getGrifballTeamSpawn,
  resolveActiveSpawnPoints,
} from './arenaSpawns';
import { getInwardSpawnYaw } from './combatGeometry';
import { createOrUpdateRemoteCombatantForState } from './remoteCombatantProvisioning';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function createArenaOrchestratorCallbacksForState({
  getState,
  getRefs,
  spawnPoints,
  getActiveCustomMap,
  getLegacyRosterProps,
  getOfflineBotCount,
  isPlaying,
  opponentClientId,
  constrainCombatantToArena,
  pushStatsUpdate,
  playRespawn,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  spawnPoints: THREE.Vector3[];
  getActiveCustomMap: () => CustomMapData | null;
  getLegacyRosterProps: () => LegacyRosterProps;
  getOfflineBotCount: () => number;
  isPlaying: boolean;
  opponentClientId: string;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
  pushStatsUpdate: () => void;
  playRespawn: () => void;
}) {
  const getOptimalSpawnPoint = (excludePositions: THREE.Vector3[]): THREE.Vector3 => {
    return getOptimalSpawnPointForArena({
      activeCustomMap: getActiveCustomMap(),
      spawnPoints,
      excludePositions,
    });
  };

  const placeCombatantsAtGrifballSpawns = () => {
    const state = getState();
    const activeCustomMap = getActiveCustomMap();
    const fallback = resolveActiveSpawnPoints(activeCustomMap, spawnPoints);
    const used: THREE.Vector3[] = [];

    const playerSpawn = getGrifballTeamSpawn(activeCustomMap, state.localPlayerTeam, fallback, used);
    state.playerPos.copy(playerSpawn);
    state.playerVel.set(0, 0, 0);
    state.yaw = playerSpawn.spawnYaw ?? getInwardSpawnYaw(playerSpawn);
    used.push(playerSpawn.clone());

    for (const bot of state.otherPlayers.values()) {
      if (bot.controller !== 'ai') continue;
      const team = bot.team || 'red';
      const spawn = getGrifballTeamSpawn(activeCustomMap, team, fallback, used);
      bot.pos.copy(spawn);
      bot.vel.set(0, 0, 0);
      bot.yaw = spawn.spawnYaw ?? getInwardSpawnYaw(spawn);
      used.push(spawn.clone());
    }
  };

  const resizeArena = (playerCount: number) => {
    resizeArenaForPlayerCount({
      state: getState(),
      refs: getRefs(),
      spawnPoints,
      playerCount,
    });
  };

  const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
    createOrUpdateRemoteCombatantForState({
      state: getState(),
      refs: getRefs(),
      clientId,
      data,
      opponentClientId,
      activeCustomMap: getActiveCustomMap(),
      spawnPoints,
      constrainCombatantToArena,
    });
  };

  const buildOrchestratorSpawnCallbacks = () => {
    const state = getState();
    return createGrifballAIOrchestratorSpawnCallbacks((exclude, team) => {
      if (state.settings.gameMode === 'grifball' && team) {
        const activeCustomMap = getActiveCustomMap();
        const fallback = resolveActiveSpawnPoints(activeCustomMap, spawnPoints);
        return getGrifballTeamSpawn(activeCustomMap, team, fallback, exclude);
      }
      return getOptimalSpawnPoint(exclude);
    });
  };

  const buildOrchestratorEvents = (opts?: { silentSpawn?: boolean }) =>
    createGrifballAIOrchestratorEvents({
      refs: getRefs(),
      createOrUpdateRemotePlayer,
      resizeArena,
      pushStatsUpdate,
      playRespawn,
      silentSpawn: opts?.silentSpawn,
    });

  const runAIOrchestrator = (dt: number) => {
    runGrifballAIOrchestratorForState({
      state: getState(),
      dt,
      isPlaying,
      legacy: getLegacyRosterProps(),
      offlineBotCount: getOfflineBotCount(),
      spawnCallbacks: buildOrchestratorSpawnCallbacks(),
      events: buildOrchestratorEvents(),
    });
  };

  return {
    getOptimalSpawnPoint,
    placeCombatantsAtGrifballSpawns,
    resizeArena,
    createOrUpdateRemotePlayer,
    buildOrchestratorSpawnCallbacks,
    buildOrchestratorEvents,
    runAIOrchestrator,
  };
}
