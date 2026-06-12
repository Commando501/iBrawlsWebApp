import * as THREE from 'three';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { getV3AnimationThrottleForTier } from '../v3/v3QualityTiers';

interface StoredV3AnimationThrottleState {
  lastAnimationMs: number;
  accumulatedDt: number;
}

export interface V3AnimationThrottleInput {
  mesh: THREE.Group;
  qualityTier: V3QualityTier;
  isLocal: boolean;
  nowMs: number;
  dt: number;
}

export interface V3AnimationThrottleResult {
  shouldAnimate: boolean;
  dt: number;
}

export function getV3AnimationThrottleState(mesh: THREE.Group): StoredV3AnimationThrottleState {
  const existing = mesh.userData.v3AnimationThrottle as StoredV3AnimationThrottleState | undefined;
  if (existing) return existing;
  const state = { lastAnimationMs: Number.NEGATIVE_INFINITY, accumulatedDt: 0 };
  mesh.userData.v3AnimationThrottle = state;
  return state;
}

export function consumeV3AnimationThrottle({
  mesh,
  qualityTier,
  isLocal,
  nowMs,
  dt,
}: V3AnimationThrottleInput): V3AnimationThrottleResult {
  const intervalMs = isLocal ? 0 : getV3AnimationThrottleForTier(qualityTier).remoteAnimationIntervalMs;
  if (intervalMs <= 0) {
    return { shouldAnimate: true, dt };
  }

  const state = getV3AnimationThrottleState(mesh);
  state.accumulatedDt += Math.max(0, dt);

  if (!Number.isFinite(state.lastAnimationMs) || nowMs - state.lastAnimationMs >= intervalMs) {
    const nextDt = state.accumulatedDt;
    state.accumulatedDt = 0;
    state.lastAnimationMs = nowMs;
    return { shouldAnimate: true, dt: nextDt };
  }

  return { shouldAnimate: false, dt: 0 };
}
