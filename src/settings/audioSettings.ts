export const AUDIO_SETTINGS_STORAGE_KEY = 'ibrawls_audio_settings_v1';

export interface AudioSettings {
  masterVolume: number;
  effectsVolume: number;
  musicVolume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  masterVolume: 100,
  effectsVolume: 100,
  musicVolume: 100,
  muted: false,
});

type AudioStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): AudioStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; /* Storage may be unavailable in private or embedded browsers. */ }
}

export function normalizeAudioSettings(value: unknown): Readonly<AudioSettings> {
  const input = value && typeof value === 'object' ? value as Partial<AudioSettings> : {};
  const volume = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value))) : 100;
  return Object.freeze({
    masterVolume: volume(input.masterVolume),
    effectsVolume: volume(input.effectsVolume),
    musicVolume: volume(input.musicVolume),
    muted: input.muted === true,
  });
}

export function loadAudioSettings(storage: AudioStorage | null = browserStorage()): Readonly<AudioSettings> {
  try { return normalizeAudioSettings(JSON.parse(storage?.getItem(AUDIO_SETTINGS_STORAGE_KEY) ?? 'null')); }
  catch { return DEFAULT_AUDIO_SETTINGS; }
}

let current: Readonly<AudioSettings> | undefined;
const listeners = new Set<() => void>();

export function getAudioSettings(): Readonly<AudioSettings> {
  return current ??= loadAudioSettings();
}

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Apply immediately even when browser storage is blocked; report persistence to the UI. */
export function updateAudioSettings(patch: Partial<AudioSettings>, storage: AudioStorage | null = browserStorage()): boolean {
  current = normalizeAudioSettings({ ...getAudioSettings(), ...patch });
  let saved = false;
  try {
    if (storage) {
      storage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(current));
      saved = true;
    }
  } catch { /* The controls still work for this session. */ }
  listeners.forEach(listener => listener());
  return saved;
}

export function getAudioVolume(channel: 'effects' | 'music', settings = getAudioSettings()): number {
  return settings.muted ? 0 : settings.masterVolume / 100
    * (channel === 'effects' ? settings.effectsVolume : settings.musicVolume) / 100;
}
