import * as THREE from 'three';
import { type CustomMapObject } from '../../types';

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

// Helper: Create custom procedural textures dynamically using 2D HTML Canvas
export const generateCustomTexture = (type: string, baseColorHex: string): THREE.Texture => {
  const baseSize = 512;
  const resolution = 2048;
  const scaleFactor = resolution / baseSize;
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scaleFactor, scaleFactor);

  // Background fill
  ctx.fillStyle = baseColorHex;
  ctx.fillRect(0, 0, 512, 512);

  if (type === 'none') {
    // Plain matte texture, add subtle boundary bevel highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 512, 512);
  } else if (type === 'nature_grass') {
    // Grass blades on rich loam soil
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // light green blades
    ctx.lineWidth = 2;
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const len = 6 + Math.random() * 14;
      const tilt = -4 + Math.random() * 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + tilt, y - len);
      ctx.stroke();
    }
  } else if (type === 'nature_mossy_stone') {
    // High fidelity granite slate with weathered green moss patches
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(0, 0, 512, 512);
    
    // Granite mineral speckling detail
    ctx.fillStyle = '#374151';
    for (let i = 0; i < 800; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.0, 2.0);
    }
    
    // Stone fractures and fissures
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2.0;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      const startX = Math.random() * 512;
      const startY = Math.random() * 512;
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + (Math.random() - 0.5) * 60, startY + (Math.random() - 0.5) * 60);
      ctx.lineTo(startX + (Math.random() - 0.5) * 120, startY + (Math.random() - 0.5) * 120);
      ctx.stroke();
    }
    
    // Mossy vegetative growth overlays with textured double-tone borders
    for (let i = 0; i < 20; i++) {
      const mx = Math.random() * 512;
      const my = Math.random() * 512;
      const mr = 18 + Math.random() * 35;
      
      // Outer dark moss cushion
      ctx.fillStyle = '#064e3b';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner bright moss core
      ctx.fillStyle = baseColorHex; // light green
      ctx.beginPath();
      ctx.arc(mx, my, mr * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'nature_wood') {
    // Wood grain bark
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // light beige grain
    ctx.lineWidth = 4;
    for (let r = 24; r < 700; r += 28) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0.2, Math.PI * 2 - 0.2);
      ctx.stroke();
    }
  } else if (type === 'space_alloy') {
    // High fidelity starbase brushed alloy hull plates
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add brushed metallic micro-scratches
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1.0;
    for (let i = 0; i < 200; i++) {
      const sy = Math.random() * 512;
      const sx = Math.random() * 300;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 100 + Math.random() * 100, sy);
      ctx.stroke();
    }
    
    // Solid cyan grid line seams
    ctx.strokeStyle = baseColorHex; 
    ctx.lineWidth = 2.5;
    for (let idx = 0; idx <= 512; idx += 128) {
      ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
      
      // Outer highlight bevel shadow
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath(); ctx.moveTo(idx + 3, 0); ctx.lineTo(idx + 3, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, idx + 3); ctx.lineTo(512, idx + 3); ctx.stroke();
      ctx.strokeStyle = baseColorHex; // reset
    }
    
    // Double-layered steel rivets with bright metallic cores
    for (let rx = 16; rx < 512; rx += 128) {
      for (let ry = 16; ry < 512; ry += 128) {
        // Rivet outer shadow ring
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath(); ctx.arc(rx + 1, ry + 1.5, 4.5, 0, Math.PI * 2); ctx.fill();
        
        // Rivet body
        ctx.fillStyle = '#64748b'; 
        ctx.beginPath(); ctx.arc(rx, ry, 3.5, 0, Math.PI * 2); ctx.fill();
        
        // Rivet specular highlight dot
        ctx.fillStyle = '#ffffff'; 
        ctx.beginPath(); ctx.arc(rx - 1, ry - 1, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (type === 'space_meteorite') {
    // Dark meteor mineral with glowing veins
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = baseColorHex;
    ctx.shadowBlur = 12;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, 0);
      ctx.bezierCurveTo(Math.random() * 512, 170, Math.random() * 512, 340, Math.random() * 512, 512);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else if (type === 'space_lunar_dust') {
    // Lunar soil with fine craters
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = baseColorHex;
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 16, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'futuristic_carbon') {
    // Threaded carbon fiber weave
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 6) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
  } else if (type === 'futuristic_hex') {
    // Cyan hexagonal grid
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 2;
    const hexSizeVal = 32;
    const hexHeightVal = hexSizeVal * Math.sqrt(3);
    for (let y = 0; y < 512 + hexHeightVal; y += hexHeightVal) {
      for (let x = 0; x < 512 + hexSizeVal * 3; x += hexSizeVal * 3) {
        ctx.beginPath();
        for (let a = 0; a < 6; a++) {
          const angle = (a * Math.PI) / 3;
          const px = x + hexSizeVal * Math.cos(angle);
          const py = y + hexSizeVal * Math.sin(angle);
          if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();

        ctx.beginPath();
        for (let a = 0; a < 6; a++) {
          const angle = (a * Math.PI) / 3;
          const px = x + hexSizeVal * 1.5 + hexSizeVal * Math.cos(angle);
          const py = y + hexHeightVal / 2 + hexSizeVal * Math.sin(angle);
          if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  } else if (type === 'futuristic_shield') {
    // Glowing circular shield emitter
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 3.5;
    for (let r = 80; r <= 320; r += 80) {
      ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (type === 'city_asphalt') {
    // Rough dark tarmac asphalt
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = baseColorHex; // gravel speckles
    for (let i = 0; i < 1500; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.5, 2.5);
    }
  } else if (type === 'city_brick') {
    // Red industrial bricks
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // mortar seams
    ctx.lineWidth = 2.5;
    const bH = 24;
    const bW = 56;
    for (let y = 0; y < 512; y += bH) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      const offset = (y / bH) % 2 === 0 ? 0 : bW / 2;
      for (let x = offset; x < 512 + bW; x += bW) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bH); ctx.stroke();
      }
    }
  } else if (type === 'city_concrete') {
    // Grey aggregate concrete slabs with cracks
    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // cracks/joints
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, 0);
      ctx.lineTo(Math.random() * 512, 160);
      ctx.lineTo(Math.random() * 512, 360);
      ctx.lineTo(Math.random() * 512, 512);
      ctx.stroke();
    }
  } else if (type === 'fantasy_runed_stone') {
    // Glowing runic ancient carvings
    ctx.fillStyle = '#27272a';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // glow paint
    ctx.lineWidth = 5;
    ctx.shadowColor = baseColorHex;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(256, 80);
    ctx.lineTo(130, 390);
    ctx.lineTo(382, 390);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(256, 270, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (type === 'fantasy_cobble') {
    // Interlocking castle stones
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 3;
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 22 + Math.random() * 32, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (type === 'fantasy_gold') {
    // Scroll-worked highly reflective gold plates
    ctx.fillStyle = '#ca8a04';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 3.5;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 50 + Math.random() * 90, 0.4, 3.4);
      ctx.stroke();
    }
  } else if (type === 'forerunner_panel') {
    // Dark forerunner metallic alloy plates with golden circuit runs
    ctx.fillStyle = '#17191e';
    ctx.fillRect(0, 0, 512, 512);
    // Dark plate joints
    ctx.strokeStyle = '#282b35';
    ctx.lineWidth = 3.5;
    for (let idx = 0; idx <= 512; idx += 128) {
      ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
    }
    // Glowing gold circuit paths
    ctx.strokeStyle = baseColorHex;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = baseColorHex;
    ctx.shadowBlur = 8;
    for (let rx = 64; rx < 512; rx += 128) {
      for (let ry = 64; ry < 512; ry += 128) {
        ctx.strokeRect(rx - 22, ry - 22, 44, 44);
        ctx.beginPath();
        ctx.arc(rx, ry, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  } else if (type === 'forerunner_gold') {
    // Brushed forerunner gold plates with fine runic lines
    ctx.fillStyle = '#a16207'; // deep gold-bronze
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex; // bright glowing gold
    ctx.lineWidth = 2.8;
    ctx.shadowColor = baseColorHex;
    ctx.shadowBlur = 9;
    for (let i = 32; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, 512);
      ctx.moveTo(0, i); ctx.lineTo(512, i);
      ctx.stroke();
    }
    for (let x = 64; x < 512; x += 128) {
      for (let y = 64; y < 512; y += 128) {
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  } else if (type === 'synthwave_grid') {
    // Glowing cyan/pink grid
    ctx.fillStyle = '#06020f'; // deep black purple
    ctx.fillRect(0, 0, 512, 512);
    // Draw grid lines
    ctx.strokeStyle = '#06b6d4'; // neon cyan
    ctx.lineWidth = 3.5;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 10;
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    // Sub-grid highlights
    ctx.strokeStyle = '#ec4899'; // neon pink
    ctx.lineWidth = 1.0;
    ctx.shadowColor = '#ec4899';
    ctx.shadowBlur = 4;
    for (let i = 32; i < 512; i += 64) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else if (type === 'synthwave_neon_laser') {
    // Neon energy lines
    ctx.fillStyle = '#080214';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = baseColorHex || '#ec4899';
    ctx.lineWidth = 4.0;
    ctx.shadowColor = baseColorHex || '#ec4899';
    ctx.shadowBlur = 12;
    // Drawing diagonal neon laser strips
    for (let i = -256; i < 512; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 256, 512);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else if (type === 'synthwave_chrome') {
    // Horizon line chrome gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#06b6d4'); // cyber cyan sky
    grad.addColorStop(0.48, '#08041d'); // deep sky horizon border
    grad.addColorStop(0.5, '#ffffff'); // blinding horizon shine
    grad.addColorStop(0.52, '#d946ef'); // neon pink ground reflection
    grad.addColorStop(1, '#1e1b4b'); // deep reflection base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    // Add subtle horizontal metal grooves
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    for (let y = 32; y < 512; y += 48) {
      if (Math.abs(y - 256) > 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      }
    }
  } else if (type === 'rainy_streets_asphalt') {
    // Wet dark slate/charcoal grey tarmac asphalt
    ctx.fillStyle = '#0f121a';
    ctx.fillRect(0, 0, 512, 512);
    
    // Add gravel texture speckling
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 2000; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
    }
    
    // Shiny water puddles (slick specular maps)
    ctx.fillStyle = 'rgba(6, 182, 212, 0.05)'; // faint cyan water reflections
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * 512, Math.random() * 512, 45 + Math.random() * 55, 20 + Math.random() * 25, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(244, 63, 94, 0.04)'; // faint red/orange reflections
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.random() * 512, Math.random() * 512, 35 + Math.random() * 45, 15 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Rain droplets ripple rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Dark road slab panel seams
    ctx.strokeStyle = '#05070a';
    ctx.lineWidth = 4;
    for (let idx = 0; idx <= 512; idx += 256) {
      ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
    }
  } else if (type === 'rainy_streets_neon_glow') {
    // Heavy steel block with orange/amber glowing neon hazard borders
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, 0, 512, 512);
    
    ctx.strokeStyle = '#ea580c'; // glowing sodium orange
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ea580c';
    ctx.shadowBlur = 10;
    
    // Draw neon industrial warning bands
    ctx.strokeRect(20, 20, 472, 472);
    ctx.strokeRect(80, 80, 352, 352);
    
    // Diagonal warning stripes inside
    for (let i = 0; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 20);
      ctx.lineTo(i + 40, 80);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(i, 432);
      ctx.lineTo(i + 40, 492);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else if (type === 'rainy_streets_dog_billboard') {
    // High-tech glowing blue dog hologram billboard screen
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 512, 512);
    
    // Cyber scanlines
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 512; y += 8) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }
    
    // Draw the cute cybernetic geometric dog
    ctx.strokeStyle = '#06b6d4'; // neon cyan
    ctx.lineWidth = 5;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    // Head outline
    ctx.moveTo(190, 190);
    ctx.lineTo(322, 190);
    ctx.lineTo(340, 235);
    ctx.lineTo(322, 270);
    ctx.lineTo(190, 270);
    ctx.lineTo(172, 235);
    ctx.closePath();
    
    // Snout
    ctx.moveTo(322, 220);
    ctx.lineTo(365, 220);
    ctx.lineTo(365, 250);
    ctx.lineTo(322, 250);
    
    // Tech Collar
    ctx.moveTo(200, 270);
    ctx.lineTo(200, 295);
    ctx.lineTo(260, 295);
    ctx.lineTo(260, 270);
    
    // Pointy ears
    ctx.moveTo(200, 190);
    ctx.lineTo(175, 125);
    ctx.lineTo(225, 190);
    
    ctx.moveTo(312, 190);
    ctx.lineTo(337, 125);
    ctx.lineTo(287, 190);
    ctx.stroke();
    
    // Glowing Eye (white starburst/circle)
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(295, 215, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Neon banner texts
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ec4899'; // magenta pink
    ctx.fillStyle = '#f472b6';
    ctx.font = '900 38px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UPGRADE', 256, 410);
    
    ctx.shadowColor = '#06b6d4';
    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText("BRAWL'S BEST FRIEND", 256, 95);
    
    ctx.shadowBlur = 0;
  } else if (type === 'winter_ice') {
    // Pristine ice hockey rink layout
    ctx.fillStyle = '#e0f2fe'; // ice light blue
    ctx.fillRect(0, 0, 512, 512);

    // Skate scratch marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      ctx.beginPath();
      ctx.arc(
        Math.random() * 512, 
        Math.random() * 512, 
        15 + Math.random() * 45, 
        Math.random() * Math.PI, 
        Math.random() * Math.PI * 2
      );
      ctx.stroke();
    }

    // Red Goal Lines (at x = 45 and x = 512 - 45)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(45, 0); ctx.lineTo(45, 512);
    ctx.moveTo(512 - 45, 0); ctx.lineTo(512 - 45, 512);
    ctx.stroke();

    // Red Goal Creases (semi-circles facing inwards, radius 20)
    ctx.beginPath();
    ctx.arc(45, 256, 20, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(512 - 45, 256, 20, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();

    // Blue Lines (at x = 170 and x = 342)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(170, 0); ctx.lineTo(170, 512);
    ctx.moveTo(342, 0); ctx.lineTo(342, 512);
    ctx.stroke();

    // Red Center Line (at x = 256)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 512);
    ctx.stroke();

    // Blue Center Face-off Circle (radius 40, red dot)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(256, 256, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(256, 256, 5, 0, Math.PI * 2);
    ctx.fill();

    // Four Red Corner Face-off Circles with inner spots
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    const spots = [[115, 120], [115, 392], [397, 120], [397, 392]];
    spots.forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 25, 0, Math.PI * 2);
      ctx.stroke();
      // Inner spot
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (type === 'winter_snow') {
    // Powdery snow-covered surface
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 512, 512);
    // Crystal ice sparkles
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 500; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.5, 2.5);
    }
    // Soft blue wind drifts
    ctx.fillStyle = 'rgba(186, 230, 253, 0.25)'; // very soft sky-blue
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.ellipse(
        Math.random() * 512, 
        Math.random() * 512, 
        50 + Math.random() * 80, 
        12 + Math.random() * 20, 
        Math.random() * 0.2 - 0.1, 
        0, 
        Math.PI * 2
      );
      ctx.fill();
    }
  } else if (type === 'winter_glacier_glass') {
    // Translucent glacier frost glass
    ctx.fillStyle = 'rgba(147, 197, 253, 0.45)';
    ctx.fillRect(0, 0, 512, 512);
    // Fine crystal ice cracks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, 0);
      ctx.lineTo(Math.random() * 512, 140);
      ctx.lineTo(Math.random() * 512, 370);
      ctx.lineTo(Math.random() * 512, 512);
      ctx.stroke();
    }
  } else if (type === 'stadium_steel_grid') {
    // High-tech dark-grey industrial steel grid floor with team markings
    ctx.fillStyle = '#111318'; // Sleek dark metallic charcoal
    ctx.fillRect(0, 0, 512, 512);

    // Draw brushed steel plate seams (4x4 grids)
    ctx.strokeStyle = '#08090c';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 512; i += 128) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    // Draw diamond steel plating / tread plate indicators
    ctx.strokeStyle = '#2d3748'; // Steel grey rivets/treads
    ctx.lineWidth = 1.5;
    for (let x = 16; x < 512; x += 32) {
      for (let y = 16; y < 512; y += 32) {
        // Draw small diagonal slash marks
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4);
        ctx.lineTo(x + 4, y + 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 4);
        ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
      }
    }

    // Add sleek team floor lines: Blue West, Red East (split at center x = 256)
    // Draw blue hazard accents on left half
    ctx.strokeStyle = 'rgba(0, 136, 255, 0.4)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(32, 64); ctx.lineTo(192, 256); ctx.lineTo(32, 448);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(0, 136, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(32, 64); ctx.lineTo(192, 256); ctx.lineTo(32, 448);
    ctx.closePath();
    ctx.fill();

    // Draw red hazard accents on right half
    ctx.strokeStyle = 'rgba(255, 51, 68, 0.4)';
    ctx.beginPath();
    ctx.moveTo(480, 64); ctx.lineTo(320, 256); ctx.lineTo(480, 448);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(255, 51, 68, 0.08)';
    ctx.beginPath();
    ctx.moveTo(480, 64); ctx.lineTo(320, 256); ctx.lineTo(480, 448);
    ctx.closePath();
    ctx.fill();

    // Outer white safety border
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 500);

    // Middle division line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(256, 6); ctx.lineTo(256, 506);
    ctx.stroke();

    // Octagonal center plate
    ctx.fillStyle = '#1e222b';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const cx = 256, cy = 256, r = 70;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner glowing core ring in the center
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(256, 256, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff0055';
    ctx.beginPath();
    ctx.arc(256, 256, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'stadium_scoreboard_screen') {
    // Championship Central Scoreboard Screen
    ctx.fillStyle = '#06080e';
    ctx.fillRect(0, 0, 512, 512);

    // Draw left side blue, right side red
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, '#002244');
    grad.addColorStop(0.45, '#001122');
    grad.addColorStop(0.5, '#05070a');
    grad.addColorStop(0.55, '#220011');
    grad.addColorStop(1, '#440022');
    ctx.fillStyle = grad;
    ctx.fillRect(10, 10, 492, 492);

    // Tech Grid overlay
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.05)';
    ctx.lineWidth = 1.5;
    for (let i = 20; i < 500; i += 24) {
      ctx.beginPath(); ctx.moveTo(i, 10); ctx.lineTo(i, 502); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, i); ctx.lineTo(502, i); ctx.stroke();
    }

    // Tech Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    for (let y = 10; y < 502; y += 4) {
      ctx.fillRect(10, y, 492, 2);
    }

    // Draw glowing yellow Spartan silhouette in the center!
    ctx.strokeStyle = '#eab308'; // Glowing gold yellow
    ctx.lineWidth = 4;
    ctx.shadowColor = '#eab308';
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    // Head / Helmet
    ctx.moveTo(246, 130); ctx.lineTo(266, 130); ctx.lineTo(274, 144); ctx.lineTo(266, 160); ctx.lineTo(246, 160); ctx.lineTo(238, 144); ctx.closePath();
    // Visor line
    ctx.moveTo(242, 142); ctx.lineTo(270, 142);
    // Chest / Shoulders
    ctx.moveTo(216, 180); ctx.lineTo(296, 180); ctx.lineTo(310, 204); ctx.lineTo(280, 250); ctx.lineTo(232, 250); ctx.lineTo(202, 204); ctx.closePath();
    // Left arm (Sword raise)
    ctx.moveTo(216, 180); ctx.lineTo(176, 160); ctx.lineTo(160, 186); ctx.lineTo(202, 204);
    // Right arm (Hammer carry)
    ctx.moveTo(296, 180); ctx.lineTo(336, 196); ctx.lineTo(346, 226); ctx.lineTo(280, 250);
    // Legs base
    ctx.moveTo(232, 250); ctx.lineTo(220, 310); ctx.lineTo(190, 380); ctx.lineTo(226, 380); ctx.lineTo(246, 310); ctx.lineTo(256, 270);
    ctx.moveTo(280, 250); ctx.lineTo(292, 310); ctx.lineTo(322, 380); ctx.lineTo(286, 380); ctx.lineTo(266, 310);
    ctx.stroke();

    // Energy Sword blade in left hand
    ctx.strokeStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(160, 186); ctx.lineTo(110, 150); ctx.lineTo(136, 172); ctx.lineTo(160, 186);
    ctx.moveTo(160, 186); ctx.lineTo(102, 166); ctx.lineTo(136, 178); ctx.lineTo(160, 186);
    ctx.stroke();

    // Glowing Scoreboard stats
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ffff';
    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('BLUE', 36, 80);
    ctx.font = 'bold 64px monospace';
    ctx.fillText('99', 42, 150);

    ctx.shadowColor = '#ff0055';
    ctx.fillStyle = '#ff2a6d';
    ctx.textAlign = 'right';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('RED', 476, 80);
    ctx.font = 'bold 64px monospace';
    ctx.fillText('88', 470, 150);

    // Center Championship text
    ctx.shadowColor = '#eab308';
    ctx.fillStyle = '#facc15';
    ctx.font = '900 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GRIFBALL ARENA', 256, 440);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('CHAMPIONSHIP SERIES V', 256, 470);
    
    ctx.shadowBlur = 0;
  } else if (type === 'stadium_advertisement_sapphire') {
    // Sapphire Burger holographic advertisement banner
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, 512, 512);

    // Grid scanlines
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 512; y += 8) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // Draw glowing Hamburger outline
    ctx.strokeStyle = '#f59e0b'; // golden yellow bun
    ctx.lineWidth = 5;
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 14;
    
    // Top bun
    ctx.beginPath();
    ctx.arc(256, 210, 100, Math.PI, 0, false);
    ctx.lineTo(356, 210);
    ctx.quadraticCurveTo(256, 240, 156, 210);
    ctx.closePath();
    ctx.stroke();

    // Patty
    ctx.strokeStyle = '#ca8a04';
    ctx.beginPath();
    ctx.moveTo(150, 230);
    ctx.lineTo(362, 230);
    ctx.quadraticCurveTo(362, 256, 350, 256);
    ctx.lineTo(162, 256);
    ctx.quadraticCurveTo(150, 256, 150, 230);
    ctx.closePath();
    ctx.stroke();

    // Lettuce / cheese layers
    ctx.strokeStyle = '#22c55e'; // green lettuce
    ctx.beginPath();
    ctx.moveTo(156, 220);
    ctx.bezierCurveTo(180, 210, 210, 230, 256, 220);
    ctx.bezierCurveTo(300, 210, 330, 230, 356, 220);
    ctx.stroke();

    // Bottom Bun
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(160, 266);
    ctx.quadraticCurveTo(256, 250, 352, 266);
    ctx.quadraticCurveTo(352, 300, 330, 300);
    ctx.lineTo(182, 300);
    ctx.quadraticCurveTo(160, 300, 160, 266);
    ctx.closePath();
    ctx.stroke();

    // Ad texts
    ctx.shadowColor = '#06b6d4'; // bright cyan
    ctx.fillStyle = '#22d3ee';
    ctx.font = '900 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SAPPHIRE BURGER', 256, 90);
    
    ctx.shadowColor = '#ec4899';
    ctx.fillStyle = '#f472b6';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('THE CHOICE OF CHAMPIONS', 256, 370);
    ctx.fillText('TASTY • ENERGIZING • PREMIUM', 256, 410);

    ctx.shadowBlur = 0;
  } else if (type === 'stadium_advertisement_gauss') {
    // Gauss Soda / Energy Drink advertisement
    ctx.fillStyle = '#060402';
    ctx.fillRect(0, 0, 512, 512);

    // Tech lines
    ctx.strokeStyle = 'rgba(234, 88, 12, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 512; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }

    // Draw soda can outline
    ctx.strokeStyle = '#ea580c'; // glowing neon orange
    ctx.lineWidth = 5;
    ctx.shadowColor = '#ea580c';
    ctx.shadowBlur = 14;

    ctx.strokeRect(200, 160, 112, 200); // can body
    ctx.strokeRect(216, 146, 80, 14);  // tab/lip top

    // Lightning bolt icon on can
    ctx.strokeStyle = '#eab308';
    ctx.shadowColor = '#eab308';
    ctx.beginPath();
    ctx.moveTo(266, 180);
    ctx.lineTo(230, 250);
    ctx.lineTo(260, 250);
    ctx.lineTo(246, 330);
    ctx.lineTo(282, 260);
    ctx.lineTo(252, 260);
    ctx.closePath();
    ctx.stroke();

    // Ad texts
    ctx.shadowColor = '#ea580c';
    ctx.fillStyle = '#ff7700';
    ctx.font = '900 56px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAUSS SODA', 256, 95);

    ctx.shadowColor = '#eab308';
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('HYPER-ACCELERATED ENERGY', 256, 420);
    ctx.font = 'italic 16px sans-serif';
    ctx.fillText('Warning: May cause anti-gravity physics side effects.', 256, 460);

    ctx.shadowBlur = 0;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (type === 'winter_ice' || type === 'stadium_scoreboard_screen' || type === 'stadium_advertisement_sapphire' || type === 'stadium_advertisement_gauss') {
    texture.repeat.set(1, 1); // Stretched exactly once
  } else if (type === 'stadium_steel_grid') {
    texture.repeat.set(3, 3); // Beautiful steel grid tile repetition
  } else if (type === 'winter_snow' || type === 'winter_glacier_glass') {
    texture.repeat.set(2, 2); // Nice repeating details
  } else {
    texture.repeat.set(4, 4); // Tiled nicely
  }
  return texture;
};
