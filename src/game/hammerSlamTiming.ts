import { type UniversalSettings } from '../types';

export const DEFAULT_HAMMER_SLAM_WINDUP_TIME = 0.28;
export const DEFAULT_HAMMER_SLAM_ATTACK_TIME = 0.12;
export const DEFAULT_HAMMER_SLAM_TIMING_LOCKED = true;

export const HAMMER_SLAM_WINDUP_MIN = 0.05;
export const HAMMER_SLAM_WINDUP_MAX = 2.33;
export const HAMMER_SLAM_ATTACK_MIN = 0.02;
export const HAMMER_SLAM_ATTACK_MAX = 1.0;
export const HAMMER_SLAM_TIMING_STEP = 0.01;

export type HammerSlamTimingKey = 'hammerSlamWindupTime' | 'hammerSlamAttackTime';

export interface HammerSlamTiming {
  windupTime: number;
  attackTime: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const roundHammerSlamTiming = (value: number): number =>
  Number(value.toFixed(2));

const sanitizeDuration = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return roundHammerSlamTiming(clamp(value, min, max));
};

export const resolveHammerSlamWindupTime = (
  settings: Partial<UniversalSettings>
): number => sanitizeDuration(
  settings.hammerSlamWindupTime,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  HAMMER_SLAM_WINDUP_MIN,
  HAMMER_SLAM_WINDUP_MAX
);

export const resolveHammerSlamAttackTime = (
  settings: Partial<UniversalSettings>
): number => sanitizeDuration(
  settings.hammerSlamAttackTime,
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  HAMMER_SLAM_ATTACK_MIN,
  HAMMER_SLAM_ATTACK_MAX
);

export const resolveHammerSlamTiming = (
  settings: Partial<UniversalSettings>
): HammerSlamTiming => ({
  windupTime: resolveHammerSlamWindupTime(settings),
  attackTime: resolveHammerSlamAttackTime(settings),
});

export const getLockedHammerSlamCounterpart = (
  key: HammerSlamTimingKey,
  value: number
): Pick<UniversalSettings, HammerSlamTimingKey> => {
  const sanitizedValue = key === 'hammerSlamWindupTime'
    ? sanitizeDuration(value, DEFAULT_HAMMER_SLAM_WINDUP_TIME, HAMMER_SLAM_WINDUP_MIN, HAMMER_SLAM_WINDUP_MAX)
    : sanitizeDuration(value, DEFAULT_HAMMER_SLAM_ATTACK_TIME, HAMMER_SLAM_ATTACK_MIN, HAMMER_SLAM_ATTACK_MAX);
  const ratio = DEFAULT_HAMMER_SLAM_ATTACK_TIME / DEFAULT_HAMMER_SLAM_WINDUP_TIME;

  if (key === 'hammerSlamWindupTime') {
    return {
      hammerSlamWindupTime: sanitizedValue,
      hammerSlamAttackTime: sanitizeDuration(
        roundHammerSlamTiming(sanitizedValue * ratio),
        DEFAULT_HAMMER_SLAM_ATTACK_TIME,
        HAMMER_SLAM_ATTACK_MIN,
        HAMMER_SLAM_ATTACK_MAX
      ),
    };
  }

  return {
    hammerSlamWindupTime: sanitizeDuration(
      roundHammerSlamTiming(sanitizedValue / ratio),
      DEFAULT_HAMMER_SLAM_WINDUP_TIME,
      HAMMER_SLAM_WINDUP_MIN,
      HAMMER_SLAM_WINDUP_MAX
    ),
    hammerSlamAttackTime: sanitizedValue,
  };
};

export const applyHammerSlamTimingSliderChange = (
  settings: UniversalSettings,
  key: HammerSlamTimingKey,
  value: number
): UniversalSettings => {
  const sanitizedValue = key === 'hammerSlamWindupTime'
    ? sanitizeDuration(value, DEFAULT_HAMMER_SLAM_WINDUP_TIME, HAMMER_SLAM_WINDUP_MIN, HAMMER_SLAM_WINDUP_MAX)
    : sanitizeDuration(value, DEFAULT_HAMMER_SLAM_ATTACK_TIME, HAMMER_SLAM_ATTACK_MIN, HAMMER_SLAM_ATTACK_MAX);

  if (!settings.hammerSlamTimingLocked) {
    return {
      ...settings,
      [key]: sanitizedValue,
    };
  }

  return {
    ...settings,
    ...getLockedHammerSlamCounterpart(key, sanitizedValue),
  };
};

export const applyHammerSlamTimingLockChange = (
  settings: UniversalSettings,
  locked: boolean
): UniversalSettings => {
  if (!locked) {
    return {
      ...settings,
      hammerSlamTimingLocked: false,
    };
  }

  return {
    ...settings,
    hammerSlamTimingLocked: true,
    ...getLockedHammerSlamCounterpart(
      'hammerSlamWindupTime',
      resolveHammerSlamWindupTime(settings)
    ),
  };
};
