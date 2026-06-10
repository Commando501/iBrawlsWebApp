import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CharacterLoadout,
  DEFAULT_LOADOUT,
  applyPaintJob,
  VoxelData,
  SpartanColors,
  ArmorPaintJob,
} from './VoxelModels';
import {
  customArmorPieceToVoxels,
  validateCustomArmorPiece,
} from './customArmor';
import {
  CHARACTER_MODEL_PROFILES,
  getCharacterModelProfile,
  resolveCharacterModelType,
} from '../characterModelTypes';
import type { CharacterModelType } from '../types';
import {
  verifyV2PartConstraints,
} from './v2ArmorConstraints';
export {
  V2_PART_CONSTRAINTS,
  getV2PartDimensions,
  verifyV2PartConstraints,
  type PartConstraint,
} from './v2ArmorConstraints';

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

export function createBeveledBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const w = width;
  const h = height;
  const r = Math.min(radius, width * 0.4);

  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const extrudeSettings = {
    depth: depth - r * 2,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: 4,
  };

  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.center();
  return geo;
}

interface MergedBox {
  startX: number;
  startY: number;
  startZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  color: string;
  emissive: boolean;
}

export function perform3DGreedyMeshing(voxels: VoxelData[]): MergedBox[] {
  if (voxels.length === 0) return [];

  const groups = new Map<string, VoxelData[]>();
  voxels.forEach((v) => {
    const key = `${v.color}_${v.emissive ? '1' : '0'}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(v);
  });

  const mergedBoxes: MergedBox[] = [];

  groups.forEach((groupVoxels, key) => {
    const parts = key.split('_');
    const color = parts[0];
    const emissive = parts[1] === '1';

    const coordSet = new Set<string>();
    groupVoxels.forEach((v) => {
      coordSet.add(`${v.x},${v.y},${v.z}`);
    });

    const visited = new Set<string>();

    const sortedVoxels = [...groupVoxels].sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.z !== b.z) return a.z - b.z;
      return a.x - b.x;
    });

    sortedVoxels.forEach((v) => {
      const vKey = `${v.x},${v.y},${v.z}`;
      if (visited.has(vKey)) return;

      let startX = v.x;
      let startY = v.y;
      let startZ = v.z;

      let sizeX = 1;
      let sizeY = 1;
      let sizeZ = 1;

      while (true) {
        const nextX = startX + sizeX;
        const checkKey = `${nextX},${startY},${startZ}`;
        if (coordSet.has(checkKey) && !visited.has(checkKey)) {
          sizeX++;
        } else {
          break;
        }
      }

      while (true) {
        const nextZ = startZ + sizeZ;
        let canGrowZ = true;
        for (let dx = 0; dx < sizeX; dx++) {
          const checkKey = `${startX + dx},${startY},${nextZ}`;
          if (!coordSet.has(checkKey) || visited.has(checkKey)) {
            canGrowZ = false;
            break;
          }
        }
        if (canGrowZ) {
          sizeZ++;
        } else {
          break;
        }
      }

      while (true) {
        const nextY = startY + sizeY;
        let canGrowY = true;
        for (let dx = 0; dx < sizeX; dx++) {
          for (let dz = 0; dz < sizeZ; dz++) {
            const checkKey = `${startX + dx},${nextY},${startZ + dz}`;
            if (!coordSet.has(checkKey) || visited.has(checkKey)) {
              canGrowY = false;
              break;
            }
          }
          if (!canGrowY) break;
        }
        if (canGrowY) {
          sizeY++;
        } else {
          break;
        }
      }

      for (let dy = 0; dy < sizeY; dy++) {
        for (let dz = 0; dz < sizeZ; dz++) {
          for (let dx = 0; dx < sizeX; dx++) {
            const markKey = `${startX + dx},${startY + dy},${startZ + dz}`;
            visited.add(markKey);
          }
        }
      }

      mergedBoxes.push({
        startX,
        startY,
        startZ,
        sizeX,
        sizeY,
        sizeZ,
        color,
        emissive,
      });
    });
  });

  return mergedBoxes;
}

export function mergeVoxelGeometries(
  voxels: VoxelData[],
  scale: number,
  pivotX: number,
  pivotY: number,
  pivotZ: number
): THREE.BufferGeometry {
  if (voxels.length === 0) return new THREE.BufferGeometry();

  const mergedBoxes = perform3DGreedyMeshing(voxels);
  const geometries: THREE.BufferGeometry[] = [];

  mergedBoxes.forEach((box) => {
    const boxW = box.sizeX * scale;
    const boxH = box.sizeY * scale;
    const boxD = box.sizeZ * scale;

    const baseBevelRadius = scale * 0.15;
    const bevelRadius = Math.min(baseBevelRadius, boxW * 0.4, boxH * 0.4, boxD * 0.4);

    const geo = createBeveledBoxGeometry(boxW, boxH, boxD, bevelRadius);

    const centerX = (box.startX + (box.sizeX - 1) / 2 - pivotX) * scale;
    const centerY = (box.startY + (box.sizeY - 1) / 2 - pivotY) * scale;
    const centerZ = (box.startZ + (box.sizeZ - 1) / 2 - pivotZ) * scale;
    geo.translate(centerX, centerY, centerZ);

    const color = new THREE.Color(box.color);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geo);
  });

  const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  return merged;
}

// ─── Primitive Helpers ─────────────────────────────────────────────────────────

function addVox(v: VoxelData[], x: number, y: number, z: number, color: string, emissive?: boolean) {
  v.push({ x, y, z, color, emissive });
}

function addBox(v: VoxelData[], x1: number, x2: number, y1: number, y2: number, z1: number, z2: number, color: string, emissive?: boolean) {
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      for (let z = z1; z <= z2; z++) {
        addVox(v, x, y, z, color, emissive);
      }
    }
  }
}

function mirrorX(voxels: VoxelData[]): VoxelData[] {
  return voxels.map((v) => ({ ...v, x: -v.x }));
}

function voxelKey(v: VoxelData): string {
  return `${v.x},${v.y},${v.z}`;
}

function dedupeVoxelData(voxels: VoxelData[]): VoxelData[] {
  const map = new Map<string, VoxelData>();
  for (const voxel of voxels) {
    map.set(voxelKey(voxel), { ...voxel });
  }
  return [...map.values()].sort((a, b) => (
    a.y !== b.y ? a.y - b.y : a.z !== b.z ? a.z - b.z : a.x - b.x
  ));
}

function addPowerArmorVolume(
  voxels: VoxelData[],
  x1: number,
  x2: number,
  y1: number,
  y2: number,
  z1: number,
  z2: number,
  colors: SpartanColors,
  options: { accent?: boolean } = {}
): void {
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      for (let z = z1; z <= z2; z++) {
        const edge = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
        const reinforced = options.accent && (Math.abs(x) === Math.max(Math.abs(x1), Math.abs(x2)) || z === z1);
        voxels.push({
          x,
          y,
          z,
          color: reinforced ? colors.accent : edge ? colors.primary : colors.secondary,
        });
      }
    }
  }
}

function applyLargeProfileVolume(slot: string, base: VoxelData[], colors: SpartanColors): VoxelData[] {
  const large: VoxelData[] = [];

  if (slot === 'helmet') {
    addPowerArmorVolume(large, -3, 3, 35, 35, -2, 1, colors);
    addPowerArmorVolume(large, -4, 4, 36, 45, -4, 3, colors, { accent: true });
  } else if (slot === 'torso') {
    addPowerArmorVolume(large, -4, 4, 11, 18, -2, 2, colors);
    addPowerArmorVolume(large, -6, 6, 19, 34, -6, 7, colors, { accent: true });
  } else if (slot === 'leftArm') {
    addPowerArmorVolume(large, -10, -4, 25, 32, -3, 2, colors, { accent: true });
    addPowerArmorVolume(large, -7, -4, 20, 24, -4, 4, colors);
    addPowerArmorVolume(large, -8, -4, 16, 19, -4, 4, colors);
    addPowerArmorVolume(large, -7, -4, 12, 15, -1, 1, colors);
  } else if (slot === 'leftLeg') {
    addPowerArmorVolume(large, -6, -1, 17, 23, -5, 6, colors, { accent: true });
    addPowerArmorVolume(large, -6, -1, 8, 16, -7, 6, colors);
    addPowerArmorVolume(large, -6, -1, 3, 7, -3, 1, colors);
    addPowerArmorVolume(large, -6, -1, 0, 2, -4, -1, colors);
  } else {
    return base;
  }

  return dedupeVoxelData([...large, ...base]);
}

// ─── V2 HIGH-RESOLUTION SPARTAN GENERATORS ─────────────────────────────────────

function buildHelmet_Base(c: SpartanColors, visorYStart: number, visorYEnd: number, visorZ: number, visorXSize: number): VoxelData[] {
  const v: VoxelData[] = [];
  addBox(v, -1, 1, 35, 35, -1, 1, c.secondary);
  addBox(v, -3, 3, 36, 44, -3, 3, c.primary);
  addBox(v, -3, 3, 36, 43, 3, 3, c.secondary);
  addBox(v, -2, 2, 45, 45, -2, 2, c.primary);
  for (let y = visorYStart; y <= visorYEnd; y++) {
    for (let x = -visorXSize; x <= visorXSize; x++) {
      const idx = v.findIndex(vox => vox.x === x && vox.y === y && vox.z === visorZ + 1);
      if (idx !== -1) v.splice(idx, 1);
      addVox(v, x, y, visorZ, c.visor, true);
    }
  }
  return v;
}

function buildHelmet_MarkVI(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 38, 41, -4, 2);
  addBox(v, -3, 3, 42, 42, -4, -3, c.accent);
  addBox(v, 0, 0, 44, 45, -2, 2, '#f97316');
  addBox(v, -4, -4, 38, 39, 0, 1, c.accent);
  addBox(v, 4, 4, 38, 39, 0, 1, c.accent);
  addVox(v, -4, 40, 0, c.visor, true);
  addVox(v, 4, 40, 0, c.visor, true);
  addVox(v, -3, 36, -3, c.dark);
  addVox(v, 3, 36, -3, c.dark);
  return v;
}

function buildHelmet_ODST(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 37, 39, -4, 3);
  addBox(v, -2, 2, 43, 43, -4, -3, c.accent);
  addVox(v, -3, 36, -4, c.dark);
  addVox(v, 3, 36, -4, c.dark);
  addBox(v, 4, 4, 39, 43, 1, 1, c.dark);
  addVox(v, 4, 44, 1, c.visor, true);
  return v;
}

function buildHelmet_Recon(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 37, 40, -4, 2);
  addBox(v, -4, -4, 40, 42, -1, 1, c.secondary);
  addBox(v, 4, 4, 40, 42, -1, 1, c.secondary);
  addVox(v, -2, 41, -4, '#ef4444', true);
  addVox(v, 0, 44, 3, c.secondary);
  addVox(v, 0, 45, 3, c.accent, true);
  return v;
}

function buildHelmet_EVA(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];
  addBox(v, -1, 1, 35, 35, -1, 1, c.secondary);
  addBox(v, -3, 3, 36, 44, 0, 3, c.primary);
  addBox(v, -3, -3, 36, 43, -2, -1, c.primary);
  addBox(v, 3, 3, 36, 43, -2, -1, c.primary);
  addBox(v, -2, 2, 45, 45, -1, 2, c.primary);
  addBox(v, -2, 2, 36, 42, -3, -1, c.visor, true);
  addBox(v, -3, -3, 37, 41, -3, -3, c.visor, true);
  addBox(v, 3, 3, 37, 41, -3, -3, c.visor, true);
  addVox(v, 0, 39, -4, '#ffffff', true);
  addVox(v, -1, 39, -4, '#60a5fa', true);
  addVox(v, 1, 39, -4, '#60a5fa', true);
  return v;
}

function buildHelmet_Gungnir(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 0, -1, -4, 0);
  addBox(v, -3, 3, 37, 42, -4, -4, c.primary);
  addVox(v, -2, 39, -5, '#ef4444', true);
  addBox(v, 0, 0, 36, 44, -4, -3, c.accent);
  addBox(v, -3, -3, 42, 44, 0, 0, c.dark);
  addBox(v, 3, 3, 42, 44, 0, 0, c.dark);
  addVox(v, -3, 45, 0, c.visor, true);
  addVox(v, 3, 45, 0, c.visor, true);
  return v;
}

function buildHelmet_EOD(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 38, 39, -4, 2);
  addBox(v, -3, -3, 36, 37, -3, -2, c.accent);
  addVox(v, -3, 36, -4, c.dark);
  addBox(v, 3, 3, 36, 37, -3, -2, c.accent);
  addVox(v, 3, 36, -4, c.dark);
  addBox(v, -3, 3, 40, 41, -4, -3, c.dark);
  addBox(v, -1, 1, 37, 40, 4, 4, c.dark);
  return v;
}

function buildHelmet_Hayabusa(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 38, 39, -4, 2);
  addBox(v, 0, 0, 40, 44, -5, -4, c.accent, true);
  addBox(v, -4, -4, 36, 41, -2, 1, c.primary);
  addBox(v, 4, 4, 36, 41, -2, 1, c.primary);
  addBox(v, 0, 0, 36, 36, -4, -3, c.primary);
  addBox(v, 0, 0, 38, 43, 3, 3, c.accent);
  return v;
}

function buildHelmet_CQB(c: SpartanColors): VoxelData[] {
  const v = buildHelmet_Base(c, 38, 40, -4, 1);
  addBox(v, 0, 0, 36, 37, -4, -4, c.visor, true);
  addBox(v, -3, -3, 36, 38, -3, -1, c.secondary);
  addBox(v, 3, 3, 36, 38, -3, -1, c.secondary);
  return v;
}

function buildTorso_Base(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];
  addBox(v, -2, 2, 11, 12, -1, 1, c.secondary);
  addBox(v, -3, 3, 13, 18, -2, 2, c.secondary);
  addBox(v, -4, 4, 19, 32, -3, 3, c.primary);
  addBox(v, -4, 4, 19, 31, 3, 3, c.secondary);
  for (let y = 24; y <= 30; y++) {
    for (let z = -2; z <= 2; z++) {
      const lIdx = v.findIndex(vox => vox.x === -4 && vox.y === y && vox.z === z);
      if (lIdx !== -1) v.splice(lIdx, 1);
      const rIdx = v.findIndex(vox => vox.x === 4 && vox.y === y && vox.z === z);
      if (rIdx !== -1) v.splice(rIdx, 1);
    }
  }
  return v;
}

function buildTorso_MarkVI(c: SpartanColors): VoxelData[] {
  const v = buildTorso_Base(c);
  addBox(v, -4, 4, 24, 30, -4, -4, c.primary);
  addBox(v, -2, 2, 13, 17, -3, -3, c.primary);
  for (let y = 13; y <= 17; y++) {
    addVox(v, 0, y, -3, c.visor, true);
  }
  addBox(v, -3, 3, 25, 31, 4, 4, c.secondary);
  addVox(v, -2, 28, 4, c.visor, true);
  addVox(v, 2, 28, 4, c.visor, true);
  addVox(v, -2, 29, 4, '#f59e0b', true);
  addVox(v, 2, 29, 4, '#f59e0b', true);
  addVox(v, -3, 27, -4, c.dark);
  addVox(v, 3, 27, -4, c.dark);
  addBox(v, -3, 3, 33, 34, -4, -4, c.secondary);
  return v;
}

function buildTorso_Scout(c: SpartanColors): VoxelData[] {
  const v = buildTorso_Base(c);
  addBox(v, -3, 3, 23, 29, -4, -4, c.primary);
  addBox(v, -5, -5, 20, 25, -1, 1, c.secondary);
  addBox(v, 5, 5, 20, 25, -1, 1, c.secondary);
  for (let y = 14; y <= 22; y++) {
    addVox(v, 0, y, -3, c.accent, true);
  }
  addBox(v, -1, 1, 26, 32, 4, 4, c.secondary);
  addVox(v, 0, 33, 4, c.accent, true);
  return v;
}

function buildTorso_Recon(c: SpartanColors): VoxelData[] {
  const v = buildTorso_Base(c);
  addBox(v, -4, -1, 22, 28, -4, -4, c.highlight);
  addBox(v, 1, 4, 22, 28, -4, -4, c.primary);
  addBox(v, -3, -3, 29, 32, -4, 3, c.dark);
  addBox(v, 3, 3, 29, 32, -4, 3, c.dark);
  addBox(v, -2, 2, 13, 16, -3, -3, c.secondary);
  addVox(v, -2, 27, -4, c.visor, true);
  return v;
}

function buildTorso_EOD(c: SpartanColors): VoxelData[] {
  const v = buildTorso_Base(c);
  addBox(v, -5, 5, 20, 31, -4, -4, c.primary);
  addBox(v, -4, 4, 32, 34, -4, -4, c.secondary);
  addBox(v, -3, -3, 15, 18, -3, -3, c.secondary);
  addBox(v, 3, 3, 15, 18, -3, -3, c.secondary);
  addVox(v, 0, 24, -4, c.visor, true);
  return v;
}

function buildTorso_Hayabusa(c: SpartanColors): VoxelData[] {
  const v = buildTorso_Base(c);
  addBox(v, -3, 3, 20, 22, -4, -4, c.primary);
  addBox(v, -3, 3, 24, 26, -4, -4, c.primary);
  addBox(v, -3, 3, 28, 30, -4, -4, c.highlight);
  addBox(v, -3, 3, 12, 13, -3, 2, c.accent);
  addBox(v, -1, 1, 20, 30, 4, 5, c.dark);
  return v;
}

function buildLeftArm_Base(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];
  addBox(v, -6, -5, 12, 15, -1, 0, c.secondary);
  addBox(v, -6, -5, 16, 19, -1, 1, c.secondary);
  addBox(v, -7, -5, 16, 19, -2, 0, c.primary);
  addBox(v, -6, -5, 20, 24, -1, 1, c.secondary);
  addBox(v, -7, -4, 21, 24, -2, 0, c.primary);
  addBox(v, -6, -5, 25, 27, -1, 1, c.secondary);
  addBox(v, -8, -4, 26, 31, -2, 2, c.primary);
  addBox(v, -6, -4, 31, 32, -1, 1, c.secondary);
  return v;
}

function buildLeftArm_MarkVI(c: SpartanColors): VoxelData[] {
  const v = buildLeftArm_Base(c);
  addBox(v, -9, -9, 28, 31, -1, 1, c.highlight);
  addBox(v, -7, -7, 16, 18, -1, -1, c.accent);
  return v;
}

function buildLeftArm_ODST(c: SpartanColors): VoxelData[] {
  const v = buildLeftArm_Base(c);
  addBox(v, -8, -5, 16, 19, -1, 1, c.primary);
  addBox(v, -8, -5, 28, 31, -3, -2, c.dark);
  addVox(v, -5, 15, -2, c.visor, true);
  return v;
}

// Keeping a simple alias mapping inside getVoxelSegmentDataV2 for EOD / Recon / Hayabusa arm presets
function buildLeftArm_Recon(c: SpartanColors): VoxelData[] {
  const v = buildLeftArm_Base(c);
  addBox(v, -8, -6, 28, 30, -3, -2, c.highlight);
  addBox(v, -7, -6, 17, 19, -2, -2, c.visor, true);
  return v;
}

function buildLeftArm_EOD(c: SpartanColors): VoxelData[] {
  const v = buildLeftArm_Base(c);
  addBox(v, -9, -4, 25, 31, -3, 2, c.primary);
  addBox(v, -9, -9, 26, 30, -2, 2, c.accent);
  addBox(v, -8, -4, 16, 18, -2, 2, c.secondary);
  return v;
}

function buildLeftArm_Hayabusa(c: SpartanColors): VoxelData[] {
  const v = buildLeftArm_Base(c);
  addBox(v, -9, -9, 30, 30, 0, 0, c.accent);
  addBox(v, -8, -8, 31, 31, 0, 0, c.accent);
  addBox(v, -7, -7, 13, 15, -2, 1, c.primary);
  return v;
}

function buildLeftLeg_Base(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];
  addBox(v, -4, -2, 0, 2, -4, -3, c.secondary);
  addBox(v, -4, -2, 3, 4, -3, 1, c.secondary);
  addBox(v, -4, -2, 5, 7, -2, 0, c.primary);
  addBox(v, -3, -2, 8, 16, -1, 1, c.secondary);
  addBox(v, -4, -1, 8, 15, 0, 2, c.secondary);
  addBox(v, -4, -2, 9, 15, -2, -2, c.primary);
  addBox(v, -4, -2, 16, 16, -2, 0, c.primary);
  addBox(v, -3, -2, 17, 23, -1, 1, c.secondary);
  addBox(v, -4, -1, 18, 23, -2, 2, c.primary);
  return v;
}

function buildLeftLeg_MarkVI(c: SpartanColors): VoxelData[] {
  const v = buildLeftLeg_Base(c);
  addBox(v, -3, -2, 16, 16, -2, -2, c.highlight);
  addVox(v, -4, 11, -2, c.visor, true);
  addBox(v, -4, -4, 4, 5, -3, -3, c.secondary);
  return v;
}

function buildLeftLeg_JumpJet(c: SpartanColors): VoxelData[] {
  const v = buildLeftLeg_Base(c);
  addBox(v, -4, -2, 10, 13, 3, 3, c.secondary);
  addVox(v, -3, 11, 3, c.visor, true);
  addVox(v, -3, 12, 3, c.visor, true);
  addBox(v, -5, -5, 12, 14, -1, 1, c.accent);
  return v;
}

function buildLeftLeg_ODST(c: SpartanColors): VoxelData[] {
  const v = buildLeftLeg_Base(c);
  addBox(v, -4, -1, 15, 16, -3, -2, c.dark);
  addBox(v, -5, -5, 9, 12, 0, 0, c.dark);
  addVox(v, -1, 4, 0, c.visor, true);
  return v;
}

function buildLeftLeg_EOD(c: SpartanColors): VoxelData[] {
  const v = buildLeftLeg_Base(c);
  addBox(v, -5, -1, 8, 14, -3, 2, c.secondary);
  addBox(v, -5, -1, 18, 23, -3, 3, c.primary);
  addBox(v, -5, -2, 3, 4, -2, 0, c.primary);
  return v;
}

function buildLeftLeg_Hayabusa(c: SpartanColors): VoxelData[] {
  const v = buildLeftLeg_Base(c);
  addBox(v, -5, -5, 19, 22, -2, 2, c.highlight);
  const idx = v.findIndex(vox => vox.x === -3 && vox.y === 0 && vox.z === -4);
  if (idx !== -1) v.splice(idx, 1);
  return v;
}

function buildHip(c: SpartanColors, modelType: CharacterModelType = 'medium'): VoxelData[] {
  const v: VoxelData[] = [];
  if (modelType === 'large') {
    addPowerArmorVolume(v, -5, 4, 0, 10, -3, 3, c, { accent: true });
  }
  addBox(v, -4, 4, 4, 10, -2, 2, c.secondary);
  addBox(v, -2, 2, 0, 8, -3, -3, c.primary);
  addBox(v, -1, 1, 9, 10, -3, -3, c.accent);
  addBox(v, -3, 3, 3, 9, 3, 3, c.secondary);
  addBox(v, -4, -4, 2, 6, -2, 2, c.dark);
  addBox(v, 4, 4, 2, 6, -2, 2, c.dark);
  return dedupeVoxelData(v);
}

// ─── Preset Loader for V2 ───────────────────────────────────────────────────────

export function getVoxelSegmentDataV2(
  slot: string,
  preset: string,
  customHue?: number,
  isEnemy: boolean = false,
  modelType: CharacterModelType = 'medium'
): VoxelData[] {
  const primaryHex = customHue !== undefined
    ? `hsl(${customHue}, 85%, 50%)`
    : isEnemy ? '#ef4444' : '#3b82f6';
  const visorHex = customHue !== undefined
    ? `hsl(${customHue}, 95%, 70%)`
    : isEnemy ? '#facc15' : '#10b981';
  const highlightHex = customHue !== undefined
    ? `hsl(${customHue}, 75%, 65%)`
    : isEnemy ? '#f87171' : '#60a5fa';
  const accentHex = customHue !== undefined
    ? `hsl(${customHue}, 90%, 75%)`
    : isEnemy ? '#fca5a5' : '#93c5fd';

  const colors: SpartanColors = {
    primary: primaryHex,
    secondary: '#1e293b',
    visor: visorHex,
    accent: accentHex,
    dark: '#0f172a',
    highlight: highlightHex,
  };
  const applyProfile = (sourceSlot: string, voxels: VoxelData[]) => (
    modelType === 'large' ? applyLargeProfileVolume(sourceSlot, voxels, colors) : voxels
  );

  if (slot === 'helmet') {
    const fn = {
      'mark-vi': buildHelmet_MarkVI,
      'odst': buildHelmet_ODST,
      'recon': buildHelmet_Recon,
      'eva': buildHelmet_EVA,
      'gungnir': buildHelmet_Gungnir,
      'eod': buildHelmet_EOD,
      'hayabusa': buildHelmet_Hayabusa,
      'cqb': buildHelmet_CQB,
    }[preset] || buildHelmet_MarkVI;
    return applyProfile('helmet', fn(colors));
  } else if (slot === 'torso') {
    const fn = {
      'mark-vi': buildTorso_MarkVI,
      'scout': buildTorso_Scout,
      'recon': buildTorso_Recon,
      'eod': buildTorso_EOD,
      'hayabusa': buildTorso_Hayabusa,
    }[preset] || buildTorso_MarkVI;
    return applyProfile('torso', fn(colors));
  } else if (slot === 'leftArm') {
    const fn = {
      'mark-vi': buildLeftArm_MarkVI,
      'odst': buildLeftArm_ODST,
      'recon': buildLeftArm_Recon,
      'eod': buildLeftArm_EOD,
      'hayabusa': buildLeftArm_Hayabusa,
    }[preset] || buildLeftArm_MarkVI;
    return applyProfile('leftArm', fn(colors));
  } else if (slot === 'rightArm') {
    const fn = {
      'mark-vi': buildLeftArm_MarkVI,
      'odst': buildLeftArm_ODST,
      'recon': buildLeftArm_Recon,
      'eod': buildLeftArm_EOD,
      'hayabusa': buildLeftArm_Hayabusa,
    }[preset] || buildLeftArm_MarkVI;
    return mirrorX(applyProfile('leftArm', fn(colors)));
  } else if (slot === 'leftLeg') {
    const fn = {
      'mark-vi': buildLeftLeg_MarkVI,
      'jump-jet': buildLeftLeg_JumpJet,
      'odst': buildLeftLeg_ODST,
      'eod': buildLeftLeg_EOD,
      'hayabusa': buildLeftLeg_Hayabusa,
    }[preset] || buildLeftLeg_MarkVI;
    return applyProfile('leftLeg', fn(colors));
  } else if (slot === 'rightLeg') {
    const fn = {
      'mark-vi': buildLeftLeg_MarkVI,
      'jump-jet': buildLeftLeg_JumpJet,
      'odst': buildLeftLeg_ODST,
      'eod': buildLeftLeg_EOD,
      'hayabusa': buildLeftLeg_Hayabusa,
    }[preset] || buildLeftLeg_MarkVI;
    return mirrorX(applyProfile('leftLeg', fn(colors)));
  }

  return [];
}

// ─── SPARTAN V2 MODEL BUILDER ──────────────────────────────────────────────────

export function buildVoxelSpartanModelV2(
  isEnemy: boolean = true,
  customHue?: number,
  loadout: CharacterLoadout = DEFAULT_LOADOUT
): THREE.Group {
  const primaryHex = customHue !== undefined
    ? `hsl(${customHue}, 85%, 50%)`
    : isEnemy ? '#ef4444' : '#3b82f6';
  const visorHex = customHue !== undefined
    ? `hsl(${customHue}, 95%, 70%)`
    : isEnemy ? '#facc15' : '#10b981';
  const highlightHex = customHue !== undefined
    ? `hsl(${customHue}, 75%, 65%)`
    : isEnemy ? '#f87171' : '#60a5fa';
  const accentHex = customHue !== undefined
    ? `hsl(${customHue}, 90%, 75%)`
    : isEnemy ? '#fca5a5' : '#93c5fd';

  const colors: SpartanColors = {
    primary: primaryHex,
    secondary: '#1e293b',
    visor: visorHex,
    accent: accentHex,
    dark: '#0f172a',
    highlight: highlightHex,
  };

  const modelType = resolveCharacterModelType(loadout.modelType, loadout.modelSystem);
  const modelProfile = getCharacterModelProfile(modelType, 'v2');
  const scale = modelProfile.voxelScale;

  const resolveCustomSlot = (
    slot: 'helmet' | 'torso' | 'arm' | 'leg',
    fallback: () => VoxelData[],
    options: { mirrorX?: boolean } = {}
  ): VoxelData[] => {
    const piece = loadout.customArmor?.[slot];
    if (!piece) return fallback();
    if (resolveCharacterModelType(piece.modelType, 'v2') !== modelType) return fallback();
    const validation = validateCustomArmorPiece(piece);
    if (!validation.valid || piece.slot !== slot) return fallback();
    return customArmorPieceToVoxels(piece, colors, options);
  };

  const helmetVoxels = resolveCustomSlot(
    'helmet',
    () => getVoxelSegmentDataV2('helmet', loadout.helmet ?? 'mark-vi', customHue, isEnemy, modelType)
  );
  const torsoVoxels = resolveCustomSlot(
    'torso',
    () => getVoxelSegmentDataV2('torso', loadout.torso ?? 'mark-vi', customHue, isEnemy, modelType)
  );
  const leftArmVoxels = resolveCustomSlot(
    'arm',
    () => getVoxelSegmentDataV2('leftArm', loadout.arm ?? 'mark-vi', customHue, isEnemy, modelType)
  );
  const rightArmVoxels = resolveCustomSlot(
    'arm',
    () => getVoxelSegmentDataV2('rightArm', loadout.arm ?? 'mark-vi', customHue, isEnemy, modelType),
    { mirrorX: true }
  );
  const leftLegVoxels = resolveCustomSlot(
    'leg',
    () => getVoxelSegmentDataV2('leftLeg', loadout.leg ?? 'mark-vi', customHue, isEnemy, modelType)
  );
  const rightLegVoxels = resolveCustomSlot(
    'leg',
    () => getVoxelSegmentDataV2('rightLeg', loadout.leg ?? 'mark-vi', customHue, isEnemy, modelType),
    { mirrorX: true }
  );
  const hipVoxels = buildHip(colors, modelType);

  const paintJob = loadout.paintJob;
  applyPaintJob(helmetVoxels, 'helmet', paintJob);
  applyPaintJob(torsoVoxels, 'torso', paintJob);
  applyPaintJob(leftArmVoxels, 'leftArm', paintJob);
  applyPaintJob(rightArmVoxels, 'rightArm', paintJob);
  applyPaintJob(leftLegVoxels, 'leftLeg', paintJob);
  applyPaintJob(rightLegVoxels, 'rightLeg', paintJob);

  const pelvis = hipVoxels;
  const stomach = torsoVoxels.filter((v) => v.y <= 18);
  const chest = torsoVoxels.filter((v) => v.y >= 19);
  const neck = helmetVoxels.filter((v) => v.y === 35);
  const head = helmetVoxels.filter((v) => v.y > 35);

  const shoulder_l = leftArmVoxels.filter((v) => v.y >= 25);
  const arm_upper_l = leftArmVoxels.filter((v) => v.y >= 20 && v.y <= 24);
  const arm_lower_l = leftArmVoxels.filter((v) => v.y >= 16 && v.y <= 19);
  const hand_l = leftArmVoxels.filter((v) => v.y <= 15);

  const shoulder_r = rightArmVoxels.filter((v) => v.y >= 25);
  const arm_upper_r = rightArmVoxels.filter((v) => v.y >= 20 && v.y <= 24);
  const arm_lower_r = rightArmVoxels.filter((v) => v.y >= 16 && v.y <= 19);
  const hand_r = rightArmVoxels.filter((v) => v.y <= 15);

  const leg_upper_l = leftLegVoxels.filter((v) => v.y >= 17);
  const leg_lower_l = leftLegVoxels.filter((v) => v.y >= 8 && v.y <= 16);
  const foot_l = leftLegVoxels.filter((v) => v.y >= 3 && v.y <= 7);
  const toes_l = leftLegVoxels.filter((v) => v.y <= 2);

  const leg_upper_r = rightLegVoxels.filter((v) => v.y >= 17);
  const leg_lower_r = rightLegVoxels.filter((v) => v.y >= 8 && v.y <= 16);
  const foot_r = rightLegVoxels.filter((v) => v.y >= 3 && v.y <= 7);
  const toes_r = rightLegVoxels.filter((v) => v.y <= 2);

  verifyV2PartConstraints(pelvis, 'pelvis');
  verifyV2PartConstraints(stomach, 'stomach');
  verifyV2PartConstraints(chest, 'chest');
  verifyV2PartConstraints(neck, 'neck');
  verifyV2PartConstraints(head, 'head');

  verifyV2PartConstraints(shoulder_l, 'shoulder_l');
  verifyV2PartConstraints(arm_upper_l, 'arm_upper_l');
  verifyV2PartConstraints(arm_lower_l, 'arm_lower_l');
  verifyV2PartConstraints(hand_l, 'hand_l');

  verifyV2PartConstraints(shoulder_r, 'shoulder_r');
  verifyV2PartConstraints(arm_upper_r, 'arm_upper_r');
  verifyV2PartConstraints(arm_lower_r, 'arm_lower_r');
  verifyV2PartConstraints(hand_r, 'hand_r');

  verifyV2PartConstraints(leg_upper_l, 'leg_upper_l');
  verifyV2PartConstraints(leg_lower_l, 'leg_lower_l');
  verifyV2PartConstraints(foot_l, 'foot_l');
  verifyV2PartConstraints(toes_l, 'toes_l');

  verifyV2PartConstraints(leg_upper_r, 'leg_upper_r');
  verifyV2PartConstraints(leg_lower_r, 'leg_lower_r');
  verifyV2PartConstraints(foot_r, 'foot_r');
  verifyV2PartConstraints(toes_r, 'toes_r');

  const createSegmentGroup = (
    voxels: VoxelData[],
    pivotX: number,
    pivotY: number,
    pivotZ: number
  ): THREE.Group => {
    const group = new THREE.Group();
    const standardVoxels = voxels.filter((v) => !v.emissive);
    const emissiveVoxels = voxels.filter((v) => v.emissive);

    if (standardVoxels.length > 0) {
      const stdGeo = mergeVoxelGeometries(standardVoxels, scale, pivotX, pivotY, pivotZ);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.65 });
      const mesh = new THREE.Mesh(stdGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    if (emissiveVoxels.length > 0) {
      const colorMap = new Map<string, VoxelData[]>();
      emissiveVoxels.forEach((v) => {
        let list = colorMap.get(v.color);
        if (!list) { list = []; colorMap.set(v.color, list); }
        list.push(v);
      });
      colorMap.forEach((list, colorStr) => {
        const emGeo = mergeVoxelGeometries(list, scale, pivotX, pivotY, pivotZ);
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(colorStr),
          emissive: new THREE.Color(colorStr),
          emissiveIntensity: 2.5,
          roughness: 0.15,
          metalness: 0.1,
        });
        const mesh = new THREE.Mesh(emGeo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      });
    }

    return group;
  };

  const pelvisG = createSegmentGroup(pelvis, 0, 10, 0);
  const stomachG = createSegmentGroup(stomach, 0, 11, 0);
  const chestG = createSegmentGroup(chest, 0, 19, 0);
  const neckG = createSegmentGroup(neck, 0, 35, 0);
  const headG = createSegmentGroup(head, 0, 36, 0);

  const shoulderLG = createSegmentGroup(shoulder_l, -5.5, 25, 0);
  const armUpperLG = createSegmentGroup(arm_upper_l, -5, 24, 0);
  const armLowerLG = createSegmentGroup(arm_lower_l, -5, 20, 0);
  const handLG = createSegmentGroup(hand_l, -5, 16, 0);

  const shoulderRG = createSegmentGroup(shoulder_r, 5.5, 25, 0);
  const armUpperRG = createSegmentGroup(arm_upper_r, 5, 24, 0);
  const armLowerRG = createSegmentGroup(arm_lower_r, 5, 20, 0);
  const handRG = createSegmentGroup(hand_r, 5, 16, 0);

  const legUpperLG = createSegmentGroup(leg_upper_l, -2.5, 17, 0);
  const legLowerLG = createSegmentGroup(leg_lower_l, -2.5, 8, 0);
  const footLG = createSegmentGroup(foot_l, -2.5, 3, 0);
  const toesLG = createSegmentGroup(toes_l, -2.5, 2.5, -0.5);

  const legUpperRG = createSegmentGroup(leg_upper_r, 2.5, 17, 0);
  const legLowerRG = createSegmentGroup(leg_lower_r, 2.5, 8, 0);
  const footRG = createSegmentGroup(foot_r, 2.5, 3, 0);
  const toesRG = createSegmentGroup(toes_r, 2.5, 2.5, -0.5);

  pelvisG.position.set(0, 10 * scale, 0);

  stomachG.position.set(0, (11 - 10) * scale, 0);
  pelvisG.add(stomachG);

  chestG.position.set(0, (19 - 11) * scale, 0);
  stomachG.add(chestG);

  neckG.position.set(0, (35 - 19) * scale, 0);
  chestG.add(neckG);

  headG.position.set(0, (36 - 35) * scale, 0);
  neckG.add(headG);

  shoulderLG.position.set(-5.5 * scale, (25 - 19) * scale, 0);
  chestG.add(shoulderLG);

  armUpperLG.position.set((-5 - -5.5) * scale, (24 - 25) * scale, 0);
  shoulderLG.add(armUpperLG);

  armLowerLG.position.set(0, (20 - 24) * scale, 0);
  armUpperLG.add(armLowerLG);

  handLG.position.set(0, (16 - 20) * scale, 0);
  armLowerLG.add(handLG);

  shoulderRG.position.set(5.5 * scale, (25 - 19) * scale, 0);
  chestG.add(shoulderRG);

  armUpperRG.position.set((5 - 5.5) * scale, (24 - 25) * scale, 0);
  shoulderRG.add(armUpperRG);

  armLowerRG.position.set(0, (20 - 24) * scale, 0);
  armUpperRG.add(armLowerRG);

  handRG.position.set(0, (16 - 20) * scale, 0);
  armLowerRG.add(handRG);

  legUpperLG.position.set(-2.5 * scale, (17 - 10) * scale, 0);
  pelvisG.add(legUpperLG);

  legLowerLG.position.set(0, (8 - 17) * scale, 0);
  legUpperLG.add(legLowerLG);

  footLG.position.set(0, (3 - 8) * scale, 0);
  legLowerLG.add(footLG);

  toesLG.position.set(0, (2.5 - 3) * scale, -0.5 * scale);
  footLG.add(toesLG);

  legUpperRG.position.set(2.5 * scale, (17 - 10) * scale, 0);
  pelvisG.add(legUpperRG);

  legLowerRG.position.set(0, (8 - 17) * scale, 0);
  legUpperRG.add(legLowerRG);

  footRG.position.set(0, (3 - 8) * scale, 0);
  legLowerRG.add(footRG);

  toesRG.position.set(0, (2.5 - 3) * scale, -0.5 * scale);
  footRG.add(toesRG);

  const SpartanV2 = new THREE.Group();
  SpartanV2.add(pelvisG);

  SpartanV2.userData = {
    modelSystem: 'v2',
    modelType,
    characterModelProfile: CHARACTER_MODEL_PROFILES[modelType],
    collisionProfile: modelProfile.collision,
    lowerTorso: pelvisG,
    upperTorso: chestG,
    head: headG,
    leftArm: shoulderLG,
    rightArm: shoulderRG,
    leftLeg: legUpperLG,
    rightLeg: legUpperRG,
    pelvis: pelvisG,
    stomach: stomachG,
    chest: chestG,
    neck: neckG,
    shoulder_l: shoulderLG,
    arm_upper_l: armUpperLG,
    arm_lower_l: armLowerLG,
    hand_l: handLG,
    shoulder_r: shoulderRG,
    arm_upper_r: armUpperRG,
    arm_lower_r: armLowerRG,
    hand_r: handRG,
    leg_upper_l: legUpperLG,
    leg_lower_l: legLowerLG,
    foot_l: footLG,
    toes_l: toesLG,
    leg_upper_r: legUpperRG,
    leg_lower_r: legLowerRG,
    foot_r: footRG,
    toes_r: toesRG,
    pelvisVoxels: pelvis,
    stomachVoxels: stomach,
    chestVoxels: chest,
    neckVoxels: neck,
    headVoxels: head,
    shoulder_l_Voxels: shoulder_l,
    arm_upper_l_Voxels: arm_upper_l,
    arm_lower_l_Voxels: arm_lower_l,
    hand_l_Voxels: hand_l,
    shoulder_r_Voxels: shoulder_r,
    arm_upper_r_Voxels: arm_upper_r,
    arm_lower_r_Voxels: arm_lower_r,
    hand_r_Voxels: hand_r,
    leg_upper_l_Voxels: leg_upper_l,
    leg_lower_l_Voxels: leg_lower_l,
    foot_l_Voxels: foot_l,
    toes_l_Voxels: toes_l,
    leg_upper_r_Voxels: leg_upper_r,
    leg_lower_r_Voxels: leg_lower_r,
    foot_r_Voxels: foot_r,
    toes_r_Voxels: toes_r,
  };

  return SpartanV2;
}
