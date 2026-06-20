import * as THREE from 'three';
import {
  deriveV3CanonicalRigContract,
  type V3CanonicalRigContract,
} from './v3CanonicalRigContract';
import type { V3DetailBoneName } from './v3RigDetail';

export type V3LowerBodySide = 'left' | 'right';

export interface V3LowerBodyChainSideContract {
  side: V3LowerBodySide;
  hip: [number, number, number];
  knee: [number, number, number];
  ankle: [number, number, number];
  toe: [number, number, number];
}

export interface V3LowerBodyChainContract {
  kind: 'v3-lower-body-chain-contract';
  version: 1;
  sourceHash: string;
  pelvis: {
    anchor: [number, number, number];
  };
  sides: Record<V3LowerBodySide, V3LowerBodyChainSideContract>;
}

export interface V3LowerBodyWalkSidePose {
  thighRotation: [number, number, number];
  calfRotation: [number, number, number];
  footRotation: [number, number, number];
  toeRotation: [number, number, number];
  kneeBend: number;
}

export interface V3LowerBodyWalkPose {
  pelvisOffset: [number, number, number];
  pelvisRotation: [number, number, number];
  broadLegRotation: [number, number, number];
  sides: Record<V3LowerBodySide, V3LowerBodyWalkSidePose>;
}

export interface V3LowerBodyWalkPoseInput {
  phase: number;
  speed: number;
  isSprinting?: boolean;
}

type V3DetailBoneMapLike = Partial<Record<V3DetailBoneName, THREE.Group>>;

const LOWER_BODY_BONES = [
  'pelvis',
  'thighLeft',
  'calfLeft',
  'footLeft',
  'toeLeft',
  'thighRight',
  'calfRight',
  'footRight',
  'toeRight',
] as const satisfies readonly V3DetailBoneName[];

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const tuple = (value: readonly number[]): [number, number, number] => [
  roundMetric(value[0] ?? 0),
  roundMetric(value[1] ?? 0),
  roundMetric(value[2] ?? 0),
];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getCanonicalContract = (modelOrContract?: THREE.Object3D | V3CanonicalRigContract): V3CanonicalRigContract => {
  const candidate = modelOrContract as V3CanonicalRigContract | undefined;
  if (candidate?.kind === 'v3-canonical-rig-contract') return candidate;
  const modelCandidate = modelOrContract as THREE.Object3D | undefined;
  const fromModel = modelCandidate?.userData?.v3CanonicalRigContract as V3CanonicalRigContract | undefined;
  return fromModel?.kind === 'v3-canonical-rig-contract' ? fromModel : deriveV3CanonicalRigContract();
};

const makeSide = (
  canonical: V3CanonicalRigContract,
  side: V3LowerBodySide
): V3LowerBodyChainSideContract => {
  const suffix = side === 'left' ? 'Left' : 'Right';
  return {
    side,
    hip: tuple(canonical.joints[`hip${suffix}`].position),
    knee: tuple(canonical.joints[`knee${suffix}`].position),
    ankle: tuple(canonical.joints[`ankle${suffix}`].position),
    toe: tuple(canonical.joints[`toe${suffix}`].position),
  };
};

export function deriveV3LowerBodyChainContract(
  modelOrSource?: THREE.Object3D | V3CanonicalRigContract
): V3LowerBodyChainContract {
  const canonical = getCanonicalContract(modelOrSource);
  return {
    kind: 'v3-lower-body-chain-contract',
    version: 1,
    sourceHash: canonical.sourceHash,
    pelvis: {
      anchor: tuple(canonical.joints.pelvis.position),
    },
    sides: {
      left: makeSide(canonical, 'left'),
      right: makeSide(canonical, 'right'),
    },
  };
}

export function applyV3LowerBodyChainBinding(
  model: THREE.Object3D,
  contract: V3LowerBodyChainContract = deriveV3LowerBodyChainContract(model)
): V3LowerBodyChainContract {
  model.userData.v3LowerBodyChainContract = contract;
  model.userData.v3LowerBodyChainMode = 'single-chain';
  model.userData.v3LowerBodyAnchors = {
    pelvis: contract.pelvis.anchor,
    hipLeft: contract.sides.left.hip,
    kneeLeft: contract.sides.left.knee,
    ankleLeft: contract.sides.left.ankle,
    toeLeft: contract.sides.left.toe,
    hipRight: contract.sides.right.hip,
    kneeRight: contract.sides.right.knee,
    ankleRight: contract.sides.right.ankle,
    toeRight: contract.sides.right.toe,
  };

  const detailBones = model.userData.v3DetailBones as V3DetailBoneMapLike | undefined;
  if (!detailBones) return contract;

  for (const boneName of LOWER_BODY_BONES) {
    const bone = detailBones[boneName];
    if (!bone) continue;
    bone.userData.v3LowerBodyChainAuthority = 'single-chain';
    bone.userData.v3LowerBodyChainContract = contract;
  }

  return contract;
}

export function sampleV3LowerBodyWalkPose(input: V3LowerBodyWalkPoseInput): V3LowerBodyWalkPose {
  const speedFactor = clamp(input.speed / 4, 0, 1);
  const sprintFactor = input.isSprinting ? 1.2 : 1;
  const stride = 0.025 * speedFactor * sprintFactor;
  const knee = 0.12 * speedFactor * sprintFactor;
  const lateral = 0.01 * speedFactor;
  const phase = Number.isFinite(input.phase) ? input.phase : 0;
  const leftStep = Math.sin(phase);
  const rightStep = -leftStep;
  const side = Math.cos(phase);
  const bob = Math.max(0, Math.sin(phase * 2)) * 0.012 * speedFactor;
  const pelvisRoll = 0;

  const sidePose = (step: number, sideSign: -1 | 1): V3LowerBodyWalkSidePose => {
    const forward = step * stride;
    const kneeBend = step < 0 ? -step * knee : 0.045 * speedFactor;
    const ankleCounter = -forward * 0.42;
    return {
      thighRotation: [
        roundMetric(forward),
        0,
        roundMetric(side * lateral * sideSign),
      ],
      calfRotation: [roundMetric(kneeBend), 0, 0],
      footRotation: [roundMetric(ankleCounter), 0, 0],
      toeRotation: [roundMetric(Math.max(0, step) * 0.035 * speedFactor), 0, 0],
      kneeBend: roundMetric(kneeBend),
    };
  };

  return {
    pelvisOffset: [0, roundMetric(bob), 0],
    pelvisRotation: [0, 0, roundMetric(pelvisRoll)],
    broadLegRotation: [0, 0, 0],
    sides: {
      left: sidePose(leftStep, -1),
      right: sidePose(rightStep, 1),
    },
  };
}
