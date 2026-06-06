import * as THREE from 'three';
import { type CustomMapData } from '../../types';
import { generateCustomTexture } from './customMapAssets';
import { type GrifballThreeRefs } from './threeRefs';

type RainVelocity = {
  x: number;
  y: number;
  z: number;
};

export function buildCustomMapRainyStreetsSceneryForRefs({
  refs,
  activeCustomMap,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
}): void {
  if (activeCustomMap.theme !== 'rainy_streets') return;

  const scene = refs.scene;
  if (!scene) return;

  const rainyGroup = new THREE.Group();
  rainyGroup.name = 'rainy_streets_scenery';

  // 1. Framing Skyscrapers Backdrop
  const buildingWidths = [14, 18, 16, 12, 20, 15, 12, 16];
  const buildingHeights = [32, 28, 42, 36, 25, 30, 48, 35];
  const buildingPositions = [
    { x: -32, z: -25 },
    { x: -32, z: 0 },
    { x: -32, z: 25 },
    { x: 32, z: -25 },
    { x: 32, z: 0 },
    { x: 32, z: 25 },
    { x: 0, z: -35 },
    { x: 15, z: -35 },
  ];

  buildingPositions.forEach((pos, idx) => {
    const w = buildingWidths[idx % buildingWidths.length];
    const h = buildingHeights[idx % buildingHeights.length];
    const d = 10;
    const bGeo = new THREE.BoxGeometry(w, h, d);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = 512;
    bCanvas.height = 1024;
    const bCtx = bCanvas.getContext('2d')!;
    bCtx.scale(4, 4);
    bCtx.fillStyle = '#06080d';
    bCtx.fillRect(0, 0, 128, 256);

    bCtx.fillStyle = '#f97316';
    for (let wy = 20; wy < 240; wy += 24) {
      for (let wx = 12; wx < 116; wx += 16) {
        if (Math.random() < 0.25) {
          bCtx.fillRect(wx, wy, 8, 12);
        }
      }
    }

    const bTexture = new THREE.CanvasTexture(bCanvas);
    const bMat = new THREE.MeshStandardMaterial({
      map: bTexture,
      color: new THREE.Color('#0c0d12'),
      roughness: 0.1,
      metalness: 0.9,
      emissive: '#f97316',
      emissiveIntensity: 0.15,
    });

    const building = new THREE.Mesh(bGeo, bMat);
    building.position.set(pos.x, h / 2 - 2, pos.z);
    if (pos.x < 0) building.rotation.y = 0.15;
    if (pos.x > 0) building.rotation.y = -0.15;

    rainyGroup.add(building);
  });

  // 2. Colossal Tech Dog Billboard on the top right
  const boardGeo = new THREE.BoxGeometry(10, 7, 0.4);
  const boardTexture = generateCustomTexture('rainy_streets_dog_billboard', '#06b6d4');
  const boardMat = new THREE.MeshBasicMaterial({
    map: boardTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.position.set(20, 15, -20);
  boardMesh.rotation.y = -Math.PI / 6;
  rainyGroup.add(boardMesh);

  // 3. Glowing Neon Green Sign on the Left Building
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 1024;
  signCanvas.height = 1024;
  const sCtx = signCanvas.getContext('2d')!;
  sCtx.scale(8, 8);
  sCtx.fillStyle = 'rgba(0,0,0,0)';
  sCtx.clearRect(0, 0, 128, 128);
  sCtx.strokeStyle = '#22c55e';
  sCtx.lineWidth = 8;
  sCtx.shadowColor = '#22c55e';
  sCtx.shadowBlur = 15;
  sCtx.beginPath();
  sCtx.arc(44, 64, 25, 0, Math.PI * 2);
  sCtx.stroke();
  sCtx.beginPath();
  sCtx.arc(84, 64, 25, 0, Math.PI * 2);
  sCtx.stroke();
  sCtx.shadowBlur = 0;

  const signTexture = new THREE.CanvasTexture(signCanvas);
  const signMat = new THREE.MeshBasicMaterial({
    map: signTexture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), signMat);
  signMesh.position.set(-20, 14, -10);
  signMesh.rotation.y = Math.PI / 4;
  rainyGroup.add(signMesh);

  // 4. Low-Poly Neon Green Palm Trees next to the court
  const buildGreenPalmTree = () => {
    const treeGroup = new THREE.Group();
    const numSegments = 5;
    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#090514',
      roughness: 0.8,
      metalness: 0.9,
      emissive: '#166534',
      emissiveIntensity: 0.8,
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
      color: '#22c55e',
      emissive: '#22c55e',
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

  const treeZPositions = [-12, 0, 12];
  treeZPositions.forEach((tz) => {
    const leftTree = buildGreenPalmTree();
    leftTree.position.set(-21.5, 0, tz);
    leftTree.rotation.y = Math.random() * Math.PI;
    rainyGroup.add(leftTree);

    const rightTree = buildGreenPalmTree();
    rightTree.position.set(21.5, 0, tz + 2);
    rightTree.rotation.y = Math.random() * Math.PI;
    rainyGroup.add(rightTree);
  });

  // 5. Rain Particle System
  const rainCount = 1500;
  const rainGeo = new THREE.BufferGeometry();
  const rainPositions = new Float32Array(rainCount * 3);
  const rainVelocities: RainVelocity[] = [];

  for (let i = 0; i < rainCount; i++) {
    const rx = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 3;
    const ry = Math.random() * 25 + 0.1;
    const rz = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2;

    rainPositions[i * 3] = rx;
    rainPositions[i * 3 + 1] = ry;
    rainPositions[i * 3 + 2] = rz;

    rainVelocities.push({
      x: -1 + Math.random() * 0.5,
      y: -15 - Math.random() * 8,
      z: (Math.random() - 0.5) * 0.4,
    });
  }

  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.PointsMaterial({
    color: '#a5f3fc',
    size: 0.18,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const rainParticles = new THREE.Points(rainGeo, rainMat);
  rainParticles.name = 'rain_particles';
  rainParticles.userData = { velocities: rainVelocities, arenaRadius: activeCustomMap.arenaRadius };

  rainyGroup.add(rainParticles);

  scene.add(rainyGroup);
  if (!refs.customMapObjects) refs.customMapObjects = [];
  refs.customMapObjects.push(rainyGroup);
}
