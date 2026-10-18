/** Original, periodic sedimentary rock maps. No external images or baked light.
 * Run: node scripts/canyon/author-surfaces.mjs
 * The quiet playable floor reuses Stadium maps; rock is reserved for scenery.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(root, 'public/assets/canyon/surfaces');
mkdirSync(destination, { recursive: true });
const size = 1024, tileMeters = 8, tau = Math.PI * 2;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => value * value * (3 - 2 * value);
const wrap = (value, span) => (value % span + span) % span;
const hash = (x, y, seed) => {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function noise(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const value = (dx, dy) => hash(wrap(ix + dx, cells), wrap(iy + dy, cells), seed);
  return (value(0, 0) * (1 - fx) + value(1, 0) * fx) * (1 - fy)
    + (value(0, 1) * (1 - fx) + value(1, 1) * fx) * fy;
}
function sample(u, v) {
  const broad = noise(u, v, 4, 509) - .5;
  const mid = noise(u, v, 16, 557) - .5;
  const grain = noise(u, v, 128, 601) - .5;
  const fine = noise(u, v, 512, 647) - .5;
  // Warped, broken strata avoid the straight painted bands of a simple sine.
  const warped = v + broad * .055 + Math.sin(u * tau * 2) * .009;
  const layer = Math.sin(warped * tau * 19 + mid * 1.4);
  const ledge = Math.tanh(layer * 2.1);
  const fractureDistance = Math.abs(noise(u * 1.0, v, 12, 701) - .5);
  const fracture = Math.pow(1 - clamp(fractureDistance / .021), 3)
    * smooth(clamp((noise(u, v, 6, 739) - .46) * 5));
  const mineral = noise(u, v, 32, 787) - .5;
  const color = broad * 35 + mid * 14 + ledge * 4 + grain * 4 + fine * 1.2 - fracture * 11;
  return {
    color: [177 + color + mineral * 5, 151 + color * .94 + mineral * 2, 121 + color * .87],
    height: broad * .18 + mid * .055 + ledge * .007 + grain * .004 + fine * .0007 - fracture * .008,
    roughness: .86 + broad * .10 + mid * .05 + grain * .025 + fracture * .04,
  };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), header = Buffer.alloc(4), footer = Buffer.alloc(4);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, name, data, footer]);
}
function png(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const files = [];
function save(name, pixels, resolution = size) {
  const encoded = png(pixels, resolution, resolution);
  writeFileSync(resolve(destination, `${name}.png`), encoded);
  files.push({ path: `assets/canyon/surfaces/${name}.png`, width: resolution, height: resolution,
    bytes: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex'),
    colorSpace: name.includes('albedo') ? 'sRGB' : 'linear / no color space' });
}
const albedo = Buffer.alloc(size * size * 3), roughness = Buffer.alloc(size * size * 3);
const normal = Buffer.alloc(size * size * 3), heights = new Float64Array(size * size);
let minimum = 255, maximum = 0, sum = 0, squared = 0;
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const p = sample(x / size, y / size), i = y * size + x;
  heights[i] = p.height;
  roughness.fill(Math.round(clamp(p.roughness) * 255), i * 3, i * 3 + 3);
  p.color.forEach((value, channel) => { albedo[i * 3 + channel] = Math.round(clamp(value, 0, 255)); });
  const value = albedo[i * 3];
  minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); sum += value; squared += value * value;
}
const at = (x, y) => heights[wrap(y, size) * size + wrap(x, size)];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = (at(x + 1, y) - at(x - 1, y)) * size / (2 * tileMeters);
  const dy = (at(x, y + 1) - at(x, y - 1)) * size / (2 * tileMeters);
  const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 3;
  normal[i] = Math.round((-dx / length * .5 + .5) * 255);
  // Image rows descend; OpenGL tangent-space +Y points upward.
  normal[i + 1] = Math.round((dy / length * .5 + .5) * 255);
  normal[i + 2] = Math.round((1 / length * .5 + .5) * 255);
}
const lowSize = size / 2, low = Buffer.alloc(lowSize * lowSize * 3);
for (let y = 0; y < lowSize; y++) for (let x = 0; x < lowSize; x++) for (let channel = 0; channel < 3; channel++) {
  let total = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) total += albedo[((y * 2 + dy) * size + x * 2 + dx) * 3 + channel];
  low[(y * lowSize + x) * 3 + channel] = Math.round(total / 4);
}
save('rock-albedo', albedo); save('rock-albedo-low', low, lowSize);
save('rock-normal-gl', normal); save('rock-roughness', roughness);
const albedoStatistics = { minimumRed: minimum, maximumRed: maximum, meanRed: sum / (size * size),
  redStandardDeviation: Math.sqrt(squared / (size * size) - (sum / (size * size)) ** 2) };
const manifest = {
  version: 1, generator: 'scripts/canyon/author-surfaces.mjs',
  provenance: 'Original deterministic authored sedimentary rock maps; no third-party source images or generated depictions of game models.',
  normalConvention: 'OpenGL (+Y)', tileMeters, albedoStatistics,
  design: 'Warm geological strata, broken shallow ledges and weathered grain for background rock. No baked illumination. Traversable surfaces reuse the quiet Stadium floor; architecture reuses its approved generated ceramic albedo and physical coating maps.',
  sharedAssets: ['assets/stadium/surfaces/floor-*', 'assets/stadium/ceramic/albedo*', 'assets/stadium/surfaces/ceramic-coating-*', 'assets/stadium/metal-panels/*'],
  files,
};
writeFileSync(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0), albedoStatistics }));
