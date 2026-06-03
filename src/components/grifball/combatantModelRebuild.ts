import * as THREE from 'three';
import { type Combatant } from '../../types';
import { type CharacterLoadout } from '../VoxelModels';
import { rebuildDualWeaponCombatantModel } from './combatantModels';
import { ballAsHammer } from '../../game/weaponCompat';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MultiplayerRole = 'host' | 'client' | 'observer' | null;

export function rebuildEnemyCombatantModelForState({
  state,
  refs,
  hue,
  isMultiplayer,
  multiplayerRole,
  playerLoadout,
  mainAI,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  hue: number;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  playerLoadout?: CharacterLoadout;
  mainAI: Combatant | undefined;
}): void {
  const scene = refs.scene;
  if (!scene || !refs.enemyGroup) return;

  const isEnemyBot = !isMultiplayer;
  const isLocalClient = isMultiplayer && multiplayerRole === 'client';
  const activeWeapon = ballAsHammer(multiplayerRole === 'observer'
    ? state.clientActiveWeapon
    : (mainAI?.activeWeapon || 'hammer'));
  const { group: enemyGroup, hammer: enemyHammer, sword: enemySword } = rebuildDualWeaponCombatantModel({
    scene,
    previousGroup: refs.enemyGroup,
    isEnemyBot,
    hue,
    weaponHue: isEnemyBot ? null : hue,
    loadout: isLocalClient ? playerLoadout : undefined,
    position: multiplayerRole === 'observer' ? state.clientPos : (mainAI ? mainAI.pos : new THREE.Vector3(0, 0, 0)),
    activeWeapon,
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
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  hue: number;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  playerLoadout?: CharacterLoadout;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  const isLocalHost = !isMultiplayer || multiplayerRole === 'host';
  const activeWeapon = ballAsHammer(multiplayerRole === 'observer' ? state.hostActiveWeapon : state.activeWeapon);
  const { group: hostGroup, hammer: hostHammer, sword: hostSword } = rebuildDualWeaponCombatantModel({
    scene,
    previousGroup: refs.hostGroup,
    isEnemyBot: false,
    hue,
    loadout: isLocalHost ? playerLoadout : undefined,
    position: multiplayerRole === 'observer' ? state.hostPos : state.playerPos,
    activeWeapon,
  });
  refs.hostGroup = hostGroup;
  refs.hostHammer = hostHammer;
  refs.hostSword = hostSword;
}
