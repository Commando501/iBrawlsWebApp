import * as THREE from 'three';
import { createRemoteCombatant } from '../../game/roster';
import { DEFAULT_AI_TEAM, PLAYER_TEAM, type TeamId } from '../../game/teamScoring';
import { type CharacterModelType, type UniversalSettings } from '../../types';
import { resolveCharacterModelType } from '../../characterModelTypes';
import { type CharacterLoadout } from '../VoxelModels';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import { createCombatantMeshRig } from './combatantModels';
import { syncCombatantTeamOutline } from './combatantTeamOutlines';
import { getInwardSpawnYaw } from './combatGeometry';
import { type CustomMapData } from '../../types';
import { getMultiplayerSpawnPoint } from './arenaSpawns';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type RemoteCombatantUpdate = {
  controller?: 'ai' | 'remote';
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
  team?: TeamId;
  modelType?: CharacterModelType;
  visualModelPolicy?: VisualModelPolicy | null;
  loadout?: CharacterLoadout;
};

const DEFAULT_REMOTE_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v2';
const DEFAULT_AI_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v1';

const resolveGameplayModelType = (data: RemoteCombatantUpdate): CharacterModelType | undefined => {
  if (data.controller === 'ai') {
    return data.modelType !== undefined
      ? resolveCharacterModelType(data.modelType, 'v2')
      : undefined;
  }

  if (data.loadout?.modelType !== undefined) {
    return resolveCharacterModelType(
      data.loadout.modelType,
      data.loadout.modelSystem ?? data.visualModelPolicy ?? DEFAULT_REMOTE_VISUAL_MODEL_POLICY
    );
  }

  if (data.modelType !== undefined) {
    return resolveCharacterModelType(
      data.modelType,
      normalizeVisualModelPolicy(data.visualModelPolicy ?? DEFAULT_REMOTE_VISUAL_MODEL_POLICY)
    );
  }

  return undefined;
};

const createVisualLoadout = (data: RemoteCombatantUpdate, modelType: CharacterModelType): CharacterLoadout => {
  if (data.controller === 'ai') {
    const visualModelPolicy = normalizeVisualModelPolicy(data.visualModelPolicy ?? DEFAULT_AI_VISUAL_MODEL_POLICY);
    const loadout = visualModelPolicy === 'v2'
      ? {
          ...(data.loadout ?? {}),
          modelType,
        }
      : data.loadout;

    return resolveLoadoutForVisualPolicy({
      visualModelPolicy,
      loadout,
    });
  }

  const visualModelPolicy = normalizeVisualModelPolicy(data.visualModelPolicy ?? DEFAULT_REMOTE_VISUAL_MODEL_POLICY);
  const loadout = visualModelPolicy === 'v2'
    ? {
        ...(data.loadout ?? {}),
        modelType: data.loadout?.modelType ?? modelType,
      }
    : data.loadout;

  return resolveLoadoutForVisualPolicy({
    visualModelPolicy,
    loadout,
  });
};

const inferGrifballRemoteTeam = (
  state: GrifballRuntimeState,
  clientId: string,
  data: RemoteCombatantUpdate
): TeamId | undefined => {
  if (data.team) return data.team;
  if (state.settings.gameMode !== 'grifball') return undefined;
  if (data.role === 'host' || clientId === state.hostClientId) return PLAYER_TEAM;
  if (data.role === 'client' || clientId === state.clientClientId) return DEFAULT_AI_TEAM;
  return undefined;
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
  v3Options = {},
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  clientId: string;
  data: RemoteCombatantUpdate;
  opponentClientId: string;
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
  v3Options?: V3RenderOptions;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  const gameplayModelType = resolveGameplayModelType(data);
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
        modelType: gameplayModelType,
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
  if (gameplayModelType !== undefined) {
    playerState.modelType = gameplayModelType;
  }
  if (data.invulnerabilityTimer !== undefined) playerState.invulnerabilityTimer = data.invulnerabilityTimer;
  const incomingTeam = inferGrifballRemoteTeam(state, clientId, data);
  if (incomingTeam) {
    playerState.team = incomingTeam;
  }
  const teamOutlineTeam = state.settings.gameMode === 'grifball'
    ? playerState.team ?? incomingTeam ?? null
    : null;

  let meshes = refs.otherPlayerMeshes.get(clientId);
  const hue = data.hue ?? playerState.hue;
  const visualLoadout = createVisualLoadout(data, resolveCharacterModelType(playerState.modelType, 'v2'));
  const visualLoadoutKey = JSON.stringify(visualLoadout);
  const qualityChanged = visualLoadout.modelSystem === 'v3' && (
    meshes?.group.userData.appliedV3QualityTier !== v3Options.v3QualityTier ||
    meshes?.group.userData.appliedV3Distance !== v3Options.v3Distance
  );
  if (!meshes || meshes.group.userData.appliedHue !== hue || meshes.group.userData.appliedLoadoutKey !== visualLoadoutKey || qualityChanged) {
    if (meshes?.group) scene.remove(meshes.group);
    meshes = createCombatantMeshRig(scene, hue, false, visualLoadout, v3Options, teamOutlineTeam, state.settings);
    meshes.group.userData.appliedLoadoutKey = visualLoadoutKey;
    refs.otherPlayerMeshes.set(clientId, meshes);
    playerState.hue = hue;
  }

  const { group, hammer, sword, pistol } = meshes;
  syncCombatantTeamOutline(group, teamOutlineTeam, state.settings);
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
