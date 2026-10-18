import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, createStadiumFloorMaterial } from './stadiumMaterials';
import { createCanyonArchitectureMaterial, createCanyonFloorMaterial, waitForCanyonTextures } from './canyonMaterials';

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
  return createCanyonArchitectureMaterial({ name: `canyon_${role}`, side: THREE.FrontSide } as THREE.Material, getEnvironmentQualityProfile(tier));
}
function readMap(name: string) {
  const encoded = readFileSync(new URL(`../../../public/assets/canyon/surfaces/${name}.png`, import.meta.url));
  assert.deepEqual([...encoded.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = encoded.readUInt32BE(16), height = encoded.readUInt32BE(20), blocks: Buffer[] = [];
  assert.equal(encoded[24], 8); assert.equal(encoded[25], 2);
  for (let offset = 8; offset < encoded.length;) {
    const length = encoded.readUInt32BE(offset);
    if (encoded.toString('ascii', offset + 4, offset + 8) === 'IDAT') blocks.push(encoded.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(blocks)), pixels = Buffer.alloc(width * height * 3);
  assert.equal(rows.length, height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    assert.equal(rows[start], 0);
    rows.copy(pixels, y * width * 3, start + 1, start + 1 + width * 3);
  }
  return { encoded, pixels, width, height };
}

test('shipped rock pack has bounded resolution, download size, and verified provenance hashes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../public/assets/canyon/surfaces/manifest.json', import.meta.url), 'utf8'));
  assert.match(manifest.provenance, /Original deterministic authored/);
  assert.equal(manifest.normalConvention, 'OpenGL (+Y)');
  assert.equal(manifest.tileMeters, 8);
  let total = 0;
  for (const name of ['rock-albedo', 'rock-albedo-low', 'rock-normal-gl', 'rock-roughness']) {
    const map = readMap(name), entry = manifest.files.find((file: { path: string }) => file.path.endsWith(`${name}.png`));
    const size = name.endsWith('-low') ? 512 : 1024;
    assert.equal(map.width, size); assert.equal(map.height, size);
    assert.equal(entry.bytes, map.encoded.length);
    assert.equal(entry.sha256, createHash('sha256').update(map.encoded).digest('hex'));
    if (name.endsWith('-low')) assert.ok(map.encoded.length < 225000);
    total += map.encoded.length;
  }
  assert.ok(total < 2900000, 'background rock adds less than 2.9 MB including the fallback tier');
});

test('authored rock has moderate color contrast, seamless boundaries, and physical surface relief', () => {
  const albedo = readMap('rock-albedo'), normal = readMap('rock-normal-gl'), roughness = readMap('rock-roughness');
  let sum = 0, squared = 0, min = 255, max = 0, hasRelief = false, seamDifference = 0;
  for (let i = 0; i < albedo.pixels.length; i += 3) {
    const value = albedo.pixels[i]; sum += value; squared += value * value;
    assert.ok(value > albedo.pixels[i + 1] && albedo.pixels[i + 1] > albedo.pixels[i + 2], 'sandstone warmth stays consistent');
    min = Math.min(min, roughness.pixels[i]); max = Math.max(max, roughness.pixels[i]);
    assert.ok(normal.pixels[i + 2] >= 220, 'weathered stone must not turn into deeply displaced spikes');
    hasRelief ||= Math.abs(normal.pixels[i] - 128) > 12 || Math.abs(normal.pixels[i + 1] - 128) > 12;
  }
  for (let n = 0; n < albedo.width; n++) {
    seamDifference += Math.abs(albedo.pixels[(n * albedo.width) * 3] - albedo.pixels[(n * albedo.width + albedo.width - 1) * 3]);
    seamDifference += Math.abs(albedo.pixels[n * 3] - albedo.pixels[((albedo.height - 1) * albedo.width + n) * 3]);
  }
  const count = albedo.width * albedo.height, standardDeviation = Math.sqrt(squared / count - (sum / count) ** 2);
  assert.ok(standardDeviation > 5 && standardDeviation < 14, 'background geology should read without high-contrast painted grunge');
  assert.ok(seamDifference / (albedo.width * 2) < 2, 'the repeat seam is no stronger than the fine surface grain');
  assert.ok(min > 190 && max - min > 20);
  assert.ok(hasRelief);
});

test('playable floor and ceramic share approved Stadium textures with independent ownership', t => {
  const requests = mockLoading(t);
  const floor = createCanyonFloorMaterial(getEnvironmentQualityProfile('high'));
  const stadiumFloor = createStadiumFloorMaterial(getEnvironmentQualityProfile('high'));
  const ceramic = architecture('ceramic');
  const stadiumCeramic = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('high'));
  t.after(() => [floor, stadiumFloor, ceramic, stadiumCeramic].forEach(dispose));
  assert.equal(requests.length, 6, 'shared floor and ceramic need no duplicated source download');
  for (const [first, second] of [[floor, stadiumFloor], [ceramic, stadiumCeramic]]) {
    assert.notEqual(first.map, second.map);
    assert.equal(first.map!.source, second.map!.source);
    assert.equal(first.normalMap!.source, second.normalMap!.source);
  }
  assert.ok(requests.every(request => request.url.includes('/assets/stadium/')));
  assert.ok(requests.some(request => request.url.endsWith('/ceramic/albedo.jpg')));
  assert.equal(floor.emissiveIntensity, 1);
  assert.equal(floor.emissive.getHex(), 0, 'playable flooring has no luminous pattern');
  assert.equal(floor.color.getHexString(), '636966');
});

test('Low uses only 512 color maps while High and Balanced keep PBR with correct data spaces', t => {
  const requests = mockLoading(t);
  const lowMaterials = ['rock', 'alloy', 'graphite', 'ceramic', 'trim', 'cyan', 'warm'].map(role => architecture(role, 'low'));
  const lowFloor = createCanyonFloorMaterial(getEnvironmentQualityProfile('low'));
  t.after(() => [...lowMaterials, lowFloor].forEach(dispose));
  assert.ok(requests.every(request => /-low\.(jpg|png)$/.test(request.url)));
  for (const material of [...lowMaterials, lowFloor]) {
    assert.equal(material.normalMap, null); assert.equal(material.roughnessMap, null);
    assert.equal(material.aoMap, null); assert.equal(material.metalnessMap, null);
    if (material.map) assert.equal(material.map.anisotropy, 2);
  }
  const high = architecture('rock'), balanced = architecture('rock', 'balanced');
  t.after(() => { dispose(high); dispose(balanced); });
  assert.equal(high.map!.source, balanced.map!.source);
  assert.equal(high.map!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(high.normalMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.roughnessMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.map!.anisotropy, 8); assert.equal(balanced.map!.anisotropy, 4);
  textures(high).forEach(texture => {
    assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.image, null, 'no upload before the decoded image dimensions are known');
    assert.equal(texture.version, 0);
  });
});

test('rock lifetime survives sibling disposal and stale downloads cannot replace a later scene', async t => {
  const requests = mockLoading(t);
  const first = architecture('rock'), surviving = architecture('rock');
  t.after(() => { dispose(first); dispose(surviving); });
  assert.equal(requests.length, 3);
  assert.notEqual(first.map, surviving.map);
  assert.equal(first.map!.source, surviving.map!.source);
  dispose(first);
  const version = first.map!.version;
  const image = { width: 1024, height: 1024 } as HTMLImageElement;
  requests.forEach(request => request.complete(image));
  await waitForCanyonTextures();
  assert.equal(first.map!.version, version);
  assert.equal(surviving.map!.image, image);
  const later = architecture('rock');
  t.after(() => dispose(later));
  assert.equal(later.map!.image, image);
  assert.ok(later.map!.version > 0);
  dispose(surviving); dispose(later);
  const current = architecture('rock');
  t.after(() => dispose(current));
  assert.equal(requests.length, 6);
  assert.notEqual(current.map!.source, first.map!.source);
  requests.slice(0, 3).forEach(request => request.complete(image));
  dispose(first);
  assert.equal(current.map!.image, null);
  const sibling = architecture('rock');
  t.after(() => dispose(sibling));
  assert.equal(requests.length, 6, 'repeated stale disposal does not evict a current source');
  assert.equal(sibling.map!.source, current.map!.source);
});

test('one readiness gate waits for reused floor and original rock; missing assets receive neutral fallbacks', async t => {
  const requests = mockLoading(t);
  t.mock.method(console, 'warn', () => {});
  const rock = architecture('rock'), floor = createCanyonFloorMaterial(getEnvironmentQualityProfile('high'));
  t.after(() => { dispose(rock); dispose(floor); });
  let ready = false;
  const gate = waitForCanyonTextures().then(() => { ready = true; });
  requests.filter(request => request.url.includes('/canyon/')).forEach(request => request.fail());
  await Promise.resolve();
  assert.equal(ready, false, 'floor source readiness is part of the Canyon loading gate');
  requests.filter(request => request.url.includes('/stadium/')).forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  await gate;
  assert.equal(ready, true);
  assert.equal((rock.map!.image as HTMLCanvasElement).width, 1);
  assert.equal((rock.map!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#b19779');
  assert.equal((rock.normalMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#8080ff');
  assert.equal((rock.roughnessMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#ffffff');
  assert.equal((floor.map!.image as HTMLImageElement).width, 1024);
});

test('timeout and disposal settle readiness without late immutable texture resizes', async t => {
  const requests = mockLoading(t);
  t.mock.method(console, 'warn', () => {});
  const rock = architecture('rock');
  t.after(() => dispose(rock));
  await waitForCanyonTextures(0);
  const fallback = rock.map!.image, version = rock.map!.version;
  requests[0].complete({ width: 1024, height: 1024 } as HTMLImageElement);
  assert.equal(rock.map!.image, fallback); assert.equal(rock.map!.version, version);
  dispose(rock);
  const pending = architecture('rock');
  const gate = waitForCanyonTextures();
  dispose(pending);
  await gate;
  assert.equal(pending.map!.image, null);
});

test('unknown source materials do not retain or dispose source-owned textures', t => {
  const requests = mockLoading(t);
  const source = new THREE.MeshStandardMaterial({ name: 'new_unmapped_role', map: new THREE.Texture() });
  const result = createCanyonArchitectureMaterial(source);
  t.after(() => { dispose(result); source.map!.dispose(); source.dispose(); });
  assert.equal(requests.length, 0); assert.equal(result.map, null);
  assert.equal(result.transparent, false); assert.equal(result.opacity, 1);
});
