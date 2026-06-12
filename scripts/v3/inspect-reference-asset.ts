import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertV3ReferenceAssetShape,
  parseV3ObjMetadata,
  type V3ObjMetadata,
} from '../../src/tools/v3ObjParser';
import { buildV3OfflineReviewPackage } from '../../src/tools/v3OfflineReviewPackage';

interface InspectArgs {
  objPath: string;
  mtlPath?: string;
  json: boolean;
  reviewJson: boolean;
  outPath?: string;
  previewResolution: number;
  assertReferenceShape: boolean;
}

const readArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
};

const parseArgs = (args: string[]): InspectArgs => {
  const objPath = readArgValue(args, '--obj');
  if (!objPath) {
    throw new Error(
      'Usage: node --import tsx scripts/v3/inspect-reference-asset.ts --obj <path> [--mtl <path>] [--json] [--review-json] [--preview-resolution <n>] [--out <path>] [--assert-reference-shape]'
    );
  }

  return {
    objPath,
    mtlPath: readArgValue(args, '--mtl'),
    json: args.includes('--json'),
    reviewJson: args.includes('--review-json'),
    outPath: readArgValue(args, '--out'),
    previewResolution: parsePreviewResolution(readArgValue(args, '--preview-resolution')),
    assertReferenceShape: args.includes('--assert-reference-shape'),
  };
};

const parsePreviewResolution = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '8', 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 8;
};

const summarizeText = (metadata: V3ObjMetadata, objPath: string, mtlPath?: string): string => [
  `OBJ: ${objPath}`,
  `MTL: ${mtlPath ?? (metadata.materialLibraries.join(', ') || 'none declared')}`,
  `vertices: ${metadata.vertexCount}`,
  `faces: ${metadata.faceCount}`,
  `triangles_estimate: ${metadata.triangleCountEstimate}`,
  `bounds: ${metadata.bounds ? JSON.stringify(metadata.bounds) : 'none'}`,
  `materials: ${metadata.materials.join(', ') || 'none'}`,
  'objects:',
  ...metadata.objects.map((object) =>
    `  - ${object.name}: faces=${object.faceCount}, triangles=${object.triangleCountEstimate}, materials=${object.materialNames.join(', ') || 'none'}, groups=${object.groupNames.join(', ') || 'none'}`
  ),
].join('\n');

export function inspectV3ReferenceAssetForCli(
  args: string[]
): { mode: 'text' | 'json' | 'review-json'; output: string } {
  const options = parseArgs(args);
  if (!existsSync(options.objPath)) {
    throw new Error(`OBJ file does not exist: ${options.objPath}`);
  }
  if (options.mtlPath && !existsSync(options.mtlPath)) {
    throw new Error(`MTL file does not exist: ${options.mtlPath}`);
  }

  const source = readFileSync(options.objPath, 'utf8');
  const mtlSource = options.mtlPath ? readFileSync(options.mtlPath, 'utf8') : undefined;
  const metadata = parseV3ObjMetadata(source, mtlSource);
  if (options.assertReferenceShape) {
    assertV3ReferenceAssetShape(metadata);
  }

  if (options.reviewJson) {
    const output = JSON.stringify(buildV3OfflineReviewPackage({
      sourcePath: options.objPath,
      metadata,
      previewResolution: options.previewResolution,
    }), null, 2);
    if (options.outPath) writeFileSync(options.outPath, output);
    return { mode: 'review-json', output };
  }

  if (options.json) {
    return {
      mode: 'json',
      output: JSON.stringify({
        sourceFile: basename(options.objPath),
        mtlFile: options.mtlPath ? basename(options.mtlPath) : null,
        metadata,
      }, null, 2),
    };
  }

  return { mode: 'text', output: summarizeText(metadata, options.objPath, options.mtlPath) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(inspectV3ReferenceAssetForCli(process.argv.slice(2)).output);
}
