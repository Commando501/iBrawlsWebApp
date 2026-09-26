import type { V3CharacterSlotId, V3QuatTuple, V3Vec3Tuple } from './v3ModelTypes';

export const V3_REFERENCE_SOURCE_BIND_SCHEMA = 'v3-reference-source-bind/v1';

export interface V3ReferenceSourceBindSourceSummary {
  kind: 'blender-reference-glb';
  fileName: string;
  sha256: string;
  generator: string | null;
}

export interface V3ReferenceSourceBindBone {
  name: string;
  parent: string | null;
  restLocalPosition: V3Vec3Tuple;
  restLocalQuaternion: V3QuatTuple;
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
  restWorldMatrix: readonly number[];
  inverseBindMatrix: readonly number[] | null;
}

export interface V3ReferenceSourceBindBasis {
  xAxis: V3Vec3Tuple;
  yAxis: V3Vec3Tuple;
  zAxis: V3Vec3Tuple;
  quaternion: V3QuatTuple;
}

export interface V3ReferenceSourceBindSlot {
  slot: V3CharacterSlotId;
  sourceBoneName: string;
  endBoneName: string;
  mesh2MotionJointName: string;
  mesh2MotionEndJointName: string | null;
  sourceRestWorldPosition: V3Vec3Tuple;
  sourceEndRestWorldPosition: V3Vec3Tuple;
  sourceRestWorldQuaternion: V3QuatTuple;
  sourceSegmentAxis: V3Vec3Tuple;
  sourceBasis: V3ReferenceSourceBindBasis;
}

export interface V3ReferenceSourceBindArtifact {
  schemaVersion: typeof V3_REFERENCE_SOURCE_BIND_SCHEMA;
  version: 1;
  source: V3ReferenceSourceBindSourceSummary;
  skeleton: {
    skinName: string | null;
    skinJointCount: number;
    bones: Readonly<Record<string, V3ReferenceSourceBindBone>>;
  };
  slots: Readonly<Partial<Record<V3CharacterSlotId, V3ReferenceSourceBindSlot>>>;
  diagnostics: {
    missingRequiredBones: readonly string[];
    armChainMaxVerticalDelta: number;
  };
}
