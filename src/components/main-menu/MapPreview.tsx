import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CustomMapData, CustomMapObject } from '../../types';
import { PREMADE_MAPS } from '../../game/premadeMaps';

// --- HIGH-FIDELITY MAP ASSETS PROCEDURAL MODEL PIPELINE ---
export function createHighFidelityObjectMesh(
  obj: CustomMapObject,
  three: typeof THREE,
  generateCustomTexture?: (type: string, baseColorHex: string) => THREE.Texture,
  scaleMultiplier: number = 1.0
): THREE.Group {
  const group = new three.Group();
  group.name = obj.id;

  // Base scale dimensions
  const sx = obj.scale.x * scaleMultiplier;
  const sy = obj.scale.y * scaleMultiplier;
  const sz = obj.scale.z * scaleMultiplier;

  // Set up materials
  const hasTexture = obj.texture && obj.texture !== 'none';
  const texture = (hasTexture && generateCustomTexture) ? generateCustomTexture(obj.texture, obj.color) : null;
  if (texture) {
    texture.needsUpdate = true;
  }

  let bumpScale = 0.02;
  if (hasTexture) {
    if (['nature_mossy_stone', 'fantasy_cobble', 'city_brick'].includes(obj.texture)) {
      bumpScale = 0.035;
    } else if (['nature_grass', 'city_concrete', 'nature_wood'].includes(obj.texture)) {
      bumpScale = 0.025;
    } else if (['space_alloy', 'futuristic_carbon', 'forerunner_panel'].includes(obj.texture)) {
      bumpScale = 0.015;
    } else if (['futuristic_hex', 'synthwave_grid', 'winter_glacier_glass'].includes(obj.texture)) {
      bumpScale = 0.008;
    }
  }

  const mat = new three.MeshStandardMaterial({
    map: texture,
    bumpMap: texture || undefined,
    bumpScale: hasTexture ? bumpScale : 0,
    color: hasTexture ? new three.Color('#ffffff') : new three.Color(obj.color),
    metalness: obj.metalness ?? 0.5,
    roughness: obj.roughness ?? 0.5,
    opacity: obj.opacity ?? 1,
    transparent: obj.transparent || false,
  });

  if (obj.emissive && obj.emissive !== '#000000') {
    mat.emissive = new three.Color(obj.emissive);
    mat.emissiveIntensity = obj.emissiveIntensity ?? 1;
  }

  // Dark accent material for metallic trims
  const accentMat = new three.MeshStandardMaterial({
    color: new three.Color('#1e293b'),
    metalness: 0.9,
    roughness: 0.2,
  });

  // Glow material
  let glowMat: THREE.Material;
  if (obj.emissive && obj.emissive !== '#000000') {
    glowMat = new three.MeshBasicMaterial({
      color: new three.Color(obj.emissive),
      transparent: true,
      opacity: 0.8
    });
  } else {
    glowMat = new three.MeshBasicMaterial({
      color: new three.Color(obj.color || '#00ffff'),
      transparent: true,
      opacity: 0.6
    });
  }

  // Render based on geometry type and name clues
  const nameLower = (obj.name || '').toLowerCase();

  if (obj.type === 'box') {
    const isRock = ['nature_mossy_stone', 'space_meteorite'].includes(obj.texture) ||
                   nameLower.includes('rock') || nameLower.includes('boulder') || nameLower.includes('asteroid') || nameLower.includes('cluster');
    const isContainer = nameLower.includes('container') || nameLower.includes('barrier') ||
                        nameLower.includes('partition') || nameLower.includes('shield') ||
                        nameLower.includes('buffer') || nameLower.includes('freight') || nameLower.includes('wall');
    const isCrate = nameLower.includes('crate') || nameLower.includes('substation') || nameLower.includes('recharge');

    if (isRock) {
      // 1. HIGH-FIDELITY ASTEROID/BOULDER (LOW-POLY ORGANIC FACETED GEODESIC CLUSTER)
      const mainGeo = new three.DodecahedronGeometry(sx / 2, 1);

      // Distort vertices slightly to make it organic and non-spherical
      const posAttr = mainGeo.attributes.position as THREE.BufferAttribute;
      if (posAttr) {
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i);
          const y = posAttr.getY(i);
          const z = posAttr.getZ(i);
          posAttr.setXYZ(
            i,
            x * 1.0 + (Math.sin(y * 5) * 0.08),
            y * (sy / sx) + (Math.cos(z * 5) * 0.08),
            z * (sz / sx) + (Math.sin(x * 5) * 0.08)
          );
        }
        mainGeo.computeVertexNormals();
      }

      const mainMesh = new three.Mesh(mainGeo, mat);
      group.add(mainMesh);

      // Add 2 smaller debris boulders clustered at the base
      const d1Geo = new three.DodecahedronGeometry(sx * 0.15, 0);
      const debris1 = new three.Mesh(d1Geo, mat);
      debris1.position.set(-sx * 0.35, -sy * 0.35, sz * 0.2);
      debris1.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(debris1);

      const d2Geo = new three.DodecahedronGeometry(sx * 0.12, 0);
      const debris2 = new three.Mesh(d2Geo, mat);
      debris2.position.set(sx * 0.3, -sy * 0.4, -sz * 0.3);
      debris2.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(debris2);

      if (obj.texture === 'space_meteorite' && obj.emissive && obj.emissive !== '#000000') {
        const coreGeo = new three.SphereGeometry(sx * 0.2, 8, 8);
        const core = new three.Mesh(coreGeo, glowMat);
        core.position.set(0, 0, 0);
        group.add(core);
      }

    } else if (isContainer) {
      // 2. DETAILED HEAVY INDUSTRIAL SHIPPING CONTAINER / STRUCTURAL BARRIER
      const bodyGeo = new three.BoxGeometry(sx * 0.94, sy * 0.96, sz * 0.94);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);

      const frameThickness = 0.04 * Math.min(sx, sz);

      // 4 Heavy vertical structural support corner pillars
      const colW = frameThickness;
      const colGeo = new three.BoxGeometry(colW, sy * 1.01, colW);

      const corners = [
        [-sx/2 + colW/2, -sz/2 + colW/2],
        [-sx/2 + colW/2, sz/2 - colW/2],
        [sx/2 - colW/2, -sz/2 + colW/2],
        [sx/2 - colW/2, sz/2 - colW/2]
      ];

      corners.forEach(([cx, cz]) => {
        const col = new three.Mesh(colGeo, accentMat);
        col.position.set(cx, 0, cz);
        group.add(col);
      });

      // Top and bottom protective edge rings (horizontal bars)
      const topBarGeo = new three.BoxGeometry(sx * 1.01, frameThickness, frameThickness);
      const botBarGeo = topBarGeo.clone();

      const barsZ = [-sz/2 + frameThickness/2, sz/2 - frameThickness/2];
      barsZ.forEach(bz => {
        const topBar = new three.Mesh(topBarGeo, accentMat);
        topBar.position.set(0, sy/2 - frameThickness/2, bz);
        group.add(topBar);

        const botBar = new three.Mesh(botBarGeo, accentMat);
        botBar.position.set(0, -sy/2 + frameThickness/2, bz);
        group.add(botBar);
      });

      // Corrugated panel ridges along the longer side
      const isXLonger = sx >= sz;
      if (isXLonger) {
        const numRibs = Math.max(3, Math.floor(sx * 1.5));
        const ribSpacing = (sx * 0.8) / (numRibs - 1 || 1);
        const ribW = 0.06;
        const ribD = 0.04;
        const ribGeo = new three.BoxGeometry(ribW, sy * 0.9, ribD);

        for (let i = 0; i < numRibs; i++) {
          const rx = -sx * 0.4 + i * ribSpacing;

          const fRib = new three.Mesh(ribGeo, accentMat);
          fRib.position.set(rx, 0, sz/2 - ribD/2);
          group.add(fRib);

          const bRib = new three.Mesh(ribGeo, accentMat);
          bRib.position.set(rx, 0, -sz/2 + ribD/2);
          group.add(bRib);
        }
      } else {
        const numRibs = Math.max(3, Math.floor(sz * 1.5));
        const ribSpacing = (sz * 0.8) / (numRibs - 1 || 1);
        const ribW = 0.04;
        const ribD = 0.06;
        const ribGeo = new three.BoxGeometry(ribW, sy * 0.9, ribD);

        for (let i = 0; i < numRibs; i++) {
          const rz = -sz * 0.4 + i * ribSpacing;

          const lRib = new three.Mesh(ribGeo, accentMat);
          lRib.position.set(-sx/2 + ribW/2, 0, rz);
          group.add(lRib);

          const rRib = new three.Mesh(ribGeo, accentMat);
          rRib.position.set(sx/2 - ribW/2, 0, rz);
          group.add(rRib);
        }
      }

    } else if (isCrate) {
      // 3. SCI-FI MECHANICAL TECH CRATE / RECHARGE STATION
      const coreGeo = new three.BoxGeometry(sx * 0.84, sy * 0.84, sz * 0.84);
      const core = new three.Mesh(coreGeo, mat);
      group.add(core);

      const frameW = 0.08 * sx;

      // Horizontal top/bottom structural rims
      const plateGeo = new three.BoxGeometry(sx * 0.94, frameW, sz * 0.94);
      const topPlate = new three.Mesh(plateGeo, accentMat);
      topPlate.position.set(0, sy/2 - frameW/2, 0);
      group.add(topPlate);

      const botPlate = new three.Mesh(plateGeo, accentMat);
      botPlate.position.set(0, -sy/2 + frameW/2, 0);
      group.add(botPlate);

      // Protective corner reinforcement cages
      const colGeo = new three.BoxGeometry(frameW, sy * 0.8, frameW);
      const offsets = [
        [-sx/2 + frameW/2, -sz/2 + frameW/2],
        [-sx/2 + frameW/2, sz/2 - frameW/2],
        [sx/2 - frameW/2, -sz/2 + frameW/2],
        [sx/2 - frameW/2, sz/2 - frameW/2]
      ];
      offsets.forEach(([cx, cz]) => {
        const col = new three.Mesh(colGeo, accentMat);
        col.position.set(cx, 0, cz);
        group.add(col);
      });

      if (obj.emissive && obj.emissive !== '#000000') {
        const glowGeo = new three.BoxGeometry(sx * 0.4, sy * 0.4, sz * 0.86);
        const glowP = new three.Mesh(glowGeo, glowMat);
        glowP.position.set(0, 0, 0);
        group.add(glowP);
      }

    } else {
      // 4. GENERAL BEVELED SCI-FI BOX WITH DETAILED OUTLINE PANELING
      const bodyGeo = new three.BoxGeometry(sx * 0.96, sy * 0.96, sz * 0.96);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);

      const frameThickness = 0.04 * Math.min(sx, sy, sz);
      const frameGeoX = new three.BoxGeometry(sx * 1.01, frameThickness, frameThickness);
      const frameGeoY = new three.BoxGeometry(frameThickness, sy * 1.01, frameThickness);
      const frameGeoZ = new three.BoxGeometry(frameThickness, frameThickness, sz * 1.01);

      const edgeY = sy/2 - frameThickness/2;
      const edgeZ = sz/2 - frameThickness/2;
      const edgeX = sx/2 - frameThickness/2;

      [[-edgeY, -edgeZ], [-edgeY, edgeZ], [edgeY, -edgeZ], [edgeY, edgeZ]].forEach(([ey, ez]) => {
        const bar = new three.Mesh(frameGeoX, accentMat);
        bar.position.set(0, ey, ez);
        group.add(bar);
      });

      [[-edgeX, -edgeZ], [-edgeX, edgeZ], [edgeX, -edgeZ], [edgeX, edgeZ]].forEach(([ex, ez]) => {
        const bar = new three.Mesh(frameGeoY, accentMat);
        bar.position.set(ex, 0, ez);
        group.add(bar);
      });
    }

  } else if (obj.type === 'cylinder') {
    const isForerunner = ['forerunner_panel', 'forerunner_gold'].includes(obj.texture) ||
                        nameLower.includes('spire') || nameLower.includes('pylon') || nameLower.includes('beacon') || nameLower.includes('forerunner');
    const isTechColumn = nameLower.includes('pillar') || nameLower.includes('column') ||
                         nameLower.includes('anchor') || nameLower.includes('generator') ||
                         ['space_alloy', 'futuristic_hex', 'synthwave_neon_laser', 'rainy_streets_neon_glow'].includes(obj.texture);

    if (isForerunner) {
      // 1. ANCIENT FORERUNNER ANCHOR PYLON / TAPERING OCTAGONAL SPIRE
      const baseH = sy * 0.14;
      const baseGeo = new three.CylinderGeometry(sx * 0.72, sx * 0.72, baseH, 8);
      const base = new three.Mesh(baseGeo, mat);
      base.position.y = -sy/2 + baseH/2;
      group.add(base);

      const shaftH = sy * 0.76;
      const shaftGeo = new three.CylinderGeometry(sx * 0.32, sx * 0.58, shaftH, 8);
      const shaft = new three.Mesh(shaftGeo, mat);
      shaft.position.y = base.position.y + baseH/2 + shaftH/2;
      group.add(shaft);

      const ribW = 0.08 * sx;
      const ribD = 0.1 * sx;
      const ribGeo = new three.BoxGeometry(ribW, shaftH * 1.02, ribD);
      const offsets = [
        [0, -sx * 0.45],
        [0, sx * 0.45],
        [-sx * 0.45, 0],
        [sx * 0.45, 0]
      ];
      offsets.forEach(([rx, rz]) => {
        const rib = new three.Mesh(ribGeo, accentMat);
        rib.position.set(rx, shaft.position.y, rz);
        if (rx !== 0) rib.rotation.z = rx > 0 ? 0.07 : -0.07;
        if (rz !== 0) rib.rotation.x = rz > 0 ? -0.07 : 0.07;
        group.add(rib);
      });

      const capH = sy * 0.08;
      const capGeo = new three.CylinderGeometry(0, sx * 0.22, capH, 8);
      const cap = new three.Mesh(capGeo, glowMat);
      cap.position.y = shaft.position.y + shaftH/2 + capH * 0.7;
      group.add(cap);

    } else if (isTechColumn) {
      // 2. DETAILED SCI-FI CYLINDRICAL GENERATOR COLUMN / SEGMENTED GLOW PILLAR
      const collarH = sy * 0.08;
      const collarGeo = new three.CylinderGeometry(sx * 0.58, sx * 0.58, collarH, 32);
      const baseCollar = new three.Mesh(collarGeo, accentMat);
      baseCollar.position.y = -sy/2 + collarH/2;
      group.add(baseCollar);

      const topCollar = new three.Mesh(collarGeo, accentMat);
      topCollar.position.y = sy/2 - collarH/2;
      group.add(topCollar);

      const shaftH = sy * 0.8;
      const shaftGeo = new three.CylinderGeometry(sx * 0.48, sx * 0.48, shaftH, 32);
      const shaft = new three.Mesh(shaftGeo, mat);
      shaft.position.y = 0;
      group.add(shaft);

      const glowRingRadius = sx * 0.505;
      const ringGeo = new three.CylinderGeometry(glowRingRadius, glowRingRadius, sy * 0.04, 32);

      const ringPositions = [-sy * 0.22, 0, sy * 0.22];
      ringPositions.forEach(ry => {
        const ring = new three.Mesh(ringGeo, glowMat);
        ring.position.y = ry;
        group.add(ring);
      });

      const gasketGeo = new three.CylinderGeometry(sx * 0.495, sx * 0.495, sy * 0.02, 32);
      [-sy * 0.11, sy * 0.11].forEach(gy => {
        const gasket = new three.Mesh(gasketGeo, accentMat);
        gasket.position.y = gy;
        group.add(gasket);
      });

    } else {
      // 3. STYLIZED CORE CYLINDER
      const baseH = sy * 0.05;
      const baseGeo = new three.CylinderGeometry(sx * 0.52, sx * 0.52, baseH, 32);

      const base = new three.Mesh(baseGeo, accentMat);
      base.position.y = -sy/2 + baseH/2;
      group.add(base);

      const top = new three.Mesh(baseGeo, accentMat);
      top.position.y = sy/2 - baseH/2;
      group.add(top);

      const bodyGeo = new three.CylinderGeometry(sx * 0.48, sx * 0.48, sy * 0.9, 32);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);
    }

  } else {
    const isReactor = nameLower.includes('core') || nameLower.includes('reactor') ||
                      nameLower.includes('plasma') || nameLower.includes('emitter') ||
                      ['futuristic_shield', 'synthwave_chrome'].includes(obj.texture);

    if (isReactor) {
      // 1. HIGH-TECH PLASMA CORE REACTOR / FLOAT EMITTER CORE (PLANETARY ORBITS)
      const coreRadius = sx * 0.35;
      const coreGeo = new three.SphereGeometry(coreRadius, 32, 32);
      const core = new three.Mesh(coreGeo, mat);
      group.add(core);

      const ringOuterR = sx * 0.52;
      const ringTubeR = 0.03 * sx;

      const ring1Geo = new three.TorusGeometry(ringOuterR, ringTubeR, 12, 48);
      const ring1 = new three.Mesh(ring1Geo, accentMat);
      ring1.rotation.y = Math.PI / 6;
      group.add(ring1);

      const ring2Geo = new three.TorusGeometry(ringOuterR * 1.05, ringTubeR, 12, 48);
      const ring2 = new three.Mesh(ring2Geo, accentMat);
      ring2.rotation.x = Math.PI / 2;
      ring2.rotation.y = -Math.PI / 6;
      group.add(ring2);

      const rodL = sx * 0.18;
      const rodGeo = new three.CylinderGeometry(0.02 * sx, 0.03 * sx, rodL, 8);
      const offsets = [
        [sx * 0.48, 0, 0, -Math.PI/2],
        [-sx * 0.48, 0, 0, Math.PI/2],
        [0, 0, sx * 0.48, 0],
        [0, 0, -sx * 0.48, Math.PI]
      ];

      offsets.forEach(([rx, ry, rz, rotZ]) => {
        const rodGroup = new three.Group();
        rodGroup.position.set(rx, ry, rz);

        const rod = new three.Mesh(rodGeo, accentMat);
        rod.rotation.z = rotZ;
        if (rz !== 0) rod.rotation.x = rz > 0 ? Math.PI/2 : -Math.PI/2;

        const tipGeo = new three.SphereGeometry(0.04 * sx, 8, 8);
        const tip = new three.Mesh(tipGeo, glowMat);
        tip.position.y = -rodL/2;
        rod.add(tip);

        rodGroup.add(rod);
        group.add(rodGroup);
      });

    } else {
      // 2. GEODESIC DOME WITH MULTI-FACETED GRID HIGHLIGHTS
      const bodyGeo = new three.IcosahedronGeometry(sx / 2, 2);
      const body = new three.Mesh(bodyGeo, mat);
      group.add(body);

      const wireGeo = new three.IcosahedronGeometry(sx * 0.505, 2);
      const wireMat = new three.MeshBasicMaterial({
        color: new three.Color(obj.color || '#00ffff'),
        wireframe: true,
        transparent: true,
        opacity: 0.18
      });
      const wire = new three.Mesh(wireGeo, wireMat);
      group.add(wire);
    }
  }

  // Traverse children to enable shadows, PBR rendering details, and link raycasting IDs
  group.traverse(child => {
    if (child instanceof three.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData = { id: obj.id }; // Store ID directly on meshes for raycast checks!
    }
  });

  return group;
}

export const MapPreview: React.FC<{ selectedMap: string; customMap?: CustomMapData | null }> = ({ selectedMap, customMap }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    // Create tiny three.js preview scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030712');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(180, 180);
    renderer.shadowMap.enabled = true;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 14, 18);
    camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight('#111827', 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#fffbeb', 1.5);
    dirLight.position.set(5, 15, 5);
    scene.add(dirLight);

    // Primary central light
    const pointLight = new THREE.PointLight(selectedMap === 'hangar' ? '#ea580c' : '#06b6d4', 3.0, 20);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    // Floor cylinder
    const floorGeo = new THREE.CylinderGeometry(8, 8, 0.4, 32);
    let floorMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.4,
      metalness: 0.8
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.2;
    scene.add(floor);

    // Dynamic map features
    const group = new THREE.Group();
    scene.add(group);

    // Resolve which map data to preview
    let mapData: CustomMapData | null = null;
    if (selectedMap !== 'hangar' && selectedMap !== 'circle') {
      const premade = PREMADE_MAPS.find(m => m.id === selectedMap);
      if (premade) {
        mapData = premade;
      } else if (selectedMap === 'custom_file' && customMap) {
        mapData = customMap;
      }
    }

    if (mapData) {
      // Custom / premade map preview
      const activeRadius = mapData.arenaRadius || 20;
      const previewScale = 8.0 / activeRadius; // Scale factor so it fits nicely

      let mainLightColor = '#06b6d4';
      if (mapData.lighting && mapData.lighting.pointLights && mapData.lighting.pointLights.length > 0) {
        mainLightColor = mapData.lighting.pointLights[0].color;
      }
      pointLight.color.set(mainLightColor);
      pointLight.position.set(0, 5, 0);

      let floorColor = '#0f172a';
      if (mapData.theme === 'nature') {
        floorColor = '#14532d';
      } else if (mapData.theme === 'space') {
        floorColor = '#1e1b4b';
      } else if (mapData.theme === 'fantasy') {
        floorColor = '#3b0764';
      } else if (mapData.theme === 'hangar') {
        floorColor = '#1e293b';
      } else if (mapData.theme === 'synthwave') {
        floorColor = '#0a0518';
      } else if (mapData.theme === 'rainy_streets') {
        floorColor = '#0f121a';
      } else if (mapData.theme === 'winter_rink') {
        floorColor = '#e0f2fe';
      } else if (mapData.theme === 'grifball_stadium') {
        floorColor = '#111318';
      }

      floor.geometry.dispose();
      floor.geometry = new THREE.CylinderGeometry(activeRadius * previewScale, activeRadius * previewScale, 0.4, 32);
      (floor.material as THREE.MeshStandardMaterial).color.set(floorColor);

      if (mapData.objects) {
        mapData.objects.forEach(obj => {
          const mesh = createHighFidelityObjectMesh(obj, THREE, undefined, previewScale);
          mesh.position.set(
            obj.position.x * previewScale,
            obj.position.y * previewScale,
            obj.position.z * previewScale
          );
          mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
          group.add(mesh);
        });
      }
    } else if (selectedMap === 'hangar') {
      // Set Hangar color
      (floor.material as THREE.MeshStandardMaterial).color.set('#1e293b');
      (floor.material as THREE.MeshStandardMaterial).roughness = 0.8;
      (floor.material as THREE.MeshStandardMaterial).metalness = 0.5;

      pointLight.color.set('#ea580c');

      // Industrial hangar details: 12-sided walls (small scale)
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        const wx = Math.cos(angle) * 8.2;
        const wz = Math.sin(angle) * 8.2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.0, 0.1), new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 }));
        wall.position.set(wx, 2, wz);
        wall.lookAt(0, 2, 0);
        group.add(wall);

        // Small orange trim lines
        const trim = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: '#ca8a04', roughness: 0.8 }));
        trim.position.set(wx, 3.8, wz);
        trim.lookAt(0, 3.8, 0);
        group.add(trim);

        // Heavy pillars
        if (i % 2 === 0) {
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.0, 0.4), new THREE.MeshStandardMaterial({ color: '#8f4f1f', roughness: 0.8 }));
          pillar.position.set(wx, 2, wz);
          pillar.lookAt(0, 2, 0);
          group.add(pillar);
        }
      }
    } else {
      // Neon circle details
      // A glowing cyan ring at the boundary
      const ringGeo = new THREE.RingGeometry(7.8, 8.0, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#06b6d4', side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      group.add(ring);

      // Glowing concentric ring
      const innerRingGeo = new THREE.RingGeometry(3.8, 4.0, 32);
      innerRingGeo.rotateX(-Math.PI / 2);
      const innerRing = new THREE.Mesh(innerRingGeo, ringMat);
      innerRing.position.y = 0.02;
      group.add(innerRing);

      // Simple neat columns at four cardinal points
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        const wx = Math.cos(angle) * 7.9;
        const wz = Math.sin(angle) * 7.9;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), new THREE.MeshStandardMaterial({ color: '#06b6d4', roughness: 0.5, metalness: 0.8 }));
        beam.position.set(wx, 1.25, wz);
        group.add(beam);
      }
    }

    let animationFrameId: number;
    let rotation = 0;

    const animate = () => {
      rotation += 0.008;
      camera.position.x = Math.sin(rotation) * 16;
      camera.position.z = Math.cos(rotation) * 16;
      camera.lookAt(0, 1.5, 0);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      scene.clear();
    };
  }, [selectedMap, customMap]);

  return (
    <div className="w-[180px] h-[180px] rounded-xl border border-white/10 bg-black/60 overflow-hidden flex items-center justify-center shrink-0 aspect-square">
      <canvas ref={canvasRef} width={180} height={180} className="w-full h-full block" />
    </div>
  );
};
