import React from 'react';
import type { CharacterModelType, UniversalSettings } from '../../types';
import {
  AVAILABLE_PRESETS,
  type ArmorPaintJob,
  type CharacterLoadout,
} from '../VoxelModels';
import {
  V3_CUSTOM_ARMOR_SLOTS,
  getCustomArmorPieceModelSystem,
  getCustomArmorSlotLabel,
  type CustomArmorCatalog,
  type CustomArmorSlot,
} from '../customArmor';
import { CharacterPainter } from '../CharacterPainter';
import { CharacterPreview } from '../CharacterPreview';

export type PreviewWeapon = 'none' | 'hammer' | 'sword';

interface ArmoryPanelProps {
  isPainting: boolean;
  playerLoadout: CharacterLoadout;
  customArmorCatalog: CustomArmorCatalog;
  playerHue?: number;
  customizerWeapon: PreviewWeapon;
  setPlayerLoadout: React.Dispatch<React.SetStateAction<CharacterLoadout>>;
  setIsPainting: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomizerWeapon: React.Dispatch<React.SetStateAction<PreviewWeapon>>;
  setAdminSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
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

const formatV3SlotLabel = (slot: string): string =>
  slot
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase());

const V3_LOADOUT_SLOTS = V3_CUSTOM_ARMOR_SLOTS.map((slot) => ({
  key: slot,
  label: formatV3SlotLabel(slot),
  title: getCustomArmorSlotLabel(slot, 'v3'),
}));

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

export function ArmoryPanel({
  isPainting,
  playerLoadout,
  customArmorCatalog,
  playerHue = DEFAULT_PLAYER_HUE,
  customizerWeapon,
  setPlayerLoadout,
  setIsPainting,
  setCustomizerWeapon,
  setAdminSettings,
}: ArmoryPanelProps) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const activeModelSystem = playerLoadout.modelSystem ?? 'v1';
  const activeModelType: CharacterModelType = activeModelSystem === 'v2'
    ? playerLoadout.modelType ?? 'medium'
    : 'medium';
  const editorModelSystem = activeModelSystem === 'v3' ? 'v3' : 'v2';

  React.useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    container.scrollTop = 0;
  }, [isPainting]);

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

  const selectBuiltinV3Armor = (slot: CustomArmorSlot) => {
    const nextCustomArmor = { ...(playerLoadout.customArmor ?? {}) };
    delete nextCustomArmor[slot];
    updateLoadout({
      modelSystem: 'v3',
      modelType: undefined,
      customArmor: nextCustomArmor,
    });
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

          <a
            href="/armor-model-editor.html"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              updateLoadout({
                modelSystem: editorModelSystem,
                modelType: editorModelSystem === 'v2' ? activeModelType : undefined,
              });
            }}
            className={`w-full py-2.5 border font-black uppercase tracking-widest rounded-lg shadow-lg transition-all active:scale-[0.98] cursor-pointer text-center text-xs ${
              (playerLoadout.modelSystem ?? 'v1') === editorModelSystem
                ? 'bg-gradient-to-r from-purple-500/20 to-fuchsia-500/15 border-purple-400/45 text-purple-200 hover:border-purple-300'
                : 'bg-purple-500/10 border-purple-500/25 text-purple-300/80 hover:border-purple-400/45'
            }`}
          >
            {editorModelSystem === 'v3' ? 'Create / Edit V3 Armor Model' : 'Create / Edit V2 Armor Model'}
          </a>

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
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">Model Sys</span>
                <div className="flex gap-1.5 flex-1">
                  {([
                    { id: 'v1', label: 'V1 (Classic)' },
                    { id: 'v2', label: 'V2 (Rigged)' },
                    { id: 'v3', label: 'V3 (Advanced)' },
                  ] as const).map((model) => {
                    const isActive = (playerLoadout.modelSystem ?? 'v1') === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => updateLoadout({
                          modelSystem: model.id,
                          modelType: model.id === 'v2' ? activeModelType : undefined,
                        })}
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
              {activeModelSystem !== 'v3' && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">Body</span>
                  <div className="grid grid-cols-2 flex-1 h-8 rounded border border-white/10 bg-black/40 overflow-hidden">
                    {(['medium', 'large'] as const).map((modelType) => {
                      const isActive = activeModelSystem === 'v2' && activeModelType === modelType;
                      return (
                        <button
                          key={modelType}
                          type="button"
                          onClick={() => updateLoadout({ modelSystem: 'v2', modelType })}
                          className={`text-[10px] font-black uppercase tracking-widest transition-all ${
                            isActive
                              ? 'bg-purple-500/25 text-purple-100'
                              : 'text-white/45 hover:text-white/75 hover:bg-white/5'
                          }`}
                        >
                          {modelType}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {activeModelSystem === 'v3' ? (
                  V3_LOADOUT_SLOTS.map(({ key, label, title }) => {
                    const equippedPiece = playerLoadout.customArmor?.[key];
                    const isBuiltinActive = !equippedPiece || getCustomArmorPieceModelSystem(equippedPiece) !== 'v3';
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span
                          title={title}
                          className="w-20 shrink-0 truncate text-[10px] font-black uppercase tracking-widest text-white/40"
                        >
                          {label}
                        </span>
                        <div className="flex flex-1 flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => selectBuiltinV3Armor(key)}
                            className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest border rounded transition-all active:scale-95 ${
                              isBuiltinActive
                                ? 'bg-[#38bdf8]/15 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                                : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                            }`}
                          >
                            Built-In
                          </button>
                          {customArmorCatalog.pieces
                            .filter((piece) => piece.slot === key && getCustomArmorPieceModelSystem(piece) === 'v3')
                            .map((piece) => {
                              const isCustomActive = equippedPiece?.id === piece.id && getCustomArmorPieceModelSystem(equippedPiece) === 'v3';
                              return (
                                <button
                                  key={piece.id}
                                  type="button"
                                  onClick={() => updateLoadout({
                                    modelSystem: 'v3',
                                    modelType: undefined,
                                    customArmor: {
                                      ...(playerLoadout.customArmor ?? {}),
                                      [key]: {
                                        version: 1,
                                        id: piece.id,
                                        name: piece.name,
                                        slot: piece.slot,
                                        modelSystem: 'v3',
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
                                  {piece.thumbnail ?? 'V3'} {piece.name.slice(0, 8)}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  LOADOUT_SLOTS.map(({ key, options }) => (
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
                          .filter((piece) => (
                            piece.slot === key &&
                            getCustomArmorPieceModelSystem(piece) === 'v2' &&
                            ((piece.modelType ?? 'medium') === activeModelType)
                          ))
                          .map((piece) => {
                            const isCustomActive = playerLoadout.customArmor?.[key as CustomArmorSlot]?.id === piece.id;
                            return (
                              <button
                                key={piece.id}
                                type="button"
                                onClick={() => updateLoadout({
                                  modelSystem: 'v2',
                                  modelType: activeModelType,
                                  customArmor: {
                                    ...(playerLoadout.customArmor ?? {}),
                                    [key]: {
                                      version: 1,
                                      id: piece.id,
                                      name: piece.name,
                                      slot: piece.slot,
                                      modelSystem: 'v2',
                                      modelType: piece.modelType ?? 'medium',
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
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
