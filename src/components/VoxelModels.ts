/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

export interface VoxelData {
  x: number;
  y: number;
  z: number;
  color: string;
  emissive?: boolean;
}

interface SpartanColors {
  primary: string;
  secondary: string;
  visor: string;
  accent: string;
  dark: string;
  highlight: string;
}

// ─── Public Preset Types ──────────────────────────────────────────────────────

export type HelmetPreset = 'mark-vi' | 'odst' | 'recon' | 'eva' | 'gungnir' | 'eod' | 'hayabusa' | 'cqb';
export type TorsoPreset = 'mark-vi' | 'scout' | 'recon' | 'eod' | 'hayabusa';
export type ArmPreset = 'mark-vi' | 'odst' | 'recon' | 'eod' | 'hayabusa';
export type LegPreset = 'mark-vi' | 'jump-jet' | 'odst' | 'eod' | 'hayabusa';
export type HammerPreset = 'default' | 'akelas' | 'akelus' | 'paegaas' | 'sepulotez' | 'halbashi' | 'eektah-fel' | 'gravity-axe' | 'gravity-mace' | 'fist-of-rukt';
export type SwordPreset = 'default' | 'halo-ce' | 'halo-2' | 'halo-3' | 'reach' | 'anniversary' | 'halo-4' | 'h2a-blue' | 'h2a-pink' | 'halo-5' | 'infinite';

export interface ArmorPaintJob {
  helmet?: { [key: string]: string };
  torso?: { [key: string]: string };
  leftArm?: { [key: string]: string };
  rightArm?: { [key: string]: string };
  leftLeg?: { [key: string]: string };
  rightLeg?: { [key: string]: string };
  emissive?: {
    helmet?: { [key: string]: boolean };
    torso?: { [key: string]: boolean };
    leftArm?: { [key: string]: boolean };
    rightArm?: { [key: string]: boolean };
    leftLeg?: { [key: string]: boolean };
    rightLeg?: { [key: string]: boolean };
  };
  baseColors?: {
    helmet?: string;
    torso?: string;
    leftArm?: string;
    rightArm?: string;
    leftLeg?: string;
    rightLeg?: string;
  };
}

export interface CharacterLoadout {
  helmet?: HelmetPreset;
  torso?: TorsoPreset;
  arm?: ArmPreset;
  leg?: LegPreset;
  paintJob?: ArmorPaintJob;
  hammerPreset?: HammerPreset;
  swordPreset?: SwordPreset;
}

export const DEFAULT_LOADOUT: CharacterLoadout = {
  helmet: 'mark-vi',
  torso: 'mark-vi',
  arm: 'mark-vi',
  leg: 'mark-vi',
  hammerPreset: 'default',
  swordPreset: 'default',
};

export const AVAILABLE_PRESETS = {
  helmet: ['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb'] as const,
  torso: ['mark-vi', 'scout', 'recon', 'eod', 'hayabusa'] as const,
  arm: ['mark-vi', 'odst', 'recon', 'eod', 'hayabusa'] as const,
  leg: ['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa'] as const,
  hammer: ['default', 'akelas', 'akelus', 'paegaas', 'sepulotez', 'halbashi', 'eektah-fel', 'gravity-axe', 'gravity-mace', 'fist-of-rukt'] as const,
  sword: ['default', 'halo-ce', 'halo-2', 'halo-3', 'reach', 'anniversary', 'halo-4', 'h2a-blue', 'h2a-pink', 'halo-5', 'infinite'] as const,
};


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

  // Group voxels by color + emissive property
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

    // Fast coordinate lookup
    const coordSet = new Set<string>();
    groupVoxels.forEach((v) => {
      coordSet.add(`${v.x},${v.y},${v.z}`);
    });

    const visited = new Set<string>();

    // Process in grid order: Y, then Z, then X
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

      // 1. Grow along X
      while (true) {
        const nextX = startX + sizeX;
        const checkKey = `${nextX},${startY},${startZ}`;
        if (coordSet.has(checkKey) && !visited.has(checkKey)) {
          sizeX++;
        } else {
          break;
        }
      }

      // 2. Grow along Z
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

      // 3. Grow along Y
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

      // Mark coordinates as visited
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

function mergeVoxelGeometries(
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

export function createVoxelGroup(data: VoxelData[], scale: number = 0.1): THREE.Group {
  const group = new THREE.Group();

  const standardVoxels = data.filter((v) => !v.emissive);
  const emissiveVoxels = data.filter((v) => v.emissive);

  if (standardVoxels.length > 0) {
    const stdGeo = mergeVoxelGeometries(standardVoxels, scale, 0, 0, 0);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.65 });
    const mesh = new THREE.Mesh(stdGeo, material);
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
    colorMap.forEach((voxels, colorStr) => {
      const emGeo = mergeVoxelGeometries(voxels, scale, 0, 0, 0);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorStr),
        emissive: new THREE.Color(colorStr),
        emissiveIntensity: 2.5,
        roughness: 0.15,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(emGeo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  }

  return group;
}

// ─── Voxel Preset Utility ─────────────────────────────────────────────────────

function mirrorX(voxels: VoxelData[]): VoxelData[] {
  return voxels.map((v) => ({ ...v, x: -v.x }));
}

// ─── HELMET PRESETS ───────────────────────────────────────────────────────────
// Global space. Neck pivot at y=16. Helmet dome grows upward.
// Coordinate convention: z=-2 is front (facing camera), z=2 is rear.

function buildHelmet_MarkVI(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck connector (y=16)
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Jaw/chin flare (y=17) — 5×5, primary front face, secondary sides
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      v.push({ x, y: 17, z, color: z === -2 ? c.primary : c.secondary });

  // Visor band (y=18-19) — glowing center strip on front face
  for (let y = 18; y <= 19; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVisor = z === -2 && Math.abs(x) <= 1;
        const isFrame = z === -2 && !isVisor;
        v.push({ x, y, z, color: isVisor ? c.visor : isFrame ? c.dark : z === 2 ? c.secondary : c.primary, emissive: isVisor });
      }
    }
  }

  // Brow ridge accent (y=20 front row)
  for (let x = -2; x <= 2; x++)
    v.push({ x, y: 20, z: -2, color: c.accent });

  // Dome (y=20-22) — primary main, secondary back/top edges
  for (let y = 20; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        if (y === 20 && z === -2) continue; // brow already placed
        const isBack = z === 2;
        v.push({ x, y, z, color: isBack ? c.secondary : c.primary });
      }
    }
  }

  // Dome cap (y=23) — 3×3
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 23, z, color: c.primary });

  // Mohawk plume (y=23-24)
  for (let py = 23; py <= 24; py++)
    for (let z = -1; z <= 1; z++)
      v.push({ x: 0, y: py, z, color: '#f97316' });

  // --- AAA MICRO-DETAILS ---
  // 1. Forehead glowing rangefinder camera lens (y=21)
  v.push({ x: 0, y: 21, z: -3, color: '#ef4444', emissive: true });
  // 2. Side cooling vents (y=17, z=-1)
  v.push({ x: -3, y: 17, z: -1, color: c.dark });
  v.push({ x: 3, y: 17, z: -1, color: c.dark });
  // 3. Earpiece tactical communications modules (y=19, z=0)
  v.push({ x: -3, y: 19, z: 0, color: c.accent });
  v.push({ x: -3, y: 19, z: 1, color: c.dark });
  v.push({ x: 3, y: 19, z: 0, color: c.accent });
  v.push({ x: 3, y: 19, z: 1, color: c.dark });
  // 4. Glowing earpiece status light
  v.push({ x: -3, y: 20, z: 0, color: c.visor, emissive: true });
  v.push({ x: 3, y: 20, z: 0, color: c.visor, emissive: true });

  return v;
}

function buildHelmet_ODST(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Boxy chin with forward mandibles (y=17)
  for (let x = -2; x <= 2; x++)
    for (let z = -3; z <= 2; z++)
      v.push({ x, y: 17, z, color: z === -3 ? c.secondary : z === -2 ? c.dark : c.secondary });

  // Thin visor slit (y=18) — full width, tactical narrow strip
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      v.push({ x, y: 18, z, color: z === -2 ? c.visor : c.primary, emissive: z === -2 });

  // Boxy dome (y=19-22) — angular, rectangular silhouette with side vents
  for (let y = 19; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVent = Math.abs(x) === 2 && (y === 20 || y === 21) && z === 0;
        const isBack = z === 2;
        v.push({ x, y, z, color: isVent ? c.dark : isBack ? c.secondary : y === 22 ? c.dark : c.primary });
      }
    }
  }

  // Flat-top cap (y=23) — full 5×5, very boxy
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      v.push({ x, y: 23, z, color: c.dark });

  // --- AAA MICRO-DETAILS ---
  // 1. Right side tactical antenna
  v.push({ x: 3, y: 20, z: 1, color: c.dark });
  v.push({ x: 3, y: 21, z: 1, color: c.dark });
  v.push({ x: 3, y: 22, z: 1, color: c.visor, emissive: true });
  // 2. Forehead heavy reinforcement brow plate
  v.push({ x: -1, y: 22, z: -3, color: c.accent });
  v.push({ x: 0, y: 22, z: -3, color: c.accent });
  v.push({ x: 1, y: 22, z: -3, color: c.accent });
  // 3. Side chin filters
  v.push({ x: -2, y: 17, z: -3, color: c.dark });
  v.push({ x: 2, y: 17, z: -3, color: c.dark });
  // 4. Glowing visor helper lights
  v.push({ x: -2, y: 19, z: -3, color: '#f59e0b', emissive: true });
  v.push({ x: 2, y: 19, z: -3, color: '#f59e0b', emissive: true });

  return v;
}

function buildHelmet_Recon(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Streamlined chin (y=17) — front-heavy profile
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      v.push({ x, y: 17, z, color: z <= -1 ? c.primary : c.secondary });

  // Tall wraparound visor (y=18-20) — 3 rows with side edge glow
  for (let y = 18; y <= 20; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isFront = z === -2;
        const isSideEdge = z === -1 && Math.abs(x) === 2 && y === 19;
        v.push({ x, y, z, color: isFront ? c.visor : isSideEdge ? c.visor : z === 2 ? c.secondary : c.primary, emissive: isFront || isSideEdge });
      }
    }
  }

  // Aerodynamic dome (y=21-22) — narrows toward top
  for (let y = 21; y <= 22; y++) {
    const hw = y === 22 ? 1 : 2;
    for (let x = -hw; x <= hw; x++)
      for (let z = -2; z <= 2; z++)
        v.push({ x, y, z, color: z === 2 ? c.secondary : c.primary });
  }

  // Side fins (y=21-22, x=±3 — aerodynamic outriggers)
  for (let y = 21; y <= 22; y++) {
    v.push({ x: -3, y, z: 0, color: c.secondary });
    v.push({ x: 3, y, z: 0, color: c.secondary });
  }

  // Dome cap (y=23)
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 23, z, color: c.primary });

  // Rear antenna
  v.push({ x: 0, y: 23, z: 1, color: c.secondary });
  v.push({ x: 0, y: 24, z: 1, color: c.accent, emissive: true });

  // --- AAA MICRO-DETAILS ---
  // 1. Left side tactical laser rangefinder attachment
  v.push({ x: -3, y: 20, z: -1, color: c.dark });
  v.push({ x: -3, y: 20, z: -2, color: '#ef4444', emissive: true });
  // 2. Front aerodynamic jaw lines
  v.push({ x: -1, y: 18, z: -3, color: c.highlight });
  v.push({ x: 1, y: 18, z: -3, color: c.highlight });
  // 3. Dual side cheek micro-exhausts
  v.push({ x: -3, y: 17, z: 0, color: c.dark });
  v.push({ x: 3, y: 17, z: 0, color: c.dark });

  return v;
}

function buildHelmet_EVA(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Wide rounded chin (y=17) — extends forward
  for (let x = -2; x <= 2; x++) {
    for (let z = -3; z <= 2; z++)
      v.push({ x, y: 17, z, color: z === -3 ? c.secondary : c.primary });
  }

  // Massive bubble visor (y=18-21) — double-depth glowing front
  for (let y = 18; y <= 21; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isBubble = z <= -1 && y <= 20;
        const isRim = z === -1 && y === 21;
        v.push({ x, y, z, color: isBubble || isRim ? c.visor : z === 2 ? c.secondary : c.primary, emissive: isBubble || isRim });
      }
    }
  }

  // Rounded teardrop dome (y=22-23)
  for (let y = 22; y <= 23; y++) {
    const hw = y === 23 ? 1 : 2;
    for (let x = -hw; x <= hw; x++)
      for (let z = -2; z <= 2; z++)
        v.push({ x, y, z, color: z === 2 ? c.secondary : c.primary });
  }

  // Apex voxel
  v.push({ x: 0, y: 24, z: 0, color: c.primary });

  // --- AAA MICRO-DETAILS ---
  // 1. Visor HUD micro-crosshair pattern
  v.push({ x: 0, y: 20, z: -3, color: '#ffffff', emissive: true });
  v.push({ x: -1, y: 20, z: -3, color: '#60a5fa', emissive: true });
  v.push({ x: 1, y: 20, z: -3, color: '#60a5fa', emissive: true });
  v.push({ x: 0, y: 19, z: -3, color: '#60a5fa', emissive: true });
  // 2. Heavy protective collar ring brace
  for (let x = -3; x <= 3; x++) {
    v.push({ x, y: 16, z: 2, color: c.dark });
  }
  // 3. Side helmet cooling inlets
  v.push({ x: -3, y: 18, z: 0, color: c.secondary });
  v.push({ x: 3, y: 18, z: 0, color: c.secondary });

  return v;
}

function buildHelmet_Gungnir(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Angular chin (y=17)
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      v.push({ x, y: 17, z, color: z === -2 ? c.dark : c.secondary });

  // Narrow central visor (y=18-19) — only center 3 wide, flanked by armor panels
  for (let y = 18; y <= 19; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVisor = z === -2 && Math.abs(x) <= 1;
        const isPanel = z === -2 && Math.abs(x) === 2;
        v.push({ x, y, z, color: isVisor ? c.visor : isPanel ? c.secondary : z === 2 ? c.secondary : c.primary, emissive: isVisor });
      }
    }
  }

  // Angular dome with center data stripe (y=20-22)
  for (let y = 20; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isCenterStripe = x === 0 && z === -2;
        const isSidePanel = Math.abs(x) === 2 && y === 21;
        v.push({ x, y, z, color: isCenterStripe || isSidePanel ? c.accent : z === 2 ? c.secondary : c.primary });
      }
    }
  }

  // Wide top cap (y=23)
  for (let x = -2; x <= 2; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 23, z, color: c.primary });

  // Dual glowing horns (x=±2, y=23-25)
  for (let y = 23; y <= 25; y++) {
    const isGlow = y === 25;
    v.push({ x: -2, y, z: 0, color: isGlow ? c.visor : c.dark, emissive: isGlow });
    v.push({ x: 2, y, z: 0, color: isGlow ? c.visor : c.dark, emissive: isGlow });
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Extreme heavy-duty camera sensor lens on left eye plate
  v.push({ x: -2, y: 19, z: -3, color: '#ef4444', emissive: true });
  // 2. Armored cheek reinforcement outriggers
  v.push({ x: -3, y: 18, z: -1, color: c.secondary });
  v.push({ x: 3, y: 18, z: -1, color: c.secondary });
  // 3. Back-of-head diagnostic status indicators
  v.push({ x: 0, y: 22, z: 2, color: c.visor, emissive: true });

  return v;
}

function buildHelmet_EOD(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Bulky jaw and respirator canister filters (y=17)
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      const isFilter = Math.abs(x) === 2 && z === -2;
      v.push({ x, y: 17, z, color: isFilter ? c.accent : c.secondary });
    }
  }
  // Canisters sticking out forward
  v.push({ x: -2, y: 17, z: -3, color: c.dark });
  v.push({ x: 2, y: 17, z: -3, color: c.dark });

  // Narrow inset horizontal visor slit (y=18-19)
  for (let y = 18; y <= 19; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVisor = z === -2 && Math.abs(x) <= 1;
        const isCheek = z === -2 && !isVisor;
        v.push({
          x, y, z,
          color: isVisor ? c.visor : isCheek ? c.primary : z === 2 ? c.secondary : c.primary,
          emissive: isVisor
        });
      }
    }
  }

  // Back of head communication/filter block (y=18-20, z=2)
  for (let y = 18; y <= 20; y++) {
    for (let x = -1; x <= 1; x++) {
      v.push({ x, y, z: 2, color: c.dark });
    }
  }

  // Heavy flat brow ridge (y=20 front)
  for (let x = -2; x <= 2; x++) {
    v.push({ x, y: 20, z: -2, color: c.accent });
  }

  // Solid protective dome shell (y=20-22)
  for (let y = 20; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        if (y === 20 && z === -2) continue; // Brow placed
        const isBack = z === 2;
        v.push({ x, y, z, color: isBack ? c.secondary : c.primary });
      }
    }
  }

  // Flat protective cap (y=23)
  for (let x = -2; x <= 2; x++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 23, z, color: c.primary });
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Central hazard warning pressure valve on jaw
  v.push({ x: 0, y: 17, z: -2, color: '#10b981', emissive: true });
  // 2. Respirator hoses running from filters to back (y=16)
  v.push({ x: -2, y: 16, z: -1, color: c.dark });
  v.push({ x: 2, y: 16, z: -1, color: c.dark });
  // 3. Blast shielding brow plates
  v.push({ x: -2, y: 21, z: -3, color: c.dark });
  v.push({ x: 2, y: 21, z: -3, color: c.dark });

  return v;
}

function buildHelmet_Hayabusa(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Sharp pointed chin (y=17)
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      const isPoint = x === 0 && z === -2;
      v.push({ x, y: 17, z, color: isPoint ? c.primary : c.secondary });
    }
  }
  v.push({ x: 0, y: 17, z: -3, color: c.primary }); // Protruding chin spike

  // Menacing ninja face mask + split visor slit (y=18-19)
  for (let y = 18; y <= 19; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVisor = z === -2 && Math.abs(x) === 1;
        const isCenterBar = z === -2 && x === 0;
        const isCheek = z === -2 && Math.abs(x) === 2;
        v.push({
          x, y, z,
          color: isVisor ? c.visor : isCenterBar ? c.dark : isCheek ? c.primary : z === 2 ? c.secondary : c.primary,
          emissive: isVisor
        });
      }
    }
  }

  // Samurai cheek guards sweeping back (y=18-21, x=±3, z=-1..1)
  for (let y = 18; y <= 21; y++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x: -3, y, z, color: c.primary });
      v.push({ x: 3, y, z, color: c.primary });
    }
  }

  // Majestic Kabuto forehead crest/horn (y=20-22, x=0, z=-3)
  for (let y = 20; y <= 22; y++) {
    v.push({ x: 0, y, z: -3, color: c.accent, emissive: true });
  }

  // High back crest/samurai plume (y=22-25, z=2, x=0)
  for (let y = 22; y <= 25; y++) {
    v.push({ x: 0, y, z: 2, color: c.accent });
  }

  // Side accent spikes (y=22, x=±2, z=0)
  v.push({ x: -2, y: 22, z: 0, color: c.dark });
  v.push({ x: 2, y: 22, z: 0, color: c.dark });

  // Main skull dome (y=20-22)
  for (let y = 20; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isBack = z === 2;
        v.push({ x, y, z, color: isBack ? c.secondary : c.primary });
      }
    }
  }

  // Dome cap (y=23)
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 23, z, color: c.primary });
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Glowing menacing visor eyes under the mask
  v.push({ x: -1, y: 19, z: -3, color: '#ef4444', emissive: true });
  v.push({ x: 1, y: 19, z: -3, color: '#ef4444', emissive: true });
  // 2. Gold crest highlight nodes
  v.push({ x: 0, y: 22, z: -4, color: '#fbbf24', emissive: true });
  // 3. Extended Kabuto neck protectors
  v.push({ x: -3, y: 16, z: 1, color: c.dark });
  v.push({ x: 3, y: 16, z: 1, color: c.dark });

  return v;
}

function buildHelmet_CQB(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Neck
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 16, z, color: c.secondary });

  // Bulky jaw sweeping forward (y=17)
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      v.push({ x, y: 17, z, color: c.secondary });
    }
  }
  // Front chin extensions
  for (let x = -1; x <= 1; x++) {
    v.push({ x, y: 17, z: -3, color: c.secondary });
  }

  // Iconic glowing T-Visor (y=18-20)
  for (let y = 18; y <= 20; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVerticalVisor = z === -2 && x === 0;
        const isHorizontalVisor = z === -2 && y >= 19;
        const isVisor = isVerticalVisor || isHorizontalVisor;
        const isCheek = z === -2 && !isVisor;
        v.push({
          x, y, z,
          color: isVisor ? c.visor : isCheek ? c.primary : z === 2 ? c.secondary : c.primary,
          emissive: isVisor
        });
      }
    }
  }

  // Bulky protective dome (y=21-22)
  for (let y = 21; y <= 22; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isRidge = x === 0 && z === -2;
        v.push({ x, y, z, color: isRidge ? c.dark : z === 2 ? c.secondary : c.primary });
      }
    }
  }

  // Center forehead/ridge cap (y=23, x=0, z=-2..1)
  for (let z = -2; z <= 1; z++) {
    v.push({ x: 0, y: 23, z, color: c.dark });
  }

  // Side ventilation canisters/ears (y=19-20, x=±3, z=0)
  for (let y = 19; y <= 20; y++) {
    v.push({ x: -3, y, z: 0, color: c.dark });
    v.push({ x: 3, y, z: 0, color: c.dark });
  }

  // Top Dome Cap (y=23)
  for (let x = -2; x <= 2; x++) {
    if (x === 0) continue; // Already placed ridge
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 23, z, color: c.primary });
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Glowing ventilation light inside side canisters
  v.push({ x: -3, y: 20, z: -1, color: c.visor, emissive: true });
  v.push({ x: 3, y: 20, z: -1, color: c.visor, emissive: true });
  // 2. Heavy forehead protective visor visor-lock
  v.push({ x: 0, y: 21, z: -3, color: c.accent, emissive: true });
  // 3. Back communications array node
  v.push({ x: -1, y: 23, z: 2, color: c.dark });
  v.push({ x: 1, y: 23, z: 2, color: c.dark });

  return v;
}
// ─── TORSO PRESETS ────────────────────────────────────────────────────────────
// Pivot at (0, 8, 0). Chest spans y=9..15 (7 wide x=-3..3, 5 deep z=-2..2).

function buildTorso_MarkVI(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Cinched waist (y=9-10)
  for (let y = 9; y <= 10; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.secondary });

  // Ab plates (y=11-12)
  for (let y = 11; y <= 12; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3;
        const isBack = z === 2;
        v.push({ x, y, z, color: isEdge || isBack ? c.secondary : c.primary });
      }
    }
  }

  // Chest plates (y=13-15) — pectoral highlights, center seam, collar trim
  for (let y = 13; y <= 15; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3;
        const isBack = z === 2;
        const isPec = Math.abs(x) >= 1 && Math.abs(x) <= 2 && z === -2;
        const isCenterFront = x === 0 && z === -2;
        const isCollar = y === 15 && z === -2 && !isEdge;
        v.push({
          x, y, z,
          color: isCollar ? c.accent : isPec && !isCenterFront ? c.highlight : isEdge || isBack ? c.secondary : c.primary,
        });
      }
    }
  }

  // Center reactor strip (emissive, y=12-15 front face)
  for (let y = 12; y <= 15; y++)
    v.push({ x: 0, y, z: -2, color: c.visor, emissive: true });

  // Back exhaust ports (y=12-14)
  for (let y = 12; y <= 14; y++) {
    v.push({ x: -1, y, z: 2, color: c.dark });
    v.push({ x: 1, y, z: 2, color: c.dark });
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Dual glowing back thrusters inside the exhaust ports
  v.push({ x: -1, y: 13, z: 2, color: c.visor, emissive: true });
  v.push({ x: 1, y: 13, z: 2, color: c.visor, emissive: true });
  v.push({ x: -1, y: 14, z: 2, color: '#f59e0b', emissive: true });
  v.push({ x: 1, y: 14, z: 2, color: '#f59e0b', emissive: true });
  // 2. Front pectoral air vents
  v.push({ x: -2, y: 14, z: -3, color: c.dark });
  v.push({ x: 2, y: 14, z: -3, color: c.dark });
  // 3. Abdominal tech seams
  v.push({ x: 0, y: 11, z: -3, color: c.secondary });
  v.push({ x: 0, y: 12, z: -3, color: c.secondary });

  return v;
}

function buildTorso_Scout(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Taller cinched waist (y=9-11)
  for (let y = 9; y <= 11; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.secondary });

  // Lighter chest — only 3 deep (y=12-15)
  for (let y = 12; y <= 15; y++)
    for (let x = -3; x <= 3; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: Math.abs(x) === 3 ? c.secondary : c.primary });

  // Side utility pouches (y=12-13)
  for (let y = 12; y <= 13; y++) {
    v.push({ x: -4, y, z: 0, color: c.dark });
    v.push({ x: -4, y, z: -1, color: c.secondary });
    v.push({ x: 4, y, z: 0, color: c.dark });
    v.push({ x: 4, y, z: -1, color: c.secondary });
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Back communications antenna array
  v.push({ x: 1, y: 14, z: 1, color: c.dark });
  v.push({ x: 1, y: 15, z: 1, color: c.accent, emissive: true });
  // 2. Active micro-reactor core in center chest
  v.push({ x: 0, y: 13, z: -2, color: c.visor, emissive: true });
  // 3. Tactical harness lines on shoulders
  for (let x = -2; x <= 2; x++) {
    if (x === 0) continue;
    v.push({ x, y: 15, z: -2, color: c.dark });
  }

  return v;
}

function buildTorso_Recon(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Waist (y=9-10)
  for (let y = 9; y <= 10; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.secondary });

  // Chest with asymmetric tech panels (y=11-15)
  for (let y = 11; y <= 15; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3;
        const isBack = z === 2;
        const isTechPanel = Math.abs(x) === 2 && z === -2 && y >= 12 && y <= 14;
        v.push({ x, y, z, color: isTechPanel ? c.secondary : isEdge || isBack ? c.secondary : c.primary });
      }
    }
  }

  // Left shoulder data stripe (accent emissive)
  for (let y = 13; y <= 15; y++)
    v.push({ x: -2, y, z: -2, color: c.accent, emissive: true });

  // Right shoulder data stripe (visor emissive)
  for (let y = 13; y <= 15; y++)
    v.push({ x: 2, y, z: -2, color: c.visor, emissive: true });

  // --- AAA MICRO-DETAILS ---
  // 1. Center tactical computing core reactor
  v.push({ x: 0, y: 13, z: -2, color: c.highlight });
  v.push({ x: 0, y: 14, z: -2, color: c.visor, emissive: true });
  // 2. Dual side ventilation tubes running up shoulders
  for (let y = 13; y <= 15; y++) {
    v.push({ x: -3, y, z: -2, color: c.dark });
    v.push({ x: 3, y, z: -2, color: c.dark });
  }

  return v;
}

function buildTorso_EOD(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Cinched waist with side plates (y=9-10)
  for (let y = 9; y <= 10; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -1; z <= 1; z++) {
        const isSidePlate = Math.abs(x) === 3 && z === 0;
        v.push({ x, y, z, color: isSidePlate ? c.primary : c.secondary });
      }
    }
  }

  // Bulky chest plates (y=11-15)
  for (let y = 11; y <= 15; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3;
        const isBack = z === 2;
        const isCollar = y === 15 && z === -2 && !isEdge;
        v.push({
          x, y, z,
          color: isCollar ? c.accent : isEdge || isBack ? c.secondary : c.primary
        });
      }
    }
  }

  // Front bulky harness canisters (y=12-14, x=±2, z=-3)
  for (let y = 12; y <= 14; y++) {
    v.push({ x: -2, y, z: -3, color: c.dark });
    v.push({ x: 2, y, z: -3, color: c.dark });
  }

  // Center reactor (y=13, x=0, z=-2)
  v.push({ x: 0, y: 13, z: -2, color: c.visor, emissive: true });

  // Back exhaust ports (y=12-14)
  for (let y = 12; y <= 14; y++) {
    v.push({ x: -1, y, z: 2, color: c.dark });
    v.push({ x: 1, y, z: 2, color: c.dark });
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Dual bulky warning light nodes on chest collar locks
  v.push({ x: -3, y: 15, z: -2, color: c.accent, emissive: true });
  v.push({ x: 3, y: 15, z: -2, color: c.accent, emissive: true });
  // 2. Extra side armor waist pads
  for (let y = 9; y <= 10; y++) {
    v.push({ x: -4, y, z: 0, color: c.dark });
    v.push({ x: 4, y, z: 0, color: c.dark });
  }

  return v;
}

function buildTorso_Hayabusa(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Waist (y=9-10)
  for (let y = 9; y <= 10; y++)
    for (let x = -2; x <= 2; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.secondary });

  // Chest with layered armor and sash (y=11-15)
  for (let y = 11; y <= 15; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3;
        const isBack = z === 2;
        // Sash sweeps from left hip (x=-2, y=11) to right shoulder (x=2, y=15)
        const sashX = y - 13; // y=11 -> x=-2; y=13 -> x=0; y=15 -> x=2
        const isSash = z === -2 && x === sashX;
        
        v.push({
          x, y, z,
          color: isSash ? c.accent : isEdge || isBack ? c.secondary : c.primary
        });
      }
    }
  }

  // Small glowing ninja chest mark (y=13, x=-1, z=-2)
  v.push({ x: -1, y: 13, z: -2, color: c.visor, emissive: true });

  // Shoulder plates (y=15, x=±3, z=-1..1)
  for (let z = -1; z <= 1; z++) {
    v.push({ x: -3, y: 15, z, color: c.highlight });
    v.push({ x: 3, y: 15, z, color: c.highlight });
  }
  return v;
}

// ─── ARM PRESETS (LEFT SIDE) ──────────────────────────────────────────────────
// Pivot at (-5.5, 15, 0).
// Pauldron: x=-7..-4, y=13..15, z=-2..2 (wide shoulder plate).
// Arm body: x=-6..-4, y=7..12, z=-1..1.

function buildLeftArm_MarkVI(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Shoulder pauldron — iconic wide plate (y=13-15)
  for (let y = 13; y <= 15; y++) {
    for (let x = -7; x <= -4; x++) {
      for (let z = -2; z <= 2; z++) {
        const isTopFront = y === 15 && z === -2;
        const isTop = y === 15;
        const isOuter = x === -7;
        const isBack = z === 2;
        const isVent = x === -6 && y === 14 && z === 0;
        v.push({
          x, y, z,
          color: isVent ? c.dark : isTopFront ? c.accent : isTop ? c.highlight : isOuter ? c.secondary : isBack ? c.secondary : c.primary,
        });
      }
    }
  }

  // Bicep (y=10-12) — 3 wide
  for (let y = 10; y <= 12; y++)
    for (let x = -6; x <= -4; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: z === -1 ? c.primary : c.secondary });

  // Elbow cap (y=9) — dark recess with accent centerpiece
  for (let x = -6; x <= -4; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 9, z, color: x === -5 && z === 0 ? c.accent : c.dark });

  // Forearm (y=7-8) — front plate, vent on back
  for (let y = 7; y <= 8; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        const isVent = y === 8 && z === 1 && x === -5;
        v.push({ x, y, z, color: isVent ? c.dark : z === -1 ? c.primary : c.secondary });
      }
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Glowing wrist-mounted diagnostic touchscreen (left arm only)
  v.push({ x: -4, y: 8, z: -2, color: c.visor, emissive: true });
  v.push({ x: -4, y: 8, z: -1, color: c.dark });
  v.push({ x: -5, y: 8, z: -2, color: '#ffffff', emissive: true });
  // 2. Extra outer elbow guard plating
  v.push({ x: -7, y: 9, z: 0, color: c.secondary });

  return v;
}

function buildLeftArm_ODST(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Compact tactical pauldron (y=13-15) — same width as arm, no flare
  for (let y = 13; y <= 15; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        const isVent = y === 14 && z === 0 && x === -5;
        v.push({ x, y, z, color: isVent ? c.dark : y === 15 ? c.secondary : c.primary });
      }
    }
  }

  // Bicep with combat stripe band (y=10-12)
  for (let y = 10; y <= 12; y++)
    for (let x = -6; x <= -4; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: y === 11 ? c.dark : z === -1 ? c.primary : c.secondary });

  // Elbow (y=9) — all dark, heavy joint
  for (let x = -6; x <= -4; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 9, z, color: c.dark });

  // Extended ODST bracer (y=7-8) — wider wrist plate extends forward
  for (let y = 7; y <= 8; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -2; z <= 1; z++) {
        const isExtPlate = z === -2;
        v.push({ x, y, z, color: isExtPlate ? c.secondary : z === -1 ? c.primary : c.secondary });
      }
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Pauldron glowing faction emblem light
  v.push({ x: -7, y: 14, z: 0, color: c.accent, emissive: true });
  // 2. Heavy mechanical forearm support rods
  v.push({ x: -6, y: 8, z: 2, color: c.dark });
  v.push({ x: -4, y: 8, z: 2, color: c.dark });

  return v;
}

function buildLeftArm_Recon(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Slim pauldron with upward dorsal fin (y=13-15)
  for (let y = 13; y <= 15; y++)
    for (let x = -6; x <= -4; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: y === 15 ? c.highlight : c.primary });

  // Dorsal fin rising above shoulder (y=16, x=-5)
  v.push({ x: -5, y: 16, z: 0, color: c.secondary });

  // Bicep with inline data reader (y=10-12)
  for (let y = 10; y <= 12; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        const isDataPanel = y === 11 && z === -1 && x === -5;
        v.push({ x, y, z, color: isDataPanel ? c.accent : z === -1 ? c.primary : c.secondary, emissive: isDataPanel });
      }
    }
  }

  // Elbow (y=9)
  for (let x = -6; x <= -4; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 9, z, color: c.secondary });

  // Slim forearm — 2 wide with wrist display (y=7-8)
  for (let y = 7; y <= 8; y++) {
    for (let x = -5; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        const isDisplay = y === 8 && z === -1 && x === -4;
        v.push({ x, y, z, color: isDisplay ? c.accent : z === -1 ? c.primary : c.secondary, emissive: isDisplay });
      }
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Extra micro-antenna on shoulder pauldron fin
  v.push({ x: -5, y: 17, z: 0, color: c.accent, emissive: true });
  // 2. Armored bicep composite plate trim
  v.push({ x: -7, y: 11, z: 0, color: c.dark });

  return v;
}

function buildLeftArm_EOD(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Heavy shoulder pauldron (y=13-15)
  for (let y = 13; y <= 15; y++) {
    for (let x = -7; x <= -4; x++) {
      for (let z = -2; z <= 2; z++) {
        const isOuter = x === -7;
        const isBack = z === 2;
        v.push({
          x, y, z,
          color: isOuter ? c.secondary : isBack ? c.secondary : c.primary
        });
      }
    }
  }

  // Hazard/warning light panel (emissive, y=14 outer)
  v.push({ x: -7, y: 14, z: 0, color: c.accent, emissive: true });

  // Heavy bicep (y=10-12)
  for (let y = 10; y <= 12; y++)
    for (let x = -6; x <= -4; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.secondary });

  // Heavy elbow joint (y=9)
  for (let x = -6; x <= -4; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 9, z, color: c.dark });

  // Blocky forearm with outer forearm shield plate (y=7-8)
  for (let y = 7; y <= 8; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        v.push({ x, y, z, color: z === -1 ? c.primary : c.secondary });
      }
    }
    // Extra shield
    for (let z = -1; z <= 1; z++) {
      v.push({ x: -7, y, z, color: c.primary });
    }
  }

  // --- AAA MICRO-DETAILS ---
  // 1. Forearm hazard stripes
  v.push({ x: -7, y: 8, z: -1, color: '#eab308' });
  v.push({ x: -7, y: 7, z: 0, color: c.dark });
  // 2. Extra bulky shoulder cap lock
  v.push({ x: -4, y: 15, z: -2, color: c.dark });

  return v;
}

function buildLeftArm_Hayabusa(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Shoulder pauldron base (y=13-15)
  for (let y = 13; y <= 15; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        v.push({ x, y, z, color: y === 15 ? c.highlight : c.primary });
      }
    }
  }

  // Curved samurai spike (extending outward/upward)
  v.push({ x: -7, y: 14, z: 0, color: c.highlight });
  v.push({ x: -8, y: 15, z: 0, color: c.accent });

  // Sleek bicep (y=10-12)
  for (let y = 10; y <= 12; y++)
    for (let x = -6; x <= -4; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: c.primary });

  // Elbow (y=9)
  for (let x = -6; x <= -4; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 9, z, color: c.secondary });

  // Forearm with front wrist blade gauntlet (y=7-8)
  for (let y = 7; y <= 8; y++) {
    for (let x = -6; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        v.push({ x, y, z, color: c.secondary });
      }
    }
  }
  // Wrist blades
  v.push({ x: -5, y: 7, z: -2, color: c.accent });
  v.push({ x: -5, y: 8, z: -2, color: c.accent });

  // --- AAA MICRO-DETAILS ---
  // 1. Triple sweeping gold spikes on the shoulder pauldron (extremely premium!)
  v.push({ x: -7, y: 15, z: 1, color: '#fbbf24', emissive: true });
  v.push({ x: -8, y: 16, z: 0, color: '#fbbf24', emissive: true });
  v.push({ x: -7, y: 15, z: -1, color: '#fbbf24', emissive: true });
  // 2. Red hand-guard wrap nodes
  v.push({ x: -5, y: 6, z: 0, color: '#ef4444' });

  return v;
}

// ─── LEG PRESETS (LEFT SIDE) ──────────────────────────────────────────────────
// Pivot at (-2.5, 7, 0). Voxels at x=-4..-1, y=0..6, z=-1..1.

function buildLeftLeg_MarkVI(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Boot (y=0-1) — dark sole, primary upper
  for (let y = 0; y <= 1; y++)
    for (let x = -4; x <= -1; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: y === 0 ? c.dark : x === -4 ? c.secondary : c.primary });

  // Shin (y=2-5) — shin plate highlight, calf secondary, vent accent strip
  for (let y = 2; y <= 5; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        const isShineRow = z === -1 && (x === -3 || x === -2);
        const isOuter = x === -4;
        const isCalf = z === 1;
        const isVent = y === 4 && z === -1 && x === -3;
        v.push({
          x, y, z,
          color: isVent ? c.accent : isShineRow ? c.highlight : isOuter || isCalf ? c.secondary : c.primary,
          emissive: isVent,
        });
      }
    }
  }

  // Knee cap (y=6) — highlighted front plate, secondary sides
  for (let x = -4; x <= -1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 6, z, color: z === -1 && (x === -3 || x === -2) ? c.highlight : c.secondary });

  // --- AAA MICRO-DETAILS ---
  // 1. Glowing boot ankle telemetry module
  v.push({ x: -4, y: 1, z: 0, color: c.visor, emissive: true });
  // 2. High-contrast knee joint line
  v.push({ x: -2, y: 5, z: -2, color: c.dark });
  v.push({ x: -3, y: 5, z: -2, color: c.dark });

  return v;
}

function buildLeftLeg_JumpJet(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Boot (y=0-1)
  for (let y = 0; y <= 1; y++)
    for (let x = -4; x <= -1; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: y === 0 ? c.dark : c.primary });

  // Thruster housing on back of boot (y=1-3)
  for (let y = 1; y <= 3; y++) {
    v.push({ x: -3, y, z: 2, color: c.secondary });
    v.push({ x: -2, y, z: 2, color: c.secondary });
  }
  // Glowing nozzle (y=1)
  v.push({ x: -3, y: 1, z: 2, color: c.visor, emissive: true });
  v.push({ x: -2, y: 1, z: 2, color: c.visor, emissive: true });

  // Shin with side thruster mounts (y=2-5)
  for (let y = 2; y <= 5; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        const isSideMount = x === -4 && y >= 3 && z === 0;
        v.push({ x, y, z, color: isSideMount ? c.accent : z === -1 ? c.primary : c.secondary });
      }
    }
  }

  // Knee (y=6)
  for (let x = -4; x <= -1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 6, z, color: z === -1 ? c.highlight : c.secondary });

  // --- AAA MICRO-DETAILS ---
  // 1. High-fidelity dual fire-nozzles emitting active glows (yellow/red)
  v.push({ x: -3, y: 2, z: 2, color: '#ef4444', emissive: true });
  v.push({ x: -2, y: 2, z: 2, color: '#f59e0b', emissive: true });
  // 2. Reinforced thruster heat vents on outer calf
  v.push({ x: -4, y: 4, z: 1, color: c.dark });

  return v;
}

function buildLeftLeg_ODST(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Heavy magnetic boot (y=0-2) — dark sole, dark side trim
  for (let y = 0; y <= 2; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        const isSole = y === 0;
        const isSide = x === -4 || x === -1;
        v.push({ x, y, z, color: isSole || isSide ? c.dark : c.primary });
      }
    }
  }

  // Shin with side tactical pouch (y=3-5)
  for (let y = 3; y <= 5; y++) {
    for (let x = -4; x <= -1; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: z === -1 ? c.primary : c.secondary });
  }
  // Side pouch sticking out (x=-5 outer edge)
  for (let y = 3; y <= 4; y++) {
    v.push({ x: -5, y, z: 0, color: c.dark });
    v.push({ x: -5, y, z: -1, color: c.secondary });
  }

  // Heavy knee (y=6) — all dark
  for (let x = -4; x <= -1; x++)
    for (let z = -1; z <= 1; z++)
      v.push({ x, y: 6, z, color: c.dark });

  // --- AAA MICRO-DETAILS ---
  // 1. Thigh utility straps
  v.push({ x: -4, y: 5, z: 0, color: c.dark });
  v.push({ x: -4, y: 5, z: -1, color: c.accent });
  // 2. Magnetic sole locking indicator LEDs
  v.push({ x: -1, y: 1, z: 0, color: c.visor, emissive: true });

  return v;
}

function buildLeftLeg_EOD(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Heavy boot (y=0-1)
  for (let y = 0; y <= 1; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -2; z <= 2; z++) {
        v.push({ x, y, z, color: y === 0 ? c.dark : c.secondary });
      }
    }
  }

  // Thick shin plate (y=2-5)
  for (let y = 2; y <= 5; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        v.push({ x, y, z, color: c.secondary });
      }
    }
    // Bulk front armor plate
    for (let x = -3; x <= -2; x++) {
      v.push({ x, y, z: -2, color: c.primary });
    }
  }

  // Hazard status panel (emissive)
  v.push({ x: -3, y: 4, z: -2, color: c.accent, emissive: true });

  // Heavy knee guard (y=6)
  for (let x = -4; x <= -1; x++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 6, z, color: c.secondary });
    }
  }
  v.push({ x: -3, y: 6, z: -2, color: c.dark });
  v.push({ x: -2, y: 6, z: -2, color: c.dark });

  // --- AAA MICRO-DETAILS ---
  // 1. Lower shin heavy-duty bumper plates
  v.push({ x: -4, y: 3, z: -2, color: c.dark });
  v.push({ x: -1, y: 3, z: -2, color: c.dark });
  // 2. Status panel flashing nodes
  v.push({ x: -2, y: 4, z: -2, color: '#ffffff', emissive: true });

  return v;
}

function buildLeftLeg_Hayabusa(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];

  // Boot (y=0-1)
  for (let y = 0; y <= 1; y++)
    for (let x = -4; x <= -1; x++)
      for (let z = -1; z <= 1; z++)
        v.push({ x, y, z, color: y === 0 ? c.dark : c.primary });

  // Sleek shin guards (y=2-5)
  for (let y = 2; y <= 5; y++) {
    for (let x = -4; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        v.push({ x, y, z, color: c.primary });
      }
    }
    // Front angled ridge greaves
    v.push({ x: -3, y, z: -2, color: c.highlight });
    v.push({ x: -2, y, z: -2, color: c.highlight });
  }

  // Sharp samurai knee armor cap pointing forward (y=6)
  for (let x = -4; x <= -1; x++) {
    for (let z = -1; z <= 1; z++) {
      v.push({ x, y: 6, z, color: c.secondary });
    }
  }
  v.push({ x: -3, y: 6, z: -2, color: c.accent });
  v.push({ x: -2, y: 6, z: -2, color: c.accent });

  // --- AAA MICRO-DETAILS ---
  // 1. Golden samurai leg plate borders
  v.push({ x: -3, y: 3, z: -2, color: '#fbbf24' });
  v.push({ x: -2, y: 3, z: -2, color: '#fbbf24' });
  v.push({ x: -3, y: 4, z: -2, color: '#fbbf24' });
  v.push({ x: -2, y: 4, z: -2, color: '#fbbf24' });
  // 2. Ankle protection wrap ties
  v.push({ x: -4, y: 2, z: 0, color: '#ef4444' });
  v.push({ x: -1, y: 2, z: 0, color: '#ef4444' });

  return v;
}
// ─── HIP BUILDER ──────────────────────────────────────────────────────────────
// Pivot at (0, 0, 0). Voxels at y=7..8, x=-3..3, z=-1..1.

function buildHip(c: SpartanColors): VoxelData[] {
  const v: VoxelData[] = [];
  for (let y = 7; y <= 8; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -1; z <= 1; z++) {
        const isBuckle = y === 8 && Math.abs(x) <= 1 && z === -1;
        const isEdge = Math.abs(x) === 3;
        v.push({ x, y, z, color: isBuckle ? c.accent : isEdge ? c.secondary : c.secondary });
      }
    }
  }
  return v;
}

export function applyPaintJob(voxels: VoxelData[], slot: string, paintJob?: ArmorPaintJob) {
  if (!paintJob) return;

  // 1. Apply base colors if any
  const baseColor = paintJob.baseColors?.[slot as keyof typeof paintJob.baseColors];
  if (baseColor) {
    voxels.forEach((v) => {
      if (!v.emissive) {
        v.color = baseColor;
      }
    });
  }

  // 2. Apply per-voxel colors if any
  const voxelColors = paintJob[slot as keyof ArmorPaintJob] as { [key: string]: string } | undefined;
  if (voxelColors) {
    voxels.forEach((v) => {
      const key = `${v.x},${v.y},${v.z}`;
      if (voxelColors[key] !== undefined) {
        v.color = voxelColors[key];
      }
    });
  }

  // 3. Apply custom emissive colors if any
  const emissiveMap = paintJob.emissive?.[slot as keyof typeof paintJob.emissive] as { [key: string]: boolean } | undefined;
  if (emissiveMap) {
    voxels.forEach((v) => {
      const key = `${v.x},${v.y},${v.z}`;
      if (emissiveMap[key] !== undefined) {
        v.emissive = emissiveMap[key];
      }
    });
  }
}

export function getVoxelSegmentData(slot: string, preset: string, customHue?: number): VoxelData[] {
  const primaryHex = customHue !== undefined
    ? `hsl(${customHue}, 85%, 50%)`
    : '#3b82f6';
  const visorHex = customHue !== undefined
    ? `hsl(${customHue}, 95%, 70%)`
    : '#10b981';
  const highlightHex = customHue !== undefined
    ? `hsl(${customHue}, 75%, 65%)`
    : '#60a5fa';
  const accentHex = customHue !== undefined
    ? `hsl(${customHue}, 90%, 75%)`
    : '#93c5fd';

  const colors: SpartanColors = {
    primary: primaryHex,
    secondary: '#1e293b',
    visor: visorHex,
    accent: accentHex,
    dark: '#0f172a',
    highlight: highlightHex,
  };

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
    return fn(colors);
  } else if (slot === 'torso') {
    const fn = {
      'mark-vi': buildTorso_MarkVI,
      'scout': buildTorso_Scout,
      'recon': buildTorso_Recon,
      'eod': buildTorso_EOD,
      'hayabusa': buildTorso_Hayabusa,
    }[preset] || buildTorso_MarkVI;
    return fn(colors);
  } else if (slot === 'leftArm') {
    const fn = {
      'mark-vi': buildLeftArm_MarkVI,
      'odst': buildLeftArm_ODST,
      'recon': buildLeftArm_Recon,
      'eod': buildLeftArm_EOD,
      'hayabusa': buildLeftArm_Hayabusa,
    }[preset] || buildLeftArm_MarkVI;
    return fn(colors);
  } else if (slot === 'rightArm') {
    const fn = {
      'mark-vi': buildLeftArm_MarkVI,
      'odst': buildLeftArm_ODST,
      'recon': buildLeftArm_Recon,
      'eod': buildLeftArm_EOD,
      'hayabusa': buildLeftArm_Hayabusa,
    }[preset] || buildLeftArm_MarkVI;
    return mirrorX(fn(colors));
  } else if (slot === 'leftLeg') {
    const fn = {
      'mark-vi': buildLeftLeg_MarkVI,
      'jump-jet': buildLeftLeg_JumpJet,
      'odst': buildLeftLeg_ODST,
      'eod': buildLeftLeg_EOD,
      'hayabusa': buildLeftLeg_Hayabusa,
    }[preset] || buildLeftLeg_MarkVI;
    return fn(colors);
  } else if (slot === 'rightLeg') {
    const fn = {
      'mark-vi': buildLeftLeg_MarkVI,
      'jump-jet': buildLeftLeg_JumpJet,
      'odst': buildLeftLeg_ODST,
      'eod': buildLeftLeg_EOD,
      'hayabusa': buildLeftLeg_Hayabusa,
    }[preset] || buildLeftLeg_MarkVI;
    return mirrorX(fn(colors));
  }

  return [];
}

// ─── SPARTAN MODEL BUILDER ────────────────────────────────────────────────────

export function buildVoxelSpartanModel(
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

  const scale = 0.08;

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

  // Select presets from loadout
  const helmetFn = {
    'mark-vi': buildHelmet_MarkVI,
    'odst': buildHelmet_ODST,
    'recon': buildHelmet_Recon,
    'eva': buildHelmet_EVA,
    'gungnir': buildHelmet_Gungnir,
    'eod': buildHelmet_EOD,
    'hayabusa': buildHelmet_Hayabusa,
    'cqb': buildHelmet_CQB,
  }[loadout.helmet ?? 'mark-vi'];

  const torsoFn = {
    'mark-vi': buildTorso_MarkVI,
    'scout': buildTorso_Scout,
    'recon': buildTorso_Recon,
    'eod': buildTorso_EOD,
    'hayabusa': buildTorso_Hayabusa,
  }[loadout.torso ?? 'mark-vi'];

  const leftArmFn = {
    'mark-vi': buildLeftArm_MarkVI,
    'odst': buildLeftArm_ODST,
    'recon': buildLeftArm_Recon,
    'eod': buildLeftArm_EOD,
    'hayabusa': buildLeftArm_Hayabusa,
  }[loadout.arm ?? 'mark-vi'];

  const leftLegFn = {
    'mark-vi': buildLeftLeg_MarkVI,
    'jump-jet': buildLeftLeg_JumpJet,
    'odst': buildLeftLeg_ODST,
    'eod': buildLeftLeg_EOD,
    'hayabusa': buildLeftLeg_Hayabusa,
  }[loadout.leg ?? 'mark-vi'];

  const paintJob = loadout.paintJob;

  // --- LEGS ---
  const leftLegVoxels = leftLegFn(colors);
  applyPaintJob(leftLegVoxels, 'leftLeg', paintJob);
  const leftLegGroup = createSegmentGroup(leftLegVoxels, -2.5, 7, 0);
  leftLegGroup.position.set(-2.5 * scale, 7 * scale, 0);

  const rightLegVoxels = mirrorX(leftLegFn(colors));
  applyPaintJob(rightLegVoxels, 'rightLeg', paintJob);
  const rightLegGroup = createSegmentGroup(rightLegVoxels, 2.5, 7, 0);
  rightLegGroup.position.set(2.5 * scale, 7 * scale, 0);

  // --- HIP / LOWER TORSO ---
  const hipVoxels = buildHip(colors);
  const lowerTorsoGroup = createSegmentGroup(hipVoxels, 0, 0, 0);
  lowerTorsoGroup.add(leftLegGroup);
  lowerTorsoGroup.add(rightLegGroup);

  // --- UPPER TORSO ---
  const torsoVoxels = torsoFn(colors);
  applyPaintJob(torsoVoxels, 'torso', paintJob);
  const upperTorsoGroup = createSegmentGroup(torsoVoxels, 0, 8, 0);
  upperTorsoGroup.position.set(0, 8 * scale, 0);

  // --- ARMS ---
  const leftArmVoxels = leftArmFn(colors);
  applyPaintJob(leftArmVoxels, 'leftArm', paintJob);
  const leftArmGroup = createSegmentGroup(leftArmVoxels, -5.5, 15, 0);
  leftArmGroup.position.set(-5.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(leftArmGroup);

  const rightArmVoxels = mirrorX(leftArmFn(colors));
  applyPaintJob(rightArmVoxels, 'rightArm', paintJob);
  const rightArmGroup = createSegmentGroup(rightArmVoxels, 5.5, 15, 0);
  rightArmGroup.position.set(5.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(rightArmGroup);

  // --- HEAD ---
  const headVoxels = helmetFn(colors);
  applyPaintJob(headVoxels, 'helmet', paintJob);
  const headGroup = createSegmentGroup(headVoxels, 0, 16, 0);
  headGroup.position.set(0, (16 - 8) * scale, 0);
  upperTorsoGroup.add(headGroup);

  // Root group
  const Spartan = new THREE.Group();
  Spartan.add(lowerTorsoGroup);
  Spartan.add(upperTorsoGroup);

  Spartan.userData = {
    lowerTorso: lowerTorsoGroup,
    upperTorso: upperTorsoGroup,
    leftLeg: leftLegGroup,
    rightLeg: rightLegGroup,
    leftArm: leftArmGroup,
    rightArm: rightArmGroup,
    head: headGroup,
  };

  return Spartan;
}

// ─── GRAVITY HAMMER MODEL ─────────────────────────────────────────────────────

export function buildGravityHammerModel(customHue?: number, preset: HammerPreset = 'default'): THREE.Group {
  const data: VoxelData[] = [];

  // ─── HANDLE / SHAFT SKELETON ───
  let handleColor = '#27272a';
  let accentColor = '#3f3f46';

  if (preset === 'sepulotez') {
    handleColor = '#5c2c16'; // rope/leather brown
    accentColor = '#b55a30';
  } else if (preset === 'fist-of-rukt') {
    handleColor = '#78350f'; // wood brown
    accentColor = '#a16207';
  } else if (preset === 'akelas') {
    handleColor = '#18181b'; // pure black
    accentColor = '#7f1d1d'; // dark red
  } else if (preset === 'akelus') {
    handleColor = '#e4e4e7'; // light gray/white
    accentColor = '#0369a1'; // blue
  } else if (preset === 'eektah-fel') {
    handleColor = '#1e293b';
    accentColor = '#15803d'; // green
  } else if (preset === 'gravity-axe' || preset === 'gravity-mace') {
    handleColor = '#171717'; // very dark
    accentColor = '#b45309'; // amber/orange
  }

  // Pole/Shaft
  for (let y = 0; y < 14; y++) {
    data.push({ x: 0, y: y, z: 0, color: handleColor });
    if (y % 4 === 0) {
      data.push({ x: 1, y: y, z: 0, color: accentColor });
      data.push({ x: -1, y: y, z: 0, color: accentColor });
      data.push({ x: 0, y: y, z: 1, color: accentColor });
      data.push({ x: 0, y: y, z: -1, color: accentColor });
    }
  }

  // Pommel at bottom of shaft (y = 0)
  if (preset === 'akelas') {
    data.push({ x: 0, y: -1, z: 0, color: '#ef4444', emissive: true });
  } else if (preset === 'akelus') {
    data.push({ x: 0, y: -1, z: 0, color: '#06b6d4', emissive: true });
  } else if (preset === 'sepulotez') {
    data.push({ x: 0, y: -1, z: 0, color: '#fbbf24' });
    data.push({ x: 1, y: -1, z: 0, color: '#d97706' });
    data.push({ x: -1, y: -1, z: 0, color: '#d97706' });
  } else if (preset === 'fist-of-rukt') {
    data.push({ x: 0, y: -1, z: 0, color: '#475569' });
    data.push({ x: 0, y: -2, z: 0, color: '#94a3b8' });
  } else {
    data.push({ x: 0, y: -1, z: 0, color: accentColor });
  }

  // Head connector
  const topY = 14;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      let connColor = '#1e293b';
      if (preset === 'akelas') connColor = '#09090b';
      else if (preset === 'akelus') connColor = '#f4f4f5';
      else if (preset === 'sepulotez') connColor = '#b45309';
      else if (preset === 'halbashi') connColor = '#3f3f46';
      else if (preset === 'fist-of-rukt') connColor = '#78716c';
      
      data.push({ x: dx, y: topY, z: dz, color: connColor });
      data.push({ x: dx, y: topY + 1, z: dz, color: connColor });
    }
  }

  // ─── UNIQUE HAMMER HEAD GEOMETRIES ───
  if (preset === 'akelas') {
    // Akelas: Sleek, dark carbon-like head with a thin, glowing red stripe
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 16; hy <= 21; hy++) {
        for (let hz = -4; hz <= -1; hz++) {
          const isEdge = hz === -4;
          const isGlow = isEdge && (hy === 18 || hy === 19);
          data.push({
            x: hx,
            y: hy,
            z: hz,
            color: isGlow ? '#ef4444' : '#18181b',
            emissive: isGlow
          });
        }
      }
    }
    // Backward counterweight fin
    for (let hy = 16; hy <= 20; hy++) {
      const depth = hy === 18 ? 3 : 2;
      for (let hz = 1; hz <= depth; hz++) {
        data.push({ x: 0, y: hy, z: hz, color: '#27272a' });
        if (hz === depth) {
          data.push({ x: 0, y: hy, z: hz, color: '#b91c1c', emissive: true });
        }
      }
    }
  } else if (preset === 'akelus') {
    // Akelus: Sleek white high-tech plating, glowing neon blue energy channels
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 16; hy <= 21; hy++) {
        for (let hz = -4; hz <= -1; hz++) {
          const isEdge = hz === -4;
          const isGlow = isEdge && (hy === 18 || hy === 19);
          data.push({
            x: hx,
            y: hy,
            z: hz,
            color: isGlow ? '#06b6d4' : '#f4f4f5',
            emissive: isGlow
          });
        }
      }
    }
    for (let hy = 17; hy <= 20; hy++) {
      data.push({ x: -2, y: hy, z: -2, color: '#38bdf8', emissive: true });
      data.push({ x: 2, y: hy, z: -2, color: '#38bdf8', emissive: true });
    }
    for (let hy = 16; hy <= 20; hy++) {
      const depth = hy === 18 ? 3 : 2;
      for (let hz = 1; hz <= depth; hz++) {
        data.push({ x: 0, y: hy, z: hz, color: '#e4e4e7' });
        if (hz === depth) {
          data.push({ x: 0, y: hy, z: hz, color: '#0ea5e9', emissive: true });
        }
      }
    }
  } else if (preset === 'paegaas') {
    // Paegaas: Layered mechanical gold and gunmetal plates, glowing orange vents
    for (let hx = -2; hx <= 2; hx++) {
      for (let hy = 15; hy <= 21; hy++) {
        for (let hz = -3; hz <= -1; hz++) {
          const isGold = Math.abs(hx) === 2 || hy === 21 || hy === 15;
          data.push({
            x: hx,
            y: hy,
            z: hz,
            color: isGold ? '#d97706' : '#334155'
          });
        }
      }
    }
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 17; hy <= 19; hy++) {
        data.push({ x: hx, y: hy, z: -4, color: '#f59e0b', emissive: true });
        data.push({ x: hx, y: hy, z: -5, color: '#f97316', emissive: true });
      }
    }
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 16; hy <= 20; hy++) {
        for (let hz = 1; hz <= 3; hz++) {
          const isGlow = hz === 3 && hy === 18;
          data.push({
            x: hx,
            y: hy,
            z: hz,
            color: isGlow ? '#fbbf24' : '#1e293b',
            emissive: isGlow
          });
        }
      }
    }
  } else if (preset === 'sepulotez') {
    // Sepulo'tez: Ancient stone-brick/gold ornament, rope wrappings
    for (let hx = -2; hx <= 2; hx++) {
      for (let hy = 16; hy <= 20; hy++) {
        for (let hz = -3; hz <= 1; hz++) {
          const isCarving = (hy === 18 && hx === 0) || (Math.abs(hx) === 2 && hy === 19);
          data.push({
            x: hx,
            y: hy,
            z: hz,
            color: isCarving ? '#fbbf24' : '#854d0e'
          });
        }
      }
    }
    const ropeColor = '#7c2d12';
    for (let hx = -3; hx <= 3; hx++) {
      data.push({ x: hx, y: 17, z: -1, color: ropeColor });
      data.push({ x: hx, y: 19, z: -1, color: ropeColor });
    }
    data.push({ x: 0, y: 21, z: -1, color: '#fbbf24' });
    data.push({ x: 0, y: 22, z: -1, color: '#fbbf24' });
  } else if (preset === 'halbashi') {
    // Halbashi: Brutalist rectangular copper-bronze head, layered steps/teeth
    for (let hy = 15; hy <= 21; hy++) {
      let frontDepth = -1;
      if (hy === 18) frontDepth = -5;
      else if (hy === 17 || hy === 19) frontDepth = -4;
      else if (hy === 16 || hy === 20) frontDepth = -3;
      else frontDepth = -2;

      for (let hx = -2; hx <= 2; hx++) {
        for (let hz = frontDepth; hz <= 2; hz++) {
          const isEdge = hz === frontDepth;
          const colorVal = isEdge ? '#b45309' : '#451a03';
          data.push({ x: hx, y: hy, z: hz, color: colorVal });
        }
      }
    }
  } else if (preset === 'eektah-fel') {
    // Eektah-Fel: Dark iron frame cage holding green vertical neon tubes
    for (let hy = 15; hy <= 22; hy++) {
      for (let hx = -2; hx <= 2; hx++) {
        for (let hz = -3; hz <= 1; hz++) {
          const isInside = Math.abs(hx) <= 1 && hz >= -2 && hz <= -1 && hy >= 17 && hy <= 20;
          if (isInside) {
            data.push({
              x: hx,
              y: hy,
              z: hz,
              color: '#22c55e',
              emissive: true
            });
          } else {
            const isFrameBorder = Math.abs(hx) === 2 || hy === 15 || hy === 22 || hz === 1 || hz === -3;
            data.push({
              x: hx,
              y: hy,
              z: hz,
              color: isFrameBorder ? '#334155' : '#0f172a'
            });
          }
        }
      }
    }
    for (let hy = 16; hy <= 21; hy++) {
      data.push({ x: -3, y: hy, z: -1, color: '#4ade80', emissive: true });
      data.push({ x: 3, y: hy, z: -1, color: '#4ade80', emissive: true });
    }
  } else if (preset === 'gravity-axe') {
    // Gravity Axe: Volcanic obsidian core, sweeping glowing orange axe blades
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 15; hy <= 21; hy++) {
        for (let hz = -2; hz <= 2; hz++) {
          data.push({ x: hx, y: hy, z: hz, color: '#1c1917' });
        }
      }
    }
    for (let hy = 14; hy <= 22; hy++) {
      let bladeWidth = 1;
      if (hy === 18) bladeWidth = 6;
      else if (hy === 17 || hy === 19) bladeWidth = 5;
      else if (hy === 16 || hy === 20) bladeWidth = 4;
      else if (hy === 15 || hy === 21) bladeWidth = 3;
      else bladeWidth = 2;

      for (let hx = 2; hx <= bladeWidth; hx++) {
        const isEdge = hx === bladeWidth;
        const colorVal = isEdge ? '#f97316' : '#78716c';
        data.push({ x: hx, y: hy, z: 0, color: colorVal, emissive: isEdge });
        data.push({ x: hx, y: hy, z: -1, color: colorVal, emissive: isEdge });
        data.push({ x: -hx, y: hy, z: 0, color: colorVal, emissive: isEdge });
        data.push({ x: -hx, y: hy, z: -1, color: colorVal, emissive: isEdge });
      }
    }
  } else if (preset === 'gravity-mace') {
    // Gravity Mace: Spiked mace head, glowing red-hot spikes, dark wrapped grip
    for (let hx = -2; hx <= 2; hx++) {
      for (let hy = 16; hy <= 20; hy++) {
        for (let hz = -2; hz <= 2; hz++) {
          data.push({ x: hx, y: hy, z: hz, color: '#262626' });
        }
      }
    }
    for (let hx = 3; hx <= 4; hx++) {
      const isTip = hx === 4;
      const c = isTip ? '#ef4444' : '#f97316';
      for (let hy = 17; hy <= 19; hy++) {
        data.push({ x: hx, y: hy, z: 0, color: c, emissive: true });
        data.push({ x: -hx, y: hy, z: 0, color: c, emissive: true });
      }
    }
    for (let hz = 3; hz <= 4; hz++) {
      const isTip = hz === 4;
      const c = isTip ? '#ef4444' : '#f97316';
      for (let hy = 17; hy <= 19; hy++) {
        data.push({ x: 0, y: hy, z: hz, color: c, emissive: true });
        data.push({ x: 0, y: hy, z: -hz, color: c, emissive: true });
      }
    }
    for (let hy = 21; hy <= 23; hy++) {
      const isTip = hy === 23;
      const c = isTip ? '#ef4444' : '#f97316';
      for (let hx = -1; hx <= 1; hx++) {
        data.push({ x: hx, y: hy, z: 0, color: c, emissive: true });
      }
    }
  } else if (preset === 'fist-of-rukt') {
    // Fist of Rukt: Massive stone mallet, gold gears, wooden shaft
    for (let hx = -3; hx <= 3; hx++) {
      for (let hy = 15; hy <= 21; hy++) {
        for (let hz = -4; hz <= 4; hz++) {
          const isGoldGear = Math.abs(hx) === 3 && (hy === 18 || hy === 17 || hy === 19) && Math.abs(hz) <= 1;
          const isStoneBorder = Math.abs(hx) === 2 || hy === 15 || hy === 21 || Math.abs(hz) === 4;
          
          if (isGoldGear) {
            data.push({ x: hx, y: hy, z: hz, color: '#fbbf24' });
          } else {
            data.push({
              x: hx,
              y: hy,
              z: hz,
              color: isStoneBorder ? '#78716c' : '#44403c'
            });
          }
        }
      }
    }
  } else {
    // Default Gravity Hammer
    for (let hx = -2; hx <= 2; hx++) {
      for (let hy = 16; hy <= 20; hy++) {
        for (let hz = -4; hz <= -1; hz++) {
          const isSpike = hy === 18 && Math.abs(hx) === 2;
          data.push({ x: hx, y: hy, z: hz, color: isSpike ? '#ff5500' : '#475569' });
        }
      }
    }

    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 16; hy <= 19; hy++) {
        for (let hz = 1; hz <= 4; hz++) {
          data.push({ x: hx, y: hy, z: hz, color: '#334155' });
        }
      }
    }

    const energyColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#38bdf8';
    for (let hx = -1; hx <= 1; hx++) {
      for (let hy = 17; hy <= 19; hy++) {
        data.push({ x: hx, y: hy, z: -5, color: energyColor, emissive: true });
      }
    }
    for (let hy = 15; hy <= 21; hy++) {
      data.push({ x: -3, y: hy, z: -1, color: energyColor, emissive: true });
      data.push({ x: 3, y: hy, z: -1, color: energyColor, emissive: true });
    }
  }

  const hammer = createVoxelGroup(data, 0.08);
  hammer.traverse((child) => {
    if (child instanceof THREE.Mesh) child.position.y -= 0.3;
  });

  return hammer;
}

// ─── KATAR SWORD MODEL ────────────────────────────────────────────────────────

export function buildKatarSwordModel(customHue?: number, preset: SwordPreset = 'default'): THREE.Group {
  const data: VoxelData[] = [];

  if (preset === 'default') {
    // BACKWARDS COMPATIBILITY: Original Katar Sword
    for (let y = 0; y <= 9; y++) {
      data.push({ x: -2, y: y, z: 0, color: '#475569' });
      data.push({ x: -2, y: y, z: 1, color: '#334155' });
      data.push({ x: 2, y: y, z: 0, color: '#475569' });
      data.push({ x: 2, y: y, z: 1, color: '#334155' });
    }

    for (let x = -1; x <= 1; x++) {
      data.push({ x: x, y: 3, z: 0, color: '#0f172a' });
      data.push({ x: x, y: 6, z: 0, color: '#0f172a' });
    }

    for (let x = -3; x <= 3; x++) {
      for (let z = -1; z <= 1; z++) {
        data.push({ x: x, y: 10, z: z, color: '#1e293b' });
      }
    }

    const swordEdgeColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#22d3ee';
    for (let y = 11; y <= 26; y++) {
      let w = 0;
      if (y <= 13) w = 3;
      else if (y <= 17) w = 2;
      else if (y <= 21) w = 1;
      else w = 0;

      for (let x = -w; x <= w; x++) {
        const isEdge = x === -w || x === w || y === 26;
        data.push({ x: x, y: y, z: 0, color: isEdge ? swordEdgeColor : '#64748b', emissive: isEdge });
      }
    }
  } else {
    // ─── PREMIUM DOUBLE-PRONGED ENERGY SWORDS ───
    let hiltColor1 = '#334155'; // Main hilt body
    let hiltColor2 = '#0f172a'; // Hilt trim
    let baseColor = '#22d3ee';  // Base blade neon color
    let coreColor = '#ffffff';  // Core blade white color
    let crackleColors: string[] = []; // Energy crackles

    // Resolve weapon-specific aesthetics
    if (preset === 'halo-ce') {
      hiltColor1 = '#3f3f46';
      hiltColor2 = '#18181b';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#22d3ee';
      coreColor = '#ffffff';
    } else if (preset === 'halo-2') {
      hiltColor1 = '#1e1b4b';
      hiltColor2 = '#2e1065';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 90%, 65%)` : '#38bdf8';
      coreColor = '#f0f9ff';
      crackleColors = ['#ec4899', '#d946ef', '#c084fc'];
    } else if (preset === 'halo-3') {
      hiltColor1 = '#334155';
      hiltColor2 = '#0f172a';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#0284c7';
      coreColor = '#ffffff';
      crackleColors = ['#818cf8', '#a78bfa', '#c084fc'];
    } else if (preset === 'reach') {
      hiltColor1 = '#0f172a';
      hiltColor2 = '#1e293b';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 95%, 55%)` : '#06b6d4';
      coreColor = '#ffffff';
    } else if (preset === 'anniversary') {
      hiltColor1 = '#94a3b8';
      hiltColor2 = '#475569';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#06b6d4';
      coreColor = '#ffffff';
      crackleColors = ['#38bdf8', '#7dd3fc', '#ffffff'];
    } else if (preset === 'halo-4') {
      hiltColor1 = '#4b5563';
      hiltColor2 = '#111827';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 90%, 65%)` : '#00bfff';
      coreColor = '#ffffff';
      crackleColors = ['#1e90ff', '#87cefa'];
    } else if (preset === 'h2a-blue') {
      hiltColor1 = '#374151';
      hiltColor2 = '#1f2937';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 85%, 55%)` : '#2563eb';
      coreColor = '#93c5fd';
    } else if (preset === 'h2a-pink') {
      hiltColor1 = '#0f172a';
      hiltColor2 = '#020617';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 90%, 65%)` : '#d946ef';
      coreColor = '#f43f5e';
      crackleColors = ['#881337', '#e11d48', '#ffffff'];
    } else if (preset === 'halo-5') {
      hiltColor1 = '#27272a';
      hiltColor2 = '#18181b';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 80%, 55%)` : '#0284c7';
      coreColor = '#ffffff';
    } else if (preset === 'infinite') {
      hiltColor1 = '#cbd5e1';
      hiltColor2 = '#f1f5f9';
      baseColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#38bdf8';
      coreColor = '#ffffff';
      crackleColors = ['#1d4ed8', '#60a5fa', '#93c5fd'];
    }

    // ─── BUILD COMMON ERGONOMIC HILT ───
    // Grip handle (y = 0..5, x = 0, z = 0)
    for (let y = 0; y <= 5; y++) {
      data.push({ x: 0, y: y, z: 0, color: hiltColor1 });
      data.push({ x: 0, y: y, z: 1, color: hiltColor2 });
      data.push({ x: 0, y: y, z: -1, color: hiltColor2 });
    }

    // Emitter Base / Guard (y = 6..7)
    // Curves outward to receive the twin blades
    for (let x = -3; x <= 3; x++) {
      const isCenter = x === 0;
      const c1 = isCenter ? hiltColor2 : hiltColor1;
      const c2 = isCenter ? '#475569' : hiltColor2;
      
      // Horizontal bar
      data.push({ x: x, y: 6, z: 0, color: c1 });
      data.push({ x: x, y: 6, z: 1, color: c2 });
      data.push({ x: x, y: 6, z: -1, color: c2 });
      
      // Sweep upward slightly at the ends
      if (Math.abs(x) >= 2) {
        data.push({ x: x, y: 7, z: 0, color: hiltColor1 });
        data.push({ x: x, y: 7, z: 1, color: hiltColor2 });
      }
    }

    // Reach indicator light / Halo 5 gold trim / Halo CE indicator
    if (preset === 'reach') {
      data.push({ x: 0, y: 6, z: 1, color: '#f59e0b', emissive: true });
    } else if (preset === 'halo-5') {
      data.push({ x: -1, y: 6, z: 1, color: '#fbbf24' });
      data.push({ x: 1, y: 6, z: 1, color: '#fbbf24' });
    }

    // Halo 4 aggressive forward teeth
    if (preset === 'halo-4') {
      data.push({ x: -4, y: 6, z: 0, color: hiltColor2 });
      data.push({ x: -4, y: 7, z: 0, color: hiltColor1 });
      data.push({ x: -4, y: 8, z: 0, color: hiltColor1 });
      data.push({ x: 4, y: 6, z: 0, color: hiltColor2 });
      data.push({ x: 4, y: 7, z: 0, color: hiltColor1 });
      data.push({ x: 4, y: 8, z: 0, color: hiltColor1 });
    }

    // ─── BUILD TWIN CURVED PLASMATIC BLADES ───
    for (let y = 8; y <= 26; y++) {
      // Curve offset progression: flares out then sweeps back in
      let offset = 3;
      if (y >= 11 && y <= 15) {
        offset = 4; // Outward flare
      } else if (y >= 16 && y <= 19) {
        offset = 3;
      } else if (y >= 20 && y <= 23) {
        offset = 2; // Inward sweep
      } else if (y >= 24) {
        offset = 1; // Sharp tips
      }

      const widths = offset > 1 ? [offset, offset - 1] : [offset];

      widths.forEach((x, index) => {
        const isEdge = x === offset || y === 26;
        
        let voxelColor = isEdge ? baseColor : coreColor;
        
        if (crackleColors.length > 0 && Math.random() < 0.28) {
          voxelColor = crackleColors[Math.floor(Math.random() * crackleColors.length)];
        }

        // Left blade prong
        data.push({ x: -x, y: y, z: 0, color: voxelColor, emissive: true });
        // Right blade prong
        data.push({ x: x, y: y, z: 0, color: voxelColor, emissive: true });

        // Add 3D diamond cross-section thickness at the prong centers
        if (index === 0 && offset > 1) {
          data.push({ x: -x, y: y, z: 1, color: isEdge ? baseColor : coreColor, emissive: true });
          data.push({ x: -x, y: y, z: -1, color: isEdge ? baseColor : coreColor, emissive: true });
          
          data.push({ x: x, y: y, z: 1, color: isEdge ? baseColor : coreColor, emissive: true });
          data.push({ x: x, y: y, z: -1, color: isEdge ? baseColor : coreColor, emissive: true });
        }
      });
    }
  }

  const sword = createVoxelGroup(data, 0.08);
  sword.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.y -= 4.5 * 0.08;
    }
  });

  return sword;
}

export function buildPistolModel(customHue?: number): THREE.Group {
  const data: VoxelData[] = [];
  
  // Grip (slanted slightly back for a sleek design)
  for (let y = 0; y <= 4; y++) {
    const zOffset = Math.floor(y / 2);
    data.push({ x: 0, y: y, z: zOffset, color: '#0f172a' }); // Dark polymer grip center
    data.push({ x: -1, y: y, z: zOffset, color: '#1e293b' }); // Left grip plate
    data.push({ x: 1, y: y, z: zOffset, color: '#1e293b' }); // Right grip plate
  }

  // Slide / Barrel receiver (main body of the pistol)
  // y = 5 to 7, z = -4 to 2
  for (let y = 5; y <= 7; y++) {
    for (let z = -4; z <= 2; z++) {
      const isTopSlide = y === 7;
      const color = isTopSlide ? '#334155' : '#1e293b';
      data.push({ x: 0, y: y, z: z, color: color });
      data.push({ x: -1, y: y, z: z, color: '#334155' });
      data.push({ x: 1, y: y, z: z, color: '#334155' });
    }
  }

  // Trigger guard and trigger
  data.push({ x: 0, y: 4, z: -1, color: '#475569' });
  data.push({ x: 0, y: 3, z: -1, color: '#475569' });
  data.push({ x: 0, y: 3, z: 0, color: '#475569' });
  data.push({ x: 0, y: 4, z: 0, color: '#f97316' }); // Orange trigger

  // Laser tactical light (emissive yellow/custom hue) under barrel
  const laserColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#22d3ee';
  data.push({ x: 0, y: 4, z: -3, color: laserColor, emissive: true });
  data.push({ x: 0, y: 6, z: -4, color: laserColor, emissive: true }); // glowing front sight

  // --- AAA MICRO-DETAILS ---
  // 1. Digital ammunition counter screen on rear slide plate (visible in first person!)
  data.push({ x: 0, y: 7, z: 2, color: '#22c55e', emissive: true }); // Glowing green numbers
  data.push({ x: -1, y: 7, z: 2, color: '#090d16' }); // Bezel left
  data.push({ x: 1, y: 7, z: 2, color: '#090d16' }); // Bezel right
  // 2. Tactical laser emitter under-barrel
  data.push({ x: 0, y: 5, z: -4, color: laserColor, emissive: true });
  // 3. Side slide plate metallic details
  data.push({ x: -2, y: 6, z: -1, color: '#64748b' });
  data.push({ x: 2, y: 6, z: -1, color: '#64748b' });

  const pistol = createVoxelGroup(data, 0.08);
  pistol.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Adjust pivot so it is held at the grip in first-person
      child.position.y -= 3.5 * 0.08;
      child.position.z += 1.0 * 0.08;
    }
  });

  return pistol;
}

