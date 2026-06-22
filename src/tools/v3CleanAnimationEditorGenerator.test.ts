import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  type V3AuthoredClipExport,
} from '../components/grifball/v3AuthoredAnimationClips';
import { generateV3AuthoredClipModule } from './v3CleanAnimationEditorGenerator';

const manualClip = (): V3AuthoredClipExport => ({
  version: ATLAS_EDITOR_EXPORT_VERSION,
  id: 'clean_hammer_strike',
  label: 'Manual Hammer Strike',
  durationFrames: 12,
  fps: 60,
  loop: false,
  animationAuthority: 'cleanRig',
  keyframes: [
    {
      frame: 0,
      jointQuaternions: {
        upperArmRight: [0, 0, 0, 1],
      },
      weaponPose: {
        weapon: 'hammer',
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        source: 'authoredCleanClip',
      },
    },
  ],
  metadata: {
    authoringSurface: 'v3AnimationAtlasCleanRigEditor',
    sanitized: true,
    mixamoRuntimeAuthority: false,
  },
});

describe('v3CleanAnimationEditorGenerator', () => {
  it('generates a sanitized TypeScript manual clip registry from source JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v3-clean-editor-'));
    const sourcePath = join(dir, 'clean_hammer_strike.json');
    const outputPath = join(dir, 'v3ManualAuthoredAnimationClips.generated.ts');
    writeFileSync(sourcePath, JSON.stringify(manualClip(), null, 2));

    const report = generateV3AuthoredClipModule(dir, outputPath);
    const output = readFileSync(outputPath, 'utf8');

    assert.equal(report.clipCount, 1);
    assert.deepEqual(report.clipIds, ['clean_hammer_strike']);
    assert.equal(output.includes('reference/mixamo-v3'), false);
    assert.equal(output.includes('.fbx'), false);
    assert.match(output, /V3_MANUAL_AUTHORED_ANIMATION_CLIPS/);
    assert.match(output, /Manual Hammer Strike/);
  });
});
