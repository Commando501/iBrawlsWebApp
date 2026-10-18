import React, { useId, useState, useSyncExternalStore } from 'react';
import { DEFAULT_AUDIO_SETTINGS, getAudioSettings, subscribeAudioSettings, updateAudioSettings, type AudioSettings } from '../../settings/audioSettings';
import { sfx } from '../AudioEngine';

const sliders = [
  ['masterVolume', 'Master volume', 'All game audio.'],
  ['effectsVolume', 'Sound effects', 'Weapons, movement, respawns, and medals.'],
  ['musicVolume', 'Music', 'Music and special tracks.'],
] as const;

export function SoundSettingsPanel() {
  const settings = useSyncExternalStore(subscribeAudioSettings, getAudioSettings, () => DEFAULT_AUDIO_SETTINGS);
  const [saveFailed, setSaveFailed] = useState(false);
  const id = useId();
  const update = (patch: Partial<AudioSettings>) => setSaveFailed(!updateAudioSettings(patch));

  return <div className="flex flex-col gap-5 text-slate-100 text-left">
    <p className="text-sm text-slate-400">Changes apply immediately and save on this device.</p>
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="font-semibold text-sm">Mute all sounds</span>
      <input type="checkbox" checked={settings.muted} onChange={event => update({ muted: event.target.checked })} className="w-5 h-5 accent-cyan-400" />
    </label>
    {sliders.map(([key, label, description]) => <div key={key}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <label htmlFor={`${id}-${key}`} className="font-semibold text-sm">{label}</label>
        <output htmlFor={`${id}-${key}`} className="text-sm font-mono text-cyan-300">{settings[key]}%</output>
      </div>
      <p id={`${id}-${key}-description`} className="text-xs text-slate-400 mb-2">{description}</p>
      <input id={`${id}-${key}`} type="range" min="0" max="100" step="1" value={settings[key]}
        aria-describedby={`${id}-${key}-description`} aria-valuetext={`${settings[key]} percent`}
        onChange={event => update({ [key]: Number(event.target.value) })} className="w-full h-6 accent-cyan-400 cursor-pointer" />
    </div>)}
    {settings.muted && <p role="status" className="text-sm text-amber-300">All sounds are muted. Your volume levels are preserved.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => sfx.playJump()} className="px-4 py-2 rounded-lg border border-cyan-500/40 text-cyan-300 text-sm hover:bg-cyan-950/40">Test sound</button>
      <button type="button" onClick={() => update(DEFAULT_AUDIO_SETTINGS)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800">Reset sound settings</button>
    </div>
    {saveFailed && <p role="status" className="text-sm text-amber-300">Sound settings apply for this session, but could not be saved on this device.</p>}
  </div>;
}
