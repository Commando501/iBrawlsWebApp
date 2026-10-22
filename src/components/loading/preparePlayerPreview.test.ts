import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerPreviewPreparation } from './preparePlayerPreview';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  const asset = deferred(), shader = deferred(), calls: string[] = [];
  const scene = new THREE.Scene(), camera = new THREE.Camera(), character = new THREE.Group();
  const child = new THREE.Group(); child.userData.assetReady = asset.promise; character.add(child);
  const preparation = createPlayerPreviewPreparation({ scene, camera,
    renderer: { compileAsync: async () => { calls.push('compile'); await shader.promise; return scene; } },
    onReady: () => calls.push('render'), onError: () => calls.push('error'), dispose: () => calls.push('dispose'),
  });
  return { asset, shader, calls, preparation, character };
}
test('preview waits for model assets and async shader compilation before rendering', async () => {
  const f = fixture(); const pending = f.preparation.prepare(f.character);
  assert.deepEqual(f.calls, []);
  f.asset.resolve(); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.calls, ['compile']);
  f.shader.resolve(); await pending;
  assert.deepEqual(f.calls, ['compile', 'render']);
  f.preparation.stop(); f.preparation.stop();
  assert.deepEqual(f.calls, ['compile', 'render', 'dispose']);
});
test('unmount during compilation defers disposal and cannot render a stale preview', async () => {
  const f = fixture(); const pending = f.preparation.prepare(f.character);
  f.asset.resolve(); await new Promise(r => setImmediate(r));
  f.preparation.stop(); assert.deepEqual(f.calls, ['compile']);
  f.shader.resolve(); await pending;
  assert.deepEqual(f.calls, ['compile', 'dispose']);
});
test('unmount during asset loading releases resources without starting shader compilation', async () => {
  const f = fixture(); const pending = f.preparation.prepare(f.character);
  f.preparation.stop(); assert.deepEqual(f.calls, ['dispose']);
  f.asset.resolve(); await pending;
  assert.deepEqual(f.calls, ['dispose']);
});
