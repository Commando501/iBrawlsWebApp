/** Validate shipped Asteroid assets with the game's actual Three.js GLTFLoader. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Box3, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const assetRoot = new URL('../../public/assets/asteroid/architecture/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('kit-v1.manifest.json', assetRoot), 'utf8'));
const contracts = {
  'ore-extractor': [2.6, 5, 2.6],
  'ore-cluster': [2.2, 3, 2.2],
  'freight-container': [1.8, 2, 3.5],
  'blast-partition': [5, 3, .4],
  'asteroid-crag': [14, 14, 14],
  'mining-gantry': [12, 16, 7],
};
const identity = new Matrix4();
const report = { loader: 'Three.js GLTFLoader', variants: {} };
for (const [quality, source] of Object.entries(manifest.variants)) {
  const buffer = readFileSync(new URL(source.file, assetRoot));
  assert.equal(buffer.byteLength, source.bytes, `${quality}: manifest byte count drift`);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  assert.equal(gltf.scene.children.length, 6, `${quality}: expected six module roots`);
  gltf.scene.updateMatrixWorld(true);
  let triangles = 0;
  let batches = 0;
  const materialNames = new Set();
  const modules = {};
  for (const [name, dimensions] of Object.entries(contracts)) {
    const node = gltf.scene.getObjectByName(name);
    assert.ok(node, `${quality}: missing exact root ${name}`);
    assert.equal(node.parent, gltf.scene, `${name}: unexpected root hierarchy`);
    node.matrix.elements.forEach((v, i) => assert.ok(Math.abs(v - identity.elements[i]) < 1e-7,
      `${quality}/${name}: root transform is not identity`));
    const box = new Box3().setFromObject(node);
    const size = box.getSize(new Vector3()).toArray();
    dimensions.forEach((value, axis) => assert.ok(Math.abs(size[axis] - value) < .001,
      `${quality}/${name}: axis ${axis} is ${size[axis]}, expected ${value}`));
    assert.ok(box.getCenter(new Vector3()).length() < .001, `${quality}/${name}: centered pivot drift`);
    let moduleTriangles = 0;
    let moduleBatches = 0;
    let maximumHorizontalRadius = 0;
    const moduleMaterials = new Set();
    node.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.matrix.elements.forEach((v, i) => assert.ok(Math.abs(v - identity.elements[i]) < 1e-7,
        `${quality}/${name}: child transform is not baked`));
      assert.ok(!Array.isArray(mesh.material), `${name}: unmerged multi-material mesh`);
      assert.ok(mesh.material.name in manifest.materials, `${name}: unexpected material`);
      assert.ok(!moduleMaterials.has(mesh.material.name), `${name}: redundant material batch`);
      moduleMaterials.add(mesh.material.name);
      materialNames.add(mesh.material.name);
      assert.equal(mesh.material.map, null, `${name}: unexpected embedded texture`);
      assert.equal(mesh.material.transparent, false, `${name}: unexpected alpha overdraw`);
      assert.equal(mesh.material.alphaTest, 0, `${name}: unexpected cutout material`);
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      assert.equal(normal.count, position.count, `${name}: invalid normals`);
      assert.equal(uv.count, position.count, `${name}: missing metre UVs`);
      for (const attr of [position, normal, uv]) {
        for (const value of attr.array) assert.ok(Number.isFinite(value), `${name}: invalid vertex attribute`);
      }
      for (let i = 0; i < position.count; i++) {
        maximumHorizontalRadius = Math.max(maximumHorizontalRadius,
          Math.hypot(position.getX(i), position.getZ(i)));
      }
      moduleTriangles += (geometry.index?.count ?? position.count) / 3;
      moduleBatches++;
    });
    assert.ok(moduleBatches <= 5, `${quality}/${name}: material batch budget exceeded`);
    if (name === 'ore-extractor') assert.ok(maximumHorizontalRadius <= 1.3001,
      `${quality}/${name}: a vertex exceeds the original cylinder radius`);
    if (name === 'asteroid-crag') assert.ok(moduleTriangles < 2000,
      `${quality}/${name}: repeated crag budget exceeded`);
    if (name === 'mining-gantry') assert.ok(moduleTriangles <= (quality === 'high' ? 10000 : 3000),
      `${quality}/${name}: repeated gantry budget exceeded`);
    assert.equal(moduleTriangles, source.modules[name].triangles, `${quality}/${name}: manifest triangle drift`);
    triangles += moduleTriangles;
    batches += moduleBatches;
    modules[name] = { dimensions: size.map(v => +v.toFixed(4)), triangles: moduleTriangles,
      materialBatches: moduleBatches, maximumHorizontalRadius: +maximumHorizontalRadius.toFixed(6),
      pivot: 'center' };
  }
  assert.deepEqual([...materialNames].sort(), Object.keys(manifest.materials).sort(),
    `${quality}: expected all seven shared surface roles`);
  assert.ok(batches <= 24, `${quality}: source material batch budget exceeded`);
  assert.ok(triangles <= (quality === 'high' ? 38000 : 10000), `${quality}: triangle budget exceeded`);
  assert.ok(buffer.byteLength <= (quality === 'high' ? 1_800_000 : 650_000), `${quality}: file budget exceeded`);
  report.variants[quality] = { triangles, batches, bytes: buffer.byteLength, modules };
}
assert.ok(report.variants.low.triangles < report.variants.high.triangles * .5, 'Insufficient Low savings');
writeFileSync(new URL('kit-validation.json', assetRoot), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('Validated Asteroid GLBs, exact envelopes, cylindrical containment, centered pivots, baked transforms, opaque surfaces, UVs, roles, and budgets.');

