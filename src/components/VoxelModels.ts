/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Internal Types ───────────────────────────────────────────────────────────

interface VoxelData {
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

export type HelmetPreset = 'mark-vi' | 'odst' | 'recon' | 'eva' | 'gungnir';
export type TorsoPreset = 'mark-vi' | 'scout' | 'recon';
export type ArmPreset = 'mark-vi' | 'odst' | 'recon';
export type LegPreset = 'mark-vi' | 'jump-jet' | 'odst';

export interface CharacterLoadout {
  helmet?: HelmetPreset;
  torso?: TorsoPreset;
  arm?: ArmPreset;
  leg?: LegPreset;
}

export const DEFAULT_LOADOUT: CharacterLoadout = {
  helmet: 'mark-vi',
  torso: 'mark-vi',
  arm: 'mark-vi',
  leg: 'mark-vi',
};

export const AVAILABLE_PRESETS = {
  helmet: ['mark-vi', 'odst', 'recon', 'eva', 'gungnir'] as const,
  torso: ['mark-vi', 'scout', 'recon'] as const,
  arm: ['mark-vi', 'odst', 'recon'] as const,
  leg: ['mark-vi', 'jump-jet', 'odst'] as const,
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

function mergeVoxelGeometries(
  voxels: VoxelData[],
  scale: number,
  baseGeo: THREE.BufferGeometry,
  pivotX: number,
  pivotY: number,
  pivotZ: number
): THREE.BufferGeometry {
  if (voxels.length === 0) return new THREE.BufferGeometry();

  const geometries: THREE.BufferGeometry[] = [];
  voxels.forEach((v) => {
    const geo = baseGeo.clone();
    geo.translate(
      (v.x - pivotX) * scale,
      (v.y - pivotY) * scale,
      (v.z - pivotZ) * scale
    );
    const color = new THREE.Color(v.color);
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
  const bevelRadius = scale * 0.15;
  const baseBeveledGeo = createBeveledBoxGeometry(scale, scale, scale, bevelRadius);

  const standardVoxels = data.filter((v) => !v.emissive);
  const emissiveVoxels = data.filter((v) => v.emissive);

  if (standardVoxels.length > 0) {
    const stdGeo = mergeVoxelGeometries(standardVoxels, scale, baseBeveledGeo, 0, 0, 0);
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
      const emGeo = mergeVoxelGeometries(voxels, scale, baseBeveledGeo, 0, 0, 0);
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

  baseBeveledGeo.dispose();
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
  const bevelRadius = scale * 0.15;
  const baseBeveledGeo = createBeveledBoxGeometry(scale, scale, scale, bevelRadius);

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
      const stdGeo = mergeVoxelGeometries(standardVoxels, scale, baseBeveledGeo, pivotX, pivotY, pivotZ);
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
        const emGeo = mergeVoxelGeometries(list, scale, baseBeveledGeo, pivotX, pivotY, pivotZ);
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
  }[loadout.helmet ?? 'mark-vi'];

  const torsoFn = {
    'mark-vi': buildTorso_MarkVI,
    'scout': buildTorso_Scout,
    'recon': buildTorso_Recon,
  }[loadout.torso ?? 'mark-vi'];

  const leftArmFn = {
    'mark-vi': buildLeftArm_MarkVI,
    'odst': buildLeftArm_ODST,
    'recon': buildLeftArm_Recon,
  }[loadout.arm ?? 'mark-vi'];

  const leftLegFn = {
    'mark-vi': buildLeftLeg_MarkVI,
    'jump-jet': buildLeftLeg_JumpJet,
    'odst': buildLeftLeg_ODST,
  }[loadout.leg ?? 'mark-vi'];

  // --- LEGS ---
  const leftLegVoxels = leftLegFn(colors);
  const leftLegGroup = createSegmentGroup(leftLegVoxels, -2.5, 7, 0);
  leftLegGroup.position.set(-2.5 * scale, 7 * scale, 0);

  const rightLegVoxels = mirrorX(leftLegVoxels);
  const rightLegGroup = createSegmentGroup(rightLegVoxels, 2.5, 7, 0);
  rightLegGroup.position.set(2.5 * scale, 7 * scale, 0);

  // --- HIP / LOWER TORSO ---
  const hipVoxels = buildHip(colors);
  const lowerTorsoGroup = createSegmentGroup(hipVoxels, 0, 0, 0);
  lowerTorsoGroup.add(leftLegGroup);
  lowerTorsoGroup.add(rightLegGroup);

  // --- UPPER TORSO ---
  const torsoVoxels = torsoFn(colors);
  const upperTorsoGroup = createSegmentGroup(torsoVoxels, 0, 8, 0);
  upperTorsoGroup.position.set(0, 8 * scale, 0);

  // --- ARMS ---
  const leftArmVoxels = leftArmFn(colors);
  const leftArmGroup = createSegmentGroup(leftArmVoxels, -5.5, 15, 0);
  leftArmGroup.position.set(-5.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(leftArmGroup);

  const rightArmVoxels = mirrorX(leftArmVoxels);
  const rightArmGroup = createSegmentGroup(rightArmVoxels, 5.5, 15, 0);
  rightArmGroup.position.set(5.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(rightArmGroup);

  // --- HEAD ---
  const headVoxels = helmetFn(colors);
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

  baseBeveledGeo.dispose();
  return Spartan;
}

// ─── GRAVITY HAMMER MODEL ─────────────────────────────────────────────────────

export function buildGravityHammerModel(customHue?: number): THREE.Group {
  const data: VoxelData[] = [];

  for (let y = 0; y < 14; y++) {
    data.push({ x: 0, y: y, z: 0, color: '#27272a' });
    if (y % 4 === 0) {
      data.push({ x: 1, y: y, z: 0, color: '#3f3f46' });
      data.push({ x: -1, y: y, z: 0, color: '#3f3f46' });
      data.push({ x: 0, y: y, z: 1, color: '#3f3f46' });
      data.push({ x: 0, y: y, z: -1, color: '#3f3f46' });
    }
  }

  const topY = 14;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      data.push({ x: dx, y: topY, z: dz, color: '#1e293b' });
      data.push({ x: dx, y: topY + 1, z: dz, color: '#1e293b' });
    }
  }

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

  const hammer = createVoxelGroup(data, 0.08);
  hammer.traverse((child) => {
    if (child instanceof THREE.Mesh) child.position.y -= 0.3;
  });

  return hammer;
}

// ─── KATAR SWORD MODEL ────────────────────────────────────────────────────────

export function buildKatarSwordModel(customHue?: number): THREE.Group {
  const data: VoxelData[] = [];

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

  const katar = createVoxelGroup(data, 0.08);
  katar.traverse((child) => {
    if (child instanceof THREE.Mesh) child.position.y -= 4.5 * 0.08;
  });

  return katar;
}
