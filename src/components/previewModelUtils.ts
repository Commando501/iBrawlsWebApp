import * as THREE from 'three';
import type { CharacterLoadout } from './VoxelModels';

const CUSTOM_ARMOR_SIGNATURE_SLOTS = ['helmet', 'torso', 'arm', 'leg'] as const;

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getPaintJobSignature(loadout?: CharacterLoadout): string {
  if (!loadout?.paintJob) return 'paint:none';
  return `paint:${hashString(JSON.stringify(loadout.paintJob))}`;
}

export function getPreviewLoadoutSignature(loadout?: CharacterLoadout): string {
  if (!loadout) return 'default';
  const customArmorSignature = CUSTOM_ARMOR_SIGNATURE_SLOTS
    .map((slot) => {
      const piece = loadout.customArmor?.[slot];
      if (!piece) return `${slot}:builtin`;
      return [
        slot,
        piece.id,
        piece.slot,
        piece.modelType ?? 'medium',
        piece.sourcePreset ?? '',
        piece.updatedAt,
        piece.voxels.length,
      ].join(':');
    })
    .join('|');
  return [
    loadout.modelSystem ?? 'v1',
    loadout.modelType ?? 'medium',
    loadout.helmet ?? 'mark-vi',
    loadout.torso ?? 'mark-vi',
    loadout.arm ?? 'mark-vi',
    loadout.leg ?? 'mark-vi',
    loadout.hammerPreset ?? 'default',
    loadout.swordPreset ?? 'default',
    getPaintJobSignature(loadout),
    customArmorSignature,
  ].join('~');
}

export function disposePreviewObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
