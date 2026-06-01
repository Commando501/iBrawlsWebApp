import { AIResolvedKnobs, DerivedAIParams, deriveAIParams } from './aiTuning';
import { resolveBehaviorTuning } from './aiBehaviorTuning';
import { UniversalSettings } from '../types';

export type AIArchetypeId =
  | 'none'
  | 'berserker'
  | 'counter_fighter'
  | 'zoner'
  | 'mixup_artist'
  | 'assassin'
  | 'brawler';

export interface AIPersonalityKnobOverrides {
  aiReactionLatency?: number;
  aiAnticipationFactor?: number;
  aiMovementComplexity?: number;
  aiWeaponSwapIQ?: number;
  aiPlaystyle?: number;
  aiWeaponPrioritization?: number;
}

export interface AIPersonalityFlags {
  /** Passive-style archetypes skip post-hit PRESSURING chains. */
  skipPressure: boolean;
  /** Multiplier on derived feint chance (1 = unchanged). */
  feintBias: number;
  /** Multiplier on combat spacing (>1 = wider standoff). */
  spacingBand: number;
}

export interface AIPersonalityDef {
  id: Exclude<AIArchetypeId, 'none'>;
  label: string;
  description: string;
  knobOverrides: AIPersonalityKnobOverrides;
  flags: AIPersonalityFlags;
}

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

export const AI_ARCHETYPE_NONE: AIArchetypeId = 'none';

export const AI_ARCHETYPES: AIPersonalityDef[] = [
  {
    id: 'berserker',
    label: 'Berserker',
    description: 'Relentless aggression, hammer-first trades, closes distance fast.',
    knobOverrides: {
      aiReactionLatency: 0.18,
      aiAnticipationFactor: 0.35,
      aiMovementComplexity: 35,
      aiWeaponSwapIQ: 45,
      aiPlaystyle: 95,
      aiWeaponPrioritization: 22,
    },
    flags: { skipPressure: false, feintBias: 0.55, spacingBand: 0.82 },
  },
  {
    id: 'counter_fighter',
    label: 'Counter-Fighter',
    description: 'Patient reads, punishes whiffs, avoids reckless pressure.',
    knobOverrides: {
      aiReactionLatency: 0.14,
      aiAnticipationFactor: 0.82,
      aiMovementComplexity: 62,
      aiWeaponSwapIQ: 88,
      aiPlaystyle: 32,
      aiWeaponPrioritization: 55,
    },
    flags: { skipPressure: true, feintBias: 0.75, spacingBand: 1.18 },
  },
  {
    id: 'zoner',
    label: 'Zoner',
    description: 'Maintains range, sword lunges, evasive footwork.',
    knobOverrides: {
      aiReactionLatency: 0.2,
      aiAnticipationFactor: 0.55,
      aiMovementComplexity: 78,
      aiWeaponSwapIQ: 72,
      aiPlaystyle: 28,
      aiWeaponPrioritization: 82,
    },
    flags: { skipPressure: true, feintBias: 0.9, spacingBand: 1.32 },
  },
  {
    id: 'mixup_artist',
    label: 'Mixup Artist',
    description: 'Unpredictable spacing, weapon swaps, and feint-heavy mind games.',
    knobOverrides: {
      aiReactionLatency: 0.16,
      aiAnticipationFactor: 0.68,
      aiMovementComplexity: 82,
      aiWeaponSwapIQ: 90,
      aiPlaystyle: 58,
      aiWeaponPrioritization: 50,
    },
    flags: { skipPressure: false, feintBias: 1.55, spacingBand: 1.05 },
  },
  {
    id: 'assassin',
    label: 'Assassin',
    description: 'Burst damage, fast reactions, sword lunge finishers.',
    knobOverrides: {
      aiReactionLatency: 0.08,
      aiAnticipationFactor: 0.78,
      aiMovementComplexity: 58,
      aiWeaponSwapIQ: 80,
      aiPlaystyle: 72,
      aiWeaponPrioritization: 88,
    },
    flags: { skipPressure: false, feintBias: 1.15, spacingBand: 0.92 },
  },
  {
    id: 'brawler',
    label: 'Brawler',
    description: 'Mid-range brawling, balanced weapons, steady pressure.',
    knobOverrides: {
      aiReactionLatency: 0.15,
      aiAnticipationFactor: 0.48,
      aiMovementComplexity: 52,
      aiWeaponSwapIQ: 58,
      aiPlaystyle: 78,
      aiWeaponPrioritization: 48,
    },
    flags: { skipPressure: false, feintBias: 0.85, spacingBand: 0.98 },
  },
];

export const AI_ARCHETYPE_OPTIONS: { value: AIArchetypeId; label: string }[] = [
  { value: 'none', label: 'None (Difficulty Only)' },
  ...AI_ARCHETYPES.map((a) => ({ value: a.id, label: a.label })),
];

const ARCHETYPE_BY_ID = new Map(AI_ARCHETYPES.map((a) => [a.id, a]));

export const NEUTRAL_PERSONALITY_FLAGS: AIPersonalityFlags = {
  skipPressure: false,
  feintBias: 1,
  spacingBand: 1,
};

export function isAIArchetypeId(value: string | undefined | null): value is AIArchetypeId {
  if (!value) return false;
  return value === 'none' || ARCHETYPE_BY_ID.has(value as Exclude<AIArchetypeId, 'none'>);
}

export function getArchetypeDef(
  id?: string | null
): AIPersonalityDef | undefined {
  if (!id || id === 'none') return undefined;
  return ARCHETYPE_BY_ID.get(id as Exclude<AIArchetypeId, 'none'>);
}

export function getPersonalityFlags(id?: string | null): AIPersonalityFlags {
  return getArchetypeDef(id)?.flags ?? NEUTRAL_PERSONALITY_FLAGS;
}

export interface PersonalityFlagOverrides {
  spacingBand?: number;
  skipPressure?: boolean;
}

/**
 * Archetype flags as a base, with any defined per-slot/custom overrides winning.
 * Used so a Custom AI Behavior build can set spacing/skip-pressure independent of archetype.
 */
export function resolvePersonalityFlags(
  id?: string | null,
  overrides?: PersonalityFlagOverrides
): AIPersonalityFlags {
  const base = getPersonalityFlags(id);
  if (!overrides) return base;
  return {
    ...base,
    spacingBand: overrides.spacingBand ?? base.spacingBand,
    skipPressure: overrides.skipPressure ?? base.skipPressure,
  };
}

export function applyPersonalityKnobs(
  knobs: AIResolvedKnobs,
  id?: string | null
): AIResolvedKnobs {
  const def = getArchetypeDef(id);
  if (!def) return knobs;

  const o = def.knobOverrides;
  return {
    ...knobs,
    reactionLatency: o.aiReactionLatency ?? knobs.reactionLatency,
    anticipationFactor: o.aiAnticipationFactor ?? knobs.anticipationFactor,
    movementComplexity: o.aiMovementComplexity ?? knobs.movementComplexity,
    weaponSwapIQ: o.aiWeaponSwapIQ ?? knobs.weaponSwapIQ,
    aiPlaystyle: o.aiPlaystyle ?? knobs.aiPlaystyle,
    weaponPrioritization: o.aiWeaponPrioritization ?? knobs.weaponPrioritization,
  };
}

export function applyPersonalityToDerived(
  derived: DerivedAIParams,
  settings: UniversalSettings,
  id?: string | null
): DerivedAIParams {
  const flags = getPersonalityFlags(id);
  const baseFeint = settings.aiFeintChance ?? derived.feintChance;
  return {
    ...derived,
    feintChance: clampPercent(baseFeint * flags.feintBias),
  };
}

export function resolveDerivedAIParams(
  settings: UniversalSettings,
  knobs: AIResolvedKnobs,
  archetypeId?: string | null
): DerivedAIParams {
  const mergedKnobs = applyPersonalityKnobs(knobs, archetypeId);
  const tuning = resolveBehaviorTuning(settings);
  const derived = deriveAIParams(settings, mergedKnobs, {
    mechanicAwareIq: tuning.mechanicAwareIq,
    highIqOverride: tuning.highIqOverride,
    feintIqGate: tuning.feintIqGate,
  });
  return applyPersonalityToDerived(derived, settings, archetypeId);
}

export function applyArchetypeToSettings(
  settings: UniversalSettings,
  archetypeId: AIArchetypeId
): UniversalSettings {
  const def = getArchetypeDef(archetypeId);
  if (!def) {
    return { ...settings, aiArchetype: 'none' };
  }

  const o = def.knobOverrides;
  const filled: UniversalSettings = {
    ...settings,
    aiArchetype: archetypeId,
    aiReactionLatency: o.aiReactionLatency ?? settings.aiReactionLatency,
    aiAnticipationFactor: o.aiAnticipationFactor ?? settings.aiAnticipationFactor,
    aiMovementComplexity: o.aiMovementComplexity ?? settings.aiMovementComplexity,
    aiWeaponSwapIQ: o.aiWeaponSwapIQ ?? settings.aiWeaponSwapIQ,
    aiPlaystyle: o.aiPlaystyle ?? settings.aiPlaystyle,
    aiWeaponPrioritization: o.aiWeaponPrioritization ?? settings.aiWeaponPrioritization,
    aiSpacingBand: def.flags.spacingBand,
    aiSkipPressure: def.flags.skipPressure,
  };

  // Seed the advanced derived dials from this archetype's knobs so the preset fills every control.
  const knobs: AIResolvedKnobs = {
    difficulty: 'custom',
    reactionLatency: filled.aiReactionLatency ?? 0.25,
    anticipationFactor: filled.aiAnticipationFactor ?? 0.4,
    movementComplexity: filled.aiMovementComplexity ?? 50,
    weaponSwapIQ: filled.aiWeaponSwapIQ ?? 50,
    aiPlaystyle: filled.aiPlaystyle ?? 50,
    weaponPrioritization: filled.aiWeaponPrioritization ?? 50,
  };
  const derived = deriveAIParams(filled, knobs);
  return {
    ...filled,
    aiSpatialIQ: derived.spatialIQ,
    aiFeintChance: clampPercent(derived.feintChance * def.flags.feintBias),
    aiPressureAggression: derived.pressureAggression,
  };
}

export function playstyleToBehavior(
  playstyle: number
): 'passive' | 'defensive' | 'aggressive' {
  if (playstyle <= 20) return 'passive';
  if (playstyle >= 80) return 'aggressive';
  return 'defensive';
}

export function pickRandomArchetype(): Exclude<AIArchetypeId, 'none'> {
  const index = Math.floor(Math.random() * AI_ARCHETYPES.length);
  return AI_ARCHETYPES[index].id;
}
