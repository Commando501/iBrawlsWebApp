import {
  V3_QUALITY_TIERS,
  type V3QualityTier,
} from './v3ModelTypes';

export interface V3QualitySignals {
  isMobile?: boolean;
  forceMobileControls?: boolean;
  graphicsAccelerated?: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  fps?: number;
  previousTier?: V3QualityTier;
}

export interface V3AnimationThrottle {
  remoteAnimationIntervalMs: number;
}

export type V3ArmorRenderStyle = 'voxelEdit' | 'armorSurface';

export interface V3RenderOptions {
  v3QualityTier?: V3QualityTier;
  v3Distance?: number;
  v3ArmorRenderStyle?: V3ArmorRenderStyle;
}

const tierRank = (tier: V3QualityTier): number => V3_QUALITY_TIERS.indexOf(tier);

const tierAtRank = (rank: number): V3QualityTier =>
  V3_QUALITY_TIERS[Math.max(0, Math.min(V3_QUALITY_TIERS.length - 1, rank))];

export function normalizeV3QualityTier(value: unknown, fallback: V3QualityTier = 'desktop'): V3QualityTier {
  return typeof value === 'string' && V3_QUALITY_TIERS.includes(value as V3QualityTier)
    ? value as V3QualityTier
    : fallback;
}

export function normalizeV3ArmorRenderStyle(
  value: unknown,
  fallback: V3ArmorRenderStyle = 'armorSurface'
): V3ArmorRenderStyle {
  return value === 'voxelEdit' || value === 'armorSurface' ? value : fallback;
}

export function selectV3QualityTier(signals: V3QualitySignals): V3QualityTier {
  if (signals.graphicsAccelerated === false) {
    return 'mobileLow';
  }

  const cores = Number.isFinite(signals.hardwareConcurrency) ? Math.max(0, signals.hardwareConcurrency ?? 0) : 0;
  const memory = Number.isFinite(signals.deviceMemoryGb) ? Math.max(0, signals.deviceMemoryGb ?? 0) : 0;
  const fps = Number.isFinite(signals.fps) ? Math.max(0, signals.fps ?? 0) : undefined;
  const mobilePath = Boolean(signals.isMobile || signals.forceMobileControls);
  const previous = normalizeV3QualityTier(signals.previousTier, mobilePath ? 'mobile' : 'desktop');

  let target: V3QualityTier;
  if (mobilePath) {
    target = cores > 2 ? 'mobile' : 'mobileLow';
  } else if (cores >= 12 && memory >= 8 && (fps === undefined || fps >= 80)) {
    target = 'ultra';
  } else {
    target = 'desktop';
  }

  if (fps !== undefined && fps > 0) {
    if (fps < 28) {
      target = tierAtRank(tierRank(previous) - 1);
    } else if (fps < 50) {
      target = tierAtRank(Math.min(tierRank(target), tierRank(previous)));
    }
  }

  if (mobilePath && tierRank(target) > tierRank('mobile')) {
    return 'mobile';
  }

  return target;
}

export function getV3AnimationThrottleForTier(tier: V3QualityTier): V3AnimationThrottle {
  if (tier === 'mobileLow') return { remoteAnimationIntervalMs: 50 };
  if (tier === 'mobile') return { remoteAnimationIntervalMs: 33 };
  return { remoteAnimationIntervalMs: 0 };
}
