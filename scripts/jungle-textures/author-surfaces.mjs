/** Original deterministic, periodic PBR materials. Run with Node; no image library or downloads. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(root, 'public/assets/jungle/surfaces');
mkdirSync(destination, { recursive: true });
const size = 1024, tau = Math.PI * 2;
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
const smooth = t => t * t * (3 - 2 * t);
const wrap = (v, n) => (v % n + n) % n;
function hash(x, y, seed) {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(u, v, cells, seed) {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const value = (dx, dy) => hash(wrap(ix + dx, cells), wrap(iy + dy, cells), seed);
  return (value(0, 0) * (1 - fx) + value(1, 0) * fx) * (1 - fy)
    + (value(0, 1) * (1 - fx) + value(1, 1) * fx) * fy;
}
function ground(u, v) {
  const broad = noise(u, v, 3, 251) - .5, weather = noise(u, v, 11, 347) - .5;
  const grain = noise(u, v, 128, 557) - .5, fine = noise(u, v, 384, 683) - .5;
  const moss = smooth(clamp((noise(u, v, 4, 419) - .48) * 2.6));
  const tone = 226 + broad * 12 + weather * 3 + grain * 1.5;
  return { albedo: [tone - moss * 7, tone + moss * 1.5, tone - moss * 10],
    roughness: .88 + weather * .12 + broad * .08 + moss * .025,
    height: broad * .006 + weather * .006 + grain * .0035 + fine * .0008 };
}
function stone(u, v) {
  const broad = noise(u, v, 4, 733) - .5, weather = noise(u, v, 16, 811) - .5;
  const grain = noise(u, v, 96, 877) - .5, fine = noise(u, v, 384, 919) - .5;
  const pores = Math.pow(clamp((noise(u, v, 192, 977) - .62) * 3), 2);
  const tone = 228 + broad * 17 + weather * 5 - pores * 4;
  return { albedo: [tone, tone + 1, tone - 2], roughness: .85 + weather * .12 + pores * .08,
    height: broad * .014 + weather * .009 + grain * .003 - pores * .003 + fine * .0008 };
}
function bark(u, v) {
  const bend = Math.sin(v * tau * 3) * .003 + Math.sin(v * tau * 7) * .001;
  const ridges = Math.pow(.5 + Math.sin((u + bend) * tau * 24) * .5, 3);
  const broad = noise(u, v, 5, 1051) - .5, grain = noise(u, v, 128, 1097) - .5;
  const tone = 219 + broad * 18 + ridges * 5 + grain * 2;
  return { albedo: [tone + 3, tone, tone - 4], roughness: .9 + broad * .09 - ridges * .04,
    height: ridges * .009 + broad * .01 + grain * .002 };
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const header = Buffer.alloc(4), footer = Buffer.alloc(4);
  header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, name, data, footer]);
}
function png(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const files = [];
function save(name, pixels, resolution = size) {
  const encoded = png(pixels, resolution, resolution);
  writeFileSync(resolve(destination, `${name}.png`), encoded);
  files.push({ path: `assets/jungle/surfaces/${name}.png`, width: resolution, height: resolution, bytes: encoded.length,
    sha256: createHash('sha256').update(encoded).digest('hex'), colorSpace: name.includes('albedo') ? 'sRGB' : 'linear / no color space' });
}
function author(name, sample, tileMeters) {
  const albedo = Buffer.alloc(size * size * 3), roughness = Buffer.alloc(size * size * 3), normal = Buffer.alloc(size * size * 3);
  const heights = new Float64Array(size * size);
  let min = 255, max = 0, sum = 0, sumSquared = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = sample(x / size, y / size), i = y * size + x;
    heights[i] = p.height;
    roughness.fill(Math.round(clamp(p.roughness) * 255), i * 3, i * 3 + 3);
    p.albedo.forEach((value, c) => { albedo[i * 3 + c] = Math.round(clamp(value, 0, 255)); });
    const luminance = p.albedo[0] * .2126 + p.albedo[1] * .7152 + p.albedo[2] * .0722;
    min = Math.min(min, luminance); max = Math.max(max, luminance); sum += luminance; sumSquared += luminance ** 2;
  }
  const at = (x, y) => heights[wrap(y, size) * size + wrap(x, size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * size / (2 * tileMeters);
    const dy = (at(x, y + 1) - at(x, y - 1)) * size / (2 * tileMeters);
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 3;
    normal[i] = Math.round((-dx / length * .5 + .5) * 255);
    normal[i + 1] = Math.round((dy / length * .5 + .5) * 255);
    normal[i + 2] = Math.round((1 / length * .5 + .5) * 255);
  }
  save(`${name}-albedo`, albedo); save(`${name}-normal-gl`, normal); save(`${name}-roughness`, roughness);
  const lowSize = size / 2, low = Buffer.alloc(lowSize * lowSize * 3);
  for (let y = 0; y < lowSize; y++) for (let x = 0; x < lowSize; x++) for (let c = 0; c < 3; c++) {
    let total = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) total += albedo[((y * 2 + dy) * size + x * 2 + dx) * 3 + c];
    low[(y * lowSize + x) * 3 + c] = Math.round(total / 4);
  }
  save(`${name}-albedo-low`, low, lowSize);
  return { min, max, mean: sum / (size * size), standardDeviation: Math.sqrt(sumSquared / (size * size) - (sum / (size * size)) ** 2) };
}
const statistics = { ground: author('ground', ground, 6), stone: author('stone', stone, 3), bark: author('bark', bark, 3) };
const manifest = {
  version: 1, generator: 'scripts/jungle-textures/author-surfaces.mjs',
  provenance: 'Original deterministic authored material maps; no third-party source images.',
  normalConvention: 'OpenGL (+Y)', tileMeters: { ground: 6, stone: 3, bark: 3 }, statistics, files,
  design: 'Quiet compact earth/stone ground with broad subtle moss color; physical micrograin and roughness carry detail. Weathered stone and vertical bark relief use distinct surface families. No baked shadows, bright markings, sharp ground debris, or displacement. Relic armor separately reuses approved Stadium coating.',
};
writeFileSync(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), statistics }));
