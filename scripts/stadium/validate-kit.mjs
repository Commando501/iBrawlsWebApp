/** Validate the actual shipping GLBs through the same loader as the game. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = new URL('../../', import.meta.url);
const assetRoot = new URL('public/assets/stadium/architecture/', root);
const manifest = JSON.parse(readFileSync(new URL('kit-v1.manifest.json', assetRoot), 'utf8'));
const sizes = { 'barrier-panel': [8, 3.2, .7], 'support-pylon': [2, 16, 2.5],
  'light-fixture': [6, 1.2, 1], 'vent-module': [3, 2, .5] };
const report = { loader: 'Three.js GLTFLoader', variants: {} };

for (const [quality, source] of Object.entries(manifest.variants)) {
  const buffer = readFileSync(new URL(source.file, assetRoot));
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  assert.equal(gltf.scene.children.length, 4, `${quality}: expected exactly four reusable module roots`);
  let triangles = 0;
  let batches = 0;
  const modules = {};
  for (const [name, dimensions] of Object.entries(sizes)) {
    const node = gltf.scene.getObjectByName(name);
    assert.ok(node, `${quality}: missing exact stable root ${name}`);
    assert.equal(node.parent, gltf.scene, `${quality}: unexpected root hierarchy ${name}`);
    assert.ok(node.position.length() < 1e-7, `${name}: offset pivot`);
    const box = new Box3().setFromObject(node);
    const size = box.getSize(new Vector3()).toArray();
    dimensions.forEach((value, axis) => assert.ok(Math.abs(size[axis] - value) < .003,
      `${quality}/${name}: axis ${axis} ${size[axis]} differs from contracted ${value}`));
    const bottomPivot = name === 'barrier-panel' || name === 'support-pylon';
    assert.ok(Math.abs(bottomPivot ? box.min.y : (box.min.y + box.max.y)) < .003,
      `${quality}/${name}: incorrect ${bottomPivot ? 'bottom' : 'center'} pivot`);
    let moduleTriangles = 0;
    let moduleBatches = 0;
    node.traverse((mesh) => {
      if (!mesh.isMesh) return;
      assert.ok(!Array.isArray(mesh.material), `${name}: material batch is not merged`);
      assert.ok(mesh.material.name in manifest.materials, `${name}: unexpected material`);
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      assert.equal(normal.count, position.count, `${name}: invalid normals`);
      assert.equal(uv.count, position.count, `${name}: missing texture coordinates`);
      for (const attr of [position, normal, uv]) {
        for (const value of attr.array) assert.ok(Number.isFinite(value), `${name}: invalid vertex attribute`);
      }
      moduleTriangles += (geometry.index?.count ?? position.count) / 3;
      moduleBatches++;
    });
    assert.ok(moduleBatches <= 4, `${quality}/${name}: draw-call budget exceeded`);
    assert.equal(moduleTriangles, source.modules[name].triangles, `${quality}/${name}: manifest drift`);
    triangles += moduleTriangles;
    batches += moduleBatches;
    modules[name] = { dimensions: size.map(x => +x.toFixed(4)), triangles: moduleTriangles,
      materialBatches: moduleBatches, pivot: bottomPivot ? 'bottom-center' : 'center' };
  }
  assert.ok(triangles <= 16000, `${quality}: total triangle budget exceeded: ${triangles}`);
  assert.ok(buffer.byteLength < 1_200_000, `${quality}: binary budget exceeded`);
  report.variants[quality] = { triangles, batches, bytes: buffer.byteLength, modules };
}
assert.ok(report.variants.low.triangles < report.variants.high.triangles * .4, 'LOD savings insufficient');
writeFileSync(new URL('kit-validation.json', assetRoot), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`Validated native GLB loading and module contracts at ${fileURLToPath(assetRoot)}`);
