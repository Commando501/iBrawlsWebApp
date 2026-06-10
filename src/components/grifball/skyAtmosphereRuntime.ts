import * as THREE from 'three';
import {
  resolveSkyboxAtmosphereSettings,
  resolveSkyboxTextureId,
  type SkyboxTextureId,
} from '../../game/skyboxTextures';
import type { CustomMapAtmosphereSettings } from '../../types';
import type { GrifballThreeRefs } from './threeRefs';

export interface SkyAtmosphereRuntime {
  group: THREE.Group;
  skyboxTextureId: SkyboxTextureId;
  settings: Required<CustomMapAtmosphereSettings>;
}

interface BuildSkyAtmosphereOptions {
  refs: GrifballThreeRefs;
  skyboxTexture: string;
  atmosphere?: CustomMapAtmosphereSettings;
  visible: boolean;
}

const SKY_RADIUS = 238;

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((mat) => {
    const maybeMap = (mat as THREE.MeshBasicMaterial).map;
    if (maybeMap) maybeMap.dispose();
    mat.dispose();
  });
};

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
};

export function disposeSkyAtmosphereForRefs(refs: GrifballThreeRefs): void {
  const runtime = refs.skyAtmosphere;
  if (!runtime) return;
  runtime.group.parent?.remove(runtime.group);
  disposeObject(runtime.group);
  refs.skyAtmosphere = null;
}

export function buildSkyAtmosphereForRefs({
  refs,
  skyboxTexture,
  atmosphere,
  visible,
}: BuildSkyAtmosphereOptions): SkyAtmosphereRuntime | null {
  const scene = refs.scene;
  if (!scene) return null;

  disposeSkyAtmosphereForRefs(refs);

  const skyboxTextureId = resolveSkyboxTextureId(skyboxTexture);
  const settings = resolveSkyboxAtmosphereSettings(skyboxTextureId, atmosphere);
  const group = new THREE.Group();
  group.name = 'sky_atmosphere';
  group.visible = visible;
  group.renderOrder = -10;

  addHazeShell(group, skyboxTextureId, settings);
  addCelestialLayer(group, skyboxTextureId, settings);
  addStarLayer(group, skyboxTextureId, settings);
  addCloudLayer(group, skyboxTextureId, settings);
  addHorizonEnergyLayer(group, skyboxTextureId, settings);
  addLightningLayer(group, skyboxTextureId, settings);
  addWeatherLayer(group, skyboxTextureId, settings);

  scene.add(group);
  refs.skyAtmosphere = { group, skyboxTextureId, settings };
  return refs.skyAtmosphere;
}

export function syncSkyAtmosphereForRefs({
  refs,
  skyboxTexture,
  atmosphere,
  visible,
}: BuildSkyAtmosphereOptions): void {
  const skyboxTextureId = resolveSkyboxTextureId(skyboxTexture);
  const settings = resolveSkyboxAtmosphereSettings(skyboxTextureId, atmosphere);
  const runtime = refs.skyAtmosphere;

  if (
    runtime &&
    runtime.skyboxTextureId === skyboxTextureId &&
    atmosphereSettingsEqual(runtime.settings, settings)
  ) {
    runtime.group.visible = visible;
    return;
  }

  buildSkyAtmosphereForRefs({ refs, skyboxTexture, atmosphere, visible });
}

export function updateSkyAtmosphereForRefs(refs: GrifballThreeRefs, dt: number, elapsed = performance.now() / 1000): void {
  const runtime = refs.skyAtmosphere;
  if (!runtime?.group.visible) return;

  const motionScale = runtime.settings.motion / 100;
  runtime.group.rotation.y += dt * 0.012 * motionScale;

  runtime.group.traverse((child) => {
    const role = child.userData.skyAtmosphereRole as string | undefined;
    if (!role) return;

    if (child instanceof THREE.Mesh) {
      updateAtmosphereMesh(child, role, dt, elapsed, motionScale);
    } else if (child instanceof THREE.Points) {
      updateAtmospherePoints(child, role, dt, motionScale);
    } else if (child instanceof THREE.LineSegments) {
      updateAtmosphereLines(child, role, elapsed);
    }
  });
}

const atmosphereSettingsEqual = (
  a: Required<CustomMapAtmosphereSettings>,
  b: Required<CustomMapAtmosphereSettings>
): boolean => (
  a.motion === b.motion &&
  a.clouds === b.clouds &&
  a.haze === b.haze &&
  a.stars === b.stars &&
  a.weather === b.weather &&
  a.lightning === b.lightning &&
  a.energy === b.energy &&
  a.celestial === b.celestial &&
  a.horizonDetail === b.horizonDetail
);

const presetColor = (id: SkyboxTextureId): string => {
  switch (id) {
    case 'nature': return '#86efac';
    case 'space': return '#93c5fd';
    case 'fantasy': return '#c4b5fd';
    case 'forerunner': return '#fbbf24';
    case 'synthwave': return '#ec4899';
    case 'rainy_streets': return '#f59e0b';
    case 'winter_rink': return '#bae6fd';
    case 'grifball_stadium': return '#f8fafc';
    case 'holodeck': return '#eab308';
    case 'rust': return '#fb923c';
    case 'toxic': return '#4ade80';
    case 'inferno': return '#ef4444';
    case 'matrix': return '#22c55e';
    case 'nebula': return '#a855f7';
    case 'hangar': return '#38bdf8';
    case 'cyberpunk':
    default:
      return '#22d3ee';
  }
};

const createSoftDiscTexture = (color: string, alpha = 1): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
  grad.addColorStop(0.45, `${color}${Math.round(alpha * 120).toString(16).padStart(2, '0')}`);
  grad.addColorStop(1, `${color}00`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const createCloudTexture = (id: SkyboxTextureId, opacity: number): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const color = presetColor(id);
  for (let i = 0; i < 26; i++) {
    const x = (i * 97) % 512;
    const y = 48 + ((i * 47) % 128);
    const r = 34 + ((i * 19) % 56);
    const grad = ctx.createRadialGradient(x, y, 3, x, y, r);
    grad.addColorStop(0, `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

function addHazeShell(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.haze <= 0) return;

  const geo = new THREE.SphereGeometry(SKY_RADIUS * 0.96, 32, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(presetColor(id)),
    transparent: true,
    opacity: 0.04 + settings.haze / 1800,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky_atmosphere_haze';
  mesh.userData.skyAtmosphereRole = 'haze';
  group.add(mesh);
}

function addCelestialLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.celestial <= 0) return;

  const celestialCount = ['space', 'fantasy', 'nebula', 'winter_rink'].includes(id) ? 3 : 1;
  const color = id === 'inferno' || id === 'rust' ? '#fed7aa' : presetColor(id);
  for (let i = 0; i < celestialCount; i++) {
    const size = 10 + settings.celestial * (id === 'grifball_stadium' ? 0.05 : 0.18) * (1 - i * 0.18);
    const mat = new THREE.MeshBasicMaterial({
      map: createSoftDiscTexture(color, 0.85 - i * 0.18),
      transparent: true,
      opacity: 0.42 + settings.celestial / 220,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    const angle = -0.8 + i * 0.55;
    mesh.position.set(Math.sin(angle) * SKY_RADIUS * 0.58, 88 - i * 18, -SKY_RADIUS * 0.65 + i * 12);
    mesh.lookAt(0, 8, 0);
    mesh.name = `sky_atmosphere_celestial_${i}`;
    mesh.userData.skyAtmosphereRole = 'celestial';
    mesh.userData.drift = 0.08 + i * 0.03;
    group.add(mesh);
  }
}

function addStarLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.stars <= 0) return;

  const count = Math.max(32, Math.round(settings.stars * (id === 'space' || id === 'nebula' ? 10 : 4)));
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = (i * 2.399963229728653) % (Math.PI * 2);
    const y = 24 + ((i * 37) % 128);
    const radius = SKY_RADIUS * (0.72 + ((i * 13) % 24) / 100);
    positions[i * 3] = Math.cos(theta) * radius;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: id === 'matrix' ? '#22c55e' : '#ffffff',
    size: 0.18 + settings.stars / 180,
    transparent: true,
    opacity: 0.28 + settings.stars / 160,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'sky_atmosphere_stars';
  points.userData.skyAtmosphereRole = 'stars';
  group.add(points);
}

function addCloudLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.clouds <= 0) return;

  const count = Math.max(2, Math.round(settings.clouds / 14));
  for (let i = 0; i < count; i++) {
    const width = 34 + settings.clouds * 0.42 + (i % 3) * 8;
    const height = width * 0.38;
    const mat = new THREE.MeshBasicMaterial({
      map: createCloudTexture(id, 0.08 + settings.clouds / 850),
      transparent: true,
      opacity: 0.22 + settings.clouds / 240,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    const angle = (i / count) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * SKY_RADIUS * 0.48, 62 + (i % 4) * 10, Math.sin(angle) * SKY_RADIUS * 0.48);
    mesh.lookAt(0, 12, 0);
    mesh.name = `sky_atmosphere_cloud_${i}`;
    mesh.userData.skyAtmosphereRole = 'cloud';
    mesh.userData.drift = 0.12 + (i % 5) * 0.03;
    group.add(mesh);
  }
}

function addHorizonEnergyLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.energy <= 0) return;

  const color = presetColor(id);
  const ringCount = Math.max(1, Math.round(settings.energy / 24));
  for (let i = 0; i < ringCount; i++) {
    const geo = new THREE.TorusGeometry(SKY_RADIUS * (0.45 + i * 0.055), 0.08 + settings.energy / 1200, 8, 128);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1 + settings.energy / 430,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 4 + i * 2;
    mesh.rotation.x = Math.PI / 2;
    mesh.name = `sky_atmosphere_energy_ring_${i}`;
    mesh.userData.skyAtmosphereRole = 'energy';
    mesh.userData.drift = 0.16 + i * 0.04;
    group.add(mesh);
  }
}

function addLightningLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.lightning <= 0) return;

  const branches = Math.max(1, Math.round(settings.lightning / 18));
  const positions: number[] = [];
  for (let i = 0; i < branches; i++) {
    let x = -80 + i * (160 / Math.max(1, branches - 1));
    let y = 132;
    const z = -SKY_RADIUS * 0.58;
    for (let j = 0; j < 6; j++) {
      const nx = x + (((i + j) % 2 === 0 ? 1 : -1) * (8 + j * 2));
      const ny = y - 12 - j * 6;
      positions.push(x, y, z, nx, ny, z + j * 1.5);
      x = nx;
      y = ny;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: id === 'inferno' ? '#fed7aa' : presetColor(id),
    transparent: true,
    opacity: 0.28 + settings.lightning / 180,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'sky_atmosphere_lightning';
  lines.userData.skyAtmosphereRole = 'lightning';
  lines.userData.baseOpacity = mat.opacity;
  group.add(lines);
}

function addWeatherLayer(group: THREE.Group, id: SkyboxTextureId, settings: Required<CustomMapAtmosphereSettings>): void {
  if (settings.weather <= 0) return;

  const count = Math.max(64, Math.round(settings.weather * 10));
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = ((i * 73) % 220) - 110;
    positions[i * 3 + 1] = 18 + ((i * 41) % 130);
    positions[i * 3 + 2] = ((i * 137) % 220) - 110;
    velocities[i * 3] = id === 'rainy_streets' ? -2.6 : ((i % 5) - 2) * 0.18;
    velocities[i * 3 + 1] = weatherFallSpeed(id, settings.weather, i);
    velocities[i * 3 + 2] = ((i % 7) - 3) * 0.16;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: weatherColor(id),
    size: weatherSize(id, settings.weather),
    transparent: true,
    opacity: 0.2 + settings.weather / 140,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'sky_atmosphere_weather';
  points.userData.skyAtmosphereRole = weatherRole(id);
  points.userData.velocities = velocities;
  points.userData.resetTop = 150;
  points.userData.resetBottom = 4;
  points.userData.resetRadius = 118;
  group.add(points);
}

const weatherRole = (id: SkyboxTextureId): string => {
  if (id === 'matrix') return 'code_rain';
  if (id === 'winter_rink') return 'snow';
  if (id === 'inferno') return 'embers';
  if (id === 'rust') return 'dust';
  if (id === 'toxic') return 'toxic_smog';
  return 'rain';
};

const weatherColor = (id: SkyboxTextureId): string => {
  switch (id) {
    case 'winter_rink': return '#ffffff';
    case 'inferno': return '#fdba74';
    case 'rust': return '#fb923c';
    case 'toxic': return '#86efac';
    case 'matrix': return '#22c55e';
    default: return '#a5f3fc';
  }
};

const weatherSize = (id: SkyboxTextureId, value: number): number => {
  if (id === 'winter_rink') return 0.22 + value / 260;
  if (id === 'inferno') return 0.15 + value / 300;
  if (id === 'matrix') return 0.18 + value / 360;
  return 0.1 + value / 450;
};

const weatherFallSpeed = (id: SkyboxTextureId, value: number, index: number): number => {
  if (id === 'winter_rink') return -0.8 - (index % 7) * 0.12 - value / 70;
  if (id === 'inferno') return 2.0 + (index % 5) * 0.24 + value / 55;
  if (id === 'matrix') return -10 - (index % 9) * 0.4;
  if (id === 'rust' || id === 'toxic') return -0.25 - value / 180;
  return -8 - value / 16;
};

function updateAtmosphereMesh(mesh: THREE.Mesh, role: string, dt: number, elapsed: number, motionScale: number): void {
  if (role === 'cloud') {
    mesh.rotation.z += dt * mesh.userData.drift * 0.05 * motionScale;
  } else if (role === 'energy') {
    mesh.rotation.z += dt * mesh.userData.drift * motionScale;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0.02, mat.opacity * 0.98 + (0.14 + Math.sin(elapsed * 1.7) * 0.04) * 0.02);
  } else if (role === 'celestial') {
    mesh.position.x += Math.sin(elapsed * 0.15 * mesh.userData.drift) * dt * motionScale * 0.18;
  } else if (role === 'haze') {
    mesh.rotation.y += dt * 0.004 * motionScale;
  }
}

function updateAtmosphereLines(lines: THREE.LineSegments, role: string, elapsed: number): void {
  if (role !== 'lightning') return;
  const mat = lines.material as THREE.LineBasicMaterial;
  const base = lines.userData.baseOpacity || 0.45;
  const pulse = Math.max(0, Math.sin(elapsed * 5.5) + Math.sin(elapsed * 11.7) * 0.45);
  mat.opacity = base * (0.18 + pulse * 0.82);
}

function updateAtmospherePoints(points: THREE.Points, role: string, dt: number, motionScale: number): void {
  if (role === 'stars') {
    points.rotation.y += dt * 0.006 * motionScale;
    return;
  }

  const positions = points.geometry.attributes.position.array as Float32Array;
  const velocities = points.userData.velocities as Float32Array | undefined;
  if (!velocities) return;

  const resetTop = points.userData.resetTop ?? 150;
  const resetBottom = points.userData.resetBottom ?? 4;
  const resetRadius = points.userData.resetRadius ?? 118;
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    positions[i * 3] += velocities[i * 3] * dt * Math.max(0.25, motionScale);
    positions[i * 3 + 1] += velocities[i * 3 + 1] * dt * Math.max(0.25, motionScale);
    positions[i * 3 + 2] += velocities[i * 3 + 2] * dt * Math.max(0.25, motionScale);

    const falling = velocities[i * 3 + 1] < 0;
    if ((falling && positions[i * 3 + 1] < resetBottom) || (!falling && positions[i * 3 + 1] > resetTop)) {
      positions[i * 3] = ((i * 83) % (resetRadius * 2)) - resetRadius;
      positions[i * 3 + 1] = falling ? resetTop : resetBottom;
      positions[i * 3 + 2] = ((i * 157) % (resetRadius * 2)) - resetRadius;
    }
  }

  points.geometry.attributes.position.needsUpdate = true;
}
