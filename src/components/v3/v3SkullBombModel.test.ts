import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildV3SkullBombModel } from './v3SkullBombModel';
import { V3_SKULL_BOMB } from './v3SkullBomb.generated';

test('skull bomb ships compact geometry with a readable face, fuse, and underside grip', () => {
  const model = buildV3SkullBombModel();
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > .20 && size.x < .23 && size.y > .225 && size.y < .255);
  assert.equal(model.children.length, 6);
  let triangles = 0;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const p = object.geometry.getAttribute('position'), n = object.geometry.getAttribute('normal');
    assert.equal(p.count, n.count);
    assert.ok(Array.from(p.array).every(Number.isFinite));
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(n, i).length() - 1) < .00001);
    triangles += p.count / 3;
  });
  assert.ok(triangles < 2500);
  for (const feature of ['eye well', 'nose', 'upper tooth', 'chin', 'fuse wick']) {
    assert.ok(V3_SKULL_BOMB.meshes.some(m => m.name.includes(feature)), `missing ${feature}`);
  }
  assert.ok(Math.abs(V3_SKULL_BOMB.grip[1] - bounds.min.y) < .025);
  const ray = new THREE.Raycaster(new THREE.Vector3(.07 * .5, .13 * .5, 1), new THREE.Vector3(0, 0, -1));
  const face = ray.intersectObject(model, true)[0];
  assert.ok(face && face.point.z > .15 * .5, 'forehead outer face must have outward-facing winding');
});
