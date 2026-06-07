import { type WeaponPose } from '../components/grifball/attackAnimationPresets';

export type AnimationInterpolationMode = 'linear' | 'smoothstep' | 'easeInOutCubic';

export interface AnimationKeyframe {
  frame: number;
  pose: WeaponPose;
  label?: string;
}

export interface GeneratedAnimationFrame {
  frame: number;
  pose: WeaponPose;
  source: 'keyframe' | 'generated';
}

const TAU = Math.PI * 2;

export const clampFrameIndex = (frame: number, frameCount: number): number => {
  const maxFrame = Math.max(0, Math.floor(frameCount) - 1);
  if (!Number.isFinite(frame)) return 0;
  return Math.min(maxFrame, Math.max(0, Math.round(frame)));
};

export const clonePose = (pose: WeaponPose): WeaponPose => ({
  position: [...pose.position],
  rotation: [...pose.rotation],
});

export const roundPose = (pose: WeaponPose, precision = 4): WeaponPose => {
  const factor = Math.pow(10, precision);
  const round = (value: number) => Math.round(value * factor) / factor;
  return {
    position: [round(pose.position[0]), round(pose.position[1]), round(pose.position[2])],
    rotation: [round(pose.rotation[0]), round(pose.rotation[1]), round(pose.rotation[2])],
  };
};

export const normalizeKeyframes = (
  keyframes: AnimationKeyframe[],
  frameCount: number
): AnimationKeyframe[] => {
  const keyedByFrame = new Map<number, AnimationKeyframe>();

  keyframes.forEach((keyframe) => {
    keyedByFrame.set(clampFrameIndex(keyframe.frame, frameCount), {
      ...keyframe,
      frame: clampFrameIndex(keyframe.frame, frameCount),
      pose: clonePose(keyframe.pose),
    });
  });

  return [...keyedByFrame.values()].sort((a, b) => a.frame - b.frame);
};

const easeProgress = (t: number, mode: AnimationInterpolationMode): number => {
  const pct = Math.min(1, Math.max(0, t));
  if (mode === 'smoothstep') {
    return pct * pct * (3 - 2 * pct);
  }
  if (mode === 'easeInOutCubic') {
    return pct < 0.5 ? 4 * pct * pct * pct : 1 - Math.pow(-2 * pct + 2, 3) / 2;
  }
  return pct;
};

const lerp = (start: number, end: number, t: number): number => start + (end - start) * t;

const shortestAngleDelta = (start: number, end: number): number => {
  let delta = (end - start) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
};

const lerpAngle = (start: number, end: number, t: number): number =>
  start + shortestAngleDelta(start, end) * t;

export const interpolatePose = (
  start: WeaponPose,
  end: WeaponPose,
  progress: number,
  mode: AnimationInterpolationMode = 'smoothstep'
): WeaponPose => {
  const t = easeProgress(progress, mode);
  return {
    position: [
      lerp(start.position[0], end.position[0], t),
      lerp(start.position[1], end.position[1], t),
      lerp(start.position[2], end.position[2], t),
    ],
    rotation: [
      lerpAngle(start.rotation[0], end.rotation[0], t),
      lerpAngle(start.rotation[1], end.rotation[1], t),
      lerpAngle(start.rotation[2], end.rotation[2], t),
    ],
  };
};

export const generatePoseFrames = (
  keyframes: AnimationKeyframe[],
  frameCount: number,
  mode: AnimationInterpolationMode = 'smoothstep'
): GeneratedAnimationFrame[] => {
  const resolvedFrameCount = Math.max(1, Math.floor(frameCount));
  const normalized = normalizeKeyframes(keyframes, resolvedFrameCount);

  if (normalized.length === 0) {
    throw new Error('Animation generation requires at least one keyframe.');
  }

  if (normalized.length === 1) {
    return Array.from({ length: resolvedFrameCount }, (_, frame) => ({
      frame,
      pose: clonePose(normalized[0].pose),
      source: frame === normalized[0].frame ? 'keyframe' : 'generated',
    }));
  }

  const keyframeIndexes = new Set(normalized.map((keyframe) => keyframe.frame));

  return Array.from({ length: resolvedFrameCount }, (_, frame) => {
    const nextIndex = normalized.findIndex((keyframe) => keyframe.frame >= frame);

    if (nextIndex <= 0) {
      return {
        frame,
        pose: clonePose(normalized[0].pose),
        source: keyframeIndexes.has(frame) ? 'keyframe' : 'generated',
      };
    }

    if (nextIndex === -1) {
      const last = normalized[normalized.length - 1];
      return {
        frame,
        pose: clonePose(last.pose),
        source: keyframeIndexes.has(frame) ? 'keyframe' : 'generated',
      };
    }

    const start = normalized[nextIndex - 1];
    const end = normalized[nextIndex];
    const span = Math.max(1, end.frame - start.frame);
    const progress = (frame - start.frame) / span;

    return {
      frame,
      pose: interpolatePose(start.pose, end.pose, progress, mode),
      source: keyframeIndexes.has(frame) ? 'keyframe' : 'generated',
    };
  });
};

export const poseToCode = (pose: WeaponPose, precision = 4): string => {
  const rounded = roundPose(pose, precision);
  const format = (value: number) => Object.is(value, -0) ? '0' : String(value);
  return `{ position: [${rounded.position.map(format).join(', ')}], rotation: [${rounded.rotation.map(format).join(', ')}] }`;
};

export const buildPoseArraySnippet = (
  constName: string,
  frames: GeneratedAnimationFrame[],
  precision = 4
): string => {
  const safeConstName = constName.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^([^A-Za-z_$])/, '_$1');
  const body = frames
    .map((frame) => `  ${poseToCode(frame.pose, precision)}, // frame ${frame.frame}${frame.source === 'keyframe' ? ' key' : ''}`)
    .join('\n');

  return `const ${safeConstName}: WeaponPose[] = [\n${body}\n];`;
};
