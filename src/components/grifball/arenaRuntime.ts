import * as THREE from 'three';
import { type CustomMapData } from '../../types';
import {
  getOptimalGrifballSpawnPoint,
  resizeArenaSceneForPlayerCount,
} from './arenaSpawns';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function getOptimalSpawnPointForArena({
  activeCustomMap,
  spawnPoints,
  excludePositions,
}: {
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  excludePositions: THREE.Vector3[];
}): THREE.Vector3 {
  return getOptimalGrifballSpawnPoint(activeCustomMap, spawnPoints, excludePositions);
}

export function resizeArenaForPlayerCount({
  state,
  refs,
  spawnPoints,
  playerCount,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  spawnPoints: THREE.Vector3[];
  playerCount: number;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  const { scale, arenaRadius } = resizeArenaSceneForPlayerCount(scene, spawnPoints, playerCount);
  state.arenaRadius = arenaRadius;

  console.log(`Arena dynamically scaled for ${playerCount} players. Factor: ${scale}, Radius: ${state.arenaRadius}`);
}
