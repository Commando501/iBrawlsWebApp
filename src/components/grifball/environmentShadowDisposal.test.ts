import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeStadiumResources } from './stadiumResourceDisposal';
import { disposeCanyonResources } from './canyonResourceDisposal';
import { disposeHangarResources } from './hangarResourceDisposal';
import { disposeCyberResources } from './cyberResourceDisposal';

for (const [map, dispose] of [
  ['stadium', disposeStadiumResources], ['canyon', disposeCanyonResources],
  ['hangar', disposeHangarResources], ['cyber', disposeCyberResources],
] as const) {
  test(`${map} teardown releases owned key and fill shadow targets once without affecting another arena`, () => {
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(); key.name = `${map}_directional_key`;
    const fill = new THREE.Group(); fill.name = `${map}_fill`;
    const rim = new THREE.DirectionalLight(); fill.add(rim);
    const otherKey = new THREE.DirectionalLight(); otherKey.name = 'circle_directional_key';
    const targets = [key, rim, otherKey].flatMap(light => {
      light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
      light.shadow.mapPass = new THREE.WebGLRenderTarget(1, 1);
      return [light.shadow.map, light.shadow.mapPass];
    });
    const counts = new Map<THREE.RenderTarget, number>();
    targets.forEach(target => target.addEventListener('dispose', () => counts.set(target, (counts.get(target) ?? 0) + 1)));
    scene.add(key, fill, otherKey);

    dispose(scene); dispose(scene); dispose(null);

    targets.slice(0, 4).forEach(target => assert.equal(counts.get(target), 1));
    targets.slice(4).forEach(target => assert.equal(counts.has(target), false));
    assert.equal(key.parent, null);
    assert.equal(fill.parent, null);
    assert.deepEqual(scene.children, [otherKey]);
    otherKey.shadow.dispose();
  });
}
