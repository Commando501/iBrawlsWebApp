import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { cacheBoneLocalMatrix } from './cacheBoneLocalMatrix';

test('unchanged bones compose once while ancestor motion still propagates', () => {
  const parent = new THREE.Group(), bone = new THREE.Bone(), tip = new THREE.Bone();
  parent.add(bone); bone.add(tip); tip.position.y = 2;
  let calls = 0;
  const compose = bone.matrix.compose;
  bone.matrix.compose = function (...args) { calls++; return compose.apply(this, args); };
  cacheBoneLocalMatrix(bone);
  for (let i = 0; i < 20; i++) {
    parent.position.x = i;
    parent.updateMatrixWorld(true);
    bone.updateWorldMatrix(true, true);
    assert.equal(tip.matrixWorld.elements[12], i);
    assert.equal(tip.matrixWorld.elements[13], 2);
  }
  assert.equal(calls, 1);
});

test('cached and standard bones retain identical matrices through animation and reparenting', () => {
  const cached = new THREE.Bone(), reference = new THREE.Bone();
  cacheBoneLocalMatrix(cached);
  for (let i = 0; i < 120; i++) {
    for (const bone of [cached, reference]) {
      bone.position.set(Math.sin(i), i / 10, -i);
      bone.rotation.set(i / 5, -i / 7, i / 11);
      bone.scale.set(i % 2 ? -2 : 1, 0.5, 3);
      const parent = new THREE.Group();
      parent.rotation.y = i / 3; parent.position.z = i;
      parent.add(bone); parent.updateMatrixWorld(true);
      bone.updateWorldMatrix(true, true);
    }
    assert.deepEqual(cached.matrix.elements, reference.matrix.elements);
    assert.deepEqual(cached.matrixWorld.elements, reference.matrixWorld.elements);
  }
});
