import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AIPreset, UniversalSettings } from '../../types';
import { AI_ARCHETYPE_OPTIONS, getArchetypeDef } from '../../game/aiPersonalities';
import { AdvancedSection } from './AdvancedSection';
import { AI_CUSTOM_KNOB_SECTIONS, getPresetDescription } from './aiMenuContent';

interface AiBehaviorEditorPanelProps {
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  aiPresets: AIPreset[];
  newAiPresetNameInput: string;
  setNewAiPresetNameInput: Dispatch<SetStateAction<string>>;
  onSelectAIPreset: (id: string) => void;
  onDeleteAIPreset: (id: string) => void;
  onSelectAIArchetype: (id: string) => void;
  onSaveAIPreset: (name: string) => void;
}

const STANDARD_AI_PRESET_IDS = ['easy', 'normal', 'hard', 'nightmare', 'custom'];

export function AiBehaviorEditorPanel({
  adminSettings,
  setAdminSettings,
  aiPresets,
  newAiPresetNameInput,
  setNewAiPresetNameInput,
  onSelectAIPreset,
  onDeleteAIPreset,
  onSelectAIArchetype,
  onSaveAIPreset,
}: AiBehaviorEditorPanelProps) {
  const [collapsedAiSections, setCollapsedAiSections] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    AI_CUSTOM_KNOB_SECTIONS.forEach((section) => {
      if (section.expert) init[section.title] = true;
    });
    return init;
  });

  const toggleAiSection = (title: string) => {
    setCollapsedAiSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const selectedDifficulty = adminSettings.aiDifficulty || 'normal';
  const selectedArchetype = adminSettings.aiArchetype || 'none';

  return (
    <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3.5 text-left shrink-0">
      <div className="flex justify-between items-center pb-2 border-b border-white/5">
        <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5 font-display">AI Behavior Editor</span>
        <span className="text-[10px] font-mono text-[#38bdf8] bg-[#38bdf8]/10 border border-[#38bdf8]/20 px-2 py-0.5 rounded uppercase font-black">Offline Play</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] text-white/50 uppercase tracking-widest font-mono">Cognitive Matrix Preset:</span>
        <div className="flex gap-2">
          <select
            value={selectedDifficulty}
            onChange={(e) => onSelectAIPreset(e.target.value)}
            className="flex-1 h-11 bg-black/60 border border-white/10 rounded px-2.5 text-sm text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] transition-all cursor-pointer font-sans"
            title={getPresetDescription(selectedDifficulty, aiPresets)}
          >
            <option value="easy" title={getPresetDescription('easy', aiPresets)}>Easy (Sub-Normal)</option>
            <option value="normal" title={getPresetDescription('normal', aiPresets)}>Normal - Standard Combat</option>
            <option value="hard" title={getPresetDescription('hard', aiPresets)}>Hard (Calibrated)</option>
            <option value="nightmare" title={getPresetDescription('nightmare', aiPresets)}>Nightmare - Override</option>
            <option value="custom" title={getPresetDescription('custom', aiPresets)}>Custom AI Behavior</option>
            {aiPresets.length > 0 && (
              <optgroup label="Saved Presets">
                {aiPresets.map((preset) => (
                  <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {!STANDARD_AI_PRESET_IDS.includes(selectedDifficulty) && (
            <button
              onClick={() => onDeleteAIPreset(selectedDifficulty)}
              className="px-3.5 h-11 bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 hover:border-red-500/50 text-red-400 text-xs font-bold uppercase rounded cursor-pointer transition-all"
              title="Delete this AI preset"
            >
              Delete
            </button>
          )}
        </div>
        {adminSettings.aiDifficulty && adminSettings.aiDifficulty !== 'custom' && (
          <span className="text-[10px] text-white/45 leading-snug">
            {getPresetDescription(adminSettings.aiDifficulty, aiPresets)}
          </span>
        )}
      </div>

      <AdvancedSection
        sectionId="sandbox-ai-tuning"
        title="Advanced AI Tuning"
        badge={adminSettings.aiDifficulty === 'custom' ? 'custom active' : undefined}
        forceOpen={adminSettings.aiDifficulty === 'custom'}
      >
      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] text-white/50 uppercase tracking-widest font-mono">Behavior Archetype Presets:</span>
        <select
          value={selectedArchetype}
          onChange={(e) => onSelectAIArchetype(e.target.value)}
          className="w-full h-11 bg-black/60 border border-white/10 rounded px-2.5 text-sm text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] transition-all cursor-pointer font-sans"
        >
          {AI_ARCHETYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {adminSettings.aiArchetype && adminSettings.aiArchetype !== 'none' && (
          <span className="text-[10px] text-white/45 leading-snug">
            {getArchetypeDef(adminSettings.aiArchetype)?.description}
          </span>
        )}
      </div>

      {adminSettings.aiDifficulty === 'custom' && (
        <div className="flex flex-col gap-4 pt-1">
          <p className="text-[10px] text-white/40 leading-snug italic">
            Tune every facet of the AI, or pick a Behavior Archetype Preset above to fill all dials as a starting point. Advanced dials marked Auto fall back to derived values until you set them.
          </p>
          {AI_CUSTOM_KNOB_SECTIONS.map((sectionGroup) => {
            const collapsed = !!collapsedAiSections[sectionGroup.title];
            return (
              <div key={sectionGroup.title} className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => toggleAiSection(sectionGroup.title)}
                  className={`flex items-center justify-between w-full text-[10px] uppercase tracking-widest font-mono border-b pb-1 cursor-pointer transition-colors group ${
                    sectionGroup.expert
                      ? 'text-fuchsia-400/70 border-fuchsia-500/10 hover:text-fuchsia-300'
                      : 'text-[#38bdf8]/70 border-white/5 hover:text-[#38bdf8]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}>{'>'}</span>
                    {sectionGroup.title}
                  </span>
                  <span className="text-white/25 group-hover:text-white/40">{sectionGroup.entries.length}</span>
                </button>
                {!collapsed && (
                  <>
                    {sectionGroup.entries.map((entry) => {
                      const raw = adminSettings[entry.key] as number | undefined;
                      return (
                        <div key={entry.key} className="flex flex-col gap-1.5">
                          <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
                            <span>{entry.label}</span>
                            <span className="text-cyan-400 font-bold">{entry.fmt(raw)}</span>
                          </div>
                          <input
                            type="range"
                            min={entry.min}
                            max={entry.max}
                            step={entry.step}
                            value={raw ?? entry.def}
                            onChange={(e) => setAdminSettings((prev) => ({ ...prev, [entry.key]: parseFloat(e.target.value) }))}
                            className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                          />
                          <p className="text-[10px] text-white/35 leading-snug">{entry.desc}</p>
                        </div>
                      );
                    })}
                    {sectionGroup.title === 'Combat Style' && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono uppercase tracking-wider text-white/60">Skip Pressure Chains</span>
                          <button
                            onClick={() => setAdminSettings((prev) => ({ ...prev, aiSkipPressure: !prev.aiSkipPressure }))}
                            className={`px-3 h-7 text-[10px] font-bold uppercase rounded cursor-pointer transition-all font-sans border ${
                              adminSettings.aiSkipPressure
                                ? 'bg-[#38bdf8]/20 border-[#38bdf8]/50 text-[#38bdf8]'
                                : 'bg-black/40 border-white/10 text-white/50 hover:text-white/80'
                            }`}
                            title="When ON, the AI never chains relentless post-hit pressure."
                          >
                            {adminSettings.aiSkipPressure ? 'On' : 'Off'}
                          </button>
                        </div>
                        <p className="text-[10px] text-white/35 leading-snug">When on, the AI disengages after landing a hit instead of chaining relentless follow-up pressure. Useful for patient, hit-and-retreat fighters.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5 mt-2">
            <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Save Custom AI Preset:</span>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Preset Name (e.g. AggroBot)"
                value={newAiPresetNameInput}
                onChange={(e) => setNewAiPresetNameInput(e.target.value)}
                className="flex-1 h-9 bg-black/60 border border-white/10 rounded px-2.5 text-xs text-white outline-none focus:border-[#38bdf8] transition-all font-sans"
              />
              <button
                onClick={() => onSaveAIPreset(newAiPresetNameInput)}
                className="px-4 h-9 bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 border border-[#38bdf8]/30 hover:border-[#38bdf8]/50 text-[#38bdf8] text-[10.5px] font-bold uppercase rounded cursor-pointer transition-all font-sans"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      </AdvancedSection>
    </div>
  );
}
