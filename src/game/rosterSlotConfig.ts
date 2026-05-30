import { AIBehaviorPreset, AIPreset, UniversalSettings } from '../types';
import { AIResolvedKnobs } from './aiTuning';
import {
  AIArchetypeId,
  applyPersonalityKnobs,
  playstyleToBehavior,
} from './aiPersonalities';

/** Per-slot AI identity and tuning — same shape and full ranges for every combatant. */
export interface RosterSlotConfig {
  difficulty: string;
  weaponPrioritization: number;
  playstyle: number;
  behavior: AIBehaviorPreset;
  archetype: AIArchetypeId;
  team: string;
  hue: number;
  name: string;
  /** Used when difficulty === 'custom'. */
  reactionLatency?: number;
  anticipationFactor?: number;
  movementComplexity?: number;
  weaponSwapIQ?: number;
}

export type RosterSlotOverride = Partial<RosterSlotConfig>;

const DEFAULT_LEGACY_BEHAVIOR: AIBehaviorPreset = 'defensive';
const DEFAULT_LEGACY_WEAPON_BEHAVIOR = 'balanced';

const PRESET_DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'] as const;

function behaviorToPlaystyle(behavior: AIBehaviorPreset): number {
  if (behavior === 'passive') return 0;
  if (behavior === 'aggressive') return 100;
  return 50;
}

function legacyWeaponBehaviorToPrioritization(value: string): number | undefined {
  if (value === 'sword_75_25') return 75;
  if (value === 'hammer_75_25') return 25;
  if (value === 'balanced') return 50;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  return undefined;
}

/** Build the shared default template from Sandbox "AI COMBAT NEURAL NET" settings. */
export function rosterTemplateFromSettings(settings: UniversalSettings): RosterSlotConfig {
  const playstyle = settings.aiPlaystyle ?? 50;
  return {
    difficulty: settings.aiDifficulty ?? 'normal',
    weaponPrioritization: settings.aiWeaponPrioritization ?? 50,
    playstyle,
    behavior: playstyleToBehavior(playstyle),
    archetype: (settings.aiArchetype ?? 'none') as AIArchetypeId,
    team: 'red',
    hue: 0,
    name: 'DoomBot',
    reactionLatency: settings.aiReactionLatency,
    anticipationFactor: settings.aiAnticipationFactor,
    movementComplexity: settings.aiMovementComplexity,
    weaponSwapIQ: settings.aiWeaponSwapIQ,
  };
}

/** Merge a per-slot override onto the default template. */
export function mergeRosterSlotConfig(
  template: RosterSlotConfig,
  override?: RosterSlotOverride
): RosterSlotConfig {
  if (!override) return { ...template };

  const merged: RosterSlotConfig = { ...template, ...override };

  if (override.playstyle !== undefined) {
    merged.behavior = playstyleToBehavior(override.playstyle);
  } else if (override.behavior !== undefined) {
    merged.playstyle = behaviorToPlaystyle(override.behavior);
  }

  return merged;
}

/** Bridge legacy bot-grid props into partial roster overrides. */
export function rosterOverrideFromLegacyProps(props: {
  difficulty?: string;
  behavior?: AIBehaviorPreset;
  weaponBehavior?: string;
  archetype?: string;
  hue?: number;
  name?: string;
}): RosterSlotOverride {
  const override: RosterSlotOverride = {};

  if (props.difficulty) override.difficulty = props.difficulty;
  if (props.archetype !== undefined) override.archetype = props.archetype as AIArchetypeId;
  if (props.hue !== undefined) override.hue = props.hue;
  if (props.name) override.name = props.name;

  if (props.behavior && props.behavior !== DEFAULT_LEGACY_BEHAVIOR) {
    override.behavior = props.behavior;
    override.playstyle = behaviorToPlaystyle(props.behavior);
  }

  if (props.weaponBehavior && props.weaponBehavior !== DEFAULT_LEGACY_WEAPON_BEHAVIOR) {
    const prioritization = legacyWeaponBehaviorToPrioritization(props.weaponBehavior);
    if (prioritization !== undefined) override.weaponPrioritization = prioritization;
  }

  return override;
}

/** Resolve tuning knobs from a fully merged roster slot config. */
export function resolveKnobsFromRosterSlot(
  slot: RosterSlotConfig,
  aiPresets: AIPreset[],
  settings: UniversalSettings
): AIResolvedKnobs {
  const difficulty = slot.difficulty || 'normal';

  let reactionLatency = 0.25;
  let anticipationFactor = 0.40;
  let movementComplexity = 50;
  let weaponSwapIQ = 50;
  let aiPlaystyle = slot.playstyle;
  let weaponPrioritization = slot.weaponPrioritization;

  if (difficulty === 'custom') {
    reactionLatency = slot.reactionLatency ?? settings.aiReactionLatency ?? 0.25;
    anticipationFactor = slot.anticipationFactor ?? settings.aiAnticipationFactor ?? 0.40;
    movementComplexity = slot.movementComplexity ?? settings.aiMovementComplexity ?? 50;
    weaponSwapIQ = slot.weaponSwapIQ ?? settings.aiWeaponSwapIQ ?? 50;
    aiPlaystyle = slot.playstyle;
    weaponPrioritization = slot.weaponPrioritization;
  } else if (PRESET_DIFFICULTIES.includes(difficulty as (typeof PRESET_DIFFICULTIES)[number])) {
    if (difficulty === 'easy') {
      reactionLatency = 0.55;
      anticipationFactor = 0.05;
      movementComplexity = 15;
      weaponSwapIQ = 10;
    } else if (difficulty === 'normal') {
      reactionLatency = 0.25;
      anticipationFactor = 0.40;
      movementComplexity = 50;
      weaponSwapIQ = 50;
    } else if (difficulty === 'hard') {
      reactionLatency = 0.12;
      anticipationFactor = 0.70;
      movementComplexity = 80;
      weaponSwapIQ = 80;
    } else if (difficulty === 'nightmare') {
      reactionLatency = 0.02;
      anticipationFactor = 0.95;
      movementComplexity = 95;
      weaponSwapIQ = 95;
    }

    const hasArchetype = slot.archetype && slot.archetype !== 'none';
    if (hasArchetype) {
      aiPlaystyle = 50;
      weaponPrioritization = 50;
    }
  } else {
    const preset = aiPresets.find((p) => p.id === difficulty);
    if (preset) {
      reactionLatency = preset.tuning.aiReactionLatency ?? 0.25;
      anticipationFactor = preset.tuning.aiAnticipationFactor ?? 0.40;
      movementComplexity = preset.tuning.aiMovementComplexity ?? 50;
      weaponSwapIQ = preset.tuning.aiWeaponSwapIQ ?? 50;
      aiPlaystyle = preset.tuning.aiPlaystyle ?? 50;
      weaponPrioritization = preset.tuning.aiWeaponPrioritization ?? 50;
    }
  }

  const baseKnobs: AIResolvedKnobs = {
    difficulty,
    reactionLatency,
    anticipationFactor,
    movementComplexity,
    weaponSwapIQ,
    aiPlaystyle,
    weaponPrioritization,
  };

  if (difficulty === 'custom') {
    return baseKnobs;
  }

  const archetypeId = slot.archetype && slot.archetype !== 'none' ? slot.archetype : undefined;
  return applyPersonalityKnobs(baseKnobs, archetypeId);
}

export interface LegacyRosterProps {
  botDifficulties?: Record<string, string>;
  botBehaviors?: Record<string, AIBehaviorPreset>;
  botWeaponBehaviors?: Record<string, string>;
  botArchetypes?: Record<string, string>;
  botColors?: Record<string, number>;
}

/** Resolve one combatant's merged roster slot from template + legacy grid props. */
export function resolveRosterSlotForCombatant(
  botId: string,
  settings: UniversalSettings,
  legacy: LegacyRosterProps
): RosterSlotConfig {
  const template = rosterTemplateFromSettings(settings);
  const override = rosterOverrideFromLegacyProps(
    botId === 'main_ai'
      ? { hue: legacy.botColors?.[botId] }
      : {
          difficulty: legacy.botDifficulties?.[botId],
          behavior: legacy.botBehaviors?.[botId],
          weaponBehavior: legacy.botWeaponBehaviors?.[botId],
          archetype: legacy.botArchetypes?.[botId],
          hue: legacy.botColors?.[botId],
        }
  );
  return mergeRosterSlotConfig(template, override);
}
