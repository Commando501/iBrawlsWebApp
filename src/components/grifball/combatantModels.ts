import * as THREE from 'three';
import {
  AVAILABLE_PRESETS,
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildPistolModel,
  buildVoxelSpartanModel,
  type CharacterLoadout,
} from '../VoxelModels';

export type CombatantMeshRig = {
  group: THREE.Group;
  hammer: THREE.Group;
  sword: THREE.Group;
  pistol?: THREE.Group;
};

export type RebuiltDualWeaponCombatantModel = {
  group: THREE.Group;
  hammer: THREE.Group;
  sword: THREE.Group;
};

const attachToUpperTorso = (group: THREE.Group, child: THREE.Object3D) => {
  if (group.userData.upperTorso) {
    group.userData.upperTorso.add(child);
  } else {
    group.add(child);
  }
};

const positionHammer = (hammer: THREE.Group) => {
  hammer.scale.set(0.6, 0.6, 0.6);
  hammer.position.set(0.5, 1.0 - 0.64, -0.4);
  hammer.rotation.set(Math.PI / 2, 0, 0);
};

const positionSword = (sword: THREE.Group) => {
  sword.scale.set(0.6, 0.6, 0.6);
  sword.position.set(0.5, 1.0 - 0.64, -0.32);
  // Blade is built along +y; negative X rotation points it toward -z (the
  // character's forward / visor direction). +PI/2 would aim it backward.
  sword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
};

const positionPistol = (pistol: THREE.Group) => {
  pistol.scale.set(0.6, 0.6, 0.6);
  pistol.position.set(0.5, 1.0 - 0.64, -0.32);
  pistol.rotation.set(Math.PI / 2, 0, 0);
};

export const getRandomLoadout = (): CharacterLoadout => {
  const helmets = AVAILABLE_PRESETS.helmet;
  const torsos = AVAILABLE_PRESETS.torso;
  const arms = AVAILABLE_PRESETS.arm;
  const legs = AVAILABLE_PRESETS.leg;
  const hammers = AVAILABLE_PRESETS.hammer;
  const swords = AVAILABLE_PRESETS.sword;
  return {
    helmet: helmets[Math.floor(Math.random() * helmets.length)],
    torso: torsos[Math.floor(Math.random() * torsos.length)],
    arm: arms[Math.floor(Math.random() * arms.length)],
    leg: legs[Math.floor(Math.random() * legs.length)],
    hammerPreset: hammers[Math.floor(Math.random() * hammers.length)],
    swordPreset: swords[Math.floor(Math.random() * swords.length)],
  };
};

export const createCombatantMeshRig = (scene: THREE.Scene, hue: number, isEnemyBot = false, loadout?: CharacterLoadout): CombatantMeshRig => {
  const resolvedLoadout = loadout ?? (isEnemyBot ? getRandomLoadout() : undefined);
  const group = buildVoxelSpartanModel(isEnemyBot, hue, resolvedLoadout);
  group.userData.appliedHue = hue;
  scene.add(group);

  const hammer = buildGravityHammerModel(hue, resolvedLoadout?.hammerPreset);
  positionHammer(hammer);
  attachToUpperTorso(group, hammer);

  const sword = buildKatarSwordModel(hue, resolvedLoadout?.swordPreset);
  positionSword(sword);
  sword.visible = false;
  attachToUpperTorso(group, sword);

  const pistol = buildPistolModel(hue);
  positionPistol(pistol);
  pistol.visible = false;
  attachToUpperTorso(group, pistol);

  return { group, hammer, sword, pistol };
};

export const rebuildDualWeaponCombatantModel = ({
  scene,
  previousGroup,
  isEnemyBot,
  hue,
  weaponHue,
  loadout,
  position,
  activeWeapon,
}: {
  scene: THREE.Scene;
  previousGroup?: THREE.Group | null;
  isEnemyBot: boolean;
  hue: number;
  weaponHue?: number | null;
  loadout?: CharacterLoadout;
  position: THREE.Vector3;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
}): RebuiltDualWeaponCombatantModel => {
  if (previousGroup) {
    scene.remove(previousGroup);
  }

  const group = buildVoxelSpartanModel(isEnemyBot, hue, loadout);
  group.position.copy(position);
  scene.add(group);

  const resolvedWeaponHue = weaponHue === null ? undefined : (weaponHue ?? hue);

  const hammer = buildGravityHammerModel(resolvedWeaponHue, loadout?.hammerPreset);
  positionHammer(hammer);
  hammer.visible = activeWeapon === 'hammer';
  attachToUpperTorso(group, hammer);

  const sword = buildKatarSwordModel(resolvedWeaponHue, loadout?.swordPreset);
  positionSword(sword);
  sword.visible = activeWeapon === 'sword';
  attachToUpperTorso(group, sword);

  return { group, hammer, sword };
};
