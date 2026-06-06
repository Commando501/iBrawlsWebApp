import * as THREE from 'three';
import {
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildPistolModel,
  type CharacterLoadout,
} from '../VoxelModels';
import { type GrifballThreeRefs } from './threeRefs';

export type LocalPlayerViewAdminSettings = {
  playerHue?: number;
};

export function buildLocalPlayerViewForRefs({
  refs,
  scene,
  camera,
  adminSettings,
  playerLoadout,
}: {
  refs: GrifballThreeRefs;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  adminSettings: LocalPlayerViewAdminSettings;
  playerLoadout?: CharacterLoadout;
}): void {
  const fpWeaponContainer = new THREE.Group();
  camera.add(fpWeaponContainer);

  const playerHammer = buildGravityHammerModel(adminSettings.playerHue, playerLoadout?.hammerPreset);
  playerHammer.position.set(0.35, -0.38, -0.65);
  playerHammer.rotation.set(0.15, -0.3, -0.15);
  fpWeaponContainer.add(playerHammer);
  refs.playerHammer = playerHammer;

  const playerSword = buildKatarSwordModel(adminSettings.playerHue, playerLoadout?.swordPreset);
  playerSword.position.set(0.35, -0.38, -0.5);
  playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
  playerSword.visible = false;
  fpWeaponContainer.add(playerSword);
  refs.playerSword = playerSword;

  const playerPistol = buildPistolModel(adminSettings.playerHue);
  playerPistol.position.set(0.25, -0.28, -0.4);
  playerPistol.rotation.set(0, 0, 0);
  playerPistol.visible = false;
  fpWeaponContainer.add(playerPistol);
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
