import * as THREE from 'three';
import { type CustomMapData } from '../../types';
import { type GrifballThreeRefs } from './threeRefs';

export function buildCustomMapSynthwaveSceneryForRefs({
  refs,
  activeCustomMap,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
}): void {
  if (activeCustomMap.theme !== 'synthwave') return;

  const scene = refs.scene;
  if (!scene) return;

  const synthwaveGroup = new THREE.Group();
  synthwaveGroup.name = 'synthwave_scenery';

  // 1. Striped Gradient Sunset Sun Disc
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 2048;
  sunCanvas.height = 2048;
  const sunCtx = sunCanvas.getContext('2d')!;
  sunCtx.scale(4, 4);

  const sunGrad = sunCtx.createLinearGradient(0, 50, 0, 462);
  sunGrad.addColorStop(0, '#ffe066'); // Golden yellow top
  sunGrad.addColorStop(0.5, '#ff007f'); // Neon pink middle
  sunGrad.addColorStop(1, '#9400d3'); // Purple violet bottom

  sunCtx.fillStyle = sunGrad;
  sunCtx.beginPath();
  sunCtx.arc(256, 256, 230, 0, Math.PI * 2);
  sunCtx.fill();

  // Horizontal slices (Outrun style)
  sunCtx.fillStyle = '#0a0518'; // Blends with atmospheric fog/sky
  for (let y = 250; y < 512; y += 18) {
    const thickness = Math.max(1.5, (y - 250) / 7.5);
    sunCtx.fillRect(0, y, 512, thickness);
  }

  const sunTexture = new THREE.CanvasTexture(sunCanvas);
  const sunMat = new THREE.MeshBasicMaterial({
    map: sunTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const sunGeo = new THREE.PlaneGeometry(55, 55);
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.set(0, 16, -72);
  synthwaveGroup.add(sunMesh);

  // 2. Skyscrapers Skyline Silhouettes
  const cityWidths = [12, 8, 14, 10, 6, 16, 9, 11, 13, 7, 15, 10];
  const cityHeights = [18, 28, 22, 34, 15, 20, 26, 32, 19, 29, 24, 17];
  const numBuildings = cityWidths.length;

  for (let i = 0; i < numBuildings; i++) {
    const w = cityWidths[i];
    const h = cityHeights[i];
    const d = 6;
    const x = -48 + i * 9 + (Math.random() - 0.5) * 1.5;
    const y = h / 2 - 2;
    const z = -60 + (Math.random() - 0.5) * 2;

    const bGeo = new THREE.BoxGeometry(w, h, d);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = 512;
    bCanvas.height = 1024;
    const bCtx = bCanvas.getContext('2d')!;
    bCtx.scale(4, 4);
    bCtx.fillStyle = '#05020c';
    bCtx.fillRect(0, 0, 128, 256);

    bCtx.fillStyle = i % 2 === 0 ? '#06b6d4' : '#ec4899';
    for (let wy = 24; wy < 240; wy += 20) {
      for (let wx = 12; wx < 116; wx += 16) {
        if (Math.random() < 0.6) {
          bCtx.fillRect(wx, wy, 6, 10);
        }
      }
    }

    const bTexture = new THREE.CanvasTexture(bCanvas);
    const bMat = new THREE.MeshStandardMaterial({
      map: bTexture,
      roughness: 0.9,
      metalness: 0.1,
      emissive: i % 2 === 0 ? '#06b6d4' : '#ec4899',
      emissiveIntensity: 0.2,
    });

    const building = new THREE.Mesh(bGeo, bMat);
    building.position.set(x, y, z);
    synthwaveGroup.add(building);
  }

  // 3. Glowing Laser Beams
  const laserColors = ['#ec4899', '#06b6d4', '#eab308'];
  for (let i = 0; i < 9; i++) {
    const lGeo = new THREE.CylinderGeometry(0.12, 0.12, 100, 6);
    const col = laserColors[i % laserColors.length];
    const lMat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const laser = new THREE.Mesh(lGeo, lMat);
    const lx = -45 + i * 11.25;
    laser.position.set(lx, 40, -68);
    synthwaveGroup.add(laser);
  }

  // 4. Low-Poly Neon Palm Trees
  const buildSynthwavePalmTree = (leafColor: string, trunkColor: string) => {
    const treeGroup = new THREE.Group();
    const numSegments = 5;
    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#08041d',
      roughness: 0.7,
      metalness: 0.8,
      emissive: trunkColor,
      emissiveIntensity: 1.5,
    });

    let currentParent: THREE.Group | THREE.Mesh = treeGroup;
    for (let j = 0; j < numSegments; j++) {
      const segGeo = new THREE.CylinderGeometry(0.18 - j * 0.02, 0.23 - j * 0.02, 1.3, 8);
      const segment = new THREE.Mesh(segGeo, trunkMat);
      segment.position.y = j === 0 ? 0.65 : 1.2;
      segment.rotation.z = 0.08;
      currentParent.add(segment);
      currentParent = segment;
    }

    const leafMat = new THREE.MeshStandardMaterial({
      color: leafColor,
      emissive: leafColor,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0.5,
      side: THREE.DoubleSide,
    });

    const numLeaves = 7;
    for (let j = 0; j < numLeaves; j++) {
      const angle = (j * Math.PI * 2) / numLeaves;
      const leafGeo = new THREE.BoxGeometry(2.4, 0.06, 0.5);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.geometry.translate(1.2, 0, 0);
      leaf.position.set(0, 0.65, 0);
      leaf.rotation.y = angle;
      leaf.rotation.z = 0.22;
      currentParent.add(leaf);
    }

    return treeGroup;
  };

  const palmPositionsZ = [-16, -6, 4, 14];
  palmPositionsZ.forEach((pz, idx) => {
    const leftPalm = buildSynthwavePalmTree('#ec4899', '#06b6d4');
    leftPalm.position.set(-23.5, 0, pz);
    leftPalm.scale.set(1.1, 1.1, 1.1);
    leftPalm.rotation.y = Math.PI / 4 + idx;
    synthwaveGroup.add(leftPalm);

    const rightPalm = buildSynthwavePalmTree('#06b6d4', '#ec4899');
    rightPalm.position.set(23.5, 0, pz + 1.0);
    rightPalm.scale.set(1.1, 1.1, 1.1);
    rightPalm.rotation.y = -Math.PI / 4 + idx;
    synthwaveGroup.add(rightPalm);
  });

  scene.add(synthwaveGroup);
  if (!refs.customMapObjects) refs.customMapObjects = [];
  refs.customMapObjects.push(synthwaveGroup);
}
