import React from 'react';
import type { UniversalSettings } from '../../types';
import {
  AVAILABLE_PRESETS,
  type ArmorPaintJob,
  type CharacterLoadout,
} from '../VoxelModels';
import type { CustomArmorCatalog, CustomArmorSlot } from '../customArmor';
import { CharacterPainter } from '../CharacterPainter';
import { CharacterPreview } from '../CharacterPreview';
import { ArmorModelEditor } from './ArmorModelEditor';

export type PreviewWeapon = 'none' | 'hammer' | 'sword';
export type SaveSystemStatus = { type: 'success' | 'error' | null; message: string };

interface CustomizationPanelProps {
  isPainting: boolean;
  playerLoadout: CharacterLoadout;
  customArmorCatalog: CustomArmorCatalog;
  playerHue?: number;
  customizerWeapon: PreviewWeapon;
  playerName: string;
  saveSystemStatus: SaveSystemStatus;
  saveCodeImportInput: string;
  setPlayerLoadout: React.Dispatch<React.SetStateAction<CharacterLoadout>>;
  setCustomArmorCatalog: React.Dispatch<React.SetStateAction<CustomArmorCatalog>>;
  setIsPainting: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomizerWeapon: React.Dispatch<React.SetStateAction<PreviewWeapon>>;
  setAdminSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
  onPlayerNameChange: (value: string) => void;
  onExportSaveCode: () => void;
  onResetAllSettings: () => void;
  onSaveCodeImportInputChange: (value: string) => void;
  onImportSaveCode: (value: string) => void;
}

const PLAYER_LOADOUT_STORAGE_KEY = 'grifball_player_loadout';
const PLAYER_HUE_STORAGE_KEY = 'grifball_player_hue';
const DEFAULT_PLAYER_HUE = 200;

const COLOR_PRESETS = [
  { name: 'Red', hue: 0, bg: 'bg-[#ef4444]' },
  { name: 'Orange', hue: 20, bg: 'bg-[#f97316]' },
  { name: 'Gold', hue: 45, bg: 'bg-[#fbbf24]' },
  { name: 'Green', hue: 120, bg: 'bg-[#22c55e]' },
  { name: 'Cyan', hue: 180, bg: 'bg-[#06b6d4]' },
  { name: 'Blue', hue: 200, bg: 'bg-[#3b82f6]' },
  { name: 'Purple', hue: 270, bg: 'bg-[#a855f7]' },
  { name: 'Magenta', hue: 300, bg: 'bg-[#d946ef]' },
  { name: 'Pink', hue: 330, bg: 'bg-[#ec4899]' },
] as const;

const WEAPON_OPTIONS: Array<{ id: PreviewWeapon; label: string }> = [
  { id: 'none', label: 'Fists' },
  { id: 'hammer', label: 'Hammer' },
  { id: 'sword', label: 'Sword' },
];

const SLOT_LABEL: Record<string, string> = {
  helmet: 'Helmet',
  torso: 'Chest',
  arm: 'Arms',
  leg: 'Legs',
  hammerPreset: 'Hammer',
  swordPreset: 'Sword',
};

const PRESET_LABEL: Record<string, string> = {
  'mark-vi': 'Mk.VI',
  odst: 'ODST',
  recon: 'Recon',
  eva: 'EVA',
  gungnir: 'Gungnir',
  scout: 'Scout',
  'jump-jet': 'JmpJet',
  eod: 'EOD',
  hayabusa: 'Hayabusa',
  cqb: 'CQB',
  default: 'Default',
  akelas: 'Akelas',
  akelus: 'Akelus',
  paegaas: 'Paegaas',
  sepulotez: "Sepulo'tez",
  halbashi: 'Halbashi',
  'eektah-fel': 'Eektah-Fel',
  'gravity-axe': 'Axe',
  'gravity-mace': 'Mace',
  'fist-of-rukt': 'Rukt',
  'halo-ce': 'CE Classic',
  'halo-2': 'Halo 2',
  'halo-3': 'Halo 3',
  reach: 'Reach',
  anniversary: 'CEA',
  'halo-4': 'Halo 4',
  'h2a-blue': 'H2A Blue',
  'h2a-pink': 'H2A Pink',
  'halo-5': 'Halo 5',
  infinite: 'Infinite',
};

const LOADOUT_SLOTS = [
  { key: 'helmet', options: AVAILABLE_PRESETS.helmet },
  { key: 'torso', options: AVAILABLE_PRESETS.torso },
  { key: 'arm', options: AVAILABLE_PRESETS.arm },
  { key: 'leg', options: AVAILABLE_PRESETS.leg },
  { key: 'hammerPreset', options: AVAILABLE_PRESETS.hammer },
  { key: 'swordPreset', options: AVAILABLE_PRESETS.sword },
] as const;

const ARMOR_SLOT_KEYS = new Set(['helmet', 'torso', 'arm', 'leg']);

function persistPlayerLoadout(loadout: CharacterLoadout) {
  try {
    localStorage.setItem(PLAYER_LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // Persistence is best-effort; the in-memory loadout still changes.
  }
}

function persistPlayerHue(hue: number) {
  try {
    localStorage.setItem(PLAYER_HUE_STORAGE_KEY, hue.toString());
  } catch (error) {
    console.error(error);
  }
}

export function CustomizationPanel({
  isPainting,
  playerLoadout,
  customArmorCatalog,
  playerHue = DEFAULT_PLAYER_HUE,
  customizerWeapon,
  playerName,
  saveSystemStatus,
  saveCodeImportInput,
  setPlayerLoadout,
  setCustomArmorCatalog,
  setIsPainting,
  setCustomizerWeapon,
  setAdminSettings,
  onPlayerNameChange,
  onExportSaveCode,
  onResetAllSettings,
  onSaveCodeImportInputChange,
  onImportSaveCode,
}: CustomizationPanelProps) {
  const [isModelEditing, setIsModelEditing] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    container.scrollTop = 0;
  }, [isPainting, isModelEditing]);

  const updateLoadout = (patch: Partial<CharacterLoadout>) => {
    setPlayerLoadout((previous) => {
      const next = { ...previous, ...patch };
      persistPlayerLoadout(next);
      return next;
    });
  };

  const updatePlayerHue = (hue: number) => {
    setAdminSettings((previous) => ({ ...previous, playerHue: hue }));
    persistPlayerHue(hue);
  };

  const savePaintJob = (paintJob: ArmorPaintJob) => {
    updateLoadout({ paintJob });
    setIsPainting(false);
  };

  const selectBuiltinArmor = (key: 'helmet' | 'torso' | 'arm' | 'leg', option: string) => {
    const nextCustomArmor = { ...(playerLoadout.customArmor ?? {}) };
    delete nextCustomArmor[key as CustomArmorSlot];
    updateLoadout({
      [key]: option,
      customArmor: nextCustomArmor,
    } as Partial<CharacterLoadout>);
  };

  return (
    <div ref={contentRef} className="flex-grow flex flex-col min-h-0 overflow-y-auto pr-1 justify-between gap-4">
      {isPainting ? (
        <CharacterPainter
          loadout={playerLoadout}
          hue={playerHue}
          onSave={savePaintJob}
          onCancel={() => setIsPainting(false)}
        />
      ) : isModelEditing ? (
        <ArmorModelEditor
          catalog={customArmorCatalog}
          playerLoadout={playerLoadout}
          playerHue={playerHue}
          onCatalogChange={setCustomArmorCatalog}
          onLoadoutChange={updateLoadout}
          onClose={() => setIsModelEditing(false)}
          onPaintPiece={() => {
            setIsModelEditing(false);
            setIsPainting(true);
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative bg-slate-950/30 border border-white/5 rounded-xl select-none overflow-hidden h-[380px] shrink-0">
            <CharacterPreview hue={playerHue} heldWeapon={customizerWeapon} loadout={playerLoadout} />
          </div>

          <button
            type="button"
            onClick={() => setIsPainting(true)}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500/15 to-blue-500/15 border border-cyan-500/35 hover:border-cyan-400 text-cyan-400 font-black uppercase tracking-widest rounded-lg shadow-lg hover:shadow-cyan-400/10 hover:bg-cyan-500/20 transition-all active:scale-[0.98] cursor-pointer text-center text-xs mt-1"
          >
            Start Paint Job
          </button>

          <button
            type="button"
            onClick={() => {
              updateLoadout({ modelSystem: 'v2' });
              setIsModelEditing(true);
            }}
            className={`w-full py-2.5 border font-black uppercase tracking-widest rounded-lg shadow-lg transition-all active:scale-[0.98] cursor-pointer text-center text-xs ${
              (playerLoadout.modelSystem ?? 'v1') === 'v2'
                ? 'bg-gradient-to-r from-purple-500/20 to-fuchsia-500/15 border-purple-400/45 text-purple-200 hover:border-purple-300'
                : 'bg-purple-500/10 border-purple-500/25 text-purple-300/80 hover:border-purple-400/45'
            }`}
          >
            Create / Edit V2 Armor Model
          </button>

          <div className="flex flex-col gap-3 font-sans text-xs">
            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Armor Color Hue angle</span>
                <span
                  className="font-mono text-xs font-black uppercase px-2 py-0.5 rounded border shadow"
                  style={{
                    color: `hsl(${playerHue}, 100%, 65%)`,
                    backgroundColor: `hsl(${playerHue}, 90%, 12%)`,
                    borderColor: `hsl(${playerHue}, 50%, 30%)`,
                  }}
                >
                  {playerHue} deg
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={playerHue}
                onChange={(event) => updatePlayerHue(parseInt(event.target.value, 10))}
                className="w-full h-2.5 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 via-purple-500 to-red-500 rounded-lg appearance-none cursor-pointer outline-none shadow-inner"
                style={{ WebkitAppearance: 'none' }}
              />
            </div>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Color presets Swatches</span>
              <div className="flex flex-wrap gap-2 justify-between">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => updatePlayerHue(preset.hue)}
                    title={preset.name}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-all active:scale-90 relative ${preset.bg} ${
                      playerHue === preset.hue
                        ? 'ring-1 ring-white ring-offset-2 ring-offset-slate-950 scale-110 shadow-lg'
                        : 'hover:scale-105 hover:opacity-90'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Pose Weapon preview</span>
              <div className="grid grid-cols-3 gap-2">
                {WEAPON_OPTIONS.map((weapon) => (
                  <button
                    key={weapon.id}
                    type="button"
                    onClick={() => setCustomizerWeapon(weapon.id)}
                    className={`py-2 text-xs font-bold uppercase tracking-wider border rounded cursor-pointer transition-all active:scale-98 ${
                      customizerWeapon === weapon.id
                        ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_10px_rgba(56,189,248,0.2)] font-black'
                        : 'bg-black/30 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {weapon.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2.5">Armor Loadout</span>
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/5">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">Model Sys</span>
                <div className="flex gap-1.5 flex-1">
                  {([
                    { id: 'v1', label: 'V1 (Classic)' },
                    { id: 'v2', label: 'V2 (Rigged)' },
                  ] as const).map((model) => {
                    const isActive = (playerLoadout.modelSystem ?? 'v1') === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => updateLoadout({ modelSystem: model.id })}
                        className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border rounded transition-all active:scale-95 ${
                          isActive
                            ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                            : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                        }`}
                      >
                        {model.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {LOADOUT_SLOTS.map(({ key, options }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">{SLOT_LABEL[key]}</span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {options.map((option) => {
                        const isArmorSlot = ARMOR_SLOT_KEYS.has(key);
                        const customForSlot = isArmorSlot ? playerLoadout.customArmor?.[key as CustomArmorSlot] : undefined;
                        const isActive = !customForSlot && playerLoadout[key as keyof CharacterLoadout] === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              if (isArmorSlot) {
                                selectBuiltinArmor(key as 'helmet' | 'torso' | 'arm' | 'leg', option);
                              } else {
                                updateLoadout({ [key]: option } as Partial<CharacterLoadout>);
                              }
                            }}
                            className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border rounded transition-all active:scale-95 ${
                              isActive
                                ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                                : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                            }`}
                          >
                            {PRESET_LABEL[option] ?? option}
                          </button>
                        );
                      })}
                      {ARMOR_SLOT_KEYS.has(key) && customArmorCatalog.pieces
                        .filter((piece) => piece.slot === key)
                        .map((piece) => {
                          const isCustomActive = playerLoadout.customArmor?.[key as CustomArmorSlot]?.id === piece.id;
                          return (
                            <button
                              key={piece.id}
                              type="button"
                              onClick={() => updateLoadout({
                                modelSystem: 'v2',
                                customArmor: {
                                  ...(playerLoadout.customArmor ?? {}),
                                  [key]: {
                                    version: 1,
                                    id: piece.id,
                                    name: piece.name,
                                    slot: piece.slot,
                                    sourcePreset: piece.sourcePreset,
                                    voxels: piece.voxels,
                                    thumbnail: piece.thumbnail,
                                    updatedAt: piece.updatedAt,
                                  },
                                },
                              })}
                              title={piece.name}
                              className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border rounded transition-all active:scale-95 ${
                                isCustomActive
                                  ? 'bg-purple-500/25 border-purple-300 text-purple-100 shadow-[0_0_8px_rgba(168,85,247,0.35)]'
                                  : 'bg-purple-950/30 border-purple-500/25 text-purple-200/70 hover:text-purple-100 hover:border-purple-400/50'
                              }`}
                            >
                              {piece.thumbnail ?? 'C'} {piece.name.slice(0, 8)}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Spartan Nickname Handle</span>
              <div className="relative">
                <input
                  type="text"
                  maxLength={10}
                  value={playerName}
                  onChange={(event) => onPlayerNameChange(event.target.value)}
                  placeholder="Max 10 characters..."
                  className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all font-sans"
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            </div>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
              <div className="flex justify-between items-center border-b border-white/5 pb-2">
                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                  Neural Backup System
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0 select-none animate-pulse">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
                  LOCAL_COOKIE_ACTIVE
                </span>
              </div>

              <p className="text-xs text-white/50 leading-normal">
                All configs, layouts, colors, and Spartan handles are synced locally. Export a decryption code to share or migrate your profile!
              </p>

              {saveSystemStatus.type && (
                <div className={`p-2.5 rounded text-xs font-mono border ${
                  saveSystemStatus.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  {saveSystemStatus.message}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onExportSaveCode}
                  className="flex-1 py-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/30 border border-[#38bdf8]/30 text-[#38bdf8] font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                >
                  Export Save Code
                </button>
                <button
                  type="button"
                  onClick={onResetAllSettings}
                  className="py-2 px-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
                  title="Wipe client database"
                >
                  Wipe Saves
                </button>
              </div>

              <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2.5">
                <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">Import Cybernetic Code:</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={saveCodeImportInput}
                    onChange={(event) => onSaveCodeImportInputChange(event.target.value)}
                    placeholder="Paste GRIF-DEC- code here..."
                    className="flex-1 h-10 bg-black/60 border border-white/10 rounded px-3 font-mono text-xs text-white placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => onImportSaveCode(saveCodeImportInput)}
                    disabled={!saveCodeImportInput}
                    className={`px-4 h-10 font-sans font-bold text-xs uppercase tracking-wider rounded transition-all border outline-none ${
                      saveCodeImportInput
                        ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border-emerald-500/40 text-emerald-400 cursor-pointer'
                        : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
                    }`}
                  >
                    Decrypt
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
