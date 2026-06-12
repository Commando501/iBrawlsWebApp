import * as THREE from 'three';
import {
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildPistolModel,
  type CharacterLoadout,
} from '../VoxelModels';
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../v3/VoxelModelsV3';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import {
  attachToAttachmentPoint,
  createFirstPersonWeaponRig,
} from './combatantRig';
import { getFirstPersonV3WeaponPose } from './combatantAnimationV3';
import { type GrifballThreeRefs } from './threeRefs';

export type LocalPlayerViewAdminSettings = {
  playerHue?: number;
};

const buildLocalFirstPersonWeaponSet = (
  hue: number | undefined,
  loadout?: CharacterLoadout,
  v3Options: V3RenderOptions = {}
) => ({
  hammer: loadout?.modelSystem === 'v3' ? buildV3HammerModel(hue, v3Options) : buildGravityHammerModel(hue, loadout?.hammerPreset),
  sword: loadout?.modelSystem === 'v3' ? buildV3SwordModel(hue, v3Options) : buildKatarSwordModel(hue, loadout?.swordPreset),
  pistol: loadout?.modelSystem === 'v3' ? buildV3PistolModel(hue, v3Options) : buildPistolModel(hue),
});

const applyLocalV3FirstPersonPose = (
  weapon: THREE.Group,
  activeWeapon: 'hammer' | 'sword' | 'pistol'
): void => {
  const pose = getFirstPersonV3WeaponPose({
    activeWeapon,
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    settings: {},
  });
  weapon.position.set(...pose.position);
  weapon.rotation.set(...pose.rotation);
  weapon.userData.v3View = 'firstPerson';
};

export function buildLocalPlayerViewForRefs({
  refs,
  scene,
  camera,
  adminSettings,
  playerLoadout,
  v3Options = {},
}: {
  refs: GrifballThreeRefs;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  adminSettings: LocalPlayerViewAdminSettings;
  playerLoadout?: CharacterLoadout;
  v3Options?: V3RenderOptions;
}): void {
  const firstPersonRig = createFirstPersonWeaponRig(camera);
  const weaponGrip = firstPersonRig.attachments.firstPersonWeaponGrip;
  const localWeapons = buildLocalFirstPersonWeaponSet(adminSettings.playerHue, playerLoadout, v3Options);
  const isV3Loadout = playerLoadout?.modelSystem === 'v3';

  const playerHammer = localWeapons.hammer;
  if (isV3Loadout) {
    applyLocalV3FirstPersonPose(playerHammer, 'hammer');
  } else {
    playerHammer.position.set(0.35, -0.38, -0.65);
    playerHammer.rotation.set(0.15, -0.3, -0.15);
  }
  attachToAttachmentPoint(weaponGrip, playerHammer);
  refs.playerHammer = playerHammer;

  const playerSword = localWeapons.sword;
  if (isV3Loadout) {
    applyLocalV3FirstPersonPose(playerSword, 'sword');
  } else {
    playerSword.position.set(0.35, -0.38, -0.5);
    playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
  }
  playerSword.visible = false;
  attachToAttachmentPoint(weaponGrip, playerSword);
  refs.playerSword = playerSword;

  const playerPistol = localWeapons.pistol;
  if (isV3Loadout) {
    applyLocalV3FirstPersonPose(playerPistol, 'pistol');
  } else {
    playerPistol.position.set(0.25, -0.28, -0.4);
    playerPistol.rotation.set(0, 0, 0);
  }
  playerPistol.visible = false;
  attachToAttachmentPoint(weaponGrip, playerPistol);
  refs.playerPistol = playerPistol;

  const debugGeo = new THREE.SphereGeometry(4.5, 32, 16);
  const debugPlayerMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const debugPlayerSphere = new THREE.Mesh(debugGeo, debugPlayerMat);
  scene.add(debugPlayerSphere);
  refs.debugPlayerSphere = debugPlayerSphere;

  const debugEnemyMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const debugEnemySphere = new THREE.Mesh(debugGeo, debugEnemyMat);
  scene.add(debugEnemySphere);
  refs.debugEnemySphere = debugEnemySphere;

  const jumpZoneGeo = new THREE.RingGeometry(0.96, 1.0, 64);
  jumpZoneGeo.rotateX(-Math.PI / 2);
  const jumpZoneMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const playerJumpZoneMesh = new THREE.Mesh(jumpZoneGeo, jumpZoneMat);
  scene.add(playerJumpZoneMesh);
  refs.playerJumpZoneMesh = playerJumpZoneMesh;
}
