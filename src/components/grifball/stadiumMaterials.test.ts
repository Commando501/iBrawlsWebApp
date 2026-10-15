import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as THREE from 'three';
import { applyStadiumWorldUVs, createStadiumMaterial, loadStadiumScreenTexture } from './stadiumMaterials';

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
  const requests: { url: string; complete: (image: HTMLImageElement) => void }[] = [];
  t.mock.method(THREE.ImageLoader.prototype, 'load', (url: string, onLoad?: (image: HTMLImageElement) => void) => {
    requests.push({ url, complete: image => onLoad?.(image) });
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
