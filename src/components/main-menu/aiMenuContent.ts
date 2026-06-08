import type { AIPreset, UniversalSettings } from '../../types';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { SETTING_DEFINITIONS } from '../../settings/settingsSchema';
import { getArchetypeDef } from '../../game/aiPersonalities';

export const getPresetDescription = (val: string, customPresets: AIPreset[] = []): string => {
  if (val === 'easy') return "Sub-Normal combat reflex latency, simple spacing behavior.";
  if (val === 'normal') return "Standard combat matrix dials, average anticipation calculations.";
  if (val === 'hard') return "Calibrated prediction systems, fast pacing & evading.";
  if (val === 'nightmare') return "Hyper-responsive matrix overrides. Zero anticipation errors.";
  if (val === 'custom') return "Configure custom neural matrix parameters below.";
  const custom = customPresets.find(p => p.id === val);
  if (custom) {
    const rl = custom.tuning.aiReactionLatency !== undefined ? `${custom.tuning.aiReactionLatency.toFixed(2)}s` : 'default';
    const anti = custom.tuning.aiAnticipationFactor !== undefined ? `${Math.round(custom.tuning.aiAnticipationFactor * 100)}%` : 'default';
    const move = custom.tuning.aiMovementComplexity !== undefined ? `${custom.tuning.aiMovementComplexity}%` : 'default';
    const swap = custom.tuning.aiWeaponSwapIQ !== undefined ? `${custom.tuning.aiWeaponSwapIQ}%` : 'default';
    const advanced: string[] = [];
    if (custom.tuning.aiSpatialIQ !== undefined) advanced.push(`Spatial: ${custom.tuning.aiSpatialIQ}%`);
    if (custom.tuning.aiFeintChance !== undefined) advanced.push(`Feint: ${custom.tuning.aiFeintChance}%`);
    if (custom.tuning.aiPressureAggression !== undefined) advanced.push(`Pressure: ${custom.tuning.aiPressureAggression}%`);
    if (custom.tuning.aiSpacingBand !== undefined) advanced.push(`Spacing: ${custom.tuning.aiSpacingBand.toFixed(2)}×`);
    if (custom.tuning.aiSkipPressure) advanced.push('No-Pressure');
    const advancedStr = advanced.length ? `, ${advanced.join(', ')}` : '';
    return `Custom Preset: Latency: ${rl}, Anticipation: ${anti}, Movement: ${move}, Weapon Swap: ${swap}${advancedStr}`;
  }
  return "";
};

export const getArchetypeDescription = (val: string): string => {
  if (!val || val === 'none') return "Neutral personality. Relies purely on difficulty matrix knobs.";
  const def = getArchetypeDef(val);
  return def ? def.description : "";
};

// Custom AI Behavior panel — every engine-wired dial, grouped for scannability.
// NOTE: any future AI-behavior knob must be added here (and to AITuning / RosterSlotConfig).
type AICustomKnobKey = keyof UniversalSettings;

export interface AICustomKnobEntry {
  key: AICustomKnobKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Slider fallback position when the stored value is undefined. */
  def: number;
  fmt: (v: number | undefined) => string;
  /** Plain-language explanation of what the dial does, shown under the slider. */
  desc: string;
}

export interface AICustomKnobSection {
  title: string;
  entries: AICustomKnobEntry[];
  /** Expert (formerly-hardcoded) tuning groups start collapsed to avoid overwhelming. */
  expert?: boolean;
}

/**
 * Build the Expert AI Tuning groups for the main-menu Custom AI Behavior panel by
 * reusing the row metadata already declared in settingsSchema's `aitune` section —
 * single source of truth for label/range/format/description.
 */
const EXPERT_AI_TUNE_GROUPS: { title: string; keys: (keyof UniversalSettings)[] }[] = [
  { title: 'Combat Decision (Expert)', keys: ['aiTuneMechanicAwareIq', 'aiTuneHighIqOverride', 'aiTuneHammerWindupSeconds'] },
  { title: 'Match State (Expert)', keys: ['aiTuneScoreAheadThreshold', 'aiTuneScoreCloseThreshold', 'aiTuneFeintIqGate'] },
  { title: 'Feints (Expert)', keys: ['aiTuneFeintCooldownMin', 'aiTuneFeintCooldownMax', 'aiTuneWeaponSwapFeintDelay', 'aiTuneApproachFeintBackTimer', 'aiTuneLungeFakeoutForwardTimer', 'aiTuneChargeAbortSidestepTimer'] },
  { title: 'Movement (Expert)', keys: ['aiTuneBaseGroundSpeed', 'aiTuneSprintEngageGap', 'aiTuneSprintChaseTargetSpeed', 'aiTuneSlideMinGap', 'aiTuneSlideMaxGap', 'aiTuneSlideMinComplexity', 'aiTuneSlideTriggerChance'] },
  { title: 'Spatial Awareness (Expert)', keys: ['aiTuneBaseEvasionDetectRange', 'aiTuneBaitDodgeDistance', 'aiTuneBaitDodgeBand', 'aiTuneEvasionTriggerJitter', 'aiTuneArenaEdgeInset'] },
  { title: 'Combos (Expert)', keys: ['aiTuneComboMinWeaponSwapIq', 'aiTuneComboAdvancedWeaponSwapIq'] },
  { title: 'Tempo & Pressure (Expert)', keys: ['aiTuneTempoCycleDuration', 'aiTunePostKillPressureDuration', 'aiTuneTempoSlowMult', 'aiTuneTempoFastMult', 'aiTuneStandoffRangeMinOffset', 'aiTuneStandoffRangeMaxOffset'] },
  { title: 'Adaptation & Learning (Expert)', keys: ['aiTuneCalibrationWindowSize', 'aiTuneMaxCalibrationDrift', 'aiTuneDodgeResolveDelay', 'aiTuneCounterResolveDelay', 'aiTunePlayerModelEmaAlpha', 'aiTuneDefaultLungeDistance', 'aiTuneDefaultReactionTime'] },
  { title: 'Coordination (Expert)', keys: ['aiTunePriorityTargetTtl', 'aiTuneDamageTagTtl', 'aiTuneAttackStaggerStep'] },
  { title: 'Engine Limits (Expert)', keys: ['aiTuneMaxAirborneHeight', 'aiTuneForcedDescentSpeed'] },
];

const AI_TUNE_DEF_BY_KEY = new Map(
  SETTING_DEFINITIONS.filter((d) => d.sectionId === 'aitune').map((d) => [d.key, d])
);

const buildExpertEntries = (keys: (keyof UniversalSettings)[]): AICustomKnobEntry[] =>
  keys.map((key) => {
    const d = AI_TUNE_DEF_BY_KEY.get(key);
    const fallback = DEFAULT_ADMIN_SETTINGS[key];
    return {
      key,
      label: d?.label ?? String(key),
      min: d?.min ?? 0,
      max: d?.max ?? 100,
      step: d?.step ?? 1,
      def: typeof fallback === 'number' ? fallback : 0,
      fmt: d?.formatValue ?? ((v) => `${v ?? 0}`),
      desc: d?.description ?? '',
    };
  });

export const AI_CUSTOM_KNOB_SECTIONS: AICustomKnobSection[] = [
  {
    title: 'Reflexes & Awareness',
    entries: [
      { key: 'aiReactionLatency', label: 'Reflex Latency', min: 0, max: 1.5, step: 0.05, def: 0.25, fmt: (v) => `${(v ?? 0.25).toFixed(2)}s`, desc: 'Delay before the AI reacts to your actions. Lower = snappier, near-instant responses; higher = sluggish and easier to bait.' },
      { key: 'aiAnticipationFactor', label: 'Anticipation Engine', min: 0, max: 1, step: 0.05, def: 0.4, fmt: (v) => `${Math.round((v ?? 0.4) * 100)}%`, desc: 'How much it predicts and leads your movement instead of reacting after the fact. Higher = harder to juke.' },
      { key: 'aiWeaponSwapIQ', label: 'Weapon Swapping IQ', min: 0, max: 100, step: 5, def: 50, fmt: (v) => `${v ?? 50}%`, desc: 'Smarts behind hammer↔sword swaps — countering lunges and punishing your cooldowns. High values also unlock feints and combo strings.' },
    ],
  },
  {
    title: 'Movement & Positioning',
    entries: [
      { key: 'aiMovementComplexity', label: 'Strafe & Evade', min: 0, max: 100, step: 5, def: 50, fmt: (v) => `${v ?? 50}%`, desc: 'Richness of its footwork — strafing, dodging and repositioning. Higher = slippery and less predictable to hit.' },
      { key: 'aiSpatialIQ', label: 'Spatial IQ', min: 0, max: 100, step: 5, def: 50, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'Arena awareness: dodge timing, cutting off your escape routes and avoiding getting pinned to walls. Auto blends Strafe & Anticipation.' },
      { key: 'aiSpacingBand', label: 'Combat Spacing', min: 0.7, max: 1.4, step: 0.05, def: 1.0, fmt: (v) => (v === undefined ? 'Auto' : `${v.toFixed(2)}×`), desc: 'Preferred standoff distance. Above 1× hangs back and zones with the sword; below 1× crowds you and brawls up close.' },
    ],
  },
  {
    title: 'Combat Style',
    entries: [
      {
        key: 'aiPlaystyle', label: 'Combat Playstyle', min: 0, max: 100, step: 5, def: 50,
        fmt: (v) => {
          const p = v ?? 50;
          if (p === 0) return 'Passive (0)';
          if (p < 50) return `Passive-Defensive (${p})`;
          if (p === 50) return 'Defensive (50)';
          if (p < 100) return `Defensive-Aggressive (${p})`;
          return 'Aggressive (100)';
        },
        desc: 'Overall temperament from passive (waits and reacts) through defensive to aggressive (constantly pushes and initiates).',
      },
      {
        key: 'aiWeaponPrioritization', label: 'Weapon Prioritization', min: 0, max: 100, step: 5, def: 50,
        fmt: (v) => {
          const p = v ?? 50;
          if (p === 50) return 'Balanced (50/50)';
          if (p > 50) return `Sword User (${p}/${100 - p})`;
          return `Hammer User (${100 - p}/${p})`;
        },
        desc: 'Hammer vs sword preference. 100 = sword only (lunges/range), 0 = hammer only (close burst), 50 = mixes both.',
      },
      { key: 'aiPressureAggression', label: 'Pressure Aggression', min: 0, max: 100, step: 5, def: 50, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'How relentlessly it chains follow-up attacks after landing a hit instead of backing off. Auto follows Playstyle.' },
      { key: 'aiFeintChance', label: 'Feint Chance', min: 0, max: 100, step: 5, def: 0, fmt: (v) => (v === undefined ? 'Auto (Derived)' : `${v}%`), desc: 'How often it fakes swings or approaches to bait your defense. Auto is derived and needs a decent Weapon Swap IQ to trigger.' },
    ],
  },
  // Expert tuning groups (formerly-hardcoded "feel" constants), collapsed by default.
  ...EXPERT_AI_TUNE_GROUPS.map((g): AICustomKnobSection => ({
    title: g.title,
    entries: buildExpertEntries(g.keys),
    expert: true,
  })),
];
