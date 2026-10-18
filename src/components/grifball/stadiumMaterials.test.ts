import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs, createStadiumCeramicMaterial, createStadiumFloorMaterial, createStadiumMaterial, loadStadiumScreenTexture, waitForStadiumTextures } from './stadiumMaterials';

function mockTextureLoading(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', fillRect() {} }),
      }),
    },
  });
  const requests: { url: string; complete: (image: HTMLImageElement) => void; fail: () => void }[] = [];
  t.mock.method(THREE.ImageLoader.prototype, 'load', (url: string, onLoad?: (image: HTMLImageElement) => void, _onProgress?: unknown, onError?: (error: unknown) => void) => {
    requests.push({ url, complete: image => onLoad?.(image), fail: () => onError?.(new Error('Missing image')) });
    return {} as HTMLImageElement;
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return requests;
}

function materialTextures(material: THREE.MeshStandardMaterial): THREE.Texture[] {
  return [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]
    .filter((texture): texture is THREE.Texture => texture !== null);
}

function disposeMaterial(material: THREE.MeshStandardMaterial) {
  materialTextures(material).forEach(texture => texture.dispose());
  material.dispose();
}

function readAuthoredSurface(name: string) {
  const data = readFileSync(new URL(`../../../public/assets/stadium/surfaces/${name}.png`, import.meta.url));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  assert.equal(data[24], 8, 'authored maps use 8-bit channels');
  assert.equal(data[25], 2, 'authored maps use RGB');
  const blocks: Buffer[] = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    if (data.toString('ascii', offset + 4, offset + 8) === 'IDAT') blocks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(blocks)), pixels = Buffer.alloc(width * height * 3);
  assert.equal(rows.length, height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    assert.equal(rows[start], 0, 'the deterministic authoring pipeline emits unfiltered rows');
    rows.copy(pixels, y * width * 3, start + 1, start + 1 + width * 3);
  }
  return { width, height, pixels, bytes: data.length };
}

test('shipped floor color stays quiet across both quality tiers and within its download budget', () => {
  for (const [name, expectedSize, budget] of [['floor-albedo', 1024, 220000], ['floor-albedo-low', 512, 80000]] as const) {
    const map = readAuthoredSurface(name);
    assert.equal(map.width, expectedSize);
    assert.equal(map.height, expectedSize);
    assert.ok(map.bytes < budget, 'surface detail must remain inexpensive to load');
    let min = 255, max = 0, sum = 0, squared = 0;
    for (let i = 0; i < map.pixels.length; i += 3) {
      const value = map.pixels[i];
      assert.equal(value, map.pixels[i + 1]);
      assert.equal(value, map.pixels[i + 2], 'tint is supplied by the material, avoiding distracting colored speckles');
      min = Math.min(min, value); max = Math.max(max, value);
      sum += value; squared += value * value;
    }
    const count = map.width * map.height, standardDeviation = Math.sqrt(squared / count - (sum / count) ** 2);
    assert.ok(min >= 210 && max <= 242, 'joints and wear must avoid high-contrast black or white marks');
    assert.ok(standardDeviation < 2, 'microdetail should change reflected light rather than create a noisy painted pattern');
    assert.ok(max - min >= 10, 'the fallback must retain its subtle expansion joints');
  }
});

test('physical surface maps provide shallow relief and varied reflectance at bounded resolution', () => {
  for (const kind of ['floor', 'ceramic-coating']) {
    const normal = readAuthoredSurface(`${kind}-normal-gl`);
    const roughness = readAuthoredSurface(`${kind}-roughness`);
    for (const map of [normal, roughness]) {
      assert.equal(map.width, 1024);
      assert.equal(map.height, 1024);
      assert.ok(map.bytes < 850000);
    }
    let minRoughness = 255, maxRoughness = 0, hasRelief = false;
    for (let i = 0; i < normal.pixels.length; i += 3) {
      assert.ok(normal.pixels[i + 2] >= 245, 'coating detail must not resemble deep rocky displacement');
      hasRelief ||= Math.abs(normal.pixels[i] - 128) > 2 || Math.abs(normal.pixels[i + 1] - 128) > 2;
      minRoughness = Math.min(minRoughness, roughness.pixels[i]);
      maxRoughness = Math.max(maxRoughness, roughness.pixels[i]);
    }
    assert.ok(hasRelief);
    assert.ok(minRoughness > 130 && maxRoughness - minRoughness > 25, 'soft coating variation must remain visible without glossy puddles');
  }
});

test('stadium materials share image sources with independently disposable texture handles', t => {
  const requests = mockTextureLoading(t);
  const first = createStadiumMaterial('metal');
  const surviving = createStadiumMaterial('metal');
  t.after(() => { disposeMaterial(first); disposeMaterial(surviving); });
  assert.equal(requests.length, 5, 'two material instances need one request per source image');
  const firstTextures = materialTextures(first);
  const survivingTextures = materialTextures(surviving);
  firstTextures.forEach((texture, index) => {
    assert.notEqual(texture, survivingTextures[index]);
    assert.equal(texture.source, survivingTextures[index].source);
  });

  const disposedVersion = first.map!.version;
  const survivingVersion = surviving.map!.version;
  disposeMaterial(first);
  const loadedImage = { width: 2048, height: 2048 } as HTMLImageElement;
  requests.find(request => request.url.endsWith('/albedo.jpg'))!.complete(loadedImage);
  assert.equal(first.map!.version, disposedVersion, 'completion must not flag disposed handles for upload');
  assert.equal(surviving.map!.version, survivingVersion + 1);
  assert.equal(surviving.map!.image, loadedImage);

  const later = createStadiumMaterial('metal');
  t.after(() => disposeMaterial(later));
  assert.equal(requests.length, 5);
  assert.equal(later.map!.source, surviving.map!.source, 'a live owner keeps the shared loaded source');
});

test('late image completion after scene disposal cannot replace a new scene source', t => {
  const requests = mockTextureLoading(t);
  const old = createStadiumMaterial('concrete');
  const oldSource = old.map!.source;
  disposeMaterial(old);

  const current = createStadiumMaterial('concrete');
  t.after(() => disposeMaterial(current));
  assert.equal(requests.length, 6, 'last-owner disposal releases all three cached sources');
  assert.notEqual(current.map!.source, oldSource);
  const placeholder = current.map!.image;
  const currentVersion = current.map!.version;
  const staleImage = { width: 2048, height: 1024, src: 'old-scene' } as HTMLImageElement;
  requests.slice(0, 3).forEach(request => request.complete(staleImage));
  assert.equal(current.map!.image, placeholder);
  assert.equal(current.map!.version, currentVersion);

  // A stale owner's repeated disposal must not evict the replacement entry.
  disposeMaterial(old);
  const another = createStadiumMaterial('concrete');
  t.after(() => disposeMaterial(another));
  assert.equal(requests.length, 6);
  assert.equal(another.map!.source, current.map!.source);
  const currentImage = { width: 2048, height: 1024, src: 'current-scene' } as HTMLImageElement;
  requests.slice(3, 6).forEach(request => request.complete(currentImage));
  assert.equal(current.map!.image, currentImage);
  assert.equal(another.map!.image, currentImage);

  disposeMaterial(current);
  disposeMaterial(another);
  const next = createStadiumMaterial('concrete');
  t.after(() => disposeMaterial(next));
  assert.equal(requests.length, 9, 'completion did not resurrect the released cache');
  assert.notEqual(next.map!.source, current.map!.source);
});

test('stadium color and data maps use appropriate color spaces and sampler modes', t => {
  mockTextureLoading(t);
  const metal = createStadiumMaterial('metal');
  const concrete = createStadiumMaterial('concrete');
  const screen = loadStadiumScreenTexture('championship');
  t.after(() => { disposeMaterial(metal); disposeMaterial(concrete); screen.dispose(); });

  assert.equal(metal.map!.colorSpace, THREE.SRGBColorSpace);
  for (const texture of [metal.normalMap, metal.roughnessMap, metal.metalnessMap, metal.aoMap]) {
    assert.equal(texture!.colorSpace, THREE.NoColorSpace);
  }
  for (const texture of materialTextures(metal)) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [1, 1]);
  }
  for (const texture of materialTextures(concrete)) {
    assert.deepEqual(texture.repeat.toArray(), [1, 2], '2:1 source aspect must retain physical texel proportions');
  }
  assert.equal(screen.colorSpace, THREE.SRGBColorSpace);
  assert.equal(screen.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(screen.wrapT, THREE.ClampToEdgeWrapping);
});

test('world UV density follows metres on each box face instead of stretching with its footprint', () => {
  const geometry = new THREE.BoxGeometry(12, 3, 6);
  applyStadiumWorldUVs(geometry, 3);
  const uv = geometry.getAttribute('uv');
  const span = (firstVertex: number, component: 'getX' | 'getY') => {
    const values = Array.from({ length: 4 }, (_, offset) => uv[component](firstVertex + offset));
    return Math.max(...values) - Math.min(...values);
  };
  // BoxGeometry orders its faces +X, -X, +Y, -Y, +Z, -Z.
  for (const firstVertex of [0, 4]) {
    assert.equal(span(firstVertex, 'getX'), 2);
    assert.equal(span(firstVertex, 'getY'), 1);
  }
  for (const firstVertex of [8, 12]) {
    assert.equal(span(firstVertex, 'getX'), 4);
    assert.equal(span(firstVertex, 'getY'), 2);
  }
  for (const firstVertex of [16, 20]) {
    assert.equal(span(firstVertex, 'getX'), 4);
    assert.equal(span(firstVertex, 'getY'), 1);
  }
  geometry.dispose();
});

test('unloaded stadium textures defer GPU allocation until an image has its final dimensions', t => {
  const requests = mockTextureLoading(t);
  const pending = createStadiumMaterial('metal');
  t.after(() => disposeMaterial(pending));
  for (const texture of materialTextures(pending)) {
    assert.equal(texture.source.data, null, 'a placeholder image could allocate immutable GPU storage at the wrong size');
    assert.equal(texture.version, 0, 'unloaded textures must not request a GPU upload');
  }

  const images = requests.map(request => {
    const image = { width: 2048, height: 2048, src: request.url } as HTMLImageElement;
    request.complete(image);
    return image;
  });
  materialTextures(pending).forEach((texture, index) => {
    assert.equal(texture.source.data, images[index]);
    assert.ok(texture.version > 0, 'image completion requests the first upload at the final resolution');
  });

  const alreadyLoaded = createStadiumMaterial('metal');
  t.after(() => disposeMaterial(alreadyLoaded));
  assert.equal(requests.length, 5);
  materialTextures(alreadyLoaded).forEach((texture, index) => {
    assert.equal(texture.source, materialTextures(pending)[index].source);
    assert.equal(texture.source.data, images[index]);
    assert.ok(texture.version > 0, 'a new handle joining a loaded source must be immediately uploadable');
  });
});

test('low environment quality keeps quiet floor detail using only small color textures', t => {
  const requests = mockTextureLoading(t);
  const quality = getEnvironmentQualityProfile('low');
  const metal = createStadiumMaterial('metal', {}, quality);
  const concrete = createStadiumMaterial('concrete', {}, quality);
  const ceramic = createStadiumCeramicMaterial({}, quality);
  const floor = createStadiumFloorMaterial(quality);
  const screen = loadStadiumScreenTexture('championship', quality);
  t.after(() => { [metal, concrete, ceramic, floor].forEach(disposeMaterial); screen.dispose(); });
  assert.equal(requests.length, 5);
  assert.ok(requests.every(request => /-low\.(jpg|png)$/.test(request.url)));
  assert.ok(requests.some(request => request.url.endsWith('ceramic/albedo-low.jpg')));
  assert.ok(requests.some(request => request.url.endsWith('surfaces/floor-albedo-low.png')));
  assert.ok(requests.some(request => request.url.endsWith('screens/championship-low.jpg')));
  for (const material of [metal, concrete, ceramic, floor]) {
    assert.equal(material.normalMap, null);
    assert.equal(material.roughnessMap, null);
    assert.equal(material.aoMap, null);
    assert.equal(material.metalnessMap, null);
  }
  for (const texture of [metal.map!, concrete.map!, ceramic.map!, floor.map!, screen]) assert.equal(texture.anisotropy, 2);
});

test('ceramic uses generated color with a separately treated physical normal and tiered anisotropy', t => {
  const requests = mockTextureLoading(t);
  const high = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('high'));
  const balanced = createStadiumCeramicMaterial({}, getEnvironmentQualityProfile('balanced'));
  t.after(() => { disposeMaterial(high); disposeMaterial(balanced); });
  assert.equal(requests.length, 3, 'quality sampler differences can reuse the same source images');
  assert.ok(requests.some(request => request.url.endsWith('/ceramic/albedo.jpg')));
  assert.equal(high.map!.source, balanced.map!.source);
  assert.equal(high.map!.colorSpace, THREE.SRGBColorSpace);
  assert.equal(high.normalMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.roughnessMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(high.map!.anisotropy, 8);
  assert.equal(balanced.map!.anisotropy, 4);
  assert.ok(requests.some(request => request.url.endsWith('/surfaces/ceramic-coating-normal-gl.png')));
  assert.ok(requests.some(request => request.url.endsWith('/surfaces/ceramic-coating-roughness.png')));
});

test('explicit texture overrides do not start unowned background downloads', t => {
  const requests = mockTextureLoading(t);
  const ceramic = createStadiumCeramicMaterial({ map: null, normalMap: null, roughnessMap: null });
  const metal = createStadiumMaterial('metal', { map: null, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null });
  t.after(() => { disposeMaterial(ceramic); disposeMaterial(metal); });
  assert.equal(requests.length, 0);
});

test('texture readiness waits for active downloads and resolves failed downloads with usable fallbacks', async t => {
  const requests = mockTextureLoading(t);
  t.mock.method(console, 'warn', () => {});
  const material = createStadiumMaterial('concrete');
  t.after(() => disposeMaterial(material));
  let ready = false;
  const gate = waitForStadiumTextures().then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  requests[0].fail();
  const image = { width: 2048, height: 1024 } as HTMLImageElement;
  requests.slice(1).forEach(request => request.complete(image));
  await gate;
  assert.equal(ready, true);
  assert.equal((material.map!.image as HTMLCanvasElement).width, 1);
  assert.ok(material.map!.version > 0);
  assert.equal(material.normalMap!.image, image);
});

test('texture readiness is bounded and late success cannot resize a terminal fallback', async t => {
  const requests = mockTextureLoading(t);
  t.mock.method(console, 'warn', () => {});
  const material = createStadiumMaterial('concrete');
  t.after(() => disposeMaterial(material));
  await waitForStadiumTextures(0);
  const fallback = material.map!.image as HTMLCanvasElement;
  const fallbackVersion = material.map!.version;
  assert.equal(fallback.width, 1);
  requests[0].complete({ width: 2048, height: 1024 } as HTMLImageElement);
  assert.equal(material.map!.image, fallback);
  assert.equal(material.map!.version, fallbackVersion);
  await waitForStadiumTextures(0);
});

test('disposing the last texture owner releases pending readiness immediately', async t => {
  mockTextureLoading(t);
  const material = createStadiumMaterial('concrete');
  const ready = waitForStadiumTextures();
  disposeMaterial(material);
  await ready;
  assert.equal(material.map!.source.data, null);
});
