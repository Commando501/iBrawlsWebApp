/** Validate shipping Glacier modules with the game's native Three GLTFLoader. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Box3, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const assetRoot = new URL('../../public/assets/glacier/architecture/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('kit-v1.manifest.json', assetRoot), 'utf8'));
const contracts = {
  'anchor-post': [.6, 5, .6],
  'goal-buffer': [1.5, 2, 4],
  'rink-board': [4, .8, .1],
  'rink-glass': [4, 1.4, .1],
  'glacier-ridge': [22, 24, 16],
  'snowy-pine': [6, 12, 6],
};
const identity = new Matrix4();
const report = { loader: 'Three.js GLTFLoader', variants: {} };
for (const [quality, source] of Object.entries(manifest.variants)) {
  const buffer = readFileSync(new URL(source.file, assetRoot));
  assert.equal(buffer.byteLength, source.bytes, `${quality}: manifest byte drift`);
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
      const isGlass = mesh.material.name === 'glacier_glass';
      assert.equal(mesh.material.transparent, isGlass, `${name}: only glass may use alpha`);
      assert.equal(mesh.material.alphaTest, 0, `${name}: unexpected cutout material`);
      assert.equal(mesh.material.emissive.getHex(), 0, `${name}: no authored emission permitted`);
      assert.ok(Math.abs(mesh.material.opacity - (isGlass ? .20 : 1)) < 1e-6,
        `${name}: approved glass opacity mismatch`);
      if (isGlass) assert.equal(name, 'rink-glass', 'Only the glass module may contain transparent glass');
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      assert.equal(normal.count, position.count, `${name}: invalid normals`);
      assert.equal(uv.count, position.count, `${name}: missing UVs`);
      for (const attr of [position, normal, uv]) {
        for (const value of attr.array) assert.ok(Number.isFinite(value), `${name}: invalid vertex attribute`);
      }
      for (let i = 0; i < position.count; i++) {
        const normalLength = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
        assert.ok(Math.abs(normalLength - 1) < .001, `${name}: non-unit normal`);
        if (name === 'anchor-post') {
          assert.ok(Math.hypot(position.getX(i), position.getZ(i)) <= .300001,
            'Anchor visual exceeds the existing radius .3 cylinder collider');
        }
      }
      moduleTriangles += (geometry.index?.count ?? position.count) / 3;
      moduleBatches++;
    });
    assert.ok(moduleBatches <= 4, `${quality}/${name}: material batch budget exceeded`);
    assert.equal(moduleBatches, source.modules[name].materialBatches, `${quality}/${name}: manifest batch drift`);
    assert.equal(moduleTriangles, source.modules[name].triangles, `${quality}/${name}: manifest triangle drift`);
    triangles += moduleTriangles;
    batches += moduleBatches;
    modules[name] = { dimensions: size.map(v => +v.toFixed(4)), triangles: moduleTriangles,
      materialBatches: moduleBatches, pivot: 'center' };
  }
  assert.deepEqual([...materialNames].sort(), Object.keys(manifest.materials).sort(),
    `${quality}: expected all nine shared surface roles`);
  assert.ok(batches < 26, `${quality}: source material batch budget exceeded`);
  assert.ok(triangles < (quality === 'high' ? 30000 : 12000), `${quality}: triangle budget exceeded`);
  assert.ok(buffer.byteLength <= (quality === 'high' ? 1_500_000 : 700_000), `${quality}: file budget exceeded`);
  report.variants[quality] = { triangles, batches, bytes: buffer.byteLength, modules };
}
assert.ok(report.variants.low.triangles < report.variants.high.triangles * .55, 'Insufficient Low savings');
writeFileSync(new URL('kit-validation.json', assetRoot), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('Validated Glacier GLBs, exact envelopes, centered pivots, identity transforms, normals/UVs, cylindrical containment, approved glass, and budgets.');
