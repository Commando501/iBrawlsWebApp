import * as THREE from 'three';
import { type CombatantMeshRig } from './combatantModels';
import { type GrifballThreeRefs } from './threeRefs';

export const getCombatantMesh = (
  threeRefs: GrifballThreeRefs,
  id: string
): THREE.Object3D | undefined => threeRefs.otherPlayerMeshes?.get(id)?.group;

export const getCombatantWeaponMeshes = (
  threeRefs: GrifballThreeRefs,
  id: string
): CombatantMeshRig | undefined => threeRefs.otherPlayerMeshes?.get(id);
