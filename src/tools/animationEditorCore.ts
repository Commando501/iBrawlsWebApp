import { type WeaponPose } from '../components/grifball/attackAnimationPresets';

export type AnimationInterpolationMode = 'linear' | 'smoothstep' | 'easeInOutCubic';
export type RigTargetPose = WeaponPose;
export type RigTargetKind = 'weapon' | 'bone' | 'socket';

export interface SelectedRigTarget {
  kind: RigTargetKind;
  name: string;
  view: 'firstPerson' | 'thirdPerson';
}

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

export interface AnimationEditorRigTrack {
  keyframes: AnimationKeyframe[];
  frames: GeneratedAnimationFrame[];
}

export interface AnimationEditorSocketLock {
  target: SelectedRigTarget;
  socket: SelectedRigTarget;
}

export interface AnimationEditorRigExport {
  bones: Record<string, AnimationEditorRigTrack>;
  sockets: Record<string, AnimationEditorRigTrack>;
  socketLocks?: AnimationEditorSocketLock[];
}

export interface AnimationEditorProceduralProfile {
  modelSystem: 'v3';
  profileVersion: number;
  source: 'v3AnimationFidelity';
}

export interface AnimationEditorExportInput {
  weapon: string;
  view: 'firstPerson' | 'thirdPerson';
  track: string;
  frameCount: number;
  interpolation: AnimationInterpolationMode;
  keyframes: AnimationKeyframe[];
  frames: GeneratedAnimationFrame[];
  rig?: AnimationEditorRigExport;
  proceduralProfile?: AnimationEditorProceduralProfile;
}

export interface AnimationEditorSerializedRigExport {
  bones: Record<string, AnimationEditorRigTrack>;
  sockets: Record<string, AnimationEditorRigTrack>;
  socketLocks: AnimationEditorSocketLock[];
}

export interface AnimationEditorExportPayload {
  tool: 'ibrawls-animation-editor';
  rigVersion: 1;
  weapon: string;
  view: 'firstPerson' | 'thirdPerson';
  track: string;
  proceduralProfile?: AnimationEditorProceduralProfile;
  frameCount: number;
  interpolation: AnimationInterpolationMode;
  keyframes: AnimationKeyframe[];
  frames: GeneratedAnimationFrame[];
  rig: AnimationEditorSerializedRigExport;
}

export interface AnimationEditorHistory<T> {
  past: T[];
  present: T;
  future: T[];
  savedJson: string;
  dirty: boolean;
}

export interface AnimationEditorLoopRange {
  inFrame: number;
  outFrame: number;
}

export interface AnimationEditorKeyframeRetiming {
  fromFrame: number;
  toFrame: number;
  frameCount: number;
}

export interface AnimationEditorLocalVariantRecord {
  storageId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  sourceTrack: string;
  payload: AnimationEditorExportPayload;
}

export interface AnimationEditorImportResult {
  payload: AnimationEditorExportPayload;
}

export type AnimationEditorValidationSeverity = 'info' | 'warning' | 'error';

export interface AnimationEditorValidationItem {
  severity: AnimationEditorValidationSeverity;
  code: string;
  frame?: number;
  target?: string;
  message: string;
}

export interface AnimationEditorValidationReport {
  ok: boolean;
  summary: string;
  items: AnimationEditorValidationItem[];
}

export interface SetKeyframePoseInput {
  currentFrame: number;
  capturedPose: WeaponPose;
  draftFrame: number | null;
  draftPose: WeaponPose | null;
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

export const mergeLinkedArmKeyframesPreservingPositions = (
  linkedKeyframes: AnimationKeyframe[],
  existingKeyframes: AnimationKeyframe[] | undefined,
  existingFrames: GeneratedAnimationFrame[] | undefined,
  frameCount: number
): AnimationKeyframe[] => {
  const existingPositionsByFrame = new Map(
    normalizeKeyframes(existingKeyframes ?? [], frameCount).map((keyframe) => [
      keyframe.frame,
      keyframe.pose.position,
    ])
  );
  const generatedPositionsByFrame = new Map(
    (existingFrames ?? []).map((frame) => [
      clampFrameIndex(frame.frame, frameCount),
      frame.pose.position,
    ])
  );

  return normalizeKeyframes(linkedKeyframes, frameCount).map((keyframe) => {
    const preservedPosition =
      existingPositionsByFrame.get(keyframe.frame) ??
      generatedPositionsByFrame.get(keyframe.frame) ??
      keyframe.pose.position;

    return {
      ...keyframe,
      pose: {
        position: [preservedPosition[0], preservedPosition[1], preservedPosition[2]],
        rotation: [keyframe.pose.rotation[0], keyframe.pose.rotation[1], keyframe.pose.rotation[2]],
      },
    };
  });
};

export const resolveSetKeyframePose = ({
  currentFrame,
  capturedPose,
  draftFrame,
  draftPose,
}: SetKeyframePoseInput): WeaponPose => {
  if (draftFrame === currentFrame && draftPose) {
    return clonePose(draftPose);
  }

  return clonePose(capturedPose);
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

const roundKeyframes = (keyframes: AnimationKeyframe[], precision: number): AnimationKeyframe[] =>
  keyframes.map((keyframe) => ({
    ...keyframe,
    pose: roundPose(keyframe.pose, precision),
  }));

const roundFrames = (frames: GeneratedAnimationFrame[], precision: number): GeneratedAnimationFrame[] =>
  frames.map((frame) => ({
    ...frame,
    pose: roundPose(frame.pose, precision),
  }));

const roundRigTrackMap = (
  tracks: Record<string, AnimationEditorRigTrack> | undefined,
  precision: number
): Record<string, AnimationEditorRigTrack> => {
  if (!tracks) return {};

  return Object.fromEntries(
    Object.entries(tracks).map(([name, track]) => [
      name,
      {
        keyframes: roundKeyframes(track.keyframes, precision),
        frames: roundFrames(track.frames, precision),
      },
    ])
  );
};

export const buildAnimationEditorExportPayload = (
  input: AnimationEditorExportInput,
  precision = 4
): AnimationEditorExportPayload => ({
  tool: 'ibrawls-animation-editor',
  rigVersion: 1,
  weapon: input.weapon,
  view: input.view,
  track: input.track,
  proceduralProfile: input.proceduralProfile ? { ...input.proceduralProfile } : undefined,
  frameCount: input.frameCount,
  interpolation: input.interpolation,
  keyframes: roundKeyframes(normalizeKeyframes(input.keyframes, input.frameCount), precision),
  frames: roundFrames(input.frames, precision),
  rig: {
    bones: roundRigTrackMap(input.rig?.bones, precision),
    sockets: roundRigTrackMap(input.rig?.sockets, precision),
    socketLocks: input.rig?.socketLocks?.map((lock) => ({
      target: { ...lock.target },
      socket: { ...lock.socket },
    })) ?? [],
  },
});

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const serializedJson = <T>(value: T): string => JSON.stringify(value);

export function createAnimationEditorHistory<T>(snapshot: T): AnimationEditorHistory<T> {
  const present = cloneJson(snapshot);
  return {
    past: [],
    present,
    future: [],
    savedJson: serializedJson(present),
    dirty: false,
  };
}

export function commitAnimationEditorHistory<T>(
  history: AnimationEditorHistory<T>,
  nextSnapshot: T
): AnimationEditorHistory<T> {
  const present = cloneJson(history.present);
  const nextPresent = cloneJson(nextSnapshot);
  const nextJson = serializedJson(nextPresent);
  if (nextJson === serializedJson(present)) {
    return {
      ...history,
      present: nextPresent,
      dirty: nextJson !== history.savedJson,
    };
  }

  return {
    past: [...history.past.map(cloneJson), present].slice(-80),
    present: nextPresent,
    future: [],
    savedJson: history.savedJson,
    dirty: nextJson !== history.savedJson,
  };
}

export function undoAnimationEditorHistory<T>(history: AnimationEditorHistory<T>): AnimationEditorHistory<T> {
  if (history.past.length === 0) return history;
  const present = cloneJson(history.past[history.past.length - 1]);
  const past = history.past.slice(0, -1).map(cloneJson);
  return {
    past,
    present,
    future: [cloneJson(history.present), ...history.future.map(cloneJson)],
    savedJson: history.savedJson,
    dirty: serializedJson(present) !== history.savedJson,
  };
}

export function redoAnimationEditorHistory<T>(history: AnimationEditorHistory<T>): AnimationEditorHistory<T> {
  if (history.future.length === 0) return history;
  const present = cloneJson(history.future[0]);
  const future = history.future.slice(1).map(cloneJson);
  return {
    past: [...history.past.map(cloneJson), cloneJson(history.present)],
    present,
    future,
    savedJson: history.savedJson,
    dirty: serializedJson(present) !== history.savedJson,
  };
}

export function markAnimationEditorHistorySaved<T>(history: AnimationEditorHistory<T>): AnimationEditorHistory<T> {
  const present = cloneJson(history.present);
  return {
    ...history,
    present,
    savedJson: serializedJson(present),
    dirty: false,
  };
}

export function clampAnimationEditorLoopRange(
  frameCount: number,
  range: AnimationEditorLoopRange
): AnimationEditorLoopRange {
  const maxFrame = Math.max(0, Math.floor(frameCount) - 1);
  const first = clampFrameIndex(range.inFrame, Math.max(1, frameCount));
  const second = clampFrameIndex(range.outFrame, Math.max(1, frameCount));
  return {
    inFrame: Math.min(first, second, maxFrame),
    outFrame: Math.min(Math.max(first, second), maxFrame),
  };
}

export function nextAnimationEditorLoopFrame(
  currentFrame: number,
  deltaFrames: number,
  frameCount: number,
  range: AnimationEditorLoopRange
): number {
  const loop = clampAnimationEditorLoopRange(frameCount, range);
  const span = Math.max(1, loop.outFrame - loop.inFrame + 1);
  if (currentFrame < loop.inFrame || currentFrame > loop.outFrame) {
    return deltaFrames < 0 ? loop.outFrame : loop.inFrame;
  }
  const base = clampFrameIndex(currentFrame, frameCount);
  return loop.inFrame + ((((base + Math.round(deltaFrames) - loop.inFrame) % span) + span) % span);
}

export function retimeAnimationEditorKeyframe(
  keyframes: AnimationKeyframe[],
  retiming: AnimationEditorKeyframeRetiming
): AnimationKeyframe[] {
  const normalized = normalizeKeyframes(keyframes, retiming.frameCount);
  const fromFrame = clampFrameIndex(retiming.fromFrame, retiming.frameCount);
  const toFrame = clampFrameIndex(retiming.toFrame, retiming.frameCount);
  if (fromFrame === toFrame) return normalized;

  const moved = normalized.find((keyframe) => keyframe.frame === fromFrame);
  if (!moved) return normalized;

  return normalizeKeyframes([
    ...normalized.filter((keyframe) => keyframe.frame !== fromFrame && keyframe.frame !== toFrame),
    {
      ...moved,
      frame: toFrame,
      pose: clonePose(moved.pose),
    },
  ], retiming.frameCount);
}

export function mirrorAnimationEditorPose(pose: WeaponPose): WeaponPose {
  return {
    position: [-pose.position[0], pose.position[1], pose.position[2]],
    rotation: [pose.rotation[0], -pose.rotation[1], -pose.rotation[2]],
  };
}

const swapDirectionalName = (name: string): string => {
  if (name.includes('Left')) return name.replace('Left', 'Right');
  if (name.includes('Right')) return name.replace('Right', 'Left');
  if (name.includes('left')) return name.replace('left', 'right');
  if (name.includes('right')) return name.replace('right', 'left');
  return name;
};

export function mirrorAnimationEditorTarget(target: SelectedRigTarget): SelectedRigTarget {
  return {
    ...target,
    name: swapDirectionalName(target.name),
  };
}

const extractFirstJsonObject = (text: string): string => {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('Unable to parse animation editor JSON: no JSON object found.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  throw new Error('Unable to parse animation editor JSON: unterminated JSON object.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid animation editor JSON: ${path} must be a string.`);
  }
  return value;
};

const readView = (value: unknown): 'firstPerson' | 'thirdPerson' => {
  if (value === 'firstPerson' || value === 'thirdPerson') return value;
  throw new Error('Invalid animation editor JSON: view must be firstPerson or thirdPerson.');
};

const readInterpolation = (value: unknown): AnimationInterpolationMode => {
  if (value === 'linear' || value === 'smoothstep' || value === 'easeInOutCubic') return value;
  throw new Error('Invalid animation editor JSON: interpolation mode is unsupported.');
};

const readPoseTuple = (value: unknown, path: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`Invalid animation editor JSON: ${path} must contain three numbers.`);
  }
  return [
    Number(value[0]),
    Number(value[1]),
    Number(value[2]),
  ];
};

const readPose = (value: unknown, path: string): WeaponPose => {
  if (!isRecord(value)) {
    throw new Error(`Invalid animation editor JSON: ${path} must be an object.`);
  }
  return {
    position: readPoseTuple(value.position, `${path}.position`),
    rotation: readPoseTuple(value.rotation, `${path}.rotation`),
  };
};

const readKeyframes = (value: unknown, path: string): AnimationKeyframe[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid animation editor JSON: ${path} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid animation editor JSON: ${path}[${index}] must be an object.`);
    }
    return {
      frame: Number(entry.frame),
      ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
      pose: readPose(entry.pose, `${path}[${index}].pose`),
    };
  });
};

const readFrames = (value: unknown, path: string): GeneratedAnimationFrame[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid animation editor JSON: ${path} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid animation editor JSON: ${path}[${index}] must be an object.`);
    }
    return {
      frame: Number(entry.frame),
      source: entry.source === 'keyframe' ? 'keyframe' : 'generated',
      pose: readPose(entry.pose, `${path}[${index}].pose`),
    };
  });
};

const readTarget = (value: unknown, path: string): SelectedRigTarget => {
  if (!isRecord(value)) {
    throw new Error(`Invalid animation editor JSON: ${path} must be an object.`);
  }
  const kind = value.kind;
  if (kind !== 'weapon' && kind !== 'bone' && kind !== 'socket') {
    throw new Error(`Invalid animation editor JSON: ${path}.kind is unsupported.`);
  }
  return {
    kind,
    name: readString(value.name, `${path}.name`),
    view: readView(value.view),
  };
};

const readTrackMap = (value: unknown, path: string): Record<string, AnimationEditorRigTrack> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, track]) => {
      if (!isRecord(track)) {
        throw new Error(`Invalid animation editor JSON: ${path}.${name} must be an object.`);
      }
      return [
        name,
        {
          keyframes: readKeyframes(track.keyframes, `${path}.${name}.keyframes`),
          frames: readFrames(track.frames, `${path}.${name}.frames`),
        },
      ];
    })
  );
};

const readSocketLocks = (value: unknown): AnimationEditorSocketLock[] => {
  if (!Array.isArray(value)) return [];
  return value.map((lock, index) => {
    if (!isRecord(lock)) {
      throw new Error(`Invalid animation editor JSON: rig.socketLocks[${index}] must be an object.`);
    }
    return {
      target: readTarget(lock.target, `rig.socketLocks[${index}].target`),
      socket: readTarget(lock.socket, `rig.socketLocks[${index}].socket`),
    };
  });
};

const normalizeAnimationEditorPayload = (value: unknown): AnimationEditorExportPayload => {
  if (!isRecord(value)) {
    throw new Error('Invalid animation editor JSON: root must be an object.');
  }
  if (value.tool !== 'ibrawls-animation-editor') {
    throw new Error('Invalid animation editor JSON: tool must be ibrawls-animation-editor.');
  }
  const frameCount = Math.max(1, Math.floor(Number(value.frameCount) || 1));
  const rig = isRecord(value.rig) ? value.rig : {};
  return buildAnimationEditorExportPayload({
    weapon: readString(value.weapon, 'weapon'),
    view: readView(value.view),
    track: readString(value.track, 'track'),
    frameCount,
    interpolation: readInterpolation(value.interpolation),
    keyframes: readKeyframes(value.keyframes, 'keyframes'),
    frames: readFrames(value.frames, 'frames'),
    proceduralProfile: isRecord(value.proceduralProfile) &&
      value.proceduralProfile.modelSystem === 'v3' &&
      value.proceduralProfile.source === 'v3AnimationFidelity'
      ? {
          modelSystem: 'v3',
          profileVersion: Number(value.proceduralProfile.profileVersion) || 1,
          source: 'v3AnimationFidelity',
        }
      : undefined,
    rig: {
      bones: readTrackMap(rig.bones, 'rig.bones'),
      sockets: readTrackMap(rig.sockets, 'rig.sockets'),
      socketLocks: readSocketLocks(rig.socketLocks),
    },
  });
};

export function parseAnimationEditorImportText(text: string): AnimationEditorImportResult {
  try {
    return {
      payload: normalizeAnimationEditorPayload(JSON.parse(extractFirstJsonObject(text))),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid animation editor JSON')) {
      throw error;
    }
    throw new Error(`Unable to parse animation editor JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

const isFiniteTuple = (value: readonly number[] | undefined): boolean =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

const pushPoseValidation = (
  items: AnimationEditorValidationItem[],
  pose: WeaponPose | undefined,
  frame: number | undefined,
  target: string
): void => {
  if (!pose || !isFiniteTuple(pose.position) || !isFiniteTuple(pose.rotation)) {
    items.push({
      severity: 'error',
      code: 'non-finite-pose',
      frame,
      target,
      message: `${target} has a missing or non-finite pose.`,
    });
  }
};

export function buildAnimationEditorValidationReport(
  payload: AnimationEditorExportPayload
): AnimationEditorValidationReport {
  const items: AnimationEditorValidationItem[] = [];
  const frameCount = Math.floor(payload.frameCount);
  const maxFrame = Math.max(0, frameCount - 1);

  if (!Number.isFinite(frameCount) || frameCount < 1) {
    items.push({
      severity: 'error',
      code: 'invalid-frame-count',
      message: 'Frame count must be at least one.',
    });
  }

  if (payload.keyframes.length === 0) {
    items.push({
      severity: 'error',
      code: 'missing-keyframes',
      message: 'Weapon track must contain at least one keyframe.',
    });
  }

  const seenFrames = new Set<number>();
  payload.keyframes.forEach((keyframe) => {
    if (!Number.isFinite(keyframe.frame) || keyframe.frame < 0 || keyframe.frame > maxFrame) {
      items.push({
        severity: 'error',
        code: 'keyframe-out-of-range',
        frame: keyframe.frame,
        target: 'weapon',
        message: `Weapon keyframe ${keyframe.frame} is outside 0..${maxFrame}.`,
      });
    }
    if (seenFrames.has(keyframe.frame)) {
      items.push({
        severity: 'warning',
        code: 'duplicate-keyframe',
        frame: keyframe.frame,
        target: 'weapon',
        message: `Weapon keyframe ${keyframe.frame} is duplicated; the last value will win.`,
      });
    }
    seenFrames.add(keyframe.frame);
    pushPoseValidation(items, keyframe.pose, keyframe.frame, 'weapon');
  });

  if (payload.frames.length !== frameCount) {
    items.push({
      severity: 'warning',
      code: 'generated-frame-count-mismatch',
      message: `Generated frame count is ${payload.frames.length}; expected ${frameCount}.`,
    });
  }
  payload.frames.forEach((frame) => pushPoseValidation(items, frame.pose, frame.frame, 'weapon frame'));

  (['bones', 'sockets'] as const).forEach((kind) => {
    Object.entries(payload.rig[kind]).forEach(([name, track]) => {
      track.keyframes.forEach((keyframe) => {
        if (!Number.isFinite(keyframe.frame) || keyframe.frame < 0 || keyframe.frame > maxFrame) {
          items.push({
            severity: 'error',
            code: 'keyframe-out-of-range',
            frame: keyframe.frame,
            target: `${kind}.${name}`,
            message: `${kind}.${name} keyframe ${keyframe.frame} is outside 0..${maxFrame}.`,
          });
        }
        pushPoseValidation(items, keyframe.pose, keyframe.frame, `${kind}.${name}`);
      });
      track.frames.forEach((frame) => pushPoseValidation(items, frame.pose, frame.frame, `${kind}.${name} frame`));
    });
  });

  payload.rig.socketLocks.forEach((lock, index) => {
    if (lock.socket.kind !== 'socket' || lock.target.kind !== 'weapon' || lock.target.view !== lock.socket.view) {
      items.push({
        severity: 'error',
        code: 'invalid-socket-lock',
        target: lock.target.name,
        message: `Socket lock ${index + 1} must lock a weapon target to a socket in the same view.`,
      });
    }
  });

  const blocking = items.some((item) => item.severity === 'error');
  return {
    ok: !blocking,
    summary: items.length === 0
      ? 'No validation issues.'
      : `${items.length} validation issue${items.length === 1 ? '' : 's'} found.`,
    items,
  };
}

export function createAnimationEditorDuplicateVariant(
  payload: AnimationEditorExportPayload,
  options: { storageId: string; now?: string }
): AnimationEditorLocalVariantRecord {
  const timestamp = options.now ?? new Date().toISOString();
  const copy = normalizeAnimationEditorPayload(payload);
  return {
    storageId: options.storageId,
    label: `${copy.track} Copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceTrack: copy.track,
    payload: copy,
  };
}

const singleFrameRigTrack = (
  track: AnimationEditorRigTrack,
  frame: number
): AnimationEditorRigTrack | null => {
  const pose = track.frames.find((candidate) => candidate.frame === frame)?.pose
    ?? track.keyframes.find((candidate) => candidate.frame === frame)?.pose;
  if (!pose) return null;
  const keyframe = { frame: 0, label: 'Current', pose: clonePose(pose) };
  return {
    keyframes: [keyframe],
    frames: [{ frame: 0, pose: clonePose(pose), source: 'keyframe' }],
  };
};

export function createAnimationEditorVariantFromCurrentFrame(
  payload: AnimationEditorExportPayload,
  options: { storageId: string; frame: number; now?: string }
): AnimationEditorLocalVariantRecord {
  const timestamp = options.now ?? new Date().toISOString();
  const source = normalizeAnimationEditorPayload(payload);
  const frame = clampFrameIndex(options.frame, source.frameCount);
  const pose = source.frames.find((candidate) => candidate.frame === frame)?.pose
    ?? source.keyframes.find((candidate) => candidate.frame === frame)?.pose
    ?? source.keyframes[0]?.pose;
  if (!pose) {
    throw new Error('Unable to create a local variant without a current weapon pose.');
  }

  const mapSingleFrameTracks = (
    tracks: Record<string, AnimationEditorRigTrack>
  ): Record<string, AnimationEditorRigTrack> => Object.fromEntries(
    Object.entries(tracks)
      .map(([name, track]) => [name, singleFrameRigTrack(track, frame)] as const)
      .filter((entry): entry is readonly [string, AnimationEditorRigTrack] => Boolean(entry[1]))
  );

  const payloadForFrame = buildAnimationEditorExportPayload({
    ...source,
    frameCount: 1,
    keyframes: [{ frame: 0, label: 'Current', pose: clonePose(pose) }],
    frames: [{ frame: 0, pose: clonePose(pose), source: 'keyframe' }],
    rig: {
      bones: mapSingleFrameTracks(source.rig.bones),
      sockets: mapSingleFrameTracks(source.rig.sockets),
      socketLocks: source.rig.socketLocks,
    },
  });

  return {
    storageId: options.storageId,
    label: `${source.track} Current Pose`,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceTrack: source.track,
    payload: payloadForFrame,
  };
}
