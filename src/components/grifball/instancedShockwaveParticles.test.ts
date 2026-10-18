import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createInstancedShockwaveBurst,
  disposeInstancedShockwaveBurst,
  updateInstancedShockwaveBurst,
} from './instancedShockwaveParticles';
import { createInitialGrifballThreeRefs } from './threeRefs';
import {
  disposeTransientVfxRefs,
  resetTransientVfxRefs,
  spawnCurrentSwordLungeCubeTrailForThreeRefs,
  spawnVoxelShockwaveParticlesForThreeRefs,
  updateExplosionParticlesForThreeRefs,
} from './vfxSystems';

function rng(seed: number) {
  let calls = 0;
  return {
    random: () => {
      calls++;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    get calls() { return calls; },
  };
}

// Independent reference of the pre-instancing spawn/integration rules. Keep the
// RNG sequence, first-fragment material cache behavior, and early expiry here.
function legacyParticles(impactCenter: THREE.Vector3) {
  let burstGlow = false;
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  let material: THREE.MeshStandardMaterial | undefined;
  const fragments = Array.from({ length: 35 }, (_, index) => {
    const glow = Math.random() > 0.35;
    if (index === 0) burstGlow = glow;
    material ??= new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: glow ? '#ef4444' : 0, emissiveIntensity: glow ? 1.5 : 0, roughness: 0.5, metalness: 0.1 });
    const cube = new THREE.Mesh(geometry, material);
    const position = cube.position.copy(impactCenter);
    position.x += (Math.random() - 0.5) * 0.4;
    position.y += Math.random() * 0.3;
    position.z += (Math.random() - 0.5) * 0.4;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5.5 + 2.5;
    const velocity = new THREE.Vector3(Math.cos(angle) * speed, Math.random() * 5 + 3.2, Math.sin(angle) * speed);
    return { position, velocity, life: 0, maxLife: Math.random() * 0.5 + 0.45 };
  });
  geometry.dispose();
  material!.dispose();
  return { fragments, burstGlow };
}

function assertMatrixNear(actual: THREE.Matrix4, expected: THREE.Matrix4) {
  actual.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.elements[index]) < 1e-6));
}

for (const seed of [1, 8000, 100000]) {
  test(`shockwave matches original fragment RNG, appearance, motion and lifetime (seed ${seed})`, (t) => {
    const source = rng(seed);
    const legacyRng = rng(seed);
    const center = new THREE.Vector3(2, 0.825, -3);
    const scene = new THREE.Scene();
    t.mock.method(Math, 'random', legacyRng.random);
    const legacy = legacyParticles(center);
    t.mock.method(Math, 'random', source.random);
    const burst = createInstancedShockwaveBurst(scene, center, '#ef4444');
    assert.equal(source.calls, 428, 'includes the legacy geometry, material, and object UUID draws');
    assert.equal(source.calls, legacyRng.calls);
    assert.equal(source.random(), legacyRng.random());
    assert.deepEqual(burst.fragments, legacy.fragments);
    assert.equal(scene.children.length, 1);
    assert.equal(burst.mesh.count, 35);
    assert.equal(burst.mesh.material.color.getHex(), new THREE.Color('#ef4444').getHex());
    assert.equal(burst.mesh.material.emissive.getHex(), legacy.burstGlow ? new THREE.Color('#ef4444').getHex() : 0);
    assert.equal(burst.mesh.material.emissiveIntensity, legacy.burstGlow ? 1.5 : 0);
    assert.equal(burst.mesh.material.roughness, 0.5);
    assert.equal(burst.mesh.material.metalness, 0.1);
    assert.equal(burst.mesh.material.transparent, false);
    assert.equal(burst.mesh.castShadow, false);

    const actualMatrix = new THREE.Matrix4();
    const expectedMatrix = new THREE.Matrix4();
    for (const dt of [0, 0.016, 0.04, 0.11, 0.17, 0.15, 0.07, 0.12, 0.31]) {
      for (const fragment of legacy.fragments) {
        if (fragment.life >= fragment.maxLife) continue;
        fragment.life += dt;
        if (fragment.life >= fragment.maxLife) continue;
        fragment.velocity.y -= 15 * dt;
        fragment.position.addScaledVector(fragment.velocity, dt);
      }
      const live = legacy.fragments.filter(fragment => fragment.life < fragment.maxLife);
      assert.equal(updateInstancedShockwaveBurst(burst, dt), live.length > 0);
      assert.deepEqual(burst.fragments, legacy.fragments);
      assert.equal(burst.mesh.count, live.length);
      live.forEach((fragment, index) => {
        const ratio = 1 - fragment.life / fragment.maxLife;
        expectedMatrix.makeScale(ratio, ratio, ratio).setPosition(fragment.position);
        burst.mesh.getMatrixAt(index, actualMatrix);
        assertMatrixNear(actualMatrix, expectedMatrix);
        assert.ok(burst.mesh.boundingSphere!.containsPoint(fragment.position));
      });
    }
    disposeInstancedShockwaveBurst(burst);
  });
}

test('non-glowing bursts do not pass undefined material parameters', (t) => {
  t.mock.method(Math, 'random', () => 0.1);
  const warn = t.mock.method(console, 'warn', () => {});
  const burst = createInstancedShockwaveBurst(new THREE.Scene(), new THREE.Vector3(), '#38bdf8');
  assert.equal(burst.mesh.material.emissive.getHex(), 0);
  assert.equal(burst.mesh.material.emissiveIntensity, 0);
  assert.equal(warn.mock.calls.length, 0);
  disposeInstancedShockwaveBurst(burst);
});

test('one burst retains geometry until all fragments expire and disposes each resource once', (t) => {
  const source = rng(42);
  t.mock.method(Math, 'random', source.random);
  const scene = new THREE.Scene();
  const burst = createInstancedShockwaveBurst(scene, new THREE.Vector3(), '#38bdf8');
  const meshDispose = t.mock.method(burst.mesh, 'dispose');
  const geometryDispose = t.mock.method(burst.mesh.geometry, 'dispose');
  const materialDispose = t.mock.method(burst.mesh.material, 'dispose');
  assert.equal(updateInstancedShockwaveBurst(burst, 0.6), true);
  assert.ok(burst.mesh.count > 0 && burst.mesh.count < 35);
  assert.equal(geometryDispose.mock.calls.length, 0);
  assert.equal(updateInstancedShockwaveBurst(burst, 0.4), false);
  disposeInstancedShockwaveBurst(burst);
  disposeInstancedShockwaveBurst(burst);
  assert.equal(updateInstancedShockwaveBurst(burst, 0.01), false);
  assert.equal(scene.children.length, 0);
  assert.equal(meshDispose.mock.calls.length, 1);
  assert.equal(geometryDispose.mock.calls.length, 1);
  assert.equal(materialDispose.mock.calls.length, 1);
});

test('many simultaneous shockwaves preserve particles in one renderable per burst', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  for (let index = 0; index < 60; index++) spawnVoxelShockwaveParticlesForThreeRefs(refs, new THREE.Vector3(), '#ef4444');
  assert.equal(refs.scene.children.length, 60);
  assert.equal(refs.scene.children.reduce((sum, child) => sum + (child as THREE.InstancedMesh).count, 0), 2100);
  assert.equal(refs.damageExplosionParticles.length, 0);
  updateExplosionParticlesForThreeRefs(refs, 1);
  assert.equal(refs.scene.children.length, 0);
  disposeTransientVfxRefs(refs);
});

test('burst updates coexist with legacy trail particles and clear on reset, disposal, or scene replacement', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  const secondRefs = createInitialGrifballThreeRefs();
  secondRefs.scene = refs.scene;
  spawnVoxelShockwaveParticlesForThreeRefs(refs, new THREE.Vector3(), '#38bdf8');
  spawnCurrentSwordLungeCubeTrailForThreeRefs(refs, new THREE.Vector3(), '#38bdf8', 'localCube');
  spawnVoxelShockwaveParticlesForThreeRefs(secondRefs, new THREE.Vector3(), '#ef4444');
  updateExplosionParticlesForThreeRefs(refs, 0.2);
  assert.equal(refs.damageExplosionParticles.length, 0);
  assert.equal(refs.scene.children.length, 2);
  resetTransientVfxRefs(refs);
  assert.equal(refs.scene.children.length, 1, 'reset leaves the other refs owner intact');
  resetTransientVfxRefs(refs);
  disposeTransientVfxRefs(secondRefs);
  assert.equal(refs.scene.children.length, 0);

  spawnVoxelShockwaveParticlesForThreeRefs(refs, new THREE.Vector3(), '#38bdf8');
  const oldScene = refs.scene;
  refs.scene = new THREE.Scene();
  updateExplosionParticlesForThreeRefs(refs, 0.01);
  assert.equal(oldScene.children.length, 0);
  spawnVoxelShockwaveParticlesForThreeRefs(refs, new THREE.Vector3(), '#38bdf8');
  const latestScene = refs.scene;
  refs.scene = null;
  disposeTransientVfxRefs(refs);
  assert.equal(latestScene.children.length, 0, 'cleanup works even after the scene ref was cleared');
});

test('remaining legacy trail particles release their independently owned materials on expiry or teardown', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  const disposed = { expired: 0, teardown: 0 };
  spawnCurrentSwordLungeCubeTrailForThreeRefs(refs, new THREE.Vector3(), '#38bdf8', 'localCube');
  const expiredMaterial = refs.damageExplosionParticles[0].mesh.material as THREE.Material;
  expiredMaterial.addEventListener('dispose', () => { disposed.expired++; });
  updateExplosionParticlesForThreeRefs(refs, 0.2);
  assert.deepEqual(disposed, { expired: 1, teardown: 0 });
  spawnCurrentSwordLungeCubeTrailForThreeRefs(refs, new THREE.Vector3(), '#38bdf8', 'localCube');
  const teardownMaterial = refs.damageExplosionParticles[0].mesh.material as THREE.Material;
  assert.notEqual(teardownMaterial, expiredMaterial);
  teardownMaterial.addEventListener('dispose', () => { disposed.teardown++; });
  disposeTransientVfxRefs(refs);
  disposeTransientVfxRefs(refs);
  assert.deepEqual(disposed, { expired: 1, teardown: 1 });
});
