import * as THREE from 'three';

interface ShockwaveFragment {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface InstancedShockwaveBurst {
  readonly mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  readonly fragments: ShockwaveFragment[];
  disposed: boolean;
}

const FRAGMENT_COUNT = 35;
const matrix = new THREE.Matrix4();

/** Keep the original shockwave's particles and timing, sharing its single draw. */
export function createInstancedShockwaveBurst(
  scene: THREE.Scene,
  impactCenter: THREE.Vector3,
  color: string,
): InstancedShockwaveBurst {
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const fragments: ShockwaveFragment[] = [];
  let material: THREE.MeshStandardMaterial | undefined;
  let mesh: InstancedShockwaveBurst['mesh'] | undefined;

  for (let index = 0; index < FRAGMENT_COUNT; index++) {
    // The original color-keyed cache gave the entire burst its first fragment's
    // glow. Keep that appearance and all subsequent cosmetic RNG consumption.
    const isGlow = Math.random() > 0.35;
    material ??= new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: isGlow ? new THREE.Color(color) : new THREE.Color(0x000000),
      emissiveIntensity: isGlow ? 1.5 : 0,
      roughness: 0.5,
      metalness: 0.1,
    });
    if (!mesh) {
      mesh = new THREE.InstancedMesh(geometry, material, FRAGMENT_COUNT);
    } else {
      // Mesh construction previously consumed UUID randomness before each
      // position sample. Preserve that sequence without allocating 34 meshes.
      THREE.MathUtils.generateUUID();
    }
    const position = impactCenter.clone();
    position.x += (Math.random() - 0.5) * 0.4;
    position.y += Math.random() * 0.3;
    position.z += (Math.random() - 0.5) * 0.4;
    const angle = Math.random() * Math.PI * 2;
    const speedHorizon = Math.random() * 5.5 + 2.5;
    const vx = Math.cos(angle) * speedHorizon;
    const vz = Math.sin(angle) * speedHorizon;
    const vy = Math.random() * 5 + 3.2;
    fragments.push({
      position,
      velocity: new THREE.Vector3(vx, vy, vz),
      life: 0,
      maxLife: Math.random() * 0.5 + 0.45,
    });
  }

  const burstMesh = mesh!;
  burstMesh.name = 'voxelShockwaveBurst';
  burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Every fragment expires before 0.95 seconds. This conservative world-space
  // envelope covers its original velocity/gravity integration without an
  // allocation-heavy bounds scan for every burst on every frame.
  burstMesh.boundingSphere = new THREE.Sphere(impactCenter.clone(), 18);
  for (let index = 0; index < fragments.length; index++) {
    matrix.makeTranslation(fragments[index].position);
    burstMesh.setMatrixAt(index, matrix);
  }
  burstMesh.instanceMatrix.needsUpdate = true;
  scene.add(burstMesh);
  return { mesh: burstMesh, fragments, disposed: false };
}

/** Uses the same semi-implicit gravity step and linear shrink as legacy cubes. */
export function updateInstancedShockwaveBurst(burst: InstancedShockwaveBurst, dt: number): boolean {
  if (burst.disposed) return false;
  let count = 0;
  for (const fragment of burst.fragments) {
    if (fragment.life >= fragment.maxLife) continue;
    fragment.life += dt;
    if (fragment.life >= fragment.maxLife) continue;
    fragment.velocity.y -= 15 * dt;
    fragment.position.addScaledVector(fragment.velocity, dt);
    const ratio = 1 - fragment.life / fragment.maxLife;
    matrix.makeScale(ratio, ratio, ratio);
    matrix.setPosition(fragment.position);
    burst.mesh.setMatrixAt(count++, matrix);
  }
  burst.mesh.count = count;
  burst.mesh.instanceMatrix.needsUpdate = true;
  return count > 0;
}

export function disposeInstancedShockwaveBurst(burst: InstancedShockwaveBurst): void {
  if (burst.disposed) return;
  burst.disposed = true;
  burst.mesh.removeFromParent();
  burst.mesh.dispose();
  burst.mesh.geometry.dispose();
  burst.mesh.material.dispose();
}
