import { getAudioVolume, subscribeAudioSettings } from '../settings/audioSettings';

/** Separate output gain leaves each sound's authored envelope and balance intact. */
export function bindEffectsVolume(output: GainNode, baseVolume = 1): () => void {
  const apply = () => { output.gain.value = baseVolume * getAudioVolume('effects'); };
  apply();
  return subscribeAudioSettings(apply);
}

export function bindMusicVolume(audio: HTMLAudioElement, baseVolume: number): () => void {
  const apply = () => { audio.volume = baseVolume * getAudioVolume('music'); };
  apply();
  const unsubscribe = subscribeAudioSettings(apply);
  const dispose = () => {
    unsubscribe();
    for (const event of ['ended', 'pause', 'error']) audio.removeEventListener(event, dispose);
  };
  for (const event of ['ended', 'pause', 'error']) audio.addEventListener(event, dispose);
  return dispose;
}
