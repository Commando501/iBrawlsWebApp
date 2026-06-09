import React from 'react';
import type { AIPreset, CharacterModelType, CustomMapData, UniversalSettings } from '../../types';
import { AI_ARCHETYPE_OPTIONS, type AIArchetypeId } from '../../game/aiPersonalities';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { MapPreview } from './MapPreview';
import { getArchetypeDescription, getPresetDescription } from './aiMenuContent';

const BOT_COLOR_PRESETS = [
  { label: 'Red', hue: 0 },
  { label: 'Orange', hue: 28 },
  { label: 'Yellow', hue: 55 },
  { label: 'Lime', hue: 85 },
  { label: 'Green', hue: 120 },
  { label: 'Teal', hue: 168 },
  { label: 'Cyan', hue: 190 },
  { label: 'Blue', hue: 215 },
  { label: 'Purple', hue: 275 },
  { label: 'Magenta', hue: 310 },
] as const;

const BOT_IDS = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'] as const;
const STOCK_DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'] as const;

const EXTRA_BOTS = [
  { id: 'bot_2', name: 'DoomBot Green', hue: 120 },
  { id: 'bot_3', name: 'DoomBot Purple', hue: 280 },
  { id: 'bot_4', name: 'DoomBot Orange', hue: 45 },
  { id: 'bot_5', name: 'DoomBot Yellow', hue: 60 },
  { id: 'bot_6', name: 'DoomBot Magenta', hue: 320 },
  { id: 'bot_7', name: 'DoomBot Cyan', hue: 180 },
] as const;

type DifficultyMap = Record<string, string>;
type ArchetypeMap = Record<string, AIArchetypeId>;
type BotColorMap = Record<string, number>;
type BotModelTypeMap = Record<string, CharacterModelType>;

interface BotSetupModalProps {
  isPlaying: boolean;
  offlineBotCount: number;
  onOfflineBotCountChange: (count: number) => void;
  adminSettings: UniversalSettings;
  playerName: string;
  selectedMap: string;
  onSelectedMapChange: (mapId: string) => void;
  lobbyCustomMapData: CustomMapData | null;
  onCustomMapDataChange: (map: CustomMapData) => void;
  botColors: BotColorMap;
  setBotColors: React.Dispatch<React.SetStateAction<BotColorMap>>;
  botDifficulties: DifficultyMap;
  setBotDifficulties: React.Dispatch<React.SetStateAction<DifficultyMap>>;
  botArchetypes: ArchetypeMap;
  setBotArchetypes: React.Dispatch<React.SetStateAction<ArchetypeMap>>;
  botModelTypes: BotModelTypeMap;
  setBotModelTypes: React.Dispatch<React.SetStateAction<BotModelTypeMap>>;
  aiPresets: AIPreset[];
  onToggleGrifballMode: () => void;
  onMainAiArchetypeChange: (archetypeId: AIArchetypeId) => void;
  onClose: () => void;
  onApplyAndResume: () => void;
  onInitializeSimulation: () => void;
}

const isStockDifficulty = (difficulty: string) =>
  (STOCK_DIFFICULTIES as readonly string[]).includes(difficulty);

export function BotSetupModal({
  isPlaying,
  offlineBotCount,
  onOfflineBotCountChange,
  adminSettings,
  playerName,
  selectedMap,
  onSelectedMapChange,
  lobbyCustomMapData,
  onCustomMapDataChange,
  botColors,
  setBotColors,
  botDifficulties,
  setBotDifficulties,
  botArchetypes,
  setBotArchetypes,
  botModelTypes,
  setBotModelTypes,
  aiPresets,
  onToggleGrifballMode,
  onMainAiArchetypeChange,
  onClose,
  onApplyAndResume,
  onInitializeSimulation,
}: BotSetupModalProps) {
  const selectedPremadeMap = PREMADE_MAPS.find((map) => map.id === selectedMap);

  const handleCustomMapFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const parsed = JSON.parse(loadEvent.target?.result as string) as CustomMapData;
        if (parsed && parsed.name && parsed.objects) {
          onCustomMapDataChange(parsed);
          return;
        }
        alert('Invalid map structure. Make sure objects and name are defined.');
      } catch {
        alert('Failed to parse map JSON.');
      }
    };
    reader.readAsText(file);
  };

  const setAllBotDifficulties = (difficulty: 'easy' | 'normal' | 'hard' | 'nightmare') => {
    const next: DifficultyMap = {};
    BOT_IDS.forEach((id) => {
      next[id] = difficulty;
    });
    setBotDifficulties(next);
  };

  const setGraduatedDifficulties = () => {
    const levels: ('easy' | 'normal' | 'hard' | 'nightmare')[] = [
      'easy',
      'normal',
      'normal',
      'hard',
      'hard',
      'nightmare',
      'nightmare',
    ];
    const next: DifficultyMap = {};
    BOT_IDS.forEach((id, index) => {
      next[id] = levels[index];
    });
    setBotDifficulties(next);
  };

  const renderDifficultyOptions = () => (
    <>
      <option value="easy" title={getPresetDescription('easy', aiPresets)}>Easy</option>
      <option value="normal" title={getPresetDescription('normal', aiPresets)}>Normal</option>
      <option value="hard" title={getPresetDescription('hard', aiPresets)}>Hard</option>
      <option value="nightmare" title={getPresetDescription('nightmare', aiPresets)}>Nightmare</option>
      {aiPresets.length > 0 && (
        <optgroup label="Custom Presets">
          {aiPresets.map((preset) => (
            <option key={preset.id} value={preset.id} title={getPresetDescription(preset.id, aiPresets)}>
              {preset.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  const renderArchetypeOptions = () => (
    <>
      {AI_ARCHETYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value} title={getArchetypeDescription(option.value)}>
          {option.label}
        </option>
      ))}
    </>
  );

  const renderColorSwatches = (botId: string, fallbackHue: number) => (
    <div className="flex flex-wrap justify-center gap-0.5">
      {BOT_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.hue}
          title={preset.label}
          onClick={() => setBotColors((prev) => ({ ...prev, [botId]: preset.hue }))}
          className="w-3 h-3 rounded-full cursor-pointer transition-transform hover:scale-125"
          style={{
            backgroundColor: `hsl(${preset.hue}, 75%, 50%)`,
            outline: (botColors[botId] ?? fallbackHue) === preset.hue ? '2px solid white' : '2px solid transparent',
            outlineOffset: '1px',
          }}
        />
      ))}
    </div>
  );

  const renderModelTypeToggle = (botId: string) => {
    const selectedType = botModelTypes[botId] ?? 'medium';
    return (
      <div className="grid grid-cols-2 h-7 rounded border border-white/10 bg-black/50 overflow-hidden">
        {(['medium', 'large'] as const).map((modelType) => (
          <button
            key={modelType}
            type="button"
            title={`${modelType === 'large' ? 'Large powerarmor body' : 'Medium Spartan body'}`}
            onClick={() => setBotModelTypes((prev) => ({ ...prev, [botId]: modelType }))}
            className={`text-[9px] font-bold uppercase transition-colors ${
              selectedType === modelType
                ? 'bg-cyan-400/20 text-cyan-200'
                : 'text-white/45 hover:text-white/75 hover:bg-white/5'
            }`}
          >
            {modelType}
          </button>
        ))}
      </div>
    );
  };

  const renderBotControls = (botId: string, onArchetypeChange: (archetypeId: AIArchetypeId) => void) => {
    const difficulty = botDifficulties[botId] || 'normal';
    return (
      <div className="w-full flex flex-col gap-1 mt-auto">
        <select
          value={difficulty}
          onChange={(event) => setBotDifficulties((prev) => ({ ...prev, [botId]: event.target.value }))}
          className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-white/70 font-bold uppercase outline-none focus:border-blue-400 cursor-pointer transition-all font-sans"
          title={getPresetDescription(difficulty, aiPresets)}
        >
          {renderDifficultyOptions()}
        </select>
        {isStockDifficulty(difficulty) && (
          <select
            value={botArchetypes[botId] || 'none'}
            onChange={(event) => onArchetypeChange(event.target.value as AIArchetypeId)}
            className="w-full h-7 bg-black/60 border border-white/10 rounded px-1.5 text-[10px] text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
            title={getArchetypeDescription(botArchetypes[botId] || 'none')}
          >
            {renderArchetypeOptions()}
          </select>
        )}
        {renderModelTypeToggle(botId)}
      </div>
    );
  };

  const renderExtraBot = (bot: typeof EXTRA_BOTS[number], index: number) => {
    const slotActive = index + 2 <= offlineBotCount;
    return (
      <div
        key={bot.id}
        className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${slotActive ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}
      >
        <div
          className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
          style={{
            borderColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 50%)`,
            backgroundColor: `hsl(${botColors[bot.id] ?? bot.hue}, 60%, 15%)`,
          }}
        >
          BOT
        </div>
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide truncate max-w-full">{bot.name}</span>
        {renderColorSwatches(bot.id, bot.hue)}
        {slotActive && renderBotControls(bot.id, (archetypeId) => (
          setBotArchetypes((prev) => ({ ...prev, [bot.id]: archetypeId }))
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none">
      <div className="mobile-modal w-full max-w-2xl bg-slate-900/60 border border-blue-500/20 backdrop-blur-2xl rounded-2xl p-6 shadow-[0_0_60px_rgba(56,189,248,0.08)] flex flex-col gap-5 max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex flex-col">
            <p className="text-[10px] text-blue-400 font-bold tracking-[0.3em] uppercase mb-1 font-display">COMBAT SIMULATION</p>
            <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
              AI Combatant Grid Setup
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-lg font-bold cursor-pointer transition-colors px-2 py-1 rounded hover:bg-white/5"
          >
            X
          </button>
        </div>

        <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Active AI Combatants</span>
            <span className="text-lg font-black font-mono text-blue-400">
              {offlineBotCount} <span className="text-xs text-white/40 font-normal">BOTS</span>
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="7"
            value={offlineBotCount}
            onChange={(event) => onOfflineBotCountChange(parseInt(event.target.value, 10))}
            className="w-full accent-blue-400 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-white/30 uppercase">
            <span>1 Bot</span>
            <span>7 Bots</span>
          </div>
        </div>

        <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex flex-col text-left">
            <span className="text-xs font-bold text-orange-400 uppercase tracking-wider">Grifball Mode (4v4)</span>
            <span className="text-[10.5px] text-white/50 leading-snug">
              Round-based neutral-ball objective. Forces an 8-player match on a reshaped stadium court.
            </span>
          </div>
          <button
            onClick={onToggleGrifballMode}
            className={`shrink-0 px-4 h-10 rounded-lg font-black text-sm uppercase tracking-wider transition-all cursor-pointer border ${
              adminSettings.gameMode === 'grifball'
                ? 'bg-orange-500/20 border-orange-400 text-orange-300'
                : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'
            }`}
          >
            {adminSettings.gameMode === 'grifball' ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex gap-5 items-stretch">
          <div className="flex-1 flex flex-col justify-between py-1 select-none text-left">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Battle Arena Map Selector</span>
              <p className="text-[10.5px] text-white/50 leading-snug">
                Choose the virtual environment where your combat simulation will be executed.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 mt-3">
              <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Arena Blueprint:</span>
              <select
                value={selectedMap}
                onChange={(event) => onSelectedMapChange(event.target.value)}
                className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm text-cyan-400 font-bold uppercase outline-none focus:border-cyan-400 cursor-pointer transition-all font-sans"
              >
                <option value="hangar">Industrial Hangar (Default)</option>
                <option value="circle">Circle Arena (Minimalist)</option>
                {PREMADE_MAPS.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name} (Preset)
                  </option>
                ))}
                <option value="custom_file">Load Custom Map (.json)</option>
              </select>
            </div>

            {selectedMap === 'custom_file' && (
              <div className="flex flex-col gap-2 mt-2 bg-black/40 border border-cyan-500/20 p-3 rounded-lg">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-bold">Import Local Map File</span>
                {lobbyCustomMapData ? (
                  <div className="flex flex-col gap-1 text-[10px] text-white/60">
                    <div>Loaded: <strong className="text-cyan-300 font-black">{lobbyCustomMapData.name}</strong></div>
                    <div>Author: {lobbyCustomMapData.author}</div>
                    <div>Objects: {lobbyCustomMapData.objects?.length || 0} | Spawns: {lobbyCustomMapData.spawnPoints?.length || 0}</div>
                  </div>
                ) : (
                  <p className="text-[10px] text-white/40 italic">No custom map file loaded yet.</p>
                )}
                <label className="h-8 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-mono text-[10px] font-bold uppercase tracking-wider rounded flex items-center justify-center cursor-pointer transition-all gap-1.5 mt-1">
                  Select Map JSON
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleCustomMapFileChange}
                  />
                </label>
              </div>
            )}

            <div className="text-[10px] text-white/45 mt-2 bg-black/30 border border-white/5 p-2 rounded">
              {selectedMap === 'hangar' ? (
                <span><strong>Industrial Hangar:</strong> A gritty, atmospheric warehouse with steel columns, hazard stripes, metal pipes, ceiling trusses, and warm amber light shafts.</span>
              ) : selectedMap === 'circle' ? (
                <span><strong>Circle Arena:</strong> A clean, minimalist holographic grid arena with concentric glowing borders, four cardinal posts, and sleek neon cyan lights.</span>
              ) : selectedMap === 'custom_file' ? (
                <span><strong>Custom Arena:</strong> An externally loaded .json map from the local Standalone Map Maker tool.</span>
              ) : (
                <span><strong>{selectedPremadeMap?.name}:</strong> {selectedPremadeMap?.description}</span>
              )}
            </div>
          </div>
          <MapPreview selectedMap={selectedMap} />
        </div>

        <div className="bg-white/5 border border-white/5 rounded-xl p-4 flex flex-col gap-3">
          <span className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">Holographic Combatant Grid</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex flex-col items-center gap-1.5 text-center">
              <div
                className="w-8 h-8 rounded-full border-2 border-blue-400 flex items-center justify-center text-sm"
                style={{ backgroundColor: `hsl(${adminSettings.playerHue}, 80%, 25%)` }}
              >
                P1
              </div>
              <span className="text-[10px] font-black text-blue-300 uppercase tracking-wider truncate max-w-full">{playerName}</span>
              <span className="text-[8px] font-mono text-blue-400/60 uppercase">PLAYER</span>
            </div>

            <div className={`rounded-lg p-3 flex flex-col items-center gap-1.5 text-center transition-all ${1 <= offlineBotCount ? 'bg-white/5 border border-white/10' : 'bg-white/2 border border-white/5 opacity-20'}`}>
              <div
                className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm"
                style={{
                  borderColor: `hsl(${botColors.main_ai ?? 0}, 60%, 50%)`,
                  backgroundColor: `hsl(${botColors.main_ai ?? 0}, 60%, 15%)`,
                }}
              >
                BOT
              </div>
              <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide">DoomBot</span>
              {renderColorSwatches('main_ai', 0)}
              {1 <= offlineBotCount && renderBotControls('main_ai', onMainAiArchetypeChange)}
            </div>

            {EXTRA_BOTS.map(renderExtraBot)}
          </div>
        </div>

        <div className="mobile-bot-presets flex items-center gap-2">
          <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono shrink-0">Presets:</span>
          <button
            onClick={() => setAllBotDifficulties('normal')}
            className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
          >
            All Normal
          </button>
          <button
            onClick={() => setAllBotDifficulties('nightmare')}
            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
          >
            All Nightmare
          </button>
          <button
            onClick={setGraduatedDifficulties}
            className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-all"
          >
            Graduated
          </button>
        </div>

        <div className="mobile-modal-actions flex gap-3 mt-1">
          {isPlaying ? (
            <button
              onClick={onApplyAndResume}
              className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg"
            >
              Apply & Resume
            </button>
          ) : (
            <button
              onClick={onInitializeSimulation}
              className="flex-1 h-12 bg-white hover:bg-blue-400 hover:text-white text-slate-900 font-black text-xs uppercase tracking-widest rounded cursor-pointer transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
            >
              Initialize Simulation
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 font-bold text-xs uppercase tracking-widest rounded cursor-pointer transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
