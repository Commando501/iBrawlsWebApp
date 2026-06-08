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
import { THIRD_PERSON_RIGHT_HAND_REST_OFFSET } from './attackAnimationPresets';
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
  enemyHammer.position.set(
    0.5 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
    1.0 - 0.64 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
    -0.4 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2]
  );
  enemyHammer.rotation.set(Math.PI / 2, 0, 0);
  attachToCombatantAttachment(enemyGroup, 'thirdPersonWeaponGrip', enemyHammer);
  refs.enemyHammer = enemyHammer;

  const enemySword = buildKatarSwordModel();
  enemySword.scale.set(0.6, 0.6, 0.6);
  enemySword.position.set(
    0.5 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[0],
    1.0 - 0.64 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[1],
    -0.32 - THIRD_PERSON_RIGHT_HAND_REST_OFFSET[2]
  );
  enemySword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
  enemySword.visible = false;
  attachToCombatantAttachment(enemyGroup, 'thirdPersonWeaponGrip', enemySword);
  refs.enemySword = enemySword;
}
