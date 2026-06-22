import { resolve } from 'node:path';
import { generateV3AuthoredClipModule } from '../../src/tools/v3CleanAnimationEditorGenerator';

const sourceDir = resolve(process.argv[2] ?? 'reference/v3-authored-clips');
const outputPath = resolve(
  process.argv[3] ?? 'src/components/grifball/v3ManualAuthoredAnimationClips.generated.ts'
);

const report = generateV3AuthoredClipModule(sourceDir, outputPath);
console.log(`Generated ${report.clipCount} V3 manual authored clips: ${report.clipIds.join(', ') || 'none'}`);
console.log(report.outputPath);
