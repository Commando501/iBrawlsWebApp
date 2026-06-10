/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import type { CustomMapAtmosphereSettings } from '../types';

export const SKYBOX_TEXTURE_IDS = [
  'cyberpunk',
  'hangar',
  'nature',
  'space',
  'fantasy',
  'forerunner',
  'synthwave',
  'rainy_streets',
  'winter_rink',
  'grifball_stadium',
  'holodeck',
  'rust',
  'toxic',
  'inferno',
  'matrix',
  'nebula',
] as const;

export type SkyboxTextureId = typeof SKYBOX_TEXTURE_IDS[number];
export type SkyboxQuality = 'standard' | 'hd';

export interface SkyboxTextureSize {
  width: number;
  height: number;
  quality: SkyboxQuality;
}

export interface SkyboxTextureCapabilities {
  maxTextureSize: number;
  devicePixelRatio: number;
  isMobile: boolean;
}

export interface SkyboxPreset {
  id: SkyboxTextureId;
  label: string;
  description: string;
  atmosphere: Required<CustomMapAtmosphereSettings>;
}

export const ATMOSPHERE_SETTING_KEYS = [
  'motion',
  'clouds',
  'haze',
  'stars',
  'weather',
  'lightning',
  'energy',
  'celestial',
  'horizonDetail',
] as const satisfies readonly (keyof CustomMapAtmosphereSettings)[];

const DEFAULT_ATMOSPHERE: Required<CustomMapAtmosphereSettings> = {
  motion: 45,
  clouds: 35,
  haze: 45,
  stars: 35,
  weather: 20,
  lightning: 0,
  energy: 45,
  celestial: 45,
  horizonDetail: 70,
};

export const SKYBOX_PRESETS: Record<SkyboxTextureId, SkyboxPreset> = {
  cyberpunk: {
    id: 'cyberpunk',
    label: 'Cyber Megacity',
    description: 'Layered neon arcologies, traffic lanes, hologram haze, and dense skyline silhouettes.',
    atmosphere: { motion: 58, clouds: 18, haze: 70, stars: 18, weather: 10, lightning: 8, energy: 88, celestial: 24, horizonDetail: 92 },
  },
  hangar: {
    id: 'hangar',
    label: 'Orbital Hangar',
    description: 'Vast station trusses, repair gantries, viewport glass, orbital planet glow, and bay lights.',
    atmosphere: { motion: 34, clouds: 4, haze: 42, stars: 62, weather: 0, lightning: 0, energy: 65, celestial: 82, horizonDetail: 88 },
  },
  nature: {
    id: 'nature',
    label: 'Ancient Canopy',
    description: 'Layered jungle canopy, warm shafts of light, distant mountains, mist shelves, and birds.',
    atmosphere: { motion: 42, clouds: 64, haze: 72, stars: 0, weather: 18, lightning: 0, energy: 18, celestial: 64, horizonDetail: 90 },
  },
  space: {
    id: 'space',
    label: 'Deep Space Expanse',
    description: 'Dense starfield, nebula sheets, orbital debris, asteroid silhouettes, and distant suns.',
    atmosphere: { motion: 40, clouds: 8, haze: 36, stars: 100, weather: 0, lightning: 0, energy: 70, celestial: 96, horizonDetail: 72 },
  },
  fantasy: {
    id: 'fantasy',
    label: 'Mythic Skylands',
    description: 'Dual moons, floating islands, rune-lit clouds, distant citadels, and magical aurora bands.',
    atmosphere: { motion: 52, clouds: 76, haze: 58, stars: 72, weather: 8, lightning: 12, energy: 80, celestial: 92, horizonDetail: 86 },
  },
  forerunner: {
    id: 'forerunner',
    label: 'Forerunner Megastructure',
    description: 'Golden alien monoliths, hardlight beams, canyon haze, suspended plates, and beacon towers.',
    atmosphere: { motion: 38, clouds: 20, haze: 62, stars: 12, weather: 0, lightning: 6, energy: 92, celestial: 56, horizonDetail: 94 },
  },
  synthwave: {
    id: 'synthwave',
    label: 'Neon Outrun Horizon',
    description: 'Retrowave city horizon, wire grids, laser lanes, palm silhouettes, and a striped sun.',
    atmosphere: { motion: 66, clouds: 14, haze: 62, stars: 48, weather: 0, lightning: 0, energy: 98, celestial: 84, horizonDetail: 88 },
  },
  rainy_streets: {
    id: 'rainy_streets',
    label: 'Rain-Slick Megablock',
    description: 'Wet megacity towers, sodium fog, billboard glow, storm clouds, and rain shafts.',
    atmosphere: { motion: 70, clouds: 82, haze: 86, stars: 0, weather: 96, lightning: 34, energy: 74, celestial: 12, horizonDetail: 96 },
  },
  winter_rink: {
    id: 'winter_rink',
    label: 'Glacial Aurora Bowl',
    description: 'Arctic glaciers, layered snowfall, aurora curtains, ice cliffs, and pale sun glow.',
    atmosphere: { motion: 48, clouds: 58, haze: 72, stars: 58, weather: 82, lightning: 0, energy: 42, celestial: 74, horizonDetail: 90 },
  },
  grifball_stadium: {
    id: 'grifball_stadium',
    label: 'Championship Stadium',
    description: 'Massive arena roof, scoreboard glow, crowd bands, floodlights, and team-color banners.',
    atmosphere: { motion: 52, clouds: 8, haze: 46, stars: 0, weather: 0, lightning: 0, energy: 90, celestial: 16, horizonDetail: 100 },
  },
  holodeck: {
    id: 'holodeck',
    label: 'Infinite Holodeck Grid',
    description: 'Endless coordinate space, depth-coded grid planes, diagnostic arcs, and glowing axis gates.',
    atmosphere: { motion: 54, clouds: 0, haze: 28, stars: 12, weather: 0, lightning: 0, energy: 96, celestial: 18, horizonDetail: 76 },
  },
  rust: {
    id: 'rust',
    label: 'Dustbound Wasteland',
    description: 'Ruined refineries, smoke stacks, sandstorm layers, harsh sun, and broken crane silhouettes.',
    atmosphere: { motion: 58, clouds: 52, haze: 90, stars: 0, weather: 42, lightning: 0, energy: 22, celestial: 78, horizonDetail: 94 },
  },
  toxic: {
    id: 'toxic',
    label: 'Toxic Wasteland',
    description: 'Chemical smog, radioactive pools, dead forests, warning strobes, and green industrial haze.',
    atmosphere: { motion: 62, clouds: 82, haze: 96, stars: 0, weather: 36, lightning: 14, energy: 80, celestial: 18, horizonDetail: 92 },
  },
  inferno: {
    id: 'inferno',
    label: 'Magma Storm Front',
    description: 'Basalt teeth, volcanic ash, ember storms, lava glow, and heat-distorted storm clouds.',
    atmosphere: { motion: 72, clouds: 76, haze: 86, stars: 0, weather: 54, lightning: 42, energy: 88, celestial: 62, horizonDetail: 96 },
  },
  matrix: {
    id: 'matrix',
    label: 'Digital Rain Void',
    description: 'Layered code rain, scanning grids, data monoliths, terminal glow, and green volumetric haze.',
    atmosphere: { motion: 82, clouds: 0, haze: 48, stars: 18, weather: 70, lightning: 0, energy: 100, celestial: 10, horizonDetail: 84 },
  },
  nebula: {
    id: 'nebula',
    label: 'Planetary Nebula',
    description: 'Planet rings, gas clouds, moon clusters, luminous dust rivers, and deep cosmic parallax.',
    atmosphere: { motion: 46, clouds: 52, haze: 54, stars: 100, weather: 0, lightning: 0, energy: 76, celestial: 100, horizonDetail: 80 },
  },
};

const skyboxTextureCache = new Map<string, THREE.Texture>();
let detectedTextureSize: SkyboxTextureSize | null = null;

export function resolveSkyboxTextureId(type?: string | null): SkyboxTextureId {
  return SKYBOX_TEXTURE_IDS.includes(type as SkyboxTextureId) ? (type as SkyboxTextureId) : 'cyberpunk';
}

const clampAtmosphereValue = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
};

export function clampAtmosphereSettings(
  settings: Partial<CustomMapAtmosphereSettings> | undefined,
  defaults: Required<CustomMapAtmosphereSettings> = DEFAULT_ATMOSPHERE
): Required<CustomMapAtmosphereSettings> {
  const resolved = { ...defaults };
  for (const key of ATMOSPHERE_SETTING_KEYS) {
    resolved[key] = clampAtmosphereValue(settings?.[key], defaults[key]);
  }
  return resolved;
}

export function resolveSkyboxAtmosphereSettings(
  type?: string | null,
  overrides?: Partial<CustomMapAtmosphereSettings>
): Required<CustomMapAtmosphereSettings> {
  const id = resolveSkyboxTextureId(type);
  return clampAtmosphereSettings(overrides, SKYBOX_PRESETS[id].atmosphere);
}

export function resolveSkyboxTextureSize(capabilities: Partial<SkyboxTextureCapabilities> = {}): SkyboxTextureSize {
  const maxTextureSize = capabilities.maxTextureSize ?? 4096;
  const devicePixelRatio = capabilities.devicePixelRatio ?? 1;
  const isMobile = capabilities.isMobile ?? false;
  const supportsHd = maxTextureSize >= 4096 && devicePixelRatio >= 1 && !isMobile;

  return supportsHd
    ? { width: 4096, height: 2048, quality: 'hd' }
    : { width: 2048, height: 1024, quality: 'standard' };
}

function detectSkyboxTextureSize(): SkyboxTextureSize {
  if (detectedTextureSize) return detectedTextureSize;

  let maxTextureSize = 4096;
  if (typeof document !== 'undefined') {
    const probe = document.createElement('canvas');
    const gl = (probe.getContext('webgl') || probe.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    }
  }

  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  detectedTextureSize = resolveSkyboxTextureSize({ maxTextureSize, devicePixelRatio, isMobile });
  return detectedTextureSize;
}

const hsl = (hue: number, saturation: number, lightness: number, alpha = 1): string =>
  `hsla(${((hue % 360) + 360) % 360}, ${saturation}%, ${Math.max(0, Math.min(100, lightness))}%, ${alpha})`;

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.trim().replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

const translucent = (hex: string, alpha: number): string => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function fillCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
  points: readonly [number, number][]
): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
}

function drawJaggedHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  horizon: number,
  baseHeight: number,
  amplitude: number,
  color: string,
  step = 48,
  phase = 0
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  for (let x = 0; x <= width; x += step) {
    const y = horizon - baseHeight - Math.sin(x * 0.007 + phase) * amplitude - Math.cos(x * 0.013 + phase) * amplitude * 0.5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, horizon);
  ctx.closePath();
  ctx.fill();
}

function drawNoiseSpecks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
  color: string,
  size = 1
): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = (i * 491 + (i % 19) * 37) % width;
    const y = (i * 233 + (i % 13) * 29) % height;
    const s = size * (0.6 + ((i * 7) % 10) / 10);
    ctx.fillRect(x, y, s, s);
  }
}

function drawBaseAtmosphere(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hue: number,
  brightness: number,
  fogColor: string
): void {
  const horizon = height * 0.52;
  const skyTop = hsl(hue, 78, Math.max(6, brightness * 3.2));
  const skyMid = hsl(hue + 10, 70, Math.max(10, brightness * 5.6));
  const horizonColor = hsl(hue + 18, 62, Math.max(14, brightness * 8.2));

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
  skyGrad.addColorStop(0, skyTop);
  skyGrad.addColorStop(0.58, skyMid);
  skyGrad.addColorStop(1, horizonColor);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizon);

  const groundGrad = ctx.createLinearGradient(0, horizon, 0, height);
  groundGrad.addColorStop(0, horizonColor);
  groundGrad.addColorStop(0.48, translucent(fogColor, 0.9));
  groundGrad.addColorStop(1, fogColor);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, horizon, width, height - horizon);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(width * 0.5, horizon * 0.92, 10, width * 0.5, horizon * 0.92, width * 0.58);
  glow.addColorStop(0, hsl(hue + 25, 90, Math.min(72, brightness * 11), 0.16));
  glow.addColorStop(1, hsl(hue + 25, 90, 50, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function getSkyboxTexture(
  type: string,
  hue: number,
  brightness: number,
  fogColor: string
): THREE.Texture {
  const id = resolveSkyboxTextureId(type);
  const size = detectSkyboxTextureSize();
  const cacheKey = `${id}_${hue}_${brightness}_${fogColor}_${size.quality}`;
  if (skyboxTextureCache.has(cacheKey)) {
    return skyboxTextureCache.get(cacheKey)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d')!;
  drawBaseAtmosphere(ctx, size.width, size.height, hue, brightness, fogColor);
  drawSkyboxById(ctx, id, hue, brightness, fogColor, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  skyboxTextureCache.set(cacheKey, texture);
  return texture;
}

function drawSkyboxById(
  ctx: CanvasRenderingContext2D,
  id: SkyboxTextureId,
  hue: number,
  brightness: number,
  fogColor: string,
  size: SkyboxTextureSize
): void {
  switch (id) {
    case 'cyberpunk': drawCyberpunkSky(ctx, hue, brightness, fogColor, size); break;
    case 'hangar': drawHangarSky(ctx, hue, brightness, fogColor, size); break;
    case 'nature': drawNatureSky(ctx, hue, brightness, fogColor, size); break;
    case 'space': drawSpaceSky(ctx, hue, brightness, fogColor, size); break;
    case 'fantasy': drawFantasySky(ctx, hue, brightness, fogColor, size); break;
    case 'forerunner': drawForerunnerSky(ctx, hue, brightness, fogColor, size); break;
    case 'synthwave': drawSynthwaveSky(ctx, hue, brightness, fogColor, size); break;
    case 'rainy_streets': drawRainyStreetsSky(ctx, hue, brightness, fogColor, size); break;
    case 'winter_rink': drawWinterRinkSky(ctx, hue, brightness, fogColor, size); break;
    case 'grifball_stadium': drawGrifballStadiumSky(ctx, hue, brightness, fogColor, size); break;
    case 'holodeck': drawHolodeckSky(ctx, hue, brightness, fogColor, size); break;
    case 'rust': drawRustSky(ctx, hue, brightness, fogColor, size); break;
    case 'toxic': drawToxicSky(ctx, hue, brightness, fogColor, size); break;
    case 'inferno': drawInfernoSky(ctx, hue, brightness, fogColor, size); break;
    case 'matrix': drawMatrixSky(ctx, hue, brightness, fogColor, size); break;
    case 'nebula': drawNebulaSky(ctx, hue, brightness, fogColor, size); break;
  }
}

function drawCyberpunkSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.52;
  drawNoiseSpecks(ctx, width, horizon * 0.62, size.quality === 'hd' ? 620 : 320, 'rgba(255,255,255,0.28)', 1.4);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    const x = width * (0.08 + i * 0.145);
    const beam = ctx.createLinearGradient(x, horizon, x + width * 0.08, 0);
    beam.addColorStop(0, i % 2 === 0 ? 'rgba(6,182,212,0.32)' : 'rgba(236,72,153,0.28)');
    beam.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.01, horizon);
    ctx.lineTo(x + width * 0.08, 0);
    ctx.lineTo(x + width * 0.15, 0);
    ctx.lineTo(x + width * 0.02, horizon);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = `rgba(${layer === 0 ? '4,7,18' : '10,5,25'}, ${0.78 - layer * 0.14})`;
    for (let i = 0; i < 28; i++) {
      const w = width * (0.018 + ((i * 17 + layer * 5) % 35) / 3000);
      const h = height * (0.08 + ((i * 29 + layer * 11) % 140) / 1000);
      const x = (i * width * 0.041 + layer * width * 0.019) % width;
      const y = horizon - h + layer * height * 0.035;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(6,182,212,0.55)' : 'rgba(236,72,153,0.48)';
      for (let wy = y + h * 0.14; wy < y + h * 0.86; wy += height * 0.018) {
        ctx.fillRect(x + w * 0.18, wy, w * 0.16, height * 0.003);
        ctx.fillRect(x + w * 0.58, wy + height * 0.004, w * 0.18, height * 0.003);
      }
      ctx.fillStyle = `rgba(${layer === 0 ? '4,7,18' : '10,5,25'}, ${0.78 - layer * 0.14})`;
    }
  }

  strokePath(ctx, 'rgba(6,182,212,0.28)', height * 0.003, Array.from({ length: 18 }, (_, i) => [i * width / 17, horizon + Math.sin(i * 0.9) * height * 0.015]));
  void brightness;
  void fogColor;
  void hue;
}

function drawHangarSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.54;
  ctx.save();
  ctx.strokeStyle = 'rgba(71,85,105,0.62)';
  ctx.lineWidth = height * 0.01;
  for (let x = -width * 0.08; x < width * 1.08; x += width * 0.12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width * 0.08, horizon);
    ctx.moveTo(x + width * 0.08, 0);
    ctx.lineTo(x, horizon);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.32)';
  ctx.lineWidth = height * 0.004;
  for (let y = height * 0.06; y < horizon; y += height * 0.075) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + Math.sin(y * 0.01) * height * 0.015);
    ctx.stroke();
  }

  const cx = width * 0.5;
  const cy = height * 0.23;
  const r = height * 0.19;
  ctx.strokeStyle = 'rgba(2,6,23,0.95)';
  ctx.lineWidth = height * 0.035;
  fillCircle(ctx, cx, cy, r * 1.12, 'rgba(2,6,23,0.72)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  const planet = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.04, cx, cy, r);
  planet.addColorStop(0, '#7dd3fc');
  planet.addColorStop(0.38, '#2563eb');
  planet.addColorStop(0.72, '#1e1b4b');
  planet.addColorStop(1, '#020617');
  ctx.fillStyle = planet;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.strokeStyle = 'rgba(224,242,254,0.26)';
  ctx.lineWidth = height * 0.018;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + i * height * 0.012, r * (0.92 - i * 0.08), height * 0.03, -Math.PI / 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  drawNoiseSpecks(ctx, width, horizon, 220, 'rgba(186,230,253,0.3)', 1.3);
  void hue;
  void brightness;
  void fogColor;
}

function drawNatureSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.55;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const sun = ctx.createRadialGradient(width * 0.16, height * 0.12, 4, width * 0.16, height * 0.12, width * 0.38);
  sun.addColorStop(0, 'rgba(254,240,138,0.52)');
  sun.addColorStop(1, 'rgba(254,240,138,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  for (let i = 0; i < 38; i++) {
    fillCircle(ctx, (i * 251) % width, (i * 97) % (height * 0.24), height * (0.045 + (i % 9) * 0.006), 'rgba(6,78,59,0.42)');
  }
  drawJaggedHorizon(ctx, width, horizon, height * 0.13, height * 0.045, 'rgba(12,74,50,0.72)', width * 0.035, 1.3);
  drawJaggedHorizon(ctx, width, horizon + height * 0.045, height * 0.08, height * 0.03, 'rgba(20,83,45,0.82)', width * 0.025, 3.2);
  ctx.fillStyle = 'rgba(15,23,42,0.45)';
  for (let i = 0; i < 8; i++) {
    const x = width * (0.18 + i * 0.09);
    const y = height * (0.18 + (i % 3) * 0.035);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + width * 0.012, y - height * 0.012, x + width * 0.024, y);
    ctx.quadraticCurveTo(x + width * 0.036, y - height * 0.012, x + width * 0.048, y);
    ctx.fill();
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawSpaceSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.62;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);
  drawNoiseSpecks(ctx, width, horizon, size.quality === 'hd' ? 1400 : 700, 'rgba(255,255,255,0.86)', 1.2);
  drawNoiseSpecks(ctx, width, horizon, size.quality === 'hd' ? 420 : 220, 'rgba(125,211,252,0.55)', 1.8);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const colors = ['rgba(6,182,212,0.28)', 'rgba(168,85,247,0.24)', 'rgba(244,114,182,0.18)'];
  colors.forEach((color, i) => {
    const cx = width * (0.25 + i * 0.25);
    const cy = height * (0.16 + i * 0.05);
    const neb = ctx.createRadialGradient(cx, cy, height * 0.02, cx, cy, height * (0.25 + i * 0.05));
    neb.addColorStop(0, color);
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, width, horizon);
  });
  ctx.restore();
  fillCircle(ctx, width * 0.78, height * 0.18, height * 0.045, '#c4b5fd');
  fillCircle(ctx, width * 0.765, height * 0.165, height * 0.044, '#020617');
  void hue;
  void brightness;
  void fogColor;
}

function drawFantasySky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.55;
  drawNoiseSpecks(ctx, width, horizon * 0.82, 360, 'rgba(255,255,255,0.42)', 1.2);
  fillCircle(ctx, width * 0.42, height * 0.18, height * 0.07, '#6ee7b7');
  fillCircle(ctx, width * 0.57, height * 0.22, height * 0.04, '#93c5fd');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    const aur = ctx.createLinearGradient(0, height * (0.15 + i * 0.05), width, height * (0.22 + i * 0.03));
    aur.addColorStop(0, 'rgba(16,185,129,0)');
    aur.addColorStop(0.45, i % 2 === 0 ? 'rgba(16,185,129,0.18)' : 'rgba(147,51,234,0.2)');
    aur.addColorStop(1, 'rgba(16,185,129,0)');
    ctx.strokeStyle = aur;
    ctx.lineWidth = height * 0.032;
    ctx.beginPath();
    ctx.moveTo(0, height * (0.18 + i * 0.05));
    for (let x = 0; x <= width; x += width * 0.03) {
      ctx.lineTo(x, height * (0.18 + i * 0.05) + Math.sin(x * 0.006 + i) * height * 0.04);
    }
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    const x = width * (0.08 + i * 0.16);
    const y = height * (0.37 + (i % 2) * 0.05);
    ctx.fillStyle = 'rgba(30,20,50,0.78)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width * 0.08, y - height * 0.01);
    ctx.lineTo(x + width * 0.065, y + height * 0.035);
    ctx.lineTo(x + width * 0.02, y + height * 0.05);
    ctx.closePath();
    ctx.fill();
    fillCircle(ctx, x + width * 0.045, y - height * 0.01, height * 0.01, 'rgba(167,243,208,0.65)');
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawForerunnerSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.55;
  drawJaggedHorizon(ctx, width, horizon, height * 0.16, height * 0.04, 'rgba(88,54,12,0.5)', width * 0.04, 0.7);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    const x = width * (0.08 + i * 0.14);
    const beam = ctx.createLinearGradient(x - height * 0.008, 0, x + height * 0.008, 0);
    beam.addColorStop(0, 'rgba(251,191,36,0)');
    beam.addColorStop(0.5, 'rgba(251,191,36,0.42)');
    beam.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = beam;
    ctx.fillRect(x - height * 0.01, 0, height * 0.02, horizon - height * 0.12);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(17,24,39,0.92)';
  ctx.strokeStyle = 'rgba(251,191,36,0.6)';
  ctx.lineWidth = height * 0.004;
  for (let i = 0; i < 9; i++) {
    const x = width * (0.04 + i * 0.115);
    const h = height * (0.16 + (i % 4) * 0.035);
    ctx.beginPath();
    ctx.moveTo(x - height * 0.018, horizon);
    ctx.lineTo(x, horizon - h);
    ctx.lineTo(x + height * 0.018, horizon);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = width * (0.16 + i * 0.17);
    const y = height * (0.13 + (i % 2) * 0.06);
    ctx.fillStyle = 'rgba(31,41,55,0.84)';
    ctx.fillRect(x, y, width * 0.08, height * 0.035);
    ctx.strokeStyle = 'rgba(251,191,36,0.45)';
    ctx.strokeRect(x + width * 0.006, y + height * 0.005, width * 0.068, height * 0.025);
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawSynthwaveSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.56;
  drawNoiseSpecks(ctx, width, horizon * 0.75, 360, 'rgba(255,255,255,0.55)', 1.1);
  const sunX = width * 0.5;
  const sunY = horizon * 0.68;
  const sunR = height * 0.13;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, height * 0.015, sunX, sunY, sunR);
  sunGrad.addColorStop(0, '#fde68a');
  sunGrad.addColorStop(0.45, '#fb7185');
  sunGrad.addColorStop(1, 'rgba(236,72,153,0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(236,72,153,0.5)';
  ctx.lineWidth = height * 0.003;
  for (let x = 0; x <= width; x += width * 0.035) {
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    ctx.lineTo(width * 0.5 + (x - width * 0.5) * 1.8, height);
    ctx.stroke();
  }
  for (let y = horizon; y <= height; y += height * 0.035) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  drawJaggedHorizon(ctx, width, horizon, height * 0.08, height * 0.03, 'rgba(20,10,45,0.82)', width * 0.035, 4.1);
  void hue;
  void brightness;
  void fogColor;
}

function drawRainyStreetsSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.58;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(15,23,42,0.36)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = `rgba(3,7,18,${0.74 - layer * 0.12})`;
    for (let i = 0; i < 22; i++) {
      const x = (i * width * 0.054 + layer * width * 0.025) % width;
      const w = width * (0.024 + ((i * 13) % 20) / 1200);
      const h = height * (0.12 + ((i * 23) % 120) / 700);
      const y = horizon - h + layer * height * 0.04;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(251,191,36,0.42)' : 'rgba(6,182,212,0.32)';
      for (let wy = y + height * 0.02; wy < horizon - height * 0.02; wy += height * 0.024) {
        for (let wx = x + width * 0.004; wx < x + w - width * 0.004; wx += width * 0.012) {
          if (((wx + wy + i) % 7) < 2) ctx.fillRect(wx, wy, width * 0.004, height * 0.006);
        }
      }
      ctx.fillStyle = `rgba(3,7,18,${0.74 - layer * 0.12})`;
    }
  }
  ctx.strokeStyle = 'rgba(125,211,252,0.24)';
  ctx.lineWidth = height * 0.002;
  for (let i = 0; i < 90; i++) {
    const x = (i * 137) % width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - width * 0.04, height);
    ctx.stroke();
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawWinterRinkSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.56;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    const aurGrad = ctx.createLinearGradient(0, height * (0.08 + i * 0.04), width, height * (0.2 + i * 0.04));
    aurGrad.addColorStop(0, 'rgba(52,211,153,0)');
    aurGrad.addColorStop(0.5, i % 2 === 0 ? 'rgba(52,211,153,0.34)' : 'rgba(96,165,250,0.28)');
    aurGrad.addColorStop(1, 'rgba(52,211,153,0)');
    ctx.strokeStyle = aurGrad;
    ctx.lineWidth = height * 0.04;
    ctx.beginPath();
    ctx.moveTo(0, height * (0.13 + i * 0.045));
    for (let x = 0; x <= width; x += width * 0.025) {
      ctx.lineTo(x, height * (0.13 + i * 0.045) + Math.sin(x * 0.006 + i) * height * 0.045);
    }
    ctx.stroke();
  }
  ctx.restore();
  drawNoiseSpecks(ctx, width, horizon, 340, 'rgba(255,255,255,0.5)', 1.2);
  drawJaggedHorizon(ctx, width, horizon, height * 0.18, height * 0.07, 'rgba(30,41,59,0.72)', width * 0.04, 0);
  drawJaggedHorizon(ctx, width, horizon + height * 0.04, height * 0.12, height * 0.05, 'rgba(219,234,254,0.82)', width * 0.03, 2);
  void hue;
  void brightness;
  void fogColor;
}

function drawGrifballStadiumSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.58;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 8; i++) {
    const sx = width * (0.06 + i * 0.13);
    const spotGrad = ctx.createLinearGradient(sx, horizon, sx + width * 0.08, 0);
    spotGrad.addColorStop(0, 'rgba(224,242,254,0.36)');
    spotGrad.addColorStop(1, 'rgba(224,242,254,0)');
    ctx.fillStyle = spotGrad;
    ctx.beginPath();
    ctx.moveTo(sx - width * 0.02, horizon);
    ctx.lineTo(sx + width * 0.06, 0);
    ctx.lineTo(sx + width * 0.13, 0);
    ctx.lineTo(sx + width * 0.025, horizon);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(8,13,22,0.9)';
  ctx.fillRect(0, horizon - height * 0.09, width, height * 0.09);
  ctx.fillStyle = 'rgba(15,23,42,0.95)';
  ctx.fillRect(width * 0.38, horizon - height * 0.2, width * 0.24, height * 0.085);
  ctx.fillStyle = 'rgba(6,182,212,0.5)';
  ctx.fillRect(width * 0.405, horizon - height * 0.18, width * 0.07, height * 0.035);
  ctx.fillStyle = 'rgba(239,68,68,0.5)';
  ctx.fillRect(width * 0.525, horizon - height * 0.18, width * 0.07, height * 0.035);
  ctx.strokeStyle = 'rgba(148,163,184,0.5)';
  ctx.lineWidth = height * 0.008;
  for (let y = height * 0.05; y < horizon - height * 0.12; y += height * 0.055) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawHolodeckSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  ctx.save();
  ctx.shadowColor = '#eab308';
  ctx.shadowBlur = height * 0.008;
  ctx.strokeStyle = 'rgba(234,179,8,0.58)';
  ctx.lineWidth = height * 0.002;
  for (let x = 0; x <= width; x += width / 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += height / 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(34,211,238,0.35)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(width * 0.5, height * 0.5, width * (0.08 + i * 0.07), height * (0.04 + i * 0.035), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  void hue;
  void brightness;
  void fogColor;
}

function drawRustSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.57;
  fillCircle(ctx, width * 0.52, height * 0.34, height * 0.13, 'rgba(251,146,60,0.3)');
  fillCircle(ctx, width * 0.52, height * 0.34, height * 0.07, 'rgba(255,237,213,0.72)');
  drawJaggedHorizon(ctx, width, horizon, height * 0.11, height * 0.055, 'rgba(44,24,16,0.78)', width * 0.035, 2.4);
  ctx.fillStyle = 'rgba(44,24,16,0.88)';
  for (let i = 0; i < 10; i++) {
    const x = width * (0.05 + i * 0.1);
    const h = height * (0.08 + (i % 4) * 0.035);
    ctx.fillRect(x, horizon - h, width * 0.012, h);
    ctx.fillRect(x - width * 0.025, horizon - h * 0.88, width * 0.07, height * 0.008);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(120,53,15,0.26)';
  for (let i = 0; i < 18; i++) {
    fillCircle(ctx, (i * 199) % width, height * (0.25 + (i % 5) * 0.05), height * (0.08 + (i % 3) * 0.03), 'rgba(120,53,15,0.16)');
  }
  ctx.restore();
  void hue;
  void brightness;
  void fogColor;
}

function drawToxicSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.58;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 14; i++) {
    const cx = (i * 281) % width;
    const cy = height * (0.2 + (i % 5) * 0.055);
    const cloud = ctx.createRadialGradient(cx, cy, height * 0.02, cx, cy, height * (0.11 + (i % 4) * 0.025));
    cloud.addColorStop(0, 'rgba(74,222,128,0.26)');
    cloud.addColorStop(1, 'rgba(74,222,128,0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(cx - height * 0.2, cy - height * 0.2, height * 0.4, height * 0.4);
  }
  ctx.restore();
  drawJaggedHorizon(ctx, width, horizon, height * 0.08, height * 0.04, 'rgba(20,30,20,0.9)', width * 0.035, 1.8);
  ctx.strokeStyle = 'rgba(20,30,20,0.9)';
  ctx.lineWidth = height * 0.006;
  for (let i = 0; i < 12; i++) {
    const x = width * (0.04 + i * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    ctx.lineTo(x + Math.sin(i) * width * 0.01, horizon - height * (0.11 + (i % 3) * 0.03));
    ctx.moveTo(x, horizon - height * 0.07);
    ctx.lineTo(x - width * 0.025, horizon - height * 0.11);
    ctx.moveTo(x, horizon - height * 0.06);
    ctx.lineTo(x + width * 0.03, horizon - height * 0.09);
    ctx.stroke();
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawInfernoSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.58;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const magma = ctx.createRadialGradient(width * 0.5, height * 0.34, height * 0.05, width * 0.5, height * 0.34, width * 0.38);
  magma.addColorStop(0, 'rgba(239,68,68,0.45)');
  magma.addColorStop(0.45, 'rgba(249,115,22,0.24)');
  magma.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = magma;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  drawJaggedHorizon(ctx, width, horizon, height * 0.18, height * 0.08, 'rgba(15,10,10,0.96)', width * 0.03, 1.2);
  ctx.strokeStyle = 'rgba(251,113,133,0.32)';
  ctx.lineWidth = height * 0.006;
  for (let i = 0; i < 8; i++) {
    const x = width * (0.08 + i * 0.12);
    strokePath(ctx, 'rgba(251,113,133,0.32)', height * 0.006, [
      [x, horizon - height * 0.16],
      [x + width * 0.018, horizon - height * 0.08],
      [x - width * 0.01, horizon - height * 0.03],
    ]);
  }
  drawNoiseSpecks(ctx, width, horizon, 260, 'rgba(253,186,116,0.55)', 1.8);
  void hue;
  void brightness;
  void fogColor;
}

function drawMatrixSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.64;
  ctx.fillStyle = 'rgba(0,8,4,0.52)';
  ctx.fillRect(0, 0, width, height);
  ctx.font = `bold ${Math.max(10, Math.round(height * 0.018))}px monospace`;
  for (let c = 0; c < 92; c++) {
    const x = (c * 71) % width;
    let y = (c * 41) % horizon;
    const length = 5 + (c % 12);
    for (let j = 0; j < length; j++) {
      const char = ((c + j) % 3 === 0) ? '1' : '0';
      ctx.fillStyle = `rgba(34,197,94,${Math.max(0, 0.95 - j / length)})`;
      ctx.fillText(char, x, y);
      y += height * 0.023;
    }
  }
  ctx.strokeStyle = 'rgba(34,197,94,0.28)';
  ctx.lineWidth = height * 0.003;
  for (let x = 0; x < width; x += width * 0.04) {
    ctx.beginPath();
    ctx.moveTo(x, horizon - height * 0.14);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  void hue;
  void brightness;
  void fogColor;
}

function drawNebulaSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string, size: SkyboxTextureSize): void {
  const { width, height } = size;
  const horizon = height * 0.66;
  drawSpaceSky(ctx, hue, brightness, fogColor, size);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const river = ctx.createLinearGradient(width * 0.12, height * 0.05, width * 0.88, height * 0.34);
  river.addColorStop(0, 'rgba(14,165,233,0)');
  river.addColorStop(0.35, 'rgba(14,165,233,0.22)');
  river.addColorStop(0.7, 'rgba(217,70,239,0.22)');
  river.addColorStop(1, 'rgba(217,70,239,0)');
  ctx.strokeStyle = river;
  ctx.lineWidth = height * 0.12;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.25);
  for (let x = 0; x <= width; x += width * 0.03) {
    ctx.lineTo(x, height * 0.25 + Math.sin(x * 0.004) * height * 0.08);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(253,224,71,0.28)';
  ctx.lineWidth = height * 0.02;
  ctx.beginPath();
  ctx.ellipse(width * 0.52, height * 0.25, width * 0.43, height * 0.065, -Math.PI / 9, 0, Math.PI * 2);
  ctx.stroke();
  fillCircle(ctx, width * 0.31, height * 0.17, height * 0.045, '#dc2626');
  fillCircle(ctx, width * 0.77, height * 0.27, height * 0.034, '#0d9488');
  drawNoiseSpecks(ctx, width, horizon, 280, 'rgba(254,240,138,0.48)', 1.4);
}
