import React, { useState } from 'react';
import type { UniversalSettings } from '../../types';
import {
  getEnvironmentQualityPreference,
  getEnvironmentQualityProfile,
  normalizeEnvironmentQualityPreference,
  setEnvironmentQualityPreference,
} from '../../settings/environmentQuality';

interface LightingSettingsModalProps {
  adminSettings: UniversalSettings;
  setAdminSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
  onClose: () => void;
}

export function LightingSettingsModal({
  adminSettings,
  setAdminSettings,
  onClose,
}: LightingSettingsModalProps) {
  const [environmentQuality, setEnvironmentQuality] = useState(getEnvironmentQualityPreference);
  const [qualitySaveFailed, setQualitySaveFailed] = useState(false);
  const resolvedQuality = getEnvironmentQualityProfile(environmentQuality).tier;

  return (
    <div className="mobile-modal bg-slate-950/90 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 w-[400px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] shadow-2xl flex flex-col select-none overflow-y-auto overflow-x-hidden">
      <div className="text-center mb-6 border-b border-white/5 pb-4">
        <p className="text-[9px] text-amber-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">ATMOSPHERE & CONFIG</p>
        <h3 className="text-2xl font-sans font-black tracking-tight uppercase text-white">
          Lighting & Shadows
        </h3>
      </div>

      <div className="flex flex-col gap-6 pointer-events-auto mb-6">
        <div className="flex flex-col gap-2 border-b border-white/10 pb-5">
          <label htmlFor="environment-quality" className="text-[11px] font-bold uppercase tracking-wider text-white/80">Environment quality</label>
          <select
            id="environment-quality"
            value={environmentQuality}
            onChange={(event) => {
              const next = normalizeEnvironmentQualityPreference(event.target.value);
              const saved = setEnvironmentQualityPreference(next);
              setQualitySaveFailed(!saved);
              if (saved) setEnvironmentQuality(next);
            }}
            aria-describedby="environment-quality-description"
            className="w-full rounded border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="auto">Auto</option>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="low">Low</option>
          </select>
          <p id="environment-quality-description" className="text-[11px] leading-relaxed text-white/60">
            {environmentQuality === 'auto' && <>Auto selects {resolvedQuality} for this device. </>}
            {resolvedQuality === 'high' && 'Full architecture, detailed surfaces and lighting in upgraded arenas.'}
            {resolvedQuality === 'balanced' && 'Reduced scenery and shadows with detailed surfaces in upgraded arenas.'}
            {resolvedQuality === 'low' && 'Lighter textures, simpler scenery and fewer effects in upgraded arenas.'}
          </p>
          <p className="text-[10px] text-amber-300/80">Applies when you start the next match. Saved on this device.</p>
          {qualitySaveFailed && <p role="alert" className="text-[11px] text-red-300">Your browser could not save this setting. The previous quality setting is still active.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
            <span>Direct Sunlight Intensity</span>
            <span className="text-amber-400 font-mono">{adminSettings.directLightIntensity.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="4.0"
            step="0.05"
            value={adminSettings.directLightIntensity}
            onChange={(event) => setAdminSettings((prev) => ({ ...prev, directLightIntensity: parseFloat(event.target.value) }))}
            className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[10px] text-white/40">Adjusts direct light intensity / exposure (increases general brightness).</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
            <span>Shadow Softness (Ambient Fill)</span>
            <span className="text-amber-400 font-mono">{adminSettings.ambientLightIntensity.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3.5"
            step="0.05"
            value={adminSettings.ambientLightIntensity}
            onChange={(event) => setAdminSettings((prev) => ({ ...prev, ambientLightIntensity: parseFloat(event.target.value) }))}
            className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[10px] text-white/40">Fills in shadowed regions to make them brighter and softer.</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
            <span>Skybox & Fog Brightness</span>
            <span className="text-amber-400 font-mono">{adminSettings.skyboxBrightness}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={adminSettings.skyboxBrightness}
            onChange={(event) => setAdminSettings((prev) => ({ ...prev, skyboxBrightness: parseInt(event.target.value, 10) }))}
            className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[10px] text-white/40">Adjusts background depth brightness and matching volumetric foggy horizon.</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider text-white/80">
            <div className="flex items-center gap-2">
              <span>Skybox & Fog Color Hue</span>
              <div
                className="w-4 h-4 rounded-full border border-white/20 shadow-inner"
                style={{ backgroundColor: `hsl(${adminSettings.skyboxHue}, 70%, ${Math.max(25, adminSettings.skyboxBrightness)}%)` }}
                title="Selected color preview"
              />
            </div>
            <span className="text-amber-400 font-mono">{adminSettings.skyboxHue}&deg;</span>
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={adminSettings.skyboxHue}
            onChange={(event) => setAdminSettings((prev) => ({ ...prev, skyboxHue: parseInt(event.target.value, 10) }))}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
            style={{
              background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
            }}
          />
          <p className="text-[10px] text-white/40">Rotate color hue to select sky atmospheric styling (eg. Blue, Neon Cyan, Purple, Crimson, Amber).</p>
        </div>

        <div className="flex justify-between items-center text-xs pt-1.5 border-t border-white/5">
          <div className="flex flex-col text-left">
            <span className="font-bold text-white/90 uppercase tracking-wider text-[11px]">Show Skybox</span>
            <span className="text-[10px] text-white/40">Toggle background skybox rendering on or off.</span>
          </div>
          <button
            id="skybox-visibility-toggle"
            onClick={() => setAdminSettings((prev) => ({ ...prev, showSkybox: prev.showSkybox !== false ? false : true }))}
            className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              adminSettings.showSkybox !== false ? 'bg-amber-400' : 'bg-white/10'
            }`}
          >
            <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-slate-900 shadow transition duration-200 ease-in-out ${
              adminSettings.showSkybox !== false ? 'translate-x-4' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>

      <button
        id="apply-lighting-btn"
        onClick={onClose}
        className="w-full h-11 bg-white text-slate-900 hover:bg-amber-400 hover:text-white text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98"
      >
        Apply & Return
      </button>
    </div>
  );
}
