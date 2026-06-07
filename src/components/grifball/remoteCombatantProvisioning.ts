import * as THREE from 'three';
import { createRemoteCombatant } from '../../game/roster';
import { type UniversalSettings } from '../../types';
import { createCombatantMeshRig } from './combatantModels';
import { getInwardSpawnYaw } from './combatGeometry';
import { type CustomMapData } from '../../types';
import { getMultiplayerSpawnPoint } from './arenaSpawns';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type RemoteCombatantUpdate = {
  role?: string;
  playerName?: string;
  hp?: number;
  maxHp?: number;
  hue?: number;
  isCrouching?: boolean;
  activeWeapon?: string;
  respawnTimer?: number;
  invulnerabilityTimer?: number;
  spawnSlot?: number;
  pos?: { x: number; y: number; z: number };
  vel?: { x: number; y: number; z: number };
  yaw?: number;
  pitch?: number;
};

export function createOrUpdateRemoteCombatantForState({
  state,
  refs,
  clientId,
  data,
  opponentClientId,
  activeCustomMap,
  spawnPoints,
  constrainCombatantToArena,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  clientId: string;
  data: RemoteCombatantUpdate;
  opponentClientId: string;
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  let playerState = state.otherPlayers.get(clientId);
  if (!playerState) {
    const isHostPlayer =
      (state.multiplayerRole === 'client' && clientId === opponentClientId) ||
      (state.multiplayerRole === 'observer' && data.role === 'host');
    const spawnZ = isHostPlayer ? 12 : -12;
    const spawnPos = getMultiplayerSpawnPoint(activeCustomMap, spawnPoints, isHostPlayer ? 0 : data.spawnSlot);
    playerState = createRemoteCombatant({
      id: clientId,
      playerName: data.playerName,
      spawnZ,
      spawnPos,
      settings: state.settings as UniversalSettings,
      data: {
        hp: data.hp,
        maxHp: data.maxHp,
        hue: data.hue,
        isCrouching: data.isCrouching,
        activeWeapon: data.activeWeapon as any,
        respawnTimer: data.respawnTimer,
        invulnerabilityTimer: data.invulnerabilityTimer,
      },
    });
    playerState.yaw = spawnPos.spawnYaw ?? getInwardSpawnYaw(playerState.pos);
    state.otherPlayers.set(clientId, playerState);
  }

  if (data.pos) playerState.pos.set(data.pos.x, data.pos.y, data.pos.z);
  if (data.vel) playerState.vel.set(data.vel.x, data.vel.y, data.vel.z);
  constrainCombatantToArena(playerState.pos, playerState.vel);
  if (data.yaw !== undefined) playerState.yaw = data.yaw;
  if (data.pitch !== undefined) playerState.pitch = data.pitch;
  if (data.hp !== undefined) playerState.hp = data.hp;
  if (data.maxHp !== undefined) playerState.maxHp = data.maxHp;
  if (data.isCrouching !== undefined) playerState.isCrouching = data.isCrouching;
  if (data.activeWeapon !== undefined) playerState.activeWeapon = data.activeWeapon as any;
  if (data.respawnTimer !== undefined) playerState.respawnTimer = data.respawnTimer;
  if (data.hue !== undefined) playerState.hue = data.hue;
  if (data.playerName) playerState.playerName = data.playerName;
  if (data.invulnerabilityTimer !== undefined) playerState.invulnerabilityTimer = data.invulnerabilityTimer;

  let meshes = refs.otherPlayerMeshes.get(clientId);
  const hue = data.hue ?? playerState.hue;
  if (!meshes || meshes.group.userData.appliedHue !== hue) {
    if (meshes?.group) scene.remove(meshes.group);
    meshes = createCombatantMeshRig(scene, hue, false);
    refs.otherPlayerMeshes.set(clientId, meshes);
    playerState.hue = hue;
  }

  const { group, hammer, sword, pistol } = meshes;
  group.position.copy(playerState.pos);
  group.rotation.y = playerState.yaw;

  if (playerState.isCrouching) {
    group.scale.set(1, 0.65, 1);
  } else {
    group.scale.set(1, 1, 1);
  }

  const activeWeapon = playerState.activeWeapon as string;
  hammer.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && activeWeapon === 'hammer';
  sword.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && activeWeapon === 'sword';
  if (pistol) {
    pistol.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && activeWeapon === 'pistol';
  }
  group.visible = playerState.hp > 0 && playerState.respawnTimer <= 0;
}
