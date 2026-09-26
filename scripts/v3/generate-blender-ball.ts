import { readFileSync, writeFileSync } from 'node:fs';
const source = JSON.parse(readFileSync('output/blender-repair/blender-skull-bomb.json', 'utf8'));
if (!source.meshes?.length) throw new Error('Missing skull bomb geometry');
for (const mesh of source.meshes) {
  if (!source.palette[mesh.role] || mesh.positions.length % 9 || mesh.positions.length !== mesh.normals.length ||
      !mesh.positions.every(Number.isFinite) || !mesh.normals.every(Number.isFinite)) throw new Error(`Invalid mesh ${mesh.name}`);
}
writeFileSync('src/components/v3/v3SkullBomb.generated.ts',
  `// Generated from Blender author-ball.py.\nimport type { V3SkullBombAsset } from './v3SkullBombModel';\nexport const V3_SKULL_BOMB: V3SkullBombAsset = JSON.parse(${JSON.stringify(JSON.stringify(source))});\n`);
console.log('Generated skull bomb geometry');
