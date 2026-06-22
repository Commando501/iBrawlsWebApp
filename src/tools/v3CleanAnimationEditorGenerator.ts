import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildV3AuthoredClipFromExport,
  normalizeV3AuthoredClipExport,
  type V3AuthoredClipId,
} from '../components/grifball/v3AuthoredAnimationClips';

export interface V3AuthoredClipModuleGenerationReport {
  clipCount: number;
  clipIds: V3AuthoredClipId[];
  outputPath: string;
}

const GENERATED_HEADER = `import type {
  V3AuthoredAnimationClip,
  V3AuthoredClipId,
} from './v3AuthoredAnimationClips';

`;

const serializeClipRegistry = (clips: ReturnType<typeof buildV3AuthoredClipFromExport>[]): string => {
  const entries = clips
    .map((clip) => `  ${JSON.stringify(clip.id)}: ${JSON.stringify(clip, null, 2).replace(/\n/g, '\n  ')},`)
    .join('\n');
  return `${GENERATED_HEADER}export const V3_MANUAL_AUTHORED_ANIMATION_CLIPS: Partial<Record<V3AuthoredClipId, V3AuthoredAnimationClip>> = {\n${entries}\n};\n`;
};

export function generateV3AuthoredClipModule(
  sourceJsonDir: string,
  outputTsPath: string
): V3AuthoredClipModuleGenerationReport {
  const files = readdirSync(sourceJsonDir)
    .filter((file) => file.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));
  const clips = files.map((file) => {
    const raw = readFileSync(join(sourceJsonDir, file), 'utf8');
    return buildV3AuthoredClipFromExport(normalizeV3AuthoredClipExport(raw));
  });
  const deduped = new Map<V3AuthoredClipId, ReturnType<typeof buildV3AuthoredClipFromExport>>();
  for (const clip of clips) deduped.set(clip.id, clip);
  const sortedClips = [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(outputTsPath), { recursive: true });
  writeFileSync(outputTsPath, serializeClipRegistry(sortedClips));
  return {
    clipCount: sortedClips.length,
    clipIds: sortedClips.map((clip) => clip.id),
    outputPath: outputTsPath,
  };
}
