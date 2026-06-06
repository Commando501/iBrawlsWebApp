import * as THREE from 'three';
import {
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildVoxelSpartanModel,
} from '../VoxelModels';
import { type GrifballThreeRefs } from './threeRefs';

export function buildMultiplayerEnemyViewForRefs({
  refs,
  scene,
  mainAIHue,
}: {
  refs: GrifballThreeRefs;
  scene: THREE.Scene;
  mainAIHue?: number;
}): void {
  const enemyGroup = buildVoxelSpartanModel(true, mainAIHue);
  enemyGroup.position.copy(new THREE.Vector3(0, 0, -12));
  enemyGroup.userData.appliedHue = mainAIHue;
  scene.add(enemyGroup);
  refs.enemyGroup = enemyGroup;
  enemyGroup.visible = false;

  const enemyHammer = buildGravityHammerModel();
  enemyHammer.scale.set(0.6, 0.6, 0.6);
  enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4);
  enemyHammer.rotation.set(Math.PI / 2, 0, 0);
  if (enemyGroup.userData.upperTorso) {
    enemyGroup.userData.upperTorso.add(enemyHammer);
  } else {
    enemyGroup.add(enemyHammer);
  }
  refs.enemyHammer = enemyHammer;

  const enemySword = buildKatarSwordModel();
  enemySword.scale.set(0.6, 0.6, 0.6);
  enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
  enemySword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
  enemySword.visible = false;
  if (enemyGroup.userData.upperTorso) {
    enemyGroup.userData.upperTorso.add(enemySword);
  } else {
    enemyGroup.add(enemySword);
  }
  refs.enemySword = enemySword;
}
