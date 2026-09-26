/** Sanitized Blender bake. Transforms use game units, Y up, facing -Z. */
export interface V3BlenderTransformTrack {
  positions: number[][];
  quaternions: number[][];
}

export interface V3BlenderAnimationClip {
  durationFrames: number;
  loop: boolean;
  weapon: 'hammer' | 'sword' | 'pistol' | 'ball' | null;
  joints: Record<string, V3BlenderTransformTrack>;
  weaponTrack?: V3BlenderTransformTrack;
  /** Secondary contact point in the corrected weapon's local coordinates. */
  offhandPositions?: number[][];
  releaseFrame?: number;
}

export interface V3BlenderAnimationSet {
  schema: 1;
  fps: 60;
  clips: Record<string, V3BlenderAnimationClip>;
}
