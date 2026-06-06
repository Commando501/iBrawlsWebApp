import * as THREE from 'three';
import { type CustomMapData } from '../../types';
import { generateCustomTexture } from './customMapAssets';
import { type GrifballThreeRefs } from './threeRefs';

type SnowVelocity = {
  x: number;
  y: number;
  z: number;
};

export function buildCustomMapWinterSceneryForRefs({
  refs,
  activeCustomMap,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
}): void {
  if (activeCustomMap.theme !== 'winter_rink') return;

  const scene = refs.scene;
  if (!scene) return;

  const winterGroup = new THREE.Group();
  winterGroup.name = 'winter_scenery';

  const snowTexture = generateCustomTexture('winter_snow', '#ffffff');
  const glassTexture = generateCustomTexture('winter_glacier_glass', '#93c5fd');

  // 1. Giant Low-Poly Icebergs / Glaciers in the background
  const icebergPositions = [
    { x: -38, z: -40 },
    { x: -15, z: -48 },
    { x: 12, z: -45 },
    { x: 35, z: -38 },
    { x: -45, z: 5 },
    { x: 45, z: -5 },
  ];

  icebergPositions.forEach((pos, idx) => {
    const radius = 6 + Math.random() * 6;
    const height = 15 + Math.random() * 20;
    const iceGeo = new THREE.ConeGeometry(radius, height, 4); // 4-sided pyramid
    iceGeo.translate(0, height / 2, 0); // rest base on ground

    const iceMat = new THREE.MeshStandardMaterial({
      map: glassTexture,
      color: new THREE.Color('#93c5fd'),
      metalness: 0.1,
      roughness: 0.22,
      opacity: 0.8,
      transparent: true,
      emissive: new THREE.Color(idx % 2 === 0 ? '#3b82f6' : '#60a5fa'),
      emissiveIntensity: 0.8,
    });

    const iceberg = new THREE.Mesh(iceGeo, iceMat);
    iceberg.position.set(pos.x, -1.0, pos.z);
    iceberg.rotation.y = Math.random() * Math.PI;
    iceberg.rotation.x = (Math.random() - 0.5) * 0.1;
    iceberg.castShadow = false;
    iceberg.receiveShadow = false;
    winterGroup.add(iceberg);
  });

  // 2. Snow Dunes / Banks surrounding the rink
  const duneGeo = new THREE.SphereGeometry(1, 16, 12);
  const duneMat = new THREE.MeshStandardMaterial({
    map: snowTexture,
    color: new THREE.Color('#ffffff'),
    roughness: 0.95,
    metalness: 0.05,
  });

  const dunePositions = [
    { x: -26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
    { x: 26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
    { x: -26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
    { x: 26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
    { x: 0, y: -1.0, z: -15, sx: 35, sy: 2.0, sz: 14 },
    { x: 0, y: -1.0, z: 15, sx: 35, sy: 2.0, sz: 14 },
  ];

  dunePositions.forEach((d) => {
    const mesh = new THREE.Mesh(duneGeo, duneMat);
    mesh.position.set(d.x, d.y, d.z);
    mesh.scale.set(d.sx, d.sy, d.sz);
    mesh.receiveShadow = false;
    winterGroup.add(mesh);
  });

  // 3. Snowy Pine Trees
  const buildSnowyPineTree = () => {
    const tree = new THREE.Group();

    // Trunk (nature_wood texture)
    const woodTexture = generateCustomTexture('nature_wood', '#451a03');
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 3.5, 8);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: woodTexture,
      color: new THREE.Color('#3f2512'),
      roughness: 0.9,
      metalness: 0.1,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.75;
    trunk.castShadow = false;
    trunk.receiveShadow = false;
    tree.add(trunk);

    // Canopy Layers (Forest green branches + snow caps stacked)
    const pineMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0f5132'), // dark green needles
      roughness: 0.95,
      metalness: 0.05,
    });

    const canopyLayers = [
      { r: 2.4, h: 2.2, y: 3.2, snowH: 0.4 },
      { r: 1.8, h: 1.8, y: 4.6, snowH: 0.35 },
      { r: 1.2, h: 1.4, y: 5.8, snowH: 0.3 },
    ];

    canopyLayers.forEach((layer) => {
      // Pine cone branches
      const pineGeo = new THREE.ConeGeometry(layer.r, layer.h, 6);
      pineGeo.translate(0, layer.h / 2, 0);
      const pine = new THREE.Mesh(pineGeo, pineMat);
      pine.position.y = layer.y;
      pine.castShadow = false;
      pine.receiveShadow = false;
      tree.add(pine);

      // Snowy cap resting on top of branches
      const capGeo = new THREE.ConeGeometry(layer.r + 0.05, layer.snowH, 6);
      capGeo.translate(0, layer.snowH / 2, 0);
      const cap = new THREE.Mesh(capGeo, duneMat);
      cap.position.y = layer.y + layer.h - layer.snowH * 0.9;
      cap.castShadow = false;
      cap.receiveShadow = false;
      tree.add(cap);
    });

    return tree;
  };

  const treePositions = [
    { x: -23, z: -15 },
    { x: -27, z: -5 },
    { x: -25, z: 8 },
    { x: 23, z: -16 },
    { x: 27, z: -4 },
    { x: 25, z: 9 },
    { x: -14, z: -17 },
    { x: 14, z: -17 },
  ];

  treePositions.forEach((pos) => {
    const t = buildSnowyPineTree();
    t.position.set(pos.x, -0.2, pos.z);
    t.scale.set(0.9 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.3);
    t.rotation.y = Math.random() * Math.PI;
    winterGroup.add(t);
  });

  // 4. Soft Drifting Snow Weather Particles
  const snowCount = 1500;
  const snowGeo = new THREE.BufferGeometry();
  const snowPositions = new Float32Array(snowCount * 3);
  const snowVelocities: SnowVelocity[] = [];

  for (let i = 0; i < snowCount; i++) {
    const rx = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 3.2;
    const ry = Math.random() * 25 + 0.1;
    const rz = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.2;

    snowPositions[i * 3] = rx;
    snowPositions[i * 3 + 1] = ry;
    snowPositions[i * 3 + 2] = rz;

    snowVelocities.push({
      x: (Math.random() - 0.5) * 0.6,
      y: -1.8 - Math.random() * 1.6, // gentle fall speed
      z: (Math.random() - 0.5) * 0.6,
    });
  }

  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowMat = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.34, // fluffy snow
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const snowParticles = new THREE.Points(snowGeo, snowMat);
  snowParticles.name = 'snow_particles';
  snowParticles.userData = { velocities: snowVelocities, arenaRadius: activeCustomMap.arenaRadius };
  winterGroup.add(snowParticles);

  scene.add(winterGroup);
  if (!refs.customMapObjects) refs.customMapObjects = [];
  refs.customMapObjects.push(winterGroup);
}
