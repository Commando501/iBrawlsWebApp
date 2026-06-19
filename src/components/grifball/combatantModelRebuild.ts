import * as THREE from 'three';
import { type Combatant } from '../../types';
import { type CharacterLoadout } from '../VoxelModels';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import {
  DEFAULT_AI_TEAM,
  PLAYER_TEAM,
  opponentTeamId,
  type TeamId,
} from '../../game/teamScoring';
import { rebuildDualWeaponCombatantModel } from './combatantModels';
import { ballAsHammer } from '../../game/weaponCompat';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MultiplayerRole = 'host' | 'client' | 'observer' | null;

const resolveEnemyTeamOutlineTeam = ({
  state,
  isMultiplayer,
  multiplayerRole,
  mainAI,
}: {
  state: GrifballRuntimeState;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  mainAI: Combatant | undefined;
}): TeamId | null => {
  if (state.settings.gameMode !== 'grifball') return null;
  if (!isMultiplayer) return mainAI?.team ?? DEFAULT_AI_TEAM;
  if (multiplayerRole === 'observer') return DEFAULT_AI_TEAM;
  return opponentTeamId(state.localPlayerTeam);
};

const resolveHostTeamOutlineTeam = ({
  state,
  multiplayerRole,
}: {
  state: GrifballRuntimeState;
  multiplayerRole: MultiplayerRole;
}): TeamId | null => {
  if (state.settings.gameMode !== 'grifball') return null;
  if (multiplayerRole === 'observer') return PLAYER_TEAM;
  return state.localPlayerTeam;
};

export function rebuildEnemyCombatantModelForState({
  state,
  refs,
  hue,
  isMultiplayer,
  multiplayerRole,
  playerLoadout,
  mainAI,
  v3Options = {},
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  hue: number;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  playerLoadout?: CharacterLoadout;
  mainAI: Combatant | undefined;
  v3Options?: V3RenderOptions;
}): void {
  const scene = refs.scene;
  if (!scene || !refs.enemyGroup) return;

  const isEnemyBot = !isMultiplayer;
  const isLocalClient = isMultiplayer && multiplayerRole === 'client';
  const activeWeapon = ballAsHammer(multiplayerRole === 'observer'
    ? state.clientActiveWeapon
    : (mainAI?.activeWeapon || 'hammer'));
  const enemyLoadout = isEnemyBot
    ? undefined
    : isLocalClient ? playerLoadout : undefined;
  const teamOutlineTeam = resolveEnemyTeamOutlineTeam({
    state,
    isMultiplayer,
    multiplayerRole,
    mainAI,
  });
  const { group: enemyGroup, hammer: enemyHammer, sword: enemySword } = rebuildDualWeaponCombatantModel({
    scene,
    previousGroup: refs.enemyGroup,
    isEnemyBot,
    hue,
    weaponHue: isEnemyBot ? null : hue,
    loadout: enemyLoadout,
    position: multiplayerRole === 'observer' ? state.clientPos : (mainAI ? mainAI.pos : new THREE.Vector3(0, 0, 0)),
    activeWeapon,
    v3Options,
    teamOutlineTeam,
    teamOutlineOptions: state.settings,
  });
  refs.enemyGroup = enemyGroup;
  refs.enemyHammer = enemyHammer;
  refs.enemySword = enemySword;
}

export function rebuildHostCombatantModelForState({
  state,
  refs,
  hue,
  isMultiplayer,
  multiplayerRole,
  playerLoadout,
  v3Options = {},
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  hue: number;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  playerLoadout?: CharacterLoadout;
  v3Options?: V3RenderOptions;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  const isLocalHost = !isMultiplayer || multiplayerRole === 'host';
  const activeWeapon = ballAsHammer(multiplayerRole === 'observer' ? state.hostActiveWeapon : state.activeWeapon);
  const teamOutlineTeam = resolveHostTeamOutlineTeam({ state, multiplayerRole });
  const { group: hostGroup, hammer: hostHammer, sword: hostSword } = rebuildDualWeaponCombatantModel({
    scene,
    previousGroup: refs.hostGroup,
    isEnemyBot: false,
    hue,
    loadout: isLocalHost ? playerLoadout : undefined,
    position: multiplayerRole === 'observer' ? state.hostPos : state.playerPos,
    activeWeapon,
    v3Options,
    teamOutlineTeam,
    teamOutlineOptions: state.settings,
  });
  refs.hostGroup = hostGroup;
  refs.hostHammer = hostHammer;
  refs.hostSword = hostSword;
}
