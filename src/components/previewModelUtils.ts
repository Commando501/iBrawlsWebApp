import * as THREE from 'three';
import type { CharacterLoadout } from './VoxelModels';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from './v3/v3ModelTypes';

type CustomArmorSignatureSlot = 'helmet' | 'torso' | 'arm' | 'leg' | V3CharacterSlotId;

const V2_CUSTOM_ARMOR_SIGNATURE_SLOTS: CustomArmorSignatureSlot[] = ['helmet', 'torso', 'arm', 'leg'];
const V3_CUSTOM_ARMOR_SIGNATURE_SLOTS: CustomArmorSignatureSlot[] = [...V3_CHARACTER_SLOT_IDS];

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
  const customArmorSlots = loadout.modelSystem === 'v3'
    ? V3_CUSTOM_ARMOR_SIGNATURE_SLOTS
    : V2_CUSTOM_ARMOR_SIGNATURE_SLOTS;
  const customArmorSignature = customArmorSlots
    .map((slot) => {
      const piece = loadout.customArmor?.[slot];
      if (!piece) return `${slot}:builtin`;
      return [
        slot,
        piece.modelSystem ?? 'v2',
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
