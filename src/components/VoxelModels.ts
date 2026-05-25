/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

interface VoxelData {
  x: number;
  y: number;
  z: number;
  color: string;
  emissive?: boolean;
}

/**
 * Helper to build custom grouped voxel models
 */
export function createVoxelGroup(data: VoxelData[], scale: number = 0.1): THREE.Group {
  const group = new THREE.Group();
  const boxGeo = new THREE.BoxGeometry(scale, scale, scale);
  
  // Cache materials to avoid redundant creation
  const materialMap = new Map<string, THREE.Material>();

  data.forEach(v => {
    const matKey = `${v.color}_${v.emissive ? 'glow' : 'standard'}`;
    let material = materialMap.get(matKey);

    if (!material) {
      if (v.emissive) {
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(v.color),
          emissive: new THREE.Color(v.color),
          emissiveIntensity: 1.5,
          roughness: 0.2,
          metalness: 0.1
        });
      } else {
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(v.color),
          roughness: 0.7,
          metalness: 0.3
        });
      }
      materialMap.set(matKey, material);
    }

    const mesh = new THREE.Mesh(boxGeo, material);
    mesh.position.set(v.x * scale, v.y * scale, v.z * scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  return group;
}

/**
 * Builds the Gravity Hammer 3D Voxel Model
 */
export function buildGravityHammerModel(): THREE.Group {
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
  for (let hx = -1; hx <= 1; hx++) {
    for (let hy = 17; hy <= 19; hy++) {
      data.push({ x: hx, y: hy, z: -5, color: '#38bdf8', emissive: true }); // glowing sky blue
    }
  }
  // Side trim charging pipes
  for (let hy = 15; hy <= 21; hy++) {
    data.push({ x: -3, y: hy, z: -1, color: '#38bdf8', emissive: true });
    data.push({ x: 3, y: hy, z: -1, color: '#38bdf8', emissive: true });
  }

  // Build the group
  // We want the handle bottom to be near origin initially for swinging
  const hammer = createVoxelGroup(data, 0.08); // 8cm voxels
  
  // Reposition the hammer model so the pivot is around the lower grip (y=3)
  // This makes the rotation point natural for swinging
  hammer.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.y -= 0.3; // Offset down so pivot is at hands
    }
  });

  return hammer;
}

/**
 * Builds the Voxel Spartan/Enemy Robot Model
 * Red or Slate Theme
 */
export function buildVoxelSpartanModel(isEnemy: boolean = true): THREE.Group {
  const primaryColor = isEnemy ? '#ef4444' : '#3b82f6'; // Crimson red Enemy, Blue Player
  const secondaryColor = '#1e293b'; // Slate background skeleton/joints
  const visorColor = isEnemy ? '#facc15' : '#10b981'; // Glowing yellow vs green
  const scale = 0.08;

  // We will create individual parts using a custom helper to set their pivots nicely
  const createSegmentGroup = (
    voxels: VoxelData[],
    pivotX: number,
    pivotY: number,
    pivotZ: number
  ): THREE.Group => {
    const group = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(scale, scale, scale);
    const materialMap = new Map<string, THREE.Material>();

    voxels.forEach(v => {
      const matKey = `${v.color}_${v.emissive ? 'glow' : 'standard'}`;
      let material = materialMap.get(matKey);

      if (!material) {
        if (v.emissive) {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(v.color),
            emissive: new THREE.Color(v.color),
            emissiveIntensity: 1.5,
            roughness: 0.2,
            metalness: 0.1
          });
        } else {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(v.color),
            roughness: 0.7,
            metalness: 0.3
          });
        }
        materialMap.set(matKey, material);
      }

      const mesh = new THREE.Mesh(boxGeo, material);
      // Offset mesh so its pivot is at the segment's joint center
      mesh.position.set(
        (v.x - pivotX) * scale,
        (v.y - pivotY) * scale,
        (v.z - pivotZ) * scale
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });

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
  // Pivot at hips: x = -1.5, y = 7, z = 0
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
  // Pivot at hips: x = 1.5, y = 7, z = 0
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
  // Pivot of lower torso is at y=0 so legs match properly
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
  // Pivot chest at waist (y = 8)
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
  // Left arm pivot in chest coordinates (relative to chest pivot at y=8):
  // joint is at x = -4.5, y = 15, z = 0. In chest coordinates, position is at (-4.5, 7, 0) relative to (0, 8, 0)
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
  // Right arm pivot in chest coordinates: position is at (4.5, 7, 0) relative to (0, 8, 0)
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
  // helmet
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

  // Head pivot in chest coordinates: neck base is at y = 16. Chest pivot is y = 8.
  // Relative position of neck base is (0, 8 * scale, 0)
  const headGroup = createSegmentGroup(headVoxels, 0, 16, 0);
  headGroup.position.set(0, (16 - 8) * scale, 0);
  upperTorsoGroup.add(headGroup);

  // Master Root Spartan Group
  const Spartan = new THREE.Group();
  Spartan.add(lowerTorsoGroup);
  Spartan.add(upperTorsoGroup);

  // Rig the references inside userData for dynamic procedural animation
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

/**
 * Builds the Procedural Voxel Katar Sword (Indian Push Dagger)
 */
export function buildKatarSwordModel(): THREE.Group {
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
  for (let y = 11; y <= 26; y++) {
    let w = 0;
    if (y <= 13) w = 3;
    else if (y <= 17) w = 2;
    else if (y <= 21) w = 1;
    else w = 0;

    for (let x = -w; x <= w; x++) {
      const isEdge = x === -w || x === w || y === 26;
      const color = isEdge ? '#22d3ee' : '#64748b'; // glowing cyan edge, steel slate center
      data.push({ x: x, y: y, z: 0, color: color, emissive: isEdge });
    }
  }

  const katar = createVoxelGroup(data, 0.08); // 8cm voxels
  
  // Pivot katar around center of the hand grips (y = 4.5)
  katar.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.position.y -= 4.5 * 0.08;
    }
  });

  return katar;
}
