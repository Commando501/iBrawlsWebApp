export const ENVIRONMENT_QUALITY_STORAGE_KEY = 'ibrawls_environment_quality';

export type EnvironmentQualityTier = 'high' | 'balanced' | 'low';
export type EnvironmentQualityPreference = 'auto' | EnvironmentQualityTier;

export interface EnvironmentQualityProfile {
  tier: EnvironmentQualityTier;
  pixelRatioCap: number;
  shadowMapSize: number;
  architectureDetail: 'high' | 'low';
  seatStride: number;
  dustCount: number;
  lightShafts: boolean;
  textureTier: 'high' | 'low';
}

export interface EnvironmentQualitySignals {
  isMobile?: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

type QualityStorage = Pick<Storage, 'getItem' | 'setItem'>;

const PROFILES: Record<EnvironmentQualityTier, Readonly<EnvironmentQualityProfile>> = {
  high: {
    tier: 'high', pixelRatioCap: 1.5, shadowMapSize: 2048,
    architectureDetail: 'high', seatStride: 1, dustCount: 180,
    lightShafts: true, textureTier: 'high',
  },
  balanced: {
    tier: 'balanced', pixelRatioCap: 1.25, shadowMapSize: 1024,
    architectureDetail: 'low', seatStride: 2, dustCount: 70,
    lightShafts: false, textureTier: 'high',
  },
  low: {
    tier: 'low', pixelRatioCap: 1, shadowMapSize: 512,
    architectureDetail: 'low', seatStride: 4, dustCount: 0,
    lightShafts: false, textureTier: 'low',
  },
};

function getBrowserStorage(): QualityStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private browsing and embedded clients can deny access to storage itself.
    return null;
  }
}

export function normalizeEnvironmentQualityPreference(value: unknown): EnvironmentQualityPreference {
  return value === 'high' || value === 'balanced' || value === 'low' || value === 'auto' ? value : 'auto';
}

export function getEnvironmentQualityPreference(storage: QualityStorage | null = getBrowserStorage()): EnvironmentQualityPreference {
  try {
    return normalizeEnvironmentQualityPreference(storage?.getItem(ENVIRONMENT_QUALITY_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

/** A failed write leaves the previous preference active; the UI reports that it could not save. */
export function setEnvironmentQualityPreference(
  value: EnvironmentQualityPreference,
  storage: QualityStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ENVIRONMENT_QUALITY_STORAGE_KEY, normalizeEnvironmentQualityPreference(value));
    return true;
  } catch {
    return false;
  }
}

function getBrowserQualitySignals(): EnvironmentQualitySignals {
  if (typeof navigator === 'undefined') return {};
  const browser = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  return {
    isMobile: browser.userAgentData?.mobile === true
      || /Android|iPhone|iPad|iPod|Mobile/i.test(browser.userAgent)
      || (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1),
    hardwareConcurrency: browser.hardwareConcurrency,
    deviceMemoryGb: browser.deviceMemory,
  };
}

export function resolveEnvironmentQualityTier(
  preference: EnvironmentQualityPreference,
  signals: EnvironmentQualitySignals = {},
): EnvironmentQualityTier {
  if (preference !== 'auto') return preference;
  const cores = Number.isFinite(signals.hardwareConcurrency) && signals.hardwareConcurrency! > 0
    ? signals.hardwareConcurrency : undefined;
  const memory = Number.isFinite(signals.deviceMemoryGb) && signals.deviceMemoryGb! > 0
    ? signals.deviceMemoryGb : undefined;
  if (signals.isMobile || (cores !== undefined && cores <= 2) || (memory !== undefined && memory <= 2)) return 'low';
  if ((cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4)) return 'balanced';
  return 'high';
}

/** Resolve once when a match is created so a settings change cannot rebuild a live arena. */
export function getEnvironmentQualityProfile(
  preference: EnvironmentQualityPreference = getEnvironmentQualityPreference(),
  signals: EnvironmentQualitySignals = getBrowserQualitySignals(),
): EnvironmentQualityProfile {
  return { ...PROFILES[resolveEnvironmentQualityTier(preference, signals)] };
}
