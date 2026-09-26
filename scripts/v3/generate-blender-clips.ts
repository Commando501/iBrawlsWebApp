import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { V3BlenderAnimationSet, V3BlenderTransformTrack } from '../../src/components/grifball/v3BlenderAnimationTypes';
import { V3_AUTHORED_ANIMATION_CLIP_IDS } from '../../src/components/grifball/v3AuthoredAnimationClips';

const args = process.argv.slice(2);
const selection = args.find(arg => arg.startsWith('--clips='))?.slice('--clips='.length).split(',');
const paths = args.filter(arg => !arg.startsWith('--clips='));
const input = resolve(paths[0] ?? 'output/blender-repair/blender-authored-clips.json');
const output = resolve(paths[1] ?? 'src/components/grifball/v3BlenderAnimationClips.generated.ts');
const source = JSON.parse(readFileSync(input, 'utf8'));
if (source.schema !== 1 || source.fps !== 60 || source.space !== 'three-y-up-game-forward-minus-z') {
  throw new Error('Expected a Blender schema-1, 60 FPS bake in game coordinates.');
}
const compact = (values: number[][]): number[][] => {
  const rounded = values.map(row => row.map(value => {
    if (!Number.isFinite(value)) throw new Error('Non-finite baked transform.');
    return Number(value.toFixed(6));
  }));
  return rounded.every(row => row.every((value, i) => Math.abs(value - rounded[0][i]) < 0.000002))
    ? [rounded[0]] : rounded;
};
const track = (positions: number[][], quaternions: number[][]): V3BlenderTransformTrack => {
  for (let i = 0; i < quaternions.length; i++) {
    const q = quaternions[i];
    if (q.length !== 4 || Math.abs(Math.hypot(...q) - 1) > .001) throw new Error('Invalid baked quaternion.');
    if (i && q.reduce((sum, value, k) => sum + value * quaternions[i - 1][k], 0) < 0) {
      quaternions[i] = q.map(value => -value);
    }
  }
  if (positions.some(p => p.length !== 3)) throw new Error('Invalid baked translation.');
  return { positions: compact(positions), quaternions: compact(quaternions) };
};
const artifact: V3BlenderAnimationSet = { schema: 1, fps: 60, clips: {} };
for (const clip of source.clips) {
  if (!Number.isInteger(clip.durationFrames) || clip.durationFrames < 1 || clip.samples.length !== clip.durationFrames + 1) {
    throw new Error(`Invalid frame count in ${clip.id}`);
  }
  if (artifact.clips[clip.id]) throw new Error(`Duplicate clip ${clip.id}`);
  const joints = Object.fromEntries(Object.keys(clip.samples[0].joints).map(name => [name, track(
    clip.samples.map(s => s.joints[name].slice(0, 3)),
    clip.samples.map(s => s.joints[name].slice(3, 7))
  )]));
  artifact.clips[clip.id] = {
    durationFrames: clip.durationFrames, loop: clip.loop, weapon: clip.weapon, joints,
    ...(clip.releaseFrame !== undefined ? { releaseFrame: clip.releaseFrame } : {}),
    ...(clip.weapon ? { weaponTrack: track(clip.samples.map(s => s.weapon.position), clip.samples.map(s => s.weapon.quaternion)) } : {}),
    ...(clip.samples[0].weapon?.offhand ? { offhandPositions: compact(clip.samples.map(s => s.weapon.offhand)) } : {}),
  };
}
if (Object.keys(artifact.clips).length !== V3_AUTHORED_ANIMATION_CLIP_IDS.length
  || V3_AUTHORED_ANIMATION_CLIP_IDS.some(id => !artifact.clips[id])) {
  throw new Error('The complete bake must contain every registered V3 clip.');
}
if (selection) {
  const encoded = readFileSync(output, 'utf8').match(/export const V3_BLENDER_ANIMATIONS: V3BlenderAnimationSet = JSON.parse\((.*)\);/);
  if (!encoded) throw new Error('Partial generation requires an existing Blender artifact.');
  const previous: V3BlenderAnimationSet = JSON.parse(JSON.parse(encoded[1]));
  for (const id of selection) if (!artifact.clips[id]) throw new Error(`Unknown selected clip ${id}`);
  for (const id of Object.keys(artifact.clips)) {
    if (!selection.includes(id)) {
      if (!previous.clips[id]) throw new Error(`Previous artifact is missing ${id}`);
      artifact.clips[id] = previous.clips[id];
    }
  }
}
writeFileSync(output, `// Generated from the Blender unified-rig bake. Do not edit by hand.\nimport type { V3BlenderAnimationSet } from './v3BlenderAnimationTypes';\nexport const V3_BLENDER_ANIMATIONS: V3BlenderAnimationSet = JSON.parse(${JSON.stringify(JSON.stringify(artifact))});\n`);
console.log(`Generated ${Object.keys(artifact.clips).length} Blender clips: ${output}`);
