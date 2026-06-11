import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  assertV3ReferenceAssetShape,
  parseV3ObjMetadata,
  type V3ObjMetadata,
} from '../../src/tools/v3ObjParser';

interface InspectArgs {
  objPath: string;
  mtlPath?: string;
  json: boolean;
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
      'Usage: node --import tsx scripts/v3/inspect-reference-asset.ts --obj <path> [--mtl <path>] [--json] [--assert-reference-shape]'
    );
  }

  return {
    objPath,
    mtlPath: readArgValue(args, '--mtl'),
    json: args.includes('--json'),
    assertReferenceShape: args.includes('--assert-reference-shape'),
  };
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

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.objPath)) {
    throw new Error(`OBJ file does not exist: ${options.objPath}`);
  }
  if (options.mtlPath && !existsSync(options.mtlPath)) {
    throw new Error(`MTL file does not exist: ${options.mtlPath}`);
  }

  const source = readFileSync(options.objPath, 'utf8');
  const metadata = parseV3ObjMetadata(source);
  if (options.assertReferenceShape) {
    assertV3ReferenceAssetShape(metadata);
  }

  if (options.json) {
    console.log(JSON.stringify({
      sourceFile: basename(options.objPath),
      mtlFile: options.mtlPath ? basename(options.mtlPath) : null,
      metadata,
    }, null, 2));
    return;
  }

  console.log(summarizeText(metadata, options.objPath, options.mtlPath));
};

main();
