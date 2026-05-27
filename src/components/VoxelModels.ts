/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface VoxelData {
  x: number;
  y: number;
  z: number;
  color: string;
  emissive?: boolean;
}

/**
 * Creates a beautifully beveled 3D Box Geometry using extruded rounded 2D shapes.
 * Specular light catches these edges, delivering a high-end physical voxel look.
 */
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
  const r = Math.min(radius, width * 0.4); // Clamp to prevent visual overlapping anomalies

  // Draw 2D shape with rounded corners
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
  geo.center(); // Center geometry pivot
  return geo;
}

/**
 * Translates and merges voxel geometries of the same category into a single BufferGeometry,
 * assigning vertex colors so multiple colors can be rendered in a single draw call.
 */
function mergeVoxelGeometries(
  voxels: VoxelData[],
  scale: number,
  baseGeo: THREE.BufferGeometry,
  pivotX: number,
  pivotY: number,
  pivotZ: number
): THREE.BufferGeometry {
  if (voxels.length === 0) {
    return new THREE.BufferGeometry();
  }

  const geometries: THREE.BufferGeometry[] = [];

  voxels.forEach((v) => {
    const geo = baseGeo.clone();
    
    // Rigging pivot offset: translate vertices relative to the joint's center point
    geo.translate(
      (v.x - pivotX) * scale,
      (v.y - pivotY) * scale,
      (v.z - pivotZ) * scale
    );

    // Apply color values to geometry vertices for unified vertex colors rendering
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
  
  // Clean up references to individual geometries to prevent WebGL memory leaks
  geometries.forEach((g) => g.dispose());

  return merged;
}

/**
 * Helper to build custom grouped voxel models with maximum performance.
 * Merges all standard voxels into one mesh, and emissive voxels by glow color.
 */
export function createVoxelGroup(data: VoxelData[], scale: number = 0.1): THREE.Group {
  const group = new THREE.Group();
  
  const bevelRadius = scale * 0.15;
  const baseBeveledGeo = createBeveledBoxGeometry(scale, scale, scale, bevelRadius);
  
  const standardVoxels = data.filter((v) => !v.emissive);
  const emissiveVoxels = data.filter((v) => v.emissive);

  // 1. Render all standard colored parts in exactly 1 draw call
  if (standardVoxels.length > 0) {
    const stdGeo = mergeVoxelGeometries(standardVoxels, scale, baseBeveledGeo, 0, 0, 0);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.65,
    });
    const mesh = new THREE.Mesh(stdGeo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 2. Render glowing parts grouped by color (1 draw call per glow color)
  if (emissiveVoxels.length > 0) {
    const emissiveColorsMap = new Map<string, VoxelData[]>();
    emissiveVoxels.forEach((v) => {
      let list = emissiveColorsMap.get(v.color);
      if (!list) {
        list = [];
        emissiveColorsMap.set(v.color, list);
      }
      list.push(v);
    });

    emissiveColorsMap.forEach((voxels, colorStr) => {
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

/**
 * Builds the Gravity Hammer 3D Voxel Model
 */
export function buildGravityHammerModel(customHue?: number): THREE.Group {
  const data: VoxelData[] = [];

  // SHAFT: long dark grey handle
  for (let y = 0; y < 14; y++) {
    data.push({ x: 0, y: y, z: 0, color: '#27272a' }); // zinc-800
    if (y % 4 === 0) {
      // Small grip rings
      data.push({ x: 1, y: y, z: 0, color: '#3f3f46' });
      data.push({ x: -1, y: y, z: 0, color: '#3f3f46' });
      data.push({ x: 0, y: y, z: 1, color: '#3f3f46' });
      data.push({ x: 0, y: y, z: -1, color: '#3f3f46' });
    }
  }

  // WEAPON BRACKETS / COUPLING at top
  const topY = 14;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      data.push({ x: dx, y: topY, z: dz, color: '#1e293b' }); // slate-800
      data.push({ x: dx, y: topY + 1, z: dz, color: '#1e293b' });
    }
  }

  // MASSIVE HAMMER HEAD
  // Front block: heavy smashing surface (large and bulky)
  for (let hx = -2; hx <= 2; hx++) {
    for (let hy = 16; hy <= 20; hy++) {
      for (let hz = -4; hz <= -1; hz++) {
        // Core vs side styling
        const isSpike = hy === 18 && Math.abs(hx) === 2;
        const color = isSpike ? '#ff5500' : '#475569'; // steel blue with orange spikes
        data.push({ x: hx, y: hy, z: hz, color });
      }
    }
  }

  // Rear block: backing weight and counterbalance
  for (let hx = -1; hx <= 1; hx++) {
    for (let hy = 16; hy <= 19; hy++) {
      for (let hz = 1; hz <= 4; hz++) {
        data.push({ x: hx, y: hy, z: hz, color: '#334155' });
      }
    }
  }

  // GLOWING GRAVITY ENERGY PLATATES (on the slam face)
  // These glow neon blue, representing the gravity generators
  const energyColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#38bdf8';
  for (let hx = -1; hx <= 1; hx++) {
    for (let hy = 17; hy <= 19; hy++) {
      data.push({ x: hx, y: hy, z: -5, color: energyColor, emissive: true }); // glowing sky blue
    }
  }
  // Side trim charging pipes
  for (let hy = 15; hy <= 21; hy++) {
    data.push({ x: -3, y: hy, z: -1, color: energyColor, emissive: true });
    data.push({ x: 3, y: hy, z: -1, color: energyColor, emissive: true });
  }

  // Build the group using the optimized layout
  const hammer = createVoxelGroup(data, 0.08); // 8cm voxels
  
  // Reposition the hammer model so the pivot is around the lower grip (y=3)
  hammer.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.y -= 0.3; // Offset down so pivot is at hands
    }
  });

  return hammer;
}

/**
 * Builds the Voxel Spartan/Enemy Robot Model
 * Optimized with limb geometry merging and beveled specular edges
 */
export function buildVoxelSpartanModel(isEnemy: boolean = true, customHue?: number): THREE.Group {
  let primaryColor = isEnemy ? '#ef4444' : '#3b82f6'; // Crimson red Enemy, Blue Player
  if (customHue !== undefined) {
    primaryColor = `hsl(${customHue}, 85%, 50%)`;
  }
  const secondaryColor = '#1e293b'; // Slate background skeleton/joints
  const visorColor = isEnemy ? '#facc15' : '#10b981'; // Glowing yellow vs green
  const scale = 0.08;

  // Shared beveled geometry to minimize vertex creation and memory fragmentation
  const bevelRadius = scale * 0.15;
  const baseBeveledGeo = createBeveledBoxGeometry(scale, scale, scale, bevelRadius);

  // Helper to build a limb/segment in exactly 1 or 2 draw calls
  const createSegmentGroup = (
    voxels: VoxelData[],
    pivotX: number,
    pivotY: number,
    pivotZ: number
  ): THREE.Group => {
    const group = new THREE.Group();

    const standardVoxels = voxels.filter((v) => !v.emissive);
    const emissiveVoxels = voxels.filter((v) => v.emissive);

    // 1. Merge standard painted parts with dynamic metallic PBR reflection
    if (standardVoxels.length > 0) {
      const stdGeo = mergeVoxelGeometries(standardVoxels, scale, baseBeveledGeo, pivotX, pivotY, pivotZ);
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35, // Glossy metallic paint sheen
        metalness: 0.65,
      });
      const mesh = new THREE.Mesh(stdGeo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // 2. Merge glowing components (e.g. glowing visors)
    if (emissiveVoxels.length > 0) {
      const emissiveColorsMap = new Map<string, VoxelData[]>();
      emissiveVoxels.forEach((v) => {
        let list = emissiveColorsMap.get(v.color);
        if (!list) {
          list = [];
          emissiveColorsMap.set(v.color, list);
        }
        list.push(v);
      });

      emissiveColorsMap.forEach((voxelsList, colorStr) => {
        const emGeo = mergeVoxelGeometries(voxelsList, scale, baseBeveledGeo, pivotX, pivotY, pivotZ);
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
  };

  // --- LEGS ---
  const leftLegVoxels: VoxelData[] = [];
  for (let y = 0; y <= 6; y++) {
    for (let x = -2; x <= -1; x++) {
      for (let z = -1; z <= 1; z++) {
        leftLegVoxels.push({ x, y, z, color: y === 0 ? '#0f172a' : primaryColor });
      }
    }
  }
  const leftLegGroup = createSegmentGroup(leftLegVoxels, -1.5, 7, 0);
  leftLegGroup.position.set(-1.5 * scale, 7 * scale, 0);

  const rightLegVoxels: VoxelData[] = [];
  for (let y = 0; y <= 6; y++) {
    for (let x = 1; x <= 2; x++) {
      for (let z = -1; z <= 1; z++) {
        rightLegVoxels.push({ x, y, z, color: y === 0 ? '#0f172a' : primaryColor });
      }
    }
  }
  const rightLegGroup = createSegmentGroup(rightLegVoxels, 1.5, 7, 0);
  rightLegGroup.position.set(1.5 * scale, 7 * scale, 0);

  // --- LOWER TORSO (HIPS) ---
  const hipVoxels: VoxelData[] = [];
  for (let y = 7; y <= 8; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -1; z <= 1; z++) {
        hipVoxels.push({ x, y, z, color: secondaryColor });
      }
    }
  }
  const lowerTorsoGroup = createSegmentGroup(hipVoxels, 0, 0, 0);
  lowerTorsoGroup.add(leftLegGroup);
  lowerTorsoGroup.add(rightLegGroup);

  // --- UPPER TORSO (TORSO/CHEST) ---
  const torsoVoxels: VoxelData[] = [];
  for (let y = 9; y <= 15; y++) {
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 2; z++) {
        const isEdge = Math.abs(x) === 3 || z === 2;
        const color = isEdge ? primaryColor : '#475569';
        torsoVoxels.push({ x, y, z, color });
      }
    }
  }
  const upperTorsoGroup = createSegmentGroup(torsoVoxels, 0, 8, 0);
  upperTorsoGroup.position.set(0, 8 * scale, 0);

  // --- ARMS ---
  const leftArmVoxels: VoxelData[] = [];
  for (let y = 11; y <= 15; y++) {
    for (let x = -5; x <= -4; x++) {
      for (let z = -1; z <= 1; z++) {
        leftArmVoxels.push({ x, y, z, color: y === 15 ? primaryColor : '#334155' });
      }
    }
  }
  const leftArmGroup = createSegmentGroup(leftArmVoxels, -4.5, 15, 0);
  leftArmGroup.position.set(-4.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(leftArmGroup);

  const rightArmVoxels: VoxelData[] = [];
  for (let y = 11; y <= 15; y++) {
    for (let x = 4; x <= 5; x++) {
      for (let z = -1; z <= 1; z++) {
        rightArmVoxels.push({ x, y, z, color: y === 15 ? primaryColor : '#334155' });
      }
    }
  }
  const rightArmGroup = createSegmentGroup(rightArmVoxels, 4.5, 15, 0);
  rightArmGroup.position.set(4.5 * scale, (15 - 8) * scale, 0);
  upperTorsoGroup.add(rightArmGroup);

  // --- HEAD / HELMET ---
  const headVoxels: VoxelData[] = [];
  // Neck
  for (let y = 16; y === 16; y++) {
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        headVoxels.push({ x, y, z, color: secondaryColor });
      }
    }
  }
  // Helmet
  for (let y = 17; y <= 21; y++) {
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const isVisor = y === 19 && z === -2 && x >= -1 && x <= 1;
        const color = isVisor ? visorColor : primaryColor;
        headVoxels.push({ x, y, z, color, emissive: isVisor });
      }
    }
  }
  // Mohawk Plume
  for (let y = 22; y <= 23; y++) {
    headVoxels.push({ x: 0, y, z: 0, color: '#f97316' });
    headVoxels.push({ x: 0, y, z: -1, color: '#f97316' });
    headVoxels.push({ x: 0, y, z: 1, color: '#f97316' });
  }

  const headGroup = createSegmentGroup(headVoxels, 0, 16, 0);
  headGroup.position.set(0, (16 - 8) * scale, 0);
  upperTorsoGroup.add(headGroup);

  // Master Root Spartan Group
  const Spartan = new THREE.Group();
  Spartan.add(lowerTorsoGroup);
  Spartan.add(upperTorsoGroup);

  // Rig references inside userData for seamless animations compatibility
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

/**
 * Builds the Procedural Voxel Katar Sword (Indian Push Dagger)
 */
export function buildKatarSwordModel(customHue?: number): THREE.Group {
  const data: VoxelData[] = [];

  // SIDE GUARD BARS (dark steel '#475569' and slate '#334155')
  for (let y = 0; y <= 9; y++) {
    // Left side bar
    data.push({ x: -2, y: y, z: 0, color: '#475569' });
    data.push({ x: -2, y: y, z: 1, color: '#334155' });
    // Right side bar
    data.push({ x: 2, y: y, z: 0, color: '#475569' });
    data.push({ x: 2, y: y, z: 1, color: '#334155' });
  }

  // DOUBLE CROSSBAR GRIPS
  for (let x = -1; x <= 1; x++) {
    // Grip 1 (y = 3)
    data.push({ x: x, y: 3, z: 0, color: '#0f172a' });
    // Grip 2 (y = 6)
    data.push({ x: x, y: 6, z: 0, color: '#0f172a' });
  }

  // CROSS GUARD PLATE
  for (let x = -3; x <= 3; x++) {
    for (let z = -1; z <= 1; z++) {
      data.push({ x: x, y: 10, z: z, color: '#1e293b' });
    }
  }

  // BLADE (Tapered triangle pointing upwards (+Y))
  // Central column is silver '#94a3b8', cutting edge is glowing cyan plasma '#22d3ee'
  const swordEdgeColor = customHue !== undefined ? `hsl(${customHue}, 85%, 60%)` : '#22d3ee';
  for (let y = 11; y <= 26; y++) {
    let w = 0;
    if (y <= 13) w = 3;
    else if (y <= 17) w = 2;
    else if (y <= 21) w = 1;
    else w = 0;

    for (let x = -w; x <= w; x++) {
      const isEdge = x === -w || x === w || y === 26;
      const color = isEdge ? swordEdgeColor : '#64748b'; // glowing custom edge, steel slate center
      data.push({ x: x, y: y, z: 0, color: color, emissive: isEdge });
    }
  }

  // Build the katar using the optimized layout
  const katar = createVoxelGroup(data, 0.08); // 8cm voxels
  
  // Pivot katar around center of the hand grips (y = 4.5)
  katar.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.y -= 4.5 * 0.08;
    }
  });

  return katar;
}

