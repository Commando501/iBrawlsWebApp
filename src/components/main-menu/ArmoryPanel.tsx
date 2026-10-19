import { useModelVariantsEnabled } from '../../model/ModelVariantsContext';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import { isIronVanguardLoadout, preloadIronVanguard } from '../iron-vanguard/ironVanguardModel';
import React from 'react';
import type { CharacterModelType, UniversalSettings } from '../../types';
import { V3_INTERNAL_PROTOTYPE_LABEL } from '../../model/v3InternalStatus';
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
import {
  applyV3SuitProfileToLoadout,
  exportV3SuitProfileBundle,
  validateV3SuitProfile,
  type V3SuitProfile,
  type V3SuitProfileCatalog,
} from './v3ArmorSuitProfiles';
import { buildV3SuitReadinessReport } from './v3ArmorSuitReadiness';
import { V3_PAINT_ROLES } from '../v3/v3ModelTypes';
import type { V3PaintRole } from '../v3/v3ModelTypes';
import { CharacterPainter } from '../CharacterPainter';
import { GameModelStage } from './GameModelStage';
import {
  resetV3PaintRole,
  updateV3PaintRoleColor,
  updateV3PaintRoleEmissive,
} from './v3PaintRoleControls';

export type PreviewWeapon = 'none' | 'hammer' | 'sword';

interface ArmoryPanelProps {
  isPainting: boolean;
  playerLoadout: CharacterLoadout;
  customArmorCatalog: CustomArmorCatalog;
  v3SuitProfileCatalog: V3SuitProfileCatalog;
  playerHue?: number;
  customizerWeapon: PreviewWeapon;
  setPlayerLoadout: React.Dispatch<React.SetStateAction<CharacterLoadout>>;
  setV3SuitProfileCatalog: React.Dispatch<React.SetStateAction<V3SuitProfileCatalog>>;
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
  'halo-ce': 'Cyan Classic',
  'halo-2': 'Twin Arc',
  'halo-3': 'Prism Edge',
  reach: 'Emberline',
  anniversary: 'Aegis Arc',
  'halo-4': 'Vanguard IV',
  'h2a-blue': 'Cerulean Rift',
  'h2a-pink': 'Crimson Rift',
  'halo-5': 'Aurum V',
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

const formatV3PaintRoleLabel = (role: V3PaintRole): string =>
  role.replace(/^./, (value) => value.toUpperCase());

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
  playerLoadout: savedPlayerLoadout,
  customArmorCatalog,
  v3SuitProfileCatalog,
  playerHue = DEFAULT_PLAYER_HUE,
  customizerWeapon,
  setPlayerLoadout,
  setIsPainting,
  setCustomizerWeapon,
  setAdminSettings,
}: ArmoryPanelProps) {
  const allowModelVariants = useModelVariantsEnabled();
  const playerLoadout = allowModelVariants ? savedPlayerLoadout : resolveLoadoutForVisualPolicy({ visualModelPolicy: 'v3', loadout: savedPlayerLoadout });
  const isIronVanguard = isIronVanguardLoadout(playerLoadout);
  const [activeTab, setActiveTab] = React.useState<'color' | 'equipment' | 'loadouts'>('color');
  const [characterLoading, setCharacterLoading] = React.useState(false);
  const [characterError, setCharacterError] = React.useState('');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const activeModelSystem = playerLoadout.modelSystem ?? 'v1';
  const activeModelType: CharacterModelType = activeModelSystem === 'v2'
    ? playerLoadout.modelType ?? 'medium'
    : 'medium';
  const editorModelSystem = activeModelSystem === 'v3' ? 'v3' : 'v2';
  const loadoutModelOptions = activeModelSystem === 'v3'
    ? ([
      { id: 'v1', label: 'V1 (Classic)' },
      { id: 'v2', label: 'V2 (Rigged)' },
      { id: 'v3', label: 'V3 (Internal)' },
    ] as const)
    : ([
      { id: 'v1', label: 'V1 (Classic)' },
      { id: 'v2', label: 'V2 (Rigged)' },
    ] as const);

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

  const equipIronVanguard = async () => {
    setCharacterLoading(true);
    setCharacterError('');
    try {
      await preloadIronVanguard();
      updateLoadout({ characterAsset: 'iron-vanguard', modelSystem: 'v3', modelType: 'medium' });
      setCustomizerWeapon('hammer');
    } catch {
      setCharacterError('Iron Vanguard could not load. Please try again.');
    } finally {
      setCharacterLoading(false);
    }
  };

  const updatePlayerHue = (hue: number) => {
    setAdminSettings((previous) => ({ ...previous, playerHue: hue }));
    persistPlayerHue(hue);
  };

  const savePaintJob = (paintJob: ArmorPaintJob) => {
    updateLoadout({ paintJob });
    setIsPainting(false);
  };

  const updateV3PaintJob = (paintJob: ArmorPaintJob) => {
    updateLoadout({
      modelSystem: 'v3',
      paintJob,
    });
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

  const applyV3SuitProfile = (profile: V3SuitProfile) => {
    const result = applyV3SuitProfileToLoadout(playerLoadout, profile, customArmorCatalog);
    if (result.loadoutPatch) {
      updateLoadout(result.loadoutPatch);
    }
  };

  const getV3SuitProfileBadges = (profile: V3SuitProfile): string[] => {
    const validation = validateV3SuitProfile(profile, customArmorCatalog);
    const exportability = exportV3SuitProfileBundle(profile, customArmorCatalog);
    const readiness = buildV3SuitReadinessReport({
      source: 'profile',
      catalog: customArmorCatalog,
      profile,
      profileValidation: validation,
      exportErrors: exportability.errors,
      exportWarnings: exportability.warnings,
    });
    const badges = [validation.status === 'ready' ? 'Ready' : validation.status === 'partial' ? 'Partial' : 'Missing'];
    const equipped = validation.appliedSlotIds.length > 0 && validation.appliedSlotIds.every((candidate) => (
      playerLoadout.customArmor?.[candidate]?.id === profile.slotPieceIds[candidate]
    ));
    if (equipped) badges.push('Equipped');
    if (!readiness.readyToExportProfile) badges.push('Export Blocked');
    return badges;
  };

  return (
    <div ref={contentRef} className={`menu-armory ${isPainting ? 'menu-armory--painting' : ''}`}>
      {isPainting && allowModelVariants ? (
        <CharacterPainter loadout={playerLoadout} hue={playerHue} onSave={savePaintJob} onCancel={() => setIsPainting(false)} />
      ) : <>
        <GameModelStage hue={playerHue} heldWeapon={customizerWeapon} loadout={playerLoadout} />
        <section className="menu-armory__inspector" aria-label="Appearance options">
          <div className="menu-armory__tabs" role="tablist" aria-label="Armory categories" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = ['color', 'equipment', 'loadouts'] as const;
            const current = tabs.indexOf(activeTab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
            setActiveTab(tabs[next]);
            event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus();
          }}>
            {([['color', 'Color'], ['equipment', 'Equipment'], ['loadouts', 'More loadouts']] as const).map(([id, label]) => <button key={id} type="button" role="tab" id={`armory-tab-${id}`} aria-controls={`armory-panel-${id}`} aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} onClick={() => setActiveTab(id)}>{label}</button>)}
          </div>
          <div className="menu-armory__options">
            <section role="tabpanel" id="armory-panel-color" aria-labelledby="armory-tab-color" hidden={activeTab !== 'color'}>
              <header className="menu-armory__section-title"><span>ARMOR FINISH</span><h2>Make it yours.</h2><p>Choose a preset or find your own hue.</p></header>

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Custom hue</span>
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
                aria-label="Armor color hue"
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
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Color presets</span>
              <div className="flex flex-wrap gap-2 justify-between">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => updatePlayerHue(preset.hue)}
                    title={preset.name}
                    aria-label={`${preset.name} armor color`}
                    aria-pressed={playerHue === preset.hue}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-all active:scale-90 relative ${preset.bg} ${
                      playerHue === preset.hue
                        ? 'ring-1 ring-white ring-offset-2 ring-offset-slate-950 scale-110 shadow-lg'
                        : 'hover:scale-105 hover:opacity-90'
                    }`}
                  />
                ))}
              </div>
            </div>

            {activeModelSystem === 'v3' && !isIronVanguard && (
              <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">V3 Material Roles</span>
                  <span className="text-[10px] text-white/45 uppercase tracking-widest">Armor + weapons</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {V3_PAINT_ROLES.map((role) => {
                    const color = playerLoadout.paintJob?.v3RoleColors?.[role] ?? '#38bdf8';
                    const emissive = playerLoadout.paintJob?.v3RoleEmissive?.[role] ?? (role === 'emissive' || role === 'visor');
                    return (
                      <div key={role} className="flex items-center gap-2 bg-black/20 border border-white/5 rounded-md p-2 min-w-0">
                        <input
                          aria-label={`${role} color`}
                          type="color"
                          value={color}
                          onChange={(event) => updateV3PaintJob(updateV3PaintRoleColor(playerLoadout.paintJob, role, event.target.value))}
                          className="w-7 h-7 rounded border border-white/10 bg-transparent shrink-0"
                        />
                        <span className="text-[10px] text-white/70 uppercase truncate flex-1">{formatV3PaintRoleLabel(role)}</span>
                        <label className="flex items-center gap-1 text-[9px] text-white/45 uppercase">
                          <input
                            type="checkbox"
                            checked={emissive}
                            onChange={(event) => updateV3PaintJob(updateV3PaintRoleEmissive(playerLoadout.paintJob, role, event.target.checked))}
                            className="w-3 h-3"
                          />
                          Emissive
                        </label>
                        <button
                          type="button"
                          onClick={() => updateV3PaintJob(resetV3PaintRole(playerLoadout.paintJob, role))}
                          className="text-[9px] text-white/35 hover:text-white"
                        >
                          Reset
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


              <div className="menu-armory__color-note"><p>Team modes use team colors during play.</p><button type="button" onClick={() => updatePlayerHue(DEFAULT_PLAYER_HUE)}>Reset color</button></div>
            </section>
            <section role="tabpanel" id="armory-panel-equipment" aria-labelledby="armory-tab-equipment" hidden={activeTab !== 'equipment'}>
              <header className="menu-armory__section-title"><span>PREVIEW EQUIPMENT</span><h2>Ready for action.</h2><p>Inspect the weapons in your character preview.</p></header>
            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Weapon preview</span>
              <div className="grid grid-cols-3 gap-2">
                {WEAPON_OPTIONS.map((weapon) => (
                  <button
                    key={weapon.id}
                    type="button"
                    onClick={() => setCustomizerWeapon(weapon.id)}
                    aria-pressed={customizerWeapon === weapon.id}
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


              <p className="menu-armory__note">These controls change the preview pose. Your match mode determines the equipment available during play.</p>
              {isIronVanguard && <p className="menu-armory__note">Iron Vanguard uses its original hammer and energy sword. {allowModelVariants ? 'Weapon skins are available for compatible Standard characters in More loadouts.' : ''}</p>}
            </section>
            <section role="tabpanel" id="armory-panel-loadouts" aria-labelledby="armory-tab-loadouts" hidden={activeTab !== 'loadouts'}>
              <header className="menu-armory__section-title"><span>COMPATIBLE CUSTOMIZATION</span><h2>Your loadout.</h2><p>Options follow the character you choose.</p></header>
              {allowModelVariants && <div className="flex gap-2 mb-3" aria-label="Character selection">
                <button type="button" disabled={characterLoading} aria-pressed={!isIronVanguard}
                  onClick={() => updateLoadout({ characterAsset: undefined, modelSystem: 'v2' })}
                  className="px-3 py-2 border border-white/20 rounded aria-pressed:bg-cyan-500/20 disabled:opacity-50">Standard</button>
                <button type="button" disabled={characterLoading} aria-pressed={isIronVanguard}
                  onClick={equipIronVanguard}
                  className="px-3 py-2 border border-white/20 rounded aria-pressed:bg-cyan-500/20 disabled:opacity-50">
                  {characterLoading ? 'Loading character…' : 'Version 3 Iron Vanguard'}
                </button>
              </div>}
              {characterError && <p role="alert" className="mb-3 text-red-300">{characterError}</p>}
          {!isIronVanguard && <>
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

          </>}
          {activeModelSystem === 'v3' && !isIronVanguard && (
            <div className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-amber-100">
              {V3_INTERNAL_PROTOTYPE_LABEL}
            </div>
          )}

            {activeModelSystem === 'v3' && !isIronVanguard && (
              <div className="bg-white/5 border border-white/5 rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Suit Profiles</span>
                  <span className="text-[10px] text-white/45 uppercase tracking-widest">V3 quick apply</span>
                </div>
                {v3SuitProfileCatalog.profiles.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {v3SuitProfileCatalog.profiles.map((profile) => (
                      <div key={profile.id} className="flex items-center gap-2 rounded border border-cyan-500/15 bg-black/20 p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[10px] font-black uppercase tracking-widest text-white/75">{profile.name}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {getV3SuitProfileBadges(profile).map((badge) => (
                              <span key={badge} className="rounded border border-white/10 bg-black/35 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-white/45">
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyV3SuitProfile(profile)}
                          className="shrink-0 rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-cyan-100 transition hover:border-cyan-300"
                        >
                          Apply Suit
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] italic text-white/35">No saved suit profiles.</div>
                )}
              </div>
            )}

            <div className="bg-white/5 border border-white/5 rounded-lg p-3">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2.5">Armor Loadout</span>

              {isIronVanguard ? <p className="text-white/70 leading-relaxed">Iron Vanguard uses its original body and equipment. {allowModelVariants ? 'Standard armor pieces, weapon skins, and painting apply to compatible Standard loadouts. The Model Set in match setup controls which models are used in a match.' : 'Customize your armor hue in the Color tab.'}</p> : <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40 w-14 shrink-0">Model Sys</span>
                <div className="flex gap-1.5 flex-1">
                  {loadoutModelOptions.map((model) => {
                    const isActive = (playerLoadout.modelSystem ?? 'v1') === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => updateLoadout({
                          characterAsset: undefined,
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
              </>}
            </div>

            </section>
          </div>
          <div className="menu-armory__saved" role="status"><span aria-hidden="true">✓</span> Appearance updates immediately</div>
        </section>
      </>}
    </div>
  );
}
