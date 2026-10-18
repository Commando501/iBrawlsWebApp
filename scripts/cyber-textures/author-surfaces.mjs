/** Deterministic surface authoring; no downloaded imagery or baked lighting.
 * Run: node scripts/cyber-textures/author-surfaces.mjs
 * PNGs use sRGB values for albedo and linear data for OpenGL normals/roughness.
 * One periodic cell covers 6 by 3*sqrt(3) metres. Geometry, not these maps, defines collision.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = resolve(root, 'public/assets/cyber/surfaces');
mkdirSync(destination, { recursive: true });
const size = 1024;
const tau = Math.PI * 2;
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
const smooth = t => t * t * (3 - 2 * t);
const wrap = (v, n) => (v % n + n) % n;
const hash = (x, y, seed) => {
  let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
// Every octave is periodic at the image boundaries, including its derivative.
function noise(u, v, cells, seed) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const value = (dx, dy) => hash(wrap(ix + dx, cells), wrap(iy + dy, cells), seed);
  return (value(0, 0) * (1 - fx) + value(1, 0) * fx) * (1 - fy)
    + (value(0, 1) * (1 - fx) + value(1, 1) * fx) * fy;
}
// Signed distance to the interior of a periodic regular hexagon cell.
function hexEdgeDistance(u, v) {
  const x = u * 3, y = v * Math.sqrt(3), apothem = Math.sqrt(3) / 2;
  let interior = -Infinity;
  for (let row = -1; row <= 1; row++) for (let column = -1; column <= 1; column++) for (let stagger = 0; stagger < 2; stagger++) {
    const dx = x - (column * 3 + stagger * 1.5);
    const dy = y - (row * Math.sqrt(3) + stagger * apothem);
    const edge = apothem - Math.max(Math.abs(dy), Math.abs(dx * apothem + dy * .5), Math.abs(-dx * apothem + dy * .5));
    interior = Math.max(interior, edge);
  }
  return Math.max(0, interior) * 2; // world metres, hex radius 2m
}
function floorSample(u, v) {
  const distance = hexEdgeDistance(u, v);
  // A 20mm recessed joint, with a gently rounded lip. No painted luminous grid.
  const joint = 1 - smooth(clamp(distance / .020));
  const lip = Math.exp(-Math.pow((distance - .027) / .010, 2));
  const broad = noise(u, v, 4, 821) - .5;
  const grain = noise(u, v, 256, 853) - .5;
  const fine = noise(u, v, 512, 887) - .5;
  const polish = noise(u, v, 8, 929) - .5;
  return {
    albedo: 236 + broad * 3 + grain * 1.8 + fine * .6 - joint * 12 + lip * .8,
    roughness: .77 + broad * .12 + polish * .14 + grain * .025 + joint * .11,
    height: grain * .0006 + fine * .0001 - joint * .0035 + lip * .00025,
  };
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
  header[8] = 8; header[9] = 2; // RGB8. No gamma chunks on linear physical maps.
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(scanlines, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const files = [];
function save(name, pixels, resolution = size) {
  const encoded = png(pixels, resolution, resolution);
  writeFileSync(resolve(destination, `${name}.png`), encoded);
  files.push({ path: `assets/cyber/surfaces/${name}.png`, width: resolution, height: resolution,
    bytes: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex'),
    colorSpace: name.includes('albedo') ? 'sRGB' : 'linear / no color space' });
}
function author(name, sample, tileMeters, includeAlbedo) {
  const albedo = includeAlbedo ? Buffer.alloc(size * size * 3) : null;
  const roughness = Buffer.alloc(size * size * 3);
  const normal = Buffer.alloc(size * size * 3);
  const heights = new Float64Array(size * size);
  let minColor = 255, maxColor = 0, sum = 0, sumSquared = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = sample(x / size, y / size);
    const i = y * size + x;
    heights[i] = p.height;
    const r = Math.round(clamp(p.roughness) * 255);
    roughness.fill(r, i * 3, i * 3 + 3);
    if (albedo) {
      const c = Math.round(clamp(p.albedo, 0, 255));
      albedo.fill(c, i * 3, i * 3 + 3);
      minColor = Math.min(minColor, c); maxColor = Math.max(maxColor, c);
      sum += c; sumSquared += c * c;
    }
  }
  const at = (x, y) => heights[wrap(y, size) * size + wrap(x, size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * size / (2 * tileMeters);
    const dy = (at(x, y + 1) - at(x, y - 1)) * size / (2 * (3 * Math.sqrt(3)));
    const length = Math.hypot(dx, dy, 1), i = (y * size + x) * 3;
    normal[i] = Math.round((-dx / length * .5 + .5) * 255);
    // Image rows descend; OpenGL tangent-space +Y points upward.
    normal[i + 1] = Math.round((dy / length * .5 + .5) * 255);
    normal[i + 2] = Math.round((1 / length * .5 + .5) * 255);
  }
  if (albedo) {
    save(`${name}-albedo`, albedo);
    const lowSize = size / 2, low = Buffer.alloc(lowSize * lowSize * 3);
    for (let y = 0; y < lowSize; y++) for (let x = 0; x < lowSize; x++) for (let channel = 0; channel < 3; channel++) {
      let total = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) total += albedo[((y * 2 + dy) * size + x * 2 + dx) * 3 + channel];
      low[(y * lowSize + x) * 3 + channel] = Math.round(total / 4);
    }
    save(`${name}-albedo-low`, low, lowSize);
  }
  save(`${name}-normal-gl`, normal);
  save(`${name}-roughness`, roughness);
  return includeAlbedo ? { min: minColor, max: maxColor, mean: sum / (size * size),
    standardDeviation: Math.sqrt(sumSquared / (size * size) - Math.pow(sum / (size * size), 2)) } : undefined;
}
const floorAlbedoStatistics = author('hex-floor', floorSample, 6, true);

const manifest = {
  version: 1, generator: 'scripts/cyber-textures/author-surfaces.mjs',
  provenance: 'Original deterministic authored material maps; no third-party source images.',
  normalConvention: 'OpenGL (+Y)', floorTileMeters: [6, 3 * Math.sqrt(3)], floorUVRepeat: [1, 2 / Math.sqrt(3)],
  hexRadiusMeters: 2, hexFlatToFlatMeters: 2 * Math.sqrt(3), floorAlbedoStatistics, files,
  design: 'Quiet slate composite hex tiles with narrow recessed joints, submillimetre coating grain and broad roughness variation. Architecture separately reuses the approved Stadium generated ceramic and coating maps. No baked lighting, lettering, logos, bright grid or high-contrast grunge.',
};
writeFileSync(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, bytes: files.reduce((n, file) => n + file.bytes, 0), floorAlbedoStatistics }));
