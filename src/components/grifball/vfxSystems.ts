import * as THREE from 'three';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { type GrifballThreeRefs } from './threeRefs';

const disposeMeshMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((m) => m.dispose());
    return;
  }

  material.dispose();
};

const disposeMappedMeshMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((m) => {
      const mapped = m as THREE.MeshBasicMaterial;
      if (mapped.map) mapped.map.dispose();
      m.dispose();
    });
    return;
  }

  const mapped = material as THREE.MeshBasicMaterial;
  if (mapped.map) mapped.map.dispose();
  material.dispose();
};

export function spawnBurnDecalForThreeRefs(
  refs: GrifballThreeRefs,
  pos: THREE.Vector3,
  radius: number
): void {
  const scene = refs.scene;
  if (!scene) return;

  const decalGeo = new THREE.PlaneGeometry(2, 2);
  decalGeo.rotateX(-Math.PI / 2);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);

    const coreGrad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    coreGrad.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
    coreGrad.addColorStop(0.3, 'rgba(56, 189, 248, 0.22)');
    coreGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.08)');
    coreGrad.addColorStop(0.85, 'rgba(6, 182, 212, 0.6)');
    coreGrad.addColorStop(0.93, 'rgba(255, 255, 255, 0.9)');
    coreGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 128, 90, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(128, 128, 50, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const startRad = 20;
      const endRad = 115;
      const xStart = 128 + Math.cos(angle) * startRad;
      const yStart = 128 + Math.sin(angle) * startRad;
      const xEnd = 128 + Math.cos(angle) * endRad;
      const yEnd = 128 + Math.sin(angle) * endRad;
      ctx.beginPath();
      ctx.moveTo(xStart, yStart);
      ctx.lineTo(xEnd, yEnd);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  const decalMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(decalGeo, decalMat);
  mesh.position.set(pos.x, 0.012 + Math.random() * 0.005, pos.z);
  mesh.scale.set(radius, 1, radius);

  scene.add(mesh);

  refs.burnDecals.push({
    mesh,
    life: 0,
    maxLife: 3.5,
  });
}

export function spawnVoxelShockwaveParticlesForThreeRefs(
  refs: GrifballThreeRefs,
  impactCenter: THREE.Vector3,
  color: string
): void {
  const scene = refs.scene;
  if (!scene) return;

  const count = 35;
  const voxelGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const voxelMatCache = new Map<string, THREE.Material>();

  for (let i = 0; i < count; i++) {
    const isGlow = Math.random() > 0.35;
    const shadeHex = color;

    let mat = voxelMatCache.get(shadeHex);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(shadeHex),
        emissive: isGlow ? new THREE.Color(shadeHex) : undefined,
        emissiveIntensity: isGlow ? 1.5 : 0.0,
        roughness: 0.5,
        metalness: 0.1,
      });
      voxelMatCache.set(shadeHex, mat);
    }

    const cube = new THREE.Mesh(voxelGeo, mat);
    cube.position.copy(impactCenter);
    cube.position.x += (Math.random() - 0.5) * 0.4;
    cube.position.y += Math.random() * 0.3;
    cube.position.z += (Math.random() - 0.5) * 0.4;

    const angle = Math.random() * Math.PI * 2;
    const speedHorizon = Math.random() * 5.5 + 2.5;
    const vx = Math.cos(angle) * speedHorizon;
    const vz = Math.sin(angle) * speedHorizon;
    const vy = Math.random() * 5.0 + 3.2;

    scene.add(cube);
    refs.damageExplosionParticles.push({
      mesh: cube,
      velocity: new THREE.Vector3(vx, vy, vz),
      life: 0.0,
      maxLife: Math.random() * 0.5 + 0.45,
    });
  }
}

export function spawnNeonBlueHammerFlashForThreeRefs(
  refs: GrifballThreeRefs,
  impactCenter: THREE.Vector3,
  radius: number
): void {
  const scene = refs.scene;
  if (!scene) return;

  const flashGeo = new THREE.SphereGeometry(1, 32, 16);
  const flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.copy(impactCenter);
  flash.scale.setScalar(Math.max(0.05, radius * 0.12));
  scene.add(flash);

  refs.hammerSplashFlashes.push({
    mesh: flash,
    life: 0,
    maxLife: 0.42,
    targetRadius: Math.max(0.1, radius),
  });
}

export function renderHammerSplashVfxForThreeRefs({
  refs,
  impactCenter,
  color,
  radius,
  splashVfx,
  enableBurnDecals,
}: {
  refs: GrifballThreeRefs;
  impactCenter: THREE.Vector3;
  color: string;
  radius: number;
  splashVfx: string;
  enableBurnDecals: boolean;
}): void {
  if (splashVfx === 'neonBlueFlash') {
    spawnNeonBlueHammerFlashForThreeRefs(refs, impactCenter, radius);
    return;
  }

  spawnVoxelShockwaveParticlesForThreeRefs(refs, impactCenter, color);

  if (enableBurnDecals) {
    const height = impactCenter.y;
    if (Math.abs(height) <= radius) {
      spawnBurnDecalForThreeRefs(refs, impactCenter, radius);
    }
  }
}

export function spawnCurrentSwordLungeCubeTrailForThreeRefs(
  refs: GrifballThreeRefs,
  trailPos: THREE.Vector3,
  color: string,
  style: Extract<SwordLungeCurrentTrailStyle, 'localCube' | 'enemyCube'>
): void {
  const scene = refs.scene;
  if (!scene) return;

  const size = style === 'localCube' ? 0.08 : 0.12;
  const opacity = style === 'localCube' ? 0.8 : 0.75;
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(trailPos);
  scene.add(mesh);

  refs.damageExplosionParticles.push({
    mesh,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.1,
      Math.random() * 0.15,
      (Math.random() - 0.5) * 0.1
    ),
    life: 0.0,
    maxLife: 0.18,
  });
}

const getSwordLungeTrailDirection = (direction?: THREE.Vector3): THREE.Vector3 => {
  const dir = direction?.clone() ?? new THREE.Vector3(0, 0, -1);
  if (dir.lengthSq() <= 0.0001) {
    dir.set(0, 0, -1);
  }
  return dir.normalize();
};

export function spawnSwordLungeSpeedLinesForThreeRefs(
  refs: GrifballThreeRefs,
  trailPos: THREE.Vector3,
  color: string,
  direction?: THREE.Vector3
): void {
  const scene = refs.scene;
  if (!scene) return;

  const dir = getSwordLungeTrailDirection(direction);
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (side.lengthSq() <= 0.0001) {
    side.set(1, 0, 0);
  } else {
    side.normalize();
  }

  const lineCount = 2 + Math.floor(Math.random() * 2);
  const highlightColor = color === '#22d3ee' ? '#a5f3fc' : '#fb923c';

  for (let i = 0; i < lineCount; i++) {
    const length = 0.75 + Math.random() * 0.95;
    const width = 0.018 + Math.random() * 0.025;
    const startOpacity = 0.72 + Math.random() * 0.18;
    const geo = new THREE.BoxGeometry(width, width, length);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(i === 0 ? highlightColor : color),
      transparent: true,
      opacity: startOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(trailPos);
    mesh.position.addScaledVector(dir, -length * (0.45 + Math.random() * 0.35));
    mesh.position.addScaledVector(side, (Math.random() - 0.5) * 0.72);
    mesh.position.y += (Math.random() - 0.5) * 0.36;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    scene.add(mesh);

    refs.swordLungeSpeedLines.push({
      mesh,
      drift: dir.clone().multiplyScalar(-1.8 - Math.random() * 1.4),
      life: 0,
      maxLife: 0.14 + Math.random() * 0.08,
      startOpacity,
    });
  }
}

export function renderSwordLungeTrailVfxForThreeRefs({
  refs,
  trailPos,
  color,
  direction,
  currentStyle = 'localCube',
  swordLungeVfx,
}: {
  refs: GrifballThreeRefs;
  trailPos: THREE.Vector3;
  color: string;
  direction?: THREE.Vector3;
  currentStyle?: SwordLungeCurrentTrailStyle;
  swordLungeVfx: string;
}): void {
  if (Math.random() <= 0.1) return;

  if (swordLungeVfx === 'speedLineTrail') {
    spawnSwordLungeSpeedLinesForThreeRefs(refs, trailPos, color, direction);
    return;
  }

  if (currentStyle === 'shockwave') {
    spawnVoxelShockwaveParticlesForThreeRefs(refs, trailPos, color);
    return;
  }

  spawnCurrentSwordLungeCubeTrailForThreeRefs(refs, trailPos, color, currentStyle);
}

export function resetTransientVfxRefs(refs: GrifballThreeRefs): void {
  refs.damageExplosionParticles = [];
  refs.hammerSplashFlashes = [];
  refs.swordLungeSpeedLines = [];
  refs.burnDecals = [];
  refs.tracers = [];
}

export function disposeTransientVfxRefs(refs: GrifballThreeRefs): void {
  const scene = refs.scene;

  refs.burnDecals.forEach((decal) => {
    if (scene) scene.remove(decal.mesh);
    decal.mesh.geometry.dispose();
    disposeMappedMeshMaterial(decal.mesh.material);
  });

  refs.hammerSplashFlashes.forEach((flash) => {
    if (scene) scene.remove(flash.mesh);
    flash.mesh.geometry.dispose();
    disposeMeshMaterial(flash.mesh.material);
  });

  refs.swordLungeSpeedLines.forEach((line) => {
    if (scene) scene.remove(line.mesh);
    line.mesh.geometry.dispose();
    disposeMeshMaterial(line.mesh.material);
  });

  refs.tracers.forEach((tracer) => {
    if (scene) scene.remove(tracer.mesh);
    tracer.mesh.geometry.dispose();
    tracer.material.dispose();
  });

  refs.damageExplosionParticles.forEach((particle) => {
    if (scene) scene.remove(particle.mesh);
    particle.mesh.geometry.dispose();
  });

  resetTransientVfxRefs(refs);
}

export function updateBurnDecalsForThreeRefs(refs: GrifballThreeRefs, dt: number): void {
  const list = refs.burnDecals;
  const scene = refs.scene;
  if (!scene || !list) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.life += dt;

    if (d.life >= d.maxLife) {
      scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      disposeMappedMeshMaterial(d.mesh.material);
      list.splice(i, 1);
    } else {
      const ratio = 1.0 - d.life / d.maxLife;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = ratio;
    }
  }
}

export function updateTracersForThreeRefs(refs: GrifballThreeRefs, dt: number): void {
  const list = refs.tracers;
  const scene = refs.scene;
  if (!list || !scene) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    t.life += dt;
    if (t.life >= t.maxLife) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.material.dispose();
      list.splice(i, 1);
    } else {
      const ratio = 1.0 - t.life / t.maxLife;
      if ('opacity' in t.material) {
        t.material.opacity = ratio;
      }
    }
  }
}

export function updateExplosionParticlesForThreeRefs(refs: GrifballThreeRefs, dt: number): void {
  const list = refs.damageExplosionParticles;
  const scene = refs.scene;
  if (!scene) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;

    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      list.splice(i, 1);
    } else {
      p.velocity.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      const ratio = 1.0 - p.life / p.maxLife;
      p.mesh.scale.set(ratio, ratio, ratio);
    }
  }
}

export function updateHammerSplashFlashesForThreeRefs(refs: GrifballThreeRefs, dt: number): void {
  const list = refs.hammerSplashFlashes;
  const scene = refs.scene;
  if (!scene) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const flash = list[i];
    flash.life += dt;

    if (flash.life >= flash.maxLife) {
      scene.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      disposeMeshMaterial(flash.mesh.material);
      list.splice(i, 1);
    } else {
      const pct = flash.life / flash.maxLife;
      const eased = 1 - Math.pow(1 - pct, 3);
      const scale = THREE.MathUtils.lerp(flash.targetRadius * 0.12, flash.targetRadius, eased);
      flash.mesh.scale.setScalar(scale);

      const mat = flash.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.9 * Math.pow(1 - pct, 2);
    }
  }
}

export function updateSwordLungeSpeedLinesForThreeRefs(refs: GrifballThreeRefs, dt: number): void {
  const list = refs.swordLungeSpeedLines;
  const scene = refs.scene;
  if (!scene) return;

  for (let i = list.length - 1; i >= 0; i--) {
    const line = list[i];
    line.life += dt;

    if (line.life >= line.maxLife) {
      scene.remove(line.mesh);
      line.mesh.geometry.dispose();
      disposeMeshMaterial(line.mesh.material);
      list.splice(i, 1);
    } else {
      const pct = line.life / line.maxLife;
      line.mesh.position.addScaledVector(line.drift, dt);
      line.mesh.scale.z = Math.max(0.18, 1 - pct * 0.72);

      const mat = line.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = line.startOpacity * Math.pow(1 - pct, 1.55);
    }
  }
}
