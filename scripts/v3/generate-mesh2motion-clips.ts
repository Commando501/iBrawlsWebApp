import { resolve } from 'node:path';
import { generateV3Mesh2MotionClipsSourceFile } from '../../src/tools/v3Mesh2MotionImporter';

const inputIndex = process.argv.indexOf('--input');
const outputIndex = process.argv.indexOf('--out');

const inputPath = inputIndex >= 0
  ? process.argv[inputIndex + 1]
  : 'reference/mesh2motion-v3/exported-model.glb';
const outputPath = outputIndex >= 0
  ? process.argv[outputIndex + 1]
  : 'src/components/grifball/v3Mesh2MotionClips.generated.ts';

if (!inputPath || !outputPath) {
  throw new Error('Usage: npm run v3:generate-mesh2motion-clips -- --input <mesh2motion glb> --out <generated ts path>');
}

const artifact = generateV3Mesh2MotionClipsSourceFile({
  filePath: resolve(inputPath),
  outputPath: resolve(outputPath),
  fps: 30,
});

// eslint-disable-next-line no-console
console.log(`Generated ${artifact.metrics.clipCount} V3 Mesh2Motion clips: ${artifact.clips.map((clip) => clip.sourceClipName).join(', ')}`);
