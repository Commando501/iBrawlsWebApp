/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

// Cache to prevent recreating canvas textures on every render tick
const skyboxTextureCache = new Map<string, THREE.Texture>();

/**
 * Generates a high-fidelity procedural canvas texture for the sky dome.
 * Performs caching based on the hash key composed of parameters.
 */
export function getSkyboxTexture(
  type: string,
  hue: number,
  brightness: number,
  fogColor: string
): THREE.Texture {
  const cacheKey = `${type}_${hue}_${brightness}_${fogColor}`;
  if (skyboxTextureCache.has(cacheKey)) {
    return skyboxTextureCache.get(cacheKey)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Resolve base sky color and horizon color from hue and brightness
  const skyColor = `hsl(${hue}, 75%, ${Math.min(100, Math.max(0, brightness * 4.5))}%)`;
  const horizonColor = `hsl(${hue}, 60%, ${Math.min(100, Math.max(0, brightness * 10))}%)`;

  // Draw Sky Gradients
  // Top half: sky to horizon
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, skyColor);
  skyGrad.addColorStop(1, horizonColor);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, 1024, 256);

  // Bottom half: horizon to fog (seam blending)
  const groundGrad = ctx.createLinearGradient(0, 256, 0, 512);
  groundGrad.addColorStop(0, horizonColor);
  groundGrad.addColorStop(1, fogColor);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, 256, 1024, 256);

  // Draw theme-specific scenery
  switch (type) {
    case 'cyberpunk':
      drawCyberpunkSky(ctx, hue, brightness, fogColor);
      break;
    case 'hangar':
      drawHangarSky(ctx, hue, brightness, fogColor);
      break;
    case 'nature':
      drawNatureSky(ctx, hue, brightness, fogColor);
      break;
    case 'space':
      drawSpaceSky(ctx, hue, brightness, fogColor);
      break;
    case 'fantasy':
      drawFantasySky(ctx, hue, brightness, fogColor);
      break;
    case 'forerunner':
      drawForerunnerSky(ctx, hue, brightness, fogColor);
      break;
    case 'synthwave':
      drawSynthwaveSky(ctx, hue, brightness, fogColor);
      break;
    case 'rainy_streets':
      drawRainyStreetsSky(ctx, hue, brightness, fogColor);
      break;
    case 'winter_rink':
      drawWinterRinkSky(ctx, hue, brightness, fogColor);
      break;
    case 'grifball_stadium':
      drawGrifballStadiumSky(ctx, hue, brightness, fogColor);
      break;
    case 'holodeck':
      drawHolodeckSky(ctx, hue, brightness, fogColor);
      break;
    case 'rust':
      drawRustSky(ctx, hue, brightness, fogColor);
      break;

    // Premium Extra Themes
    case 'toxic':
      drawToxicSky(ctx, hue, brightness, fogColor);
      break;
    case 'inferno':
      drawInfernoSky(ctx, hue, brightness, fogColor);
      break;
    case 'matrix':
      drawMatrixSky(ctx, hue, brightness, fogColor);
      break;
    case 'nebula':
      drawNebulaSky(ctx, hue, brightness, fogColor);
      break;
    default:
      drawCyberpunkSky(ctx, hue, brightness, fogColor);
      break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  skyboxTextureCache.set(cacheKey, texture);
  return texture;
}

function drawCyberpunkSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Digital star particles in upper half
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % 1024;
    const y = (i * 17) % 220;
    ctx.fillRect(x, y, 2, 2);
  }

  // Circuits along the horizon (y = 210 to 256)
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)'; // neon cyan
  ctx.lineWidth = 1.5;
  for (let x = 0; x < 1024; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 210);
    ctx.lineTo(x + ((x * 7) % 30) - 15, 256);
    ctx.stroke();
  }
  // Horizontal lines
  for (let y = 210; y < 256; y += 12) {
    ctx.strokeStyle = `rgba(236, 72, 153, ${Math.max(0.1, (y - 210) / 100)})`; // pink
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
  }

  // Skyscraper blocks
  ctx.fillStyle = 'rgba(10, 5, 20, 0.6)';
  for (let i = 0; i < 15; i++) {
    const w = 40 + ((i * 13) % 50);
    const h = 50 + ((i * 19) % 80);
    const x = (i * 81) % 950;
    const y = 256 - h;
    ctx.fillRect(x, y, w, h);
    // Neon accents on buildings
    ctx.fillStyle = i % 2 === 0 ? 'rgba(6, 182, 212, 0.5)' : 'rgba(236, 72, 153, 0.5)';
    ctx.fillRect(x + w / 2 - 2, y, 4, h * 0.4);
  }
}

function drawHangarSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Scaffolding truss structures
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
  ctx.lineWidth = 4;
  for (let x = 60; x < 1024; x += 180) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 80, 256);
    ctx.moveTo(x + 80, 0); ctx.lineTo(x, 256);
    ctx.stroke();
  }

  // Viewport showing orbital planet
  const cx = 512, cy = 128, r = 90;
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.clip();
  const gasGrad = ctx.createRadialGradient(cx - 30, cy - 30, 5, cx, cy, r);
  gasGrad.addColorStop(0, '#38bdf8');
  gasGrad.addColorStop(0.6, '#1e3a8a');
  gasGrad.addColorStop(1, '#020617');
  ctx.fillStyle = gasGrad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(224, 242, 254, 0.25)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r - 20, 20, -Math.PI / 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNatureSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Sunbeams
  const beamGrad = ctx.createRadialGradient(100, 40, 5, 100, 40, 400);
  beamGrad.addColorStop(0, 'rgba(254, 240, 138, 0.35)');
  beamGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
  ctx.fillStyle = beamGrad;
  ctx.beginPath(); ctx.arc(100, 40, 400, 0, Math.PI * 2); ctx.fill();

  // Canopy branches
  ctx.fillStyle = 'rgba(6, 78, 59, 0.4)'; // forest dark green
  for (let i = 0; i < 25; i++) {
    const rx = (i * 47) % 1024;
    const ry = (i * 7) % 80;
    const rd = 40 + ((i * 11) % 60);
    ctx.beginPath(); ctx.arc(rx, ry, rd, 0, Math.PI * 2); ctx.fill();
  }

  // Distant jungle canopy on horizon
  ctx.fillStyle = 'rgba(20, 83, 45, 0.5)';
  ctx.beginPath();
  ctx.moveTo(0, 256);
  for (let x = 0; x <= 1024; x += 40) {
    const y = 256 - (30 + Math.sin(x * 0.02) * 20 + Math.cos(x * 0.01) * 15);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(1024, 256);
  ctx.closePath();
  ctx.fill();

  // Tiny silhouetted birds
  ctx.fillStyle = 'rgba(20, 83, 45, 0.6)';
  for (let i = 0; i < 5; i++) {
    const bx = 200 + i * 150;
    const by = 80 + (i % 2 === 0 ? 20 : -10);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + 10, by - 8, bx + 20, by);
    ctx.quadraticCurveTo(bx + 30, by - 8, bx + 40, by);
    ctx.quadraticCurveTo(bx + 20, by + 5, bx, by);
    ctx.fill();
  }
}

function drawSpaceSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Heavy starry field
  for (let i = 0; i < 200; i++) {
    const x = (i * 79) % 1024;
    const y = (i * 23) % 320;
    const size = i % 10 === 0 ? 1.8 : 1.0;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + ((i * 7) % 8) / 10})`;
    ctx.fillRect(x, y, size, size);
  }

  // Swirling cyan & purple deep space nebulas
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // Nebula 1: Cyan
  const neb1 = ctx.createRadialGradient(300, 120, 20, 300, 120, 180);
  neb1.addColorStop(0, 'rgba(6, 182, 212, 0.15)');
  neb1.addColorStop(1, 'rgba(6, 182, 212, 0)');
  ctx.fillStyle = neb1;
  ctx.beginPath(); ctx.arc(300, 120, 180, 0, Math.PI * 2); ctx.fill();

  // Nebula 2: Purple
  const neb2 = ctx.createRadialGradient(700, 100, 30, 700, 100, 220);
  neb2.addColorStop(0, 'rgba(168, 85, 247, 0.18)');
  neb2.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.fillStyle = neb2;
  ctx.beginPath(); ctx.arc(700, 100, 220, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawFantasySky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Twinkling stars
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (let i = 0; i < 60; i++) {
    ctx.fillRect((i * 47) % 1024, (i * 19) % 240, 1.2, 1.2);
  }

  // Emerald Moon
  const m1x = 420, m1y = 90, m1r = 45;
  const grad1 = ctx.createRadialGradient(m1x - 10, m1y - 10, 5, m1x, m1y, m1r);
  grad1.addColorStop(0, '#a7f3d0');
  grad1.addColorStop(0.7, '#047857');
  grad1.addColorStop(1, '#022c22');
  ctx.fillStyle = grad1;
  ctx.beginPath(); ctx.arc(m1x, m1y, m1r, 0, Math.PI * 2); ctx.fill();

  // Sapphire Moon
  const m2x = 580, m2y = 110, m2r = 25;
  const grad2 = ctx.createRadialGradient(m2x - 5, m2y - 5, 2, m2x, m2y, m2r);
  grad2.addColorStop(0, '#bfdbfe');
  grad2.addColorStop(0.7, '#1d4ed8');
  grad2.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = grad2;
  ctx.beginPath(); ctx.arc(m2x, m2y, m2r, 0, Math.PI * 2); ctx.fill();

  // Floating islands
  ctx.fillStyle = 'rgba(30, 20, 50, 0.75)';
  // Island 1
  ctx.beginPath();
  ctx.moveTo(150, 180);
  ctx.lineTo(250, 180);
  ctx.lineTo(220, 205);
  ctx.lineTo(170, 200);
  ctx.closePath(); ctx.fill();
  // Island 2
  ctx.beginPath();
  ctx.moveTo(750, 170);
  ctx.lineTo(870, 170);
  ctx.lineTo(840, 192);
  ctx.lineTo(780, 188);
  ctx.closePath(); ctx.fill();
}

function drawForerunnerSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Architectural floating monolith blocks
  ctx.fillStyle = 'rgba(31, 41, 55, 0.85)';
  ctx.fillRect(180, 50, 90, 45);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'; // golden yellow lines
  ctx.lineWidth = 2;
  ctx.strokeRect(185, 55, 80, 35);
  
  ctx.fillRect(720, 60, 120, 30);
  ctx.strokeRect(725, 65, 110, 20);

  // Spires projecting energy beams
  ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
  const spireXs = [120, 380, 640, 900];
  spireXs.forEach(sx => {
    ctx.beginPath();
    ctx.moveTo(sx - 15, 256);
    ctx.lineTo(sx, 160);
    ctx.lineTo(sx + 15, 256);
    ctx.fill();

    const beamGrad = ctx.createLinearGradient(sx - 4, 0, sx + 4, 0);
    beamGrad.addColorStop(0, 'rgba(251, 191, 36, 0)');
    beamGrad.addColorStop(0.5, 'rgba(251, 191, 36, 0.4)');
    beamGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(sx - 4, 0, 8, 160);
  });
}

function drawSynthwaveSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Starry retro sky
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  for (let i = 0; i < 50; i++) {
    ctx.fillRect((i * 61) % 1024, (i * 13) % 200, 1, 1);
  }

  // Receding horizon wiregrid
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.35)'; // neon pink grid
  ctx.lineWidth = 1.2;
  for (let x = 0; x <= 1024; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 210);
    ctx.lineTo(x + (x - 512) * 0.45, 256);
    ctx.stroke();
  }
  for (let y = 210; y <= 256; y += 8) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
  }
}

function drawRainyStreetsSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Towering skyscraper outlines
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  for (let i = 0; i < 12; i++) {
    const x = 20 + i * 85;
    const w = 45 + ((i * 17) % 25);
    const h = 80 + ((i * 29) % 100);
    ctx.fillRect(x, 256 - h, w, h);

    // Grid of windows
    ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
    for (let wx = x + 8; wx < x + w - 8; wx += 12) {
      for (let wy = 256 - h + 15; wy < 240; wy += 18) {
        if (((wx + wy) % 5) < 2) {
          ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; // restore
  }
}

function drawWinterRinkSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Snowy mountains
  ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
  ctx.beginPath();
  ctx.moveTo(0, 256);
  for (let x = 0; x <= 1024; x += 60) {
    const y = 256 - (40 + Math.sin(x * 0.015) * 35 + Math.cos(x * 0.007) * 25);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(1024, 256);
  ctx.closePath();
  ctx.fill();

  // Wavy Northern Lights
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const aurGrad = ctx.createLinearGradient(0, 40, 0, 160);
  aurGrad.addColorStop(0, 'rgba(52, 211, 153, 0)');
  aurGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.35)');
  aurGrad.addColorStop(1, 'rgba(52, 211, 153, 0)');
  ctx.fillStyle = aurGrad;
  ctx.beginPath();
  ctx.moveTo(0, 80);
  for (let x = 0; x <= 1024; x += 10) {
    const y = 80 + Math.sin(x * 0.007 + 1.2) * 35 + Math.cos(x * 0.003) * 15;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(1024, 160);
  for (let x = 1024; x >= 0; x -= 10) {
    const y = 120 + Math.sin(x * 0.007 + 1.2) * 35 + Math.cos(x * 0.003) * 15;
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGrifballStadiumSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Spotlight beam cones
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const spotlightXs = [180, 480, 780];
  spotlightXs.forEach(sx => {
    const spotGrad = ctx.createLinearGradient(sx, 256, sx + 80, 0);
    spotGrad.addColorStop(0, 'rgba(224, 242, 254, 0.35)');
    spotGrad.addColorStop(1, 'rgba(224, 242, 254, 0)');
    ctx.fillStyle = spotGrad;
    ctx.beginPath();
    ctx.moveTo(sx - 10, 256);
    ctx.lineTo(sx + 120, 0);
    ctx.lineTo(sx + 240, 0);
    ctx.lineTo(sx + 10, 256);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  // Metal structural frames
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 30); ctx.lineTo(1024, 30);
  ctx.moveTo(0, 60); ctx.lineTo(1024, 60);
  for (let x = 0; x < 1024; x += 100) {
    ctx.moveTo(x, 30); ctx.lineTo(x + 50, 60);
    ctx.moveTo(x + 50, 30); ctx.lineTo(x, 60);
  }
  ctx.stroke();
}

function drawHolodeckSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  ctx.strokeStyle = '#eab308'; // glowing yellow coordinate grid
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#eab308';
  ctx.shadowBlur = 4;

  for (let x = 0; x <= 1024; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  for (let y = 0; y <= 512; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawRustSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Giant dusty sun
  const sunx = 512, suny = 200, sunr = 60;
  const sGrad = ctx.createRadialGradient(sunx - 10, suny - 10, 5, sunx, suny, sunr);
  sGrad.addColorStop(0, 'rgba(255, 237, 213, 0.85)');
  sGrad.addColorStop(0.6, 'rgba(251, 146, 60, 0.4)');
  sGrad.addColorStop(1, 'rgba(251, 146, 60, 0)');
  ctx.fillStyle = sGrad;
  ctx.beginPath(); ctx.arc(sunx, suny, sunr * 1.5, 0, Math.PI * 2); ctx.fill();

  // Ruined cranes & smokestacks
  ctx.fillStyle = 'rgba(44, 24, 16, 0.8)';
  ctx.fillRect(200, 160, 15, 96);
  ctx.beginPath();
  ctx.moveTo(200, 165); ctx.lineTo(120, 120); ctx.lineTo(120, 130); ctx.lineTo(200, 180);
  ctx.fill();

  ctx.fillRect(750, 150, 80, 106);
  ctx.fillRect(770, 100, 20, 50); // smokestack
  ctx.fillRect(810, 80, 15, 70); // smokestack 2
}

// ─── PREMIUM EXTRA THEMES ──────────────────────────────────────────────────

function drawToxicSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Sickly green radioactive smog clouds
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(74, 222, 128, 0.15)';
  for (let i = 0; i < 12; i++) {
    const rx = (i * 97) % 1024;
    const ry = 120 + ((i * 19) % 80);
    const rd = 80 + ((i * 31) % 100);
    ctx.beginPath(); ctx.arc(rx, ry, rd, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Dead trees silhouette
  ctx.fillStyle = 'rgba(20, 30, 20, 0.85)';
  const treeXs = [150, 320, 550, 780, 920];
  treeXs.forEach(tx => {
    ctx.beginPath();
    ctx.moveTo(tx - 4, 256);
    ctx.lineTo(tx, 180);
    ctx.lineTo(tx + 4, 256);
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(20, 30, 20, 0.85)';
    ctx.beginPath();
    ctx.moveTo(tx, 200); ctx.lineTo(tx - 25, 175);
    ctx.moveTo(tx, 215); ctx.lineTo(tx + 30, 195);
    ctx.stroke();
  });
}

function drawInfernoSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Magma glowing sky reflection
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const magmaGrad = ctx.createRadialGradient(512, 150, 50, 512, 150, 300);
  magmaGrad.addColorStop(0, 'rgba(239, 68, 68, 0.35)'); // fiery red
  magmaGrad.addColorStop(0.5, 'rgba(249, 115, 22, 0.18)'); // hot orange
  magmaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = magmaGrad;
  ctx.beginPath(); ctx.arc(512, 150, 300, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Jagged basalt peaks
  ctx.fillStyle = 'rgba(15, 10, 10, 0.95)';
  ctx.beginPath();
  ctx.moveTo(0, 256);
  for (let x = 0; x <= 1024; x += 50) {
    const y = 256 - (50 + Math.sin(x * 0.02) * 35 + Math.cos(x * 0.01) * 20);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(1024, 256);
  ctx.closePath();
  ctx.fill();
}

function drawMatrixSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Cascading binary digit rain
  ctx.font = 'bold 9px monospace';
  for (let c = 0; c < 35; c++) {
    const x = (c * 31) % 1024;
    let y = (c * 17) % 200;
    const length = 4 + (c % 8);
    for (let j = 0; j < length; j++) {
      const char = ((c + j) % 2 === 0) ? '0' : '1';
      ctx.fillStyle = `rgba(34, 197, 94, ${1.0 - (j / length)})`;
      ctx.fillText(char, x, y);
      y += 11;
    }
  }

  // Glowing circuitry traces on horizon
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.22)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1024; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 220); ctx.lineTo(x, 256); ctx.stroke();
  }
}

function drawNebulaSky(ctx: CanvasRenderingContext2D, hue: number, brightness: number, fogColor: string) {
  // Diagonal golden planetary rings
  ctx.strokeStyle = 'rgba(253, 224, 71, 0.18)'; // golden ring
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(512, 128, 480, 60, -Math.PI / 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(253, 224, 71, 0.08)'; // fine ring
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(512, 128, 510, 65, -Math.PI / 8, 0, Math.PI * 2);
  ctx.stroke();

  // Dual orbiting planet/moons
  // Ruby planet
  const ax = 280, ay = 80, ar = 22;
  const ag = ctx.createRadialGradient(ax - 5, ay - 5, 2, ax, ay, ar);
  ag.addColorStop(0, '#fca5a5');
  ag.addColorStop(0.7, '#dc2626');
  ag.addColorStop(1, '#7f1d1d');
  ctx.fillStyle = ag;
  ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.fill();
  
  // Turquoise moon
  const bx = 780, by = 130, br = 18;
  const bg = ctx.createRadialGradient(bx - 3, by - 3, 2, bx, by, br);
  bg.addColorStop(0, '#99f6e4');
  bg.addColorStop(0.7, '#0d9488');
  bg.addColorStop(1, '#115e59');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
}
