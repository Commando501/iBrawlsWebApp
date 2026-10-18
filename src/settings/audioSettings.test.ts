import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, getAudioSettings, getAudioVolume, loadAudioSettings, normalizeAudioSettings, updateAudioSettings } from './audioSettings';
import { bindEffectsVolume, bindMusicVolume } from '../components/audioVolume';

test('saved audio settings tolerate missing, corrupt, and out-of-range values', () => {
  for (const raw of [null, 'invalid', 'null', '[]']) {
    assert.deepEqual(loadAudioSettings({ getItem: () => raw, setItem() {} }), DEFAULT_AUDIO_SETTINGS);
  }
  assert.deepEqual(normalizeAudioSettings({ masterVolume: -20, effectsVolume: 150, musicVolume: NaN, muted: 'false' }), {
    masterVolume: 0, effectsVolume: 100, musicVolume: 100, muted: false,
  });
  assert.deepEqual(loadAudioSettings({ getItem() { throw new Error('denied'); }, setItem() {} }), DEFAULT_AUDIO_SETTINGS);
});

test('volume changes persist, multiply by channel, mute, and restore previous levels', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  try {
    assert.equal(updateAudioSettings({ masterVolume: 50, effectsVolume: 40, musicVolume: 80, muted: false }, storage), true);
    assert.equal(getAudioVolume('effects'), 0.2);
    assert.equal(getAudioVolume('music'), 0.4);
    assert.deepEqual(loadAudioSettings(storage), getAudioSettings());
    assert.ok(values.has(AUDIO_SETTINGS_STORAGE_KEY));
    updateAudioSettings({ muted: true }, storage);
    assert.equal(getAudioVolume('effects'), 0);
    assert.equal(getAudioVolume('music'), 0);
    updateAudioSettings({ muted: false }, storage);
    assert.equal(getAudioVolume('effects'), 0.2);
    updateAudioSettings({ masterVolume: 0 }, storage);
    assert.equal(getAudioVolume('music'), 0);
  } finally { updateAudioSettings(DEFAULT_AUDIO_SETTINGS, null); }
});

test('active effects and music update immediately even when persistence fails, and detach on cleanup', () => {
  class Media extends EventTarget { volume = 1; }
  const output = { gain: { value: 1 } } as GainNode;
  const media = new Media() as unknown as HTMLAudioElement;
  updateAudioSettings(DEFAULT_AUDIO_SETTINGS, null);
  const unbindEffects = bindEffectsVolume(output, 0.4);
  const unbindMusic = bindMusicVolume(media, 0.55);
  try {
    assert.equal(output.gain.value, 0.4);
    assert.equal(media.volume, 0.55);
    const saved = updateAudioSettings({ masterVolume: 50, effectsVolume: 40, musicVolume: 80 }, {
      getItem: () => null, setItem() { throw new Error('quota exceeded'); },
    });
    assert.equal(saved, false);
    assert.equal(output.gain.value, 0.4 * 0.2);
    assert.equal(media.volume, 0.55 * 0.4);
    updateAudioSettings({ muted: true }, null);
    assert.equal(output.gain.value, 0);
    assert.equal(media.volume, 0);
    updateAudioSettings({ muted: false }, null);
    assert.equal(media.volume, 0.55 * 0.4);
    media.dispatchEvent(new Event('pause'));
    unbindEffects();
    updateAudioSettings(DEFAULT_AUDIO_SETTINGS, null);
    assert.equal(output.gain.value, 0.4 * 0.2);
    assert.equal(media.volume, 0.55 * 0.4);
  } finally {
    unbindEffects();
    unbindMusic();
    updateAudioSettings(DEFAULT_AUDIO_SETTINGS, null);
  }
});
