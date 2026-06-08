import * as THREE from 'three';
import {
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildVoxelSpartanModel,
} from '../VoxelModels';
import {
  attachToCombatantAttachment,
  buildCombatantRigForModel,
} from './combatantRig';
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
  buildCombatantRigForModel(enemyGroup);
  scene.add(enemyGroup);
  refs.enemyGroup = enemyGroup;
  enemyGroup.visible = false;

  const enemyHammer = buildGravityHammerModel();
  enemyHammer.scale.set(0.6, 0.6, 0.6);
  enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4);
  enemyHammer.rotation.set(Math.PI / 2, 0, 0);
  attachToCombatantAttachment(enemyGroup, 'thirdPersonWeaponGrip', enemyHammer);
  refs.enemyHammer = enemyHammer;

  const enemySword = buildKatarSwordModel();
  enemySword.scale.set(0.6, 0.6, 0.6);
  enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
  enemySword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
  enemySword.visible = false;
  attachToCombatantAttachment(enemyGroup, 'thirdPersonWeaponGrip', enemySword);
  refs.enemySword = enemySword;
}
