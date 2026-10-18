import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, createStadiumFloorMaterial } from './stadiumMaterials';
import { createHangarArchitectureMaterial, createHangarFloorMaterial, waitForHangarTextures } from './hangarMaterials';

function mockLoading(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => {
      const context = { fillStyle: '', fillRect() {} };
      return { width: 0, height: 0, getContext: () => context };
    } },
  });
  const requests: { url: string; complete: (image: HTMLImageElement) => void; fail: () => void }[] = [];
  t.mock.method(THREE.ImageLoader.prototype, 'load', (url: string, onLoad?: (image: HTMLImageElement) => void, _progress?: unknown, onError?: (error: unknown) => void) => {
    requests.push({ url, complete: image => onLoad?.(image), fail: () => onError?.(new Error('Missing image')) });
    return {} as HTMLImageElement;
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return requests;
}
const textures = (material: THREE.MeshStandardMaterial) => [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]
  .filter((texture): texture is THREE.Texture => !!texture);
function dispose(material: THREE.MeshStandardMaterial) {
  textures(material).forEach(texture => texture.dispose());
  material.dispose();
}
function architecture(role: string, tier: 'high' | 'balanced' | 'low' = 'high') {
  return createHangarArchitectureMaterial({ name: `hangar_${role}`, side: THREE.FrontSide } as THREE.Material, getEnvironmentQualityProfile(tier));
}

test('floor and alloy reuse approved quiet Stadium sources through independent scene handles', t => {
  const requests = mockLoading(t);
  const floor = createHangarFloorMaterial(getEnvironmentQualityProfile('high'));
  const stadiumFloor = createStadiumFloorMaterial(getEnvironmentQualityProfile('high'));
  const alloy = architecture('alloy');
  const stadiumCeramic = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('high'));
  t.after(() => [floor, stadiumFloor, alloy, stadiumCeramic].forEach(dispose));
  assert.equal(requests.length, 6);
  for (const [first, second] of [[floor, stadiumFloor], [alloy, stadiumCeramic]]) {
    assert.notEqual(first.map, second.map);
    assert.equal(first.map!.source, second.map!.source);
    assert.equal(first.normalMap!.source, second.normalMap!.source);
  }
  assert.ok(requests.every(request => request.url.includes('/assets/stadium/')));
  assert.ok(requests.every(request => !request.url.includes('/metal-panels/')), 'architecture uses coating detail rather than repeated high-contrast patterning');
  assert.equal(floor.emissive.getHex(), 0);
  assert.equal(floor.color.getHexString(), '535e65');
  assert.equal(floor.roughness, 1);
});

test('Low requests color maps only while High and Balanced keep PBR data and anisotropy budgets', t => {
  const requests = mockLoading(t);
  const low = ['alloy', 'graphite', 'ceramic', 'trim', 'amber', 'light'].map(role => architecture(role, 'low'));
  low.push(createHangarFloorMaterial(getEnvironmentQualityProfile('low')));
  t.after(() => low.forEach(dispose));
  assert.equal(requests.length, 2, 'one coating and one floor source cover all low-tier surfaces');
  assert.ok(requests.every(request => /-low\.(jpg|png)$/.test(request.url)));
  for (const material of low) {
    assert.equal(material.normalMap, null); assert.equal(material.roughnessMap, null);
    assert.equal(material.aoMap, null); assert.equal(material.metalnessMap, null);
    if (material.map) assert.equal(material.map.anisotropy, 2);
  }
  const high = architecture('alloy'), balanced = architecture('alloy', 'balanced');
  t.after(() => { dispose(high); dispose(balanced); });
  assert.equal(high.map!.source, balanced.map!.source);
  assert.equal(high.map!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(high.normalMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.roughnessMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.map!.anisotropy, 8); assert.equal(balanced.map!.anisotropy, 4);
  textures(high).forEach(texture => {
    assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.image, null, 'immutable storage is not allocated before final image dimensions exist');
    assert.equal(texture.version, 0);
  });
});

test('source lifetime survives another map disposal and stale callbacks cannot replace a new scene', async t => {
  const requests = mockLoading(t);
  const first = architecture('ceramic'), surviving = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('high'));
  t.after(() => { dispose(first); dispose(surviving); });
  dispose(first);
  const version = first.map!.version;
  const image = { width: 1024, height: 1024 } as HTMLImageElement;
  requests.forEach(request => request.complete(image));
  await waitForHangarTextures();
  assert.equal(first.map!.version, version);
  assert.equal(surviving.map!.image, image);
  dispose(surviving);
  const current = architecture('ceramic');
  t.after(() => dispose(current));
  assert.equal(requests.length, 6);
  assert.notEqual(current.map!.source, first.map!.source);
  requests.slice(0, 3).forEach(request => request.complete(image));
  dispose(first);
  assert.equal(current.map!.image, null);
  const sibling = architecture('alloy');
  t.after(() => dispose(sibling));
  assert.equal(requests.length, 6);
  assert.equal(sibling.map!.source, current.map!.source);
});

test('readiness includes floor and architecture with neutral terminal fallbacks on failed downloads', async t => {
  const requests = mockLoading(t);
  t.mock.method(console, 'warn', () => {});
  const alloy = architecture('alloy'), floor = createHangarFloorMaterial(getEnvironmentQualityProfile('high'));
  t.after(() => { dispose(alloy); dispose(floor); });
  let ready = false;
  const gate = waitForHangarTextures().then(() => { ready = true; });
  requests.slice(0, 3).forEach(request => request.fail());
  await Promise.resolve();
  assert.equal(ready, false);
  requests.slice(3).forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  await gate;
  assert.equal(ready, true);
  assert.equal((alloy.map!.image as HTMLCanvasElement).width, 1);
  assert.equal((alloy.map!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#ffffff');
  assert.equal((alloy.normalMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#8080ff');
  assert.equal((floor.map!.image as HTMLImageElement).width, 1024);
});

test('timeout and early disposal settle the gate without late texture resizing', async t => {
  const requests = mockLoading(t);
  t.mock.method(console, 'warn', () => {});
  const first = architecture('graphite');
  t.after(() => dispose(first));
  await waitForHangarTextures(0);
  const fallback = first.map!.image, version = first.map!.version;
  requests[0].complete({ width: 1024, height: 1024 } as HTMLImageElement);
  assert.equal(first.map!.image, fallback); assert.equal(first.map!.version, version);
  dispose(first);
  const pending = architecture('trim');
  const gate = waitForHangarTextures();
  dispose(pending);
  await gate;
  assert.equal(pending.map!.image, null);
});

test('authored emission stays reserved to fixtures and no source-owned resources are retained', t => {
  mockLoading(t);
  const roles = ['alloy', 'graphite', 'ceramic', 'trim', 'amber', 'light'];
  const materials = roles.map(role => architecture(role));
  t.after(() => materials.forEach(dispose));
  for (const material of materials) {
    assert.equal(material.userData.preserveEmissiveIntensity, true);
    assert.equal(material.transparent, false);
  }
  materials.slice(0, 4).forEach(material => assert.equal(material.emissive.getHex(), 0));
  assert.equal(materials[4].emissiveIntensity, .55); assert.equal(materials[5].emissiveIntensity, 1.35);
  const source = new THREE.MeshStandardMaterial({ name: 'new_unmapped_role', map: new THREE.Texture(), side: THREE.DoubleSide });
  const unknown = createHangarArchitectureMaterial(source);
  t.after(() => { dispose(unknown); source.map!.dispose(); source.dispose(); });
  assert.equal(unknown.map, null); assert.equal(unknown.side, THREE.DoubleSide);
});
