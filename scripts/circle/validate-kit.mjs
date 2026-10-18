/** Validate shipping Circle modules with the game's native Three GLTFLoader. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Box3, Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const assetRoot = new URL('../../public/assets/circle/architecture/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('kit-v1.manifest.json', assetRoot), 'utf8'));
const contracts = {
  'perimeter-pylon': [1.2, 9, 1.2],
  'ring-beam': [7, .5, .9],
  'projector-node': [1.8, 1.2, 1.2],
  'service-pod': [4, 3, 2.4],
  'backdrop-spire': [3.5, 24, 3.5],
};
const identity = new Matrix4();
const report = { loader: 'Three.js GLTFLoader', variants: {} };
for (const [quality, source] of Object.entries(manifest.variants)) {
  const buffer = readFileSync(new URL(source.file, assetRoot));
  assert.equal(buffer.byteLength, source.bytes, `${quality}: manifest byte drift`);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  assert.equal(gltf.scene.children.length, 5, `${quality}: expected five module roots`);
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
    let emissiveArea = 0;
    let totalArea = 0;
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
      assert.equal(mesh.material.transparent, false, `${name}: alpha is not permitted`);
      assert.equal(mesh.material.opacity, 1, `${name}: opacity must be one`);
      assert.equal(mesh.material.alphaTest, 0, `${name}: cutout is not permitted`);
      const emits = ['circle_cyan', 'circle_light'].includes(mesh.material.name);
      if (!emits) assert.equal(mesh.material.emissive.getHex(), 0, `${name}: unexpected emission`);
      else {
        const values = mesh.material.emissive.toArray().map(v => v * mesh.material.emissiveIntensity);
        assert.ok(Math.max(...values) <= .600001, `${name}: excessive source emission`);
        assert.ok(manifest.materials[mesh.material.name].emissiveStrength <= .6);
      }
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
      }
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      const count = geometry.index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) {
        const ix = offset => geometry.index?.getX(i + offset) ?? (i + offset);
        a.fromBufferAttribute(position, ix(0));
        b.fromBufferAttribute(position, ix(1));
        c.fromBufferAttribute(position, ix(2));
        const area = b.sub(a).cross(c.sub(a)).length() * .5;
        totalArea += area;
        if (emits) emissiveArea += area;
      }
      moduleTriangles += count / 3;
      moduleBatches++;
    });
    assert.ok(emissiveArea / totalArea < .035, `${quality}/${name}: emissive surfaces exceed 3.5% area`);
    assert.ok(moduleBatches <= 5, `${quality}/${name}: material batch budget exceeded`);
    assert.equal(moduleBatches, source.modules[name].materialBatches, `${quality}/${name}: manifest batch drift`);
    assert.equal(moduleTriangles, source.modules[name].triangles, `${quality}/${name}: manifest triangle drift`);
    triangles += moduleTriangles;
    batches += moduleBatches;
    modules[name] = { dimensions: size.map(v => +v.toFixed(4)), triangles: moduleTriangles,
      materialBatches: moduleBatches, emissiveAreaFraction: + (emissiveArea / totalArea).toFixed(5), pivot: 'center' };
  }
  assert.deepEqual([...materialNames].sort(), Object.keys(manifest.materials).sort(),
    `${quality}: expected all six shared surface roles`);
  assert.ok(batches <= 22, `${quality}: source material batch budget exceeded`);
  assert.ok(triangles < (quality === 'high' ? 20000 : 7000), `${quality}: triangle budget exceeded`);
  assert.ok(buffer.byteLength < (quality === 'high' ? 1_200_000 : 500_000), `${quality}: file budget exceeded`);
  report.variants[quality] = { triangles, batches, bytes: buffer.byteLength, modules };
}
assert.ok(report.variants.low.triangles < report.variants.high.triangles * .55, 'Insufficient Low savings');
writeFileSync(new URL('kit-validation.json', assetRoot), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log('Validated Circle GLBs, exact envelopes, centered pivots, identity transforms, normals/UVs, opaque surfaces, small restrained emissive insets, and budgets.');
