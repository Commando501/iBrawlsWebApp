import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial } from './stadiumMaterials';
import { createCyberArchitectureMaterial, createCyberFloorMaterial, waitForCyberTextures } from './cyberMaterials';

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
  return createCyberArchitectureMaterial({ name: `cyber_${role}`, side: THREE.FrontSide } as THREE.Material, getEnvironmentQualityProfile(tier));
}

test('hex floor and approved coating sources share storage through independently owned handles', t => {
  const requests = mockLoading(t);
  const floor = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  const stadiumFloor = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  const alloy = architecture('alloy');
  const stadiumCeramic = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('high'));
  t.after(() => [floor, stadiumFloor, alloy, stadiumCeramic].forEach(dispose));
  assert.equal(requests.length, 6);
  for (const [first, second] of [[floor, stadiumFloor], [alloy, stadiumCeramic]]) {
    assert.notEqual(first.map, second.map);
    assert.equal(first.map!.source, second.map!.source);
    assert.equal(first.normalMap!.source, second.normalMap!.source);
  }
  assert.equal(requests.filter(request => request.url.includes('/assets/cyber/')).length, 3);
  assert.equal(requests.filter(request => request.url.includes('/assets/stadium/')).length, 3);
  assert.ok(requests.every(request => !request.url.includes('/metal-panels/')), 'architecture uses coating detail rather than repeated high-contrast patterning');
  assert.equal(floor.emissive.getHex(), 0);
  assert.equal(floor.color.getHexString(), '59646b');
  assert.equal(floor.roughness, 1);
  assert.equal(floor.map!.repeat.y, 2 / Math.sqrt(3));
});

test('Low requests color maps only while High and Balanced keep PBR data and anisotropy budgets', t => {
  const requests = mockLoading(t);
  const low = ['alloy', 'graphite', 'ceramic', 'trim', 'cyan', 'core'].map(role => architecture(role, 'low'));
  low.push(createCyberFloorMaterial(getEnvironmentQualityProfile('low')));
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
  await waitForCyberTextures();
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
  const alloy = architecture('alloy'), floor = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  t.after(() => { dispose(alloy); dispose(floor); });
  let ready = false;
  const gate = waitForCyberTextures().then(() => { ready = true; });
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
  await waitForCyberTextures(0);
  const fallback = first.map!.image, version = first.map!.version;
  requests[0].complete({ width: 1024, height: 1024 } as HTMLImageElement);
  assert.equal(first.map!.image, fallback); assert.equal(first.map!.version, version);
  dispose(first);
  const pending = architecture('trim');
  const gate = waitForCyberTextures();
  dispose(pending);
  await gate;
  assert.equal(pending.map!.image, null);
});

test('hex floor handles survive sibling disposal and reject stale or timed-out downloads', async t => {
  const requests = mockLoading(t);
  t.mock.method(console, 'warn', () => {});
  const first = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  const surviving = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  t.after(() => { dispose(first); dispose(surviving); });
  assert.equal(requests.length, 3);
  assert.equal(first.map!.source, surviving.map!.source);
  dispose(first);
  const disposedVersion = first.map!.version;
  requests.forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  await waitForCyberTextures();
  assert.equal(first.map!.version, disposedVersion);
  assert.equal((surviving.map!.image as HTMLImageElement).width, 1024);
  dispose(surviving);
  const current = createCyberFloorMaterial(getEnvironmentQualityProfile('high'));
  t.after(() => dispose(current));
  assert.notEqual(current.map!.source, first.map!.source);
  requests[0].complete({ width: 2048, height: 2048 } as HTMLImageElement);
  assert.equal(current.map!.image, null);
  await waitForCyberTextures(0);
  const fallback = current.map!.image as HTMLCanvasElement, fallbackVersion = current.map!.version;
  assert.equal(fallback.width, 1);
  assert.equal(fallback.getContext('2d')!.fillStyle, '#eeeeee');
  assert.equal((current.normalMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#8080ff');
  requests.slice(3).forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  assert.equal(current.map!.image, fallback);
  assert.equal(current.map!.version, fallbackVersion);
  dispose(current);
  const pending = createCyberFloorMaterial(getEnvironmentQualityProfile('low'));
  const gate = waitForCyberTextures(); dispose(pending); await gate;
  assert.equal(pending.map!.image, null);
});

test('shipped hex maps preserve low contrast, physical normals, repeat continuity, and resolution budgets', () => {
  const root = new URL('../../../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('public/assets/cyber/surfaces/manifest.json', root), 'utf8'));
  assert.equal(manifest.normalConvention, 'OpenGL (+Y)');
  assert.equal(manifest.files.length, 4);
  assert.ok(manifest.floorAlbedoStatistics.standardDeviation < 2);
  assert.ok(manifest.floorAlbedoStatistics.max - manifest.floorAlbedoStatistics.min < 20);
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(`public/${file.path}`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.equal(width, file.path.includes('-low') ? 512 : 1024); assert.equal(height, width);
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const rows = inflateSync(Buffer.concat(chunks)), stride = width * 3 + 1;
    for (let y = 0; y < height; y++) assert.equal(rows[y * stride], 0);
    // Adjacent edge texels are neighbouring periodic samples, not duplicated pixels.
    let seamDifference = 0;
    for (let i = 0; i < width; i++) for (let c = 0; c < 3; c++) {
      seamDifference += Math.abs(rows[i * stride + 1 + c] - rows[i * stride + (width - 1) * 3 + 1 + c]);
      seamDifference += Math.abs(rows[i * 3 + 1 + c] - rows[(height - 1) * stride + i * 3 + 1 + c]);
    }
    assert.ok(seamDifference / (width * 6) < 4, `${file.path} visible periodic seam`);
    if (file.path.includes('normal-gl')) {
      let tilted = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * stride + x * 3 + 1;
        assert.ok(rows[i + 2] >= 246, 'low-angle relief protects floor readability');
        tilted += Number(Math.abs(rows[i] - 128) > 3 || Math.abs(rows[i + 1] - 128) > 3);
      }
      assert.ok(tilted > width, 'recessed seams contain physical relief');
    }
  }
});

test('authored emission stays reserved to fixtures and no source-owned resources are retained', t => {
  mockLoading(t);
  const roles = ['alloy', 'graphite', 'ceramic', 'trim', 'cyan', 'core'];
  const materials = roles.map(role => architecture(role));
  t.after(() => materials.forEach(dispose));
  for (const material of materials) {
    assert.equal(material.userData.preserveEmissiveIntensity, true);
    assert.equal(material.transparent, false);
  }
  materials.slice(0, 4).forEach(material => assert.equal(material.emissive.getHex(), 0));
  assert.equal(materials[4].emissiveIntensity, .65); assert.equal(materials[5].emissiveIntensity, 1.15);
  const source = new THREE.MeshStandardMaterial({ name: 'new_unmapped_role', map: new THREE.Texture(), side: THREE.DoubleSide });
  const unknown = createCyberArchitectureMaterial(source);
  t.after(() => { dispose(unknown); source.map!.dispose(); source.dispose(); });
  assert.equal(unknown.map, null); assert.equal(unknown.side, THREE.DoubleSide);
});
