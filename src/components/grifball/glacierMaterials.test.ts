import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial } from './stadiumMaterials';
import { createGlacierArchitectureMaterial, createGlacierFloorMaterial, waitForGlacierTextures } from './glacierMaterials';

function mockLoading(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const context = { fillStyle: '', texts: [] as string[], images: [] as unknown[],
      fillRect() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, arc() {}, fill() {},
      fillText(text: string) { this.texts.push(text); }, drawImage(image: unknown) { this.images.push(image); } };
    return { width: 0, height: 0, getContext: () => context };
  } } });
  const requests: { url: string; complete: (image: HTMLImageElement) => void; fail: () => void }[] = [];
  t.mock.method(THREE.ImageLoader.prototype, 'load', (url: string, onLoad?: (image: HTMLImageElement) => void, _progress?: unknown, onError?: (error: unknown) => void) => {
    requests.push({ url, complete: image => onLoad?.(image), fail: () => onError?.(new Error('Missing image')) });
    return {} as HTMLImageElement;
  });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document'); });
  return requests;
}
const textures = (material: THREE.MeshStandardMaterial) => [...new Set([material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap]
  .filter((texture): texture is THREE.Texture => !!texture))];
function dispose(material: THREE.MeshStandardMaterial) { textures(material).forEach(texture => texture.dispose()); material.dispose(); }
function architecture(role: string, tier: 'high' | 'balanced' | 'low' = 'high') {
  return createGlacierArchitectureMaterial({ name: `glacier_${role}`, side: THREE.FrontSide } as THREE.Material, getEnvironmentQualityProfile(tier));
}

test('quiet floor and approved coating share storage through independent owned handles', t => {
  const requests = mockLoading(t);
  const floor = createGlacierFloorMaterial(), sibling = createGlacierFloorMaterial();
  const alloy = architecture('alloy'), stadium = createStadiumCeramicMaterial();
  t.after(() => [floor, sibling, alloy, stadium].forEach(dispose));
  assert.equal(requests.length, 6);
  for (const [a, b] of [[floor, sibling], [alloy, stadium]]) {
    assert.notEqual(a.map, b.map); assert.equal(a.map!.source, b.map!.source); assert.equal(a.normalMap!.source, b.normalMap!.source);
  }
  assert.equal(requests.filter(request => request.url.includes('/assets/glacier/')).length, 3);
  assert.equal(floor.emissive.getHex(), 0); assert.ok(floor.metalness < .1);
  assert.equal(floor.color.getHexString(), '9eafba');
  assert.equal(floor.map!.repeat.x, 1); assert.equal(floor.map!.repeat.y, 1);
  assert.equal(floor.displacementMap, null); assert.ok(floor.roughness > .8);
});

test('Low uses two shared 512px color sources; High and Balanced keep bounded physical detail', t => {
  const requests = mockLoading(t);
  const materials = ['ceramic', 'alloy', 'graphite', 'red', 'glass', 'ice', 'snow', 'foliage', 'bark'].map(role => architecture(role, 'low'));
  materials.push(createGlacierFloorMaterial(getEnvironmentQualityProfile('low')));
  t.after(() => materials.forEach(dispose));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => /-low\.(jpg|png)$/.test(request.url)));
  materials.forEach(material => {
    assert.equal(material.normalMap, null); assert.equal(material.roughnessMap, null);
    assert.equal(material.aoMap, null); assert.equal(material.metalnessMap, null);
    if (material.map) assert.equal(material.map.anisotropy, 2);
  });
  const high = createGlacierFloorMaterial(), balanced = createGlacierFloorMaterial(getEnvironmentQualityProfile('balanced'));
  t.after(() => { dispose(high); dispose(balanced); });
  assert.equal(high.map!.source, balanced.map!.source);
  assert.equal(high.map!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(high.normalMap!.colorSpace, THREE.NoColorSpace); assert.equal(high.roughnessMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.map!.anisotropy, 8); assert.equal(balanced.map!.anisotropy, 4);
  textures(high).forEach(texture => {
    assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.image, null); assert.equal(texture.version, 0);
  });
});

test('sibling disposal and stale downloads do not mutate a new scene or a surviving floor', async t => {
  const requests = mockLoading(t);
  const first = createGlacierFloorMaterial(), surviving = createGlacierFloorMaterial();
  t.after(() => { dispose(first); dispose(surviving); });
  dispose(first); const oldVersion = first.map!.version;
  const image = { width: 1024, height: 1024 } as HTMLImageElement;
  requests.forEach(request => request.complete(image)); await waitForGlacierTextures();
  assert.equal(first.map!.version, oldVersion); assert.equal(surviving.map!.image, image);
  dispose(surviving);
  const current = createGlacierFloorMaterial(); t.after(() => dispose(current));
  assert.equal(requests.length, 6); assert.notEqual(current.map!.source, first.map!.source);
  requests.slice(0, 3).forEach(request => request.complete(image)); dispose(first);
  assert.equal(current.map!.image, null);
  const sibling = createGlacierFloorMaterial(); t.after(() => dispose(sibling));
  assert.equal(requests.length, 6); assert.equal(sibling.map!.source, current.map!.source);
});

test('coating shared with Stadium survives Glacier handle disposal', async t => {
  const requests = mockLoading(t);
  const coating = architecture('ceramic'), stadium = createStadiumCeramicMaterial();
  t.after(() => { dispose(coating); dispose(stadium); });
  assert.equal(requests.length, 3); dispose(coating); const version = coating.map!.version;
  requests.forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  await waitForGlacierTextures();
  assert.equal(coating.map!.version, version); assert.equal((stadium.map!.image as HTMLImageElement).width, 1024);
});

test('loading gate includes panels and shared coatings with neutral terminal error fallbacks', async t => {
  const requests = mockLoading(t); t.mock.method(console, 'warn', () => {});
  const floor = createGlacierFloorMaterial(), coating = architecture('alloy');
  t.after(() => [floor, coating].forEach(dispose));
  let ready = false; const gate = waitForGlacierTextures().then(() => { ready = true; });
  requests.slice(0, 3).forEach(request => request.fail()); await Promise.resolve();
  assert.equal(ready, false);
  requests.slice(3).forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement)); await gate;
  assert.equal(ready, true);
  const floorImage = floor.map!.image as HTMLCanvasElement;
  assert.equal(floorImage.width, 1); assert.equal(floorImage.getContext('2d')!.fillStyle, '#eeeeee');
  assert.equal((floor.normalMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#8080ff');
  assert.equal((floor.roughnessMap!.image as HTMLCanvasElement).getContext('2d')!.fillStyle, '#dddddd');
  assert.equal((coating.map!.image as HTMLImageElement).width, 1024);
});

test('timeout or early disposal settles both libraries and prevents late storage resizing', async t => {
  const requests = mockLoading(t); t.mock.method(console, 'warn', () => {});
  const floor = createGlacierFloorMaterial(), coating = architecture('graphite');
  t.after(() => { dispose(floor); dispose(coating); });
  await waitForGlacierTextures(0);
  const image = floor.map!.image, version = floor.map!.version;
  requests.forEach(request => request.complete({ width: 2048, height: 2048 } as HTMLImageElement));
  assert.equal(floor.map!.image, image); assert.equal(floor.map!.version, version);
  assert.equal((coating.map!.image as HTMLCanvasElement).width, 1);
  dispose(floor); dispose(coating);
  const pending = createGlacierFloorMaterial(), pendingCoating = architecture('ceramic');
  const gate = waitForGlacierTextures(); dispose(pending); dispose(pendingCoating); await gate;
  assert.equal(pending.map!.image, null); assert.equal(pendingCoating.map!.image, null);
});

test('shipped original maps satisfy physical scale, low floor contrast, periodic edges and texture budgets', () => {
  const root = new URL('../../../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('public/assets/glacier/surfaces/manifest.json', root), 'utf8'));
  assert.equal(manifest.normalConvention, 'OpenGL (+Y)'); assert.equal(manifest.files.length, 4);
  assert.deepEqual(manifest.tileMeters, { floor: 6 });
  assert.ok(manifest.files.reduce((sum: number, file: { bytes: number }) => sum + file.bytes, 0) < 1500000);
  assert.ok(manifest.statistics.floor.standardDeviation < 1.2);
  assert.ok(manifest.statistics.floor.max - manifest.statistics.floor.min < 15);
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
    let seamDifference = 0;
    for (let i = 0; i < width; i++) for (let c = 0; c < 3; c++) {
      seamDifference += Math.abs(rows[i * stride + 1 + c] - rows[i * stride + (width - 1) * 3 + 1 + c]);
      seamDifference += Math.abs(rows[i * 3 + 1 + c] - rows[(height - 1) * stride + i * 3 + 1 + c]);
    }
    assert.ok(seamDifference / (width * 6) < 4, `${file.path} periodic seam`);
    if (file.path.includes('normal-gl')) {
      let tilted = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * stride + x * 3 + 1;
        assert.ok(rows[i + 2] >= 250, 'panel relief stays shallow');
        tilted += Number(Math.abs(rows[i] - 128) > 3 || Math.abs(rows[i + 1] - 128) > 3);
      }
      assert.ok(tilted > width, 'physical detail is not flat');
    }
  }
});

test('only rink glass is transparent and every surface remains non-emissive with protected material settings', t => {
  mockLoading(t);
  const roles = ['ceramic', 'alloy', 'graphite', 'red', 'ice', 'snow', 'foliage', 'bark'];
  const materials = roles.map(role => architecture(role)); t.after(() => materials.forEach(dispose));
  materials.forEach(material => {
    assert.equal(material.userData.preserveEmissiveIntensity, true); assert.equal(material.transparent, false); assert.equal(material.alphaTest, 0);
  });
  materials.forEach(material => assert.equal(material.emissive.getHex(), 0));
  const glass = architecture('glass'); t.after(() => dispose(glass));
  assert.equal(glass.transparent, true); assert.equal(glass.depthWrite, false);
  assert.equal(glass.opacity, .28); assert.equal(glass.forceSinglePass, true);
  assert.equal(glass.emissive.getHex(), 0); assert.equal(glass.userData.preserveEmissiveIntensity, true);
  assert.equal('transmission' in glass, false, 'the glass uses no screen capture or transmission pass');
  const source = new THREE.MeshStandardMaterial({ name: 'future_role', map: new THREE.Texture(), side: THREE.DoubleSide });
  const fallback = createGlacierArchitectureMaterial(source);
  t.after(() => { dispose(fallback); source.map!.dispose(); source.dispose(); });
  assert.equal(fallback.map, null); assert.equal(fallback.side, THREE.DoubleSide);
});

test('ice cliffs share bounded floor texture sources without sharing material or disposal ownership', t => {
  const requests = mockLoading(t);
  const floor = createGlacierFloorMaterial(), cliff = architecture('ice');
  t.after(() => [floor, cliff].forEach(dispose));
  assert.equal(requests.length, 3);
  assert.equal(floor.map!.source, cliff.map!.source); assert.notEqual(floor.map, cliff.map);
  assert.notEqual(floor.color.getHex(), cliff.color.getHex());
  assert.equal(cliff.transparent, false); assert.equal(cliff.displacementMap, null);
  let cliffDisposed = false; cliff.map!.addEventListener('dispose', () => { cliffDisposed = true; });
  dispose(floor); assert.equal(cliffDisposed, false);
  requests.forEach(request => request.complete({ width: 1024, height: 1024 } as HTMLImageElement));
  assert.equal((cliff.map!.image as HTMLImageElement).width, 1024);
});
