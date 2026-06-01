import type { UniversalSettings } from '../types';

import {
  MECHANIC_AWARE_IQ_DEFAULT,
  HIGH_IQ_OVERRIDE_DEFAULT,
  HAMMER_WINDUP_SECONDS_DEFAULT,
} from './aiCombatDecision';
import {
  SCORE_AHEAD_THRESHOLD_DEFAULT,
  SCORE_CLOSE_THRESHOLD_DEFAULT,
  FEINT_IQ_GATE_DEFAULT,
} from './aiTuning';
import {
  FEINT_COOLDOWN_MIN,
  FEINT_COOLDOWN_MAX,
  WEAPON_SWAP_FEINT_DELAY,
  APPROACH_FEINT_BACK_TIMER,
  LUNGE_FAKEOUT_FORWARD_TIMER,
  CHARGE_ABORT_SIDESTEP_TIMER,
} from './aiFeints';
import {
  AI_BASE_GROUND_SPEED,
  SPRINT_ENGAGE_GAP,
  SPRINT_CHASE_TARGET_SPEED,
  SLIDE_MIN_GAP,
  SLIDE_MAX_GAP,
  SLIDE_MIN_COMPLEXITY,
  SLIDE_TRIGGER_CHANCE,
} from './aiMovementMechanics';
import {
  BASE_EVASION_DETECT_RANGE,
  BAIT_DODGE_DISTANCE,
  BAIT_DODGE_BAND,
  EVASION_TRIGGER_JITTER,
  ARENA_EDGE_INSET,
} from './aiSpatialStrategy';
import {
  COMBO_MIN_WEAPON_SWAP_IQ,
  COMBO_ADVANCED_WEAPON_SWAP_IQ,
} from './aiComboEngine';
import {
  TEMPO_CYCLE_DURATION,
  POST_KILL_PRESSURE_DURATION,
  TEMPO_SLOW_MULT,
  TEMPO_FAST_MULT,
  STANDOFF_RANGE_MIN_OFFSET,
  STANDOFF_RANGE_MAX_OFFSET,
} from './aiPsychologicalPressure';
import {
  CALIBRATION_WINDOW_SIZE,
  MAX_CALIBRATION_DRIFT,
  DODGE_RESOLVE_DELAY,
  COUNTER_RESOLVE_DELAY,
} from './aiSkillCalibration';
import {
  PLAYER_MODEL_EMA_ALPHA,
  DEFAULT_LUNGE_DISTANCE,
  DEFAULT_REACTION_TIME,
} from './aiPlayerModel';
import {
  PRIORITY_TARGET_TTL,
  DAMAGE_TAG_TTL,
  ATTACK_STAGGER_STEP,
} from './aiBotCoordinator';
import {
  AI_MAX_AIRBORNE_HEIGHT,
  AI_FORCED_DESCENT_SPEED,
} from './aiAltitude';

/**
 * Single source of truth for every previously-hardcoded AI "feel" constant.
 *
 * Two families live here:
 *  - **Group A** (exposed): each field has a matching `aiTune*` key in
 *    `UniversalSettings` and a row in the Expert AI Tuning settings section, so
 *    the user can override it live. Defaults below mirror the original module
 *    constants verbatim — with no override, behavior is byte-for-byte unchanged.
 *  - **Group B** (centralized, exposure-ready): inline coefficients lifted out of
 *    `updateSingleAIEntity` in GrifballGame.tsx. They resolve from defaults today
 *    and already accept `settings.aiTune*` overrides, so surfacing a UI row later
 *    is a one-line change in settingsSchema.ts.
 */
export interface AIBehaviorTuning {
  // --- aiCombatDecision ---
  mechanicAwareIq: number;
  highIqOverride: number;
  hammerWindupSeconds: number;
  // --- aiTuning (match state) ---
  scoreAheadThreshold: number;
  scoreCloseThreshold: number;
  feintIqGate: number;
  // --- aiFeints ---
  feintCooldownMin: number;
  feintCooldownMax: number;
  weaponSwapFeintDelay: number;
  approachFeintBackTimer: number;
  lungeFakeoutForwardTimer: number;
  chargeAbortSidestepTimer: number;
  // --- aiMovementMechanics ---
  aiBaseGroundSpeed: number;
  sprintEngageGap: number;
  sprintChaseTargetSpeed: number;
  slideMinGap: number;
  slideMaxGap: number;
  slideMinComplexity: number;
  slideTriggerChance: number;
  // --- aiSpatialStrategy ---
  baseEvasionDetectRange: number;
  baitDodgeDistance: number;
  baitDodgeBand: number;
  evasionTriggerJitter: number;
  arenaEdgeInset: number;
  // --- aiComboEngine ---
  comboMinWeaponSwapIq: number;
  comboAdvancedWeaponSwapIq: number;
  // --- aiPsychologicalPressure ---
  tempoCycleDuration: number;
  postKillPressureDuration: number;
  tempoSlowMult: number;
  tempoFastMult: number;
  standoffRangeMinOffset: number;
  standoffRangeMaxOffset: number;
  // --- aiSkillCalibration ---
  calibrationWindowSize: number;
  maxCalibrationDrift: number;
  dodgeResolveDelay: number;
  counterResolveDelay: number;
  // --- aiPlayerModel ---
  playerModelEmaAlpha: number;
  defaultLungeDistance: number;
  defaultReactionTime: number;
  // --- aiBotCoordinator ---
  priorityTargetTtl: number;
  damageTagTtl: number;
  attackStaggerStep: number;
  // --- aiAltitude ---
  maxAirborneHeight: number;
  forcedDescentSpeed: number;

  // --- Group B: brain inline coefficients (centralized, UI deferred) ---
  /** Bonus added to anticipation when computing landing-prediction lead. */
  predictionAnticipationBonus: number;
  /** Anticipation weight applied to predicted landing-position blend. */
  predictionLandingWeight: number;
  /** Base + anticipation-scaled chance to lunge at a grounded target. */
  lungeChanceGroundBase: number;
  lungeChanceGroundAnticipation: number;
  /** Base + anticipation-scaled chance to lunge at an airborne target. */
  lungeChanceAirborneBase: number;
  lungeChanceAirborneAnticipation: number;
  /** Base + anticipation-scaled chance to react to a telegraphed action. */
  reactChanceBase: number;
  reactChanceAnticipation: number;
  /** Hammer-jump-on-approach commit chances (body-reach vs vertical gap). */
  hammerJumpReachBase: number;
  hammerJumpReachAnticipation: number;
  hammerJumpVerticalBase: number;
  hammerJumpVerticalAnticipation: number;
}

export const DEFAULT_AI_BEHAVIOR_TUNING: AIBehaviorTuning = {
  // aiCombatDecision
  mechanicAwareIq: MECHANIC_AWARE_IQ_DEFAULT,
  highIqOverride: HIGH_IQ_OVERRIDE_DEFAULT,
  hammerWindupSeconds: HAMMER_WINDUP_SECONDS_DEFAULT,
  // aiTuning
  scoreAheadThreshold: SCORE_AHEAD_THRESHOLD_DEFAULT,
  scoreCloseThreshold: SCORE_CLOSE_THRESHOLD_DEFAULT,
  feintIqGate: FEINT_IQ_GATE_DEFAULT,
  // aiFeints
  feintCooldownMin: FEINT_COOLDOWN_MIN,
  feintCooldownMax: FEINT_COOLDOWN_MAX,
  weaponSwapFeintDelay: WEAPON_SWAP_FEINT_DELAY,
  approachFeintBackTimer: APPROACH_FEINT_BACK_TIMER,
  lungeFakeoutForwardTimer: LUNGE_FAKEOUT_FORWARD_TIMER,
  chargeAbortSidestepTimer: CHARGE_ABORT_SIDESTEP_TIMER,
  // aiMovementMechanics
  aiBaseGroundSpeed: AI_BASE_GROUND_SPEED,
  sprintEngageGap: SPRINT_ENGAGE_GAP,
  sprintChaseTargetSpeed: SPRINT_CHASE_TARGET_SPEED,
  slideMinGap: SLIDE_MIN_GAP,
  slideMaxGap: SLIDE_MAX_GAP,
  slideMinComplexity: SLIDE_MIN_COMPLEXITY,
  slideTriggerChance: SLIDE_TRIGGER_CHANCE,
  // aiSpatialStrategy
  baseEvasionDetectRange: BASE_EVASION_DETECT_RANGE,
  baitDodgeDistance: BAIT_DODGE_DISTANCE,
  baitDodgeBand: BAIT_DODGE_BAND,
  evasionTriggerJitter: EVASION_TRIGGER_JITTER,
  arenaEdgeInset: ARENA_EDGE_INSET,
  // aiComboEngine
  comboMinWeaponSwapIq: COMBO_MIN_WEAPON_SWAP_IQ,
  comboAdvancedWeaponSwapIq: COMBO_ADVANCED_WEAPON_SWAP_IQ,
  // aiPsychologicalPressure
  tempoCycleDuration: TEMPO_CYCLE_DURATION,
  postKillPressureDuration: POST_KILL_PRESSURE_DURATION,
  tempoSlowMult: TEMPO_SLOW_MULT,
  tempoFastMult: TEMPO_FAST_MULT,
  standoffRangeMinOffset: STANDOFF_RANGE_MIN_OFFSET,
  standoffRangeMaxOffset: STANDOFF_RANGE_MAX_OFFSET,
  // aiSkillCalibration
  calibrationWindowSize: CALIBRATION_WINDOW_SIZE,
  maxCalibrationDrift: MAX_CALIBRATION_DRIFT,
  dodgeResolveDelay: DODGE_RESOLVE_DELAY,
  counterResolveDelay: COUNTER_RESOLVE_DELAY,
  // aiPlayerModel
  playerModelEmaAlpha: PLAYER_MODEL_EMA_ALPHA,
  defaultLungeDistance: DEFAULT_LUNGE_DISTANCE,
  defaultReactionTime: DEFAULT_REACTION_TIME,
  // aiBotCoordinator
  priorityTargetTtl: PRIORITY_TARGET_TTL,
  damageTagTtl: DAMAGE_TAG_TTL,
  attackStaggerStep: ATTACK_STAGGER_STEP,
  // aiAltitude
  maxAirborneHeight: AI_MAX_AIRBORNE_HEIGHT,
  forcedDescentSpeed: AI_FORCED_DESCENT_SPEED,
  // Group B (brain inline coefficients)
  predictionAnticipationBonus: 0.42,
  predictionLandingWeight: 0.65,
  lungeChanceGroundBase: 0.04,
  lungeChanceGroundAnticipation: 0.08,
  lungeChanceAirborneBase: 0.08,
  lungeChanceAirborneAnticipation: 0.18,
  reactChanceBase: 0.45,
  reactChanceAnticipation: 0.4,
  hammerJumpReachBase: 0.18,
  hammerJumpReachAnticipation: 0.42,
  hammerJumpVerticalBase: 0.012,
  hammerJumpVerticalAnticipation: 0.035,
};

/**
 * Maps each tuning field to its `UniversalSettings` override key. Keeping the
 * pairing in one table lets `resolveBehaviorTuning` apply overrides generically
 * and lets settingsSchema reference the exact key names.
 */
export const AI_TUNE_SETTING_KEYS: Record<keyof AIBehaviorTuning, keyof UniversalSettings> = {
  mechanicAwareIq: 'aiTuneMechanicAwareIq',
  highIqOverride: 'aiTuneHighIqOverride',
  hammerWindupSeconds: 'aiTuneHammerWindupSeconds',
  scoreAheadThreshold: 'aiTuneScoreAheadThreshold',
  scoreCloseThreshold: 'aiTuneScoreCloseThreshold',
  feintIqGate: 'aiTuneFeintIqGate',
  feintCooldownMin: 'aiTuneFeintCooldownMin',
  feintCooldownMax: 'aiTuneFeintCooldownMax',
  weaponSwapFeintDelay: 'aiTuneWeaponSwapFeintDelay',
  approachFeintBackTimer: 'aiTuneApproachFeintBackTimer',
  lungeFakeoutForwardTimer: 'aiTuneLungeFakeoutForwardTimer',
  chargeAbortSidestepTimer: 'aiTuneChargeAbortSidestepTimer',
  aiBaseGroundSpeed: 'aiTuneBaseGroundSpeed',
  sprintEngageGap: 'aiTuneSprintEngageGap',
  sprintChaseTargetSpeed: 'aiTuneSprintChaseTargetSpeed',
  slideMinGap: 'aiTuneSlideMinGap',
  slideMaxGap: 'aiTuneSlideMaxGap',
  slideMinComplexity: 'aiTuneSlideMinComplexity',
  slideTriggerChance: 'aiTuneSlideTriggerChance',
  baseEvasionDetectRange: 'aiTuneBaseEvasionDetectRange',
  baitDodgeDistance: 'aiTuneBaitDodgeDistance',
  baitDodgeBand: 'aiTuneBaitDodgeBand',
  evasionTriggerJitter: 'aiTuneEvasionTriggerJitter',
  arenaEdgeInset: 'aiTuneArenaEdgeInset',
  comboMinWeaponSwapIq: 'aiTuneComboMinWeaponSwapIq',
  comboAdvancedWeaponSwapIq: 'aiTuneComboAdvancedWeaponSwapIq',
  tempoCycleDuration: 'aiTuneTempoCycleDuration',
  postKillPressureDuration: 'aiTunePostKillPressureDuration',
  tempoSlowMult: 'aiTuneTempoSlowMult',
  tempoFastMult: 'aiTuneTempoFastMult',
  standoffRangeMinOffset: 'aiTuneStandoffRangeMinOffset',
  standoffRangeMaxOffset: 'aiTuneStandoffRangeMaxOffset',
  calibrationWindowSize: 'aiTuneCalibrationWindowSize',
  maxCalibrationDrift: 'aiTuneMaxCalibrationDrift',
  dodgeResolveDelay: 'aiTuneDodgeResolveDelay',
  counterResolveDelay: 'aiTuneCounterResolveDelay',
  playerModelEmaAlpha: 'aiTunePlayerModelEmaAlpha',
  defaultLungeDistance: 'aiTuneDefaultLungeDistance',
  defaultReactionTime: 'aiTuneDefaultReactionTime',
  priorityTargetTtl: 'aiTunePriorityTargetTtl',
  damageTagTtl: 'aiTuneDamageTagTtl',
  attackStaggerStep: 'aiTuneAttackStaggerStep',
  maxAirborneHeight: 'aiTuneMaxAirborneHeight',
  forcedDescentSpeed: 'aiTuneForcedDescentSpeed',
  // Group B keys exist for forward-compatibility; no UI rows yet.
  predictionAnticipationBonus: 'aiTunePredictionAnticipationBonus',
  predictionLandingWeight: 'aiTunePredictionLandingWeight',
  lungeChanceGroundBase: 'aiTuneLungeChanceGroundBase',
  lungeChanceGroundAnticipation: 'aiTuneLungeChanceGroundAnticipation',
  lungeChanceAirborneBase: 'aiTuneLungeChanceAirborneBase',
  lungeChanceAirborneAnticipation: 'aiTuneLungeChanceAirborneAnticipation',
  reactChanceBase: 'aiTuneReactChanceBase',
  reactChanceAnticipation: 'aiTuneReactChanceAnticipation',
  hammerJumpReachBase: 'aiTuneHammerJumpReachBase',
  hammerJumpReachAnticipation: 'aiTuneHammerJumpReachAnticipation',
  hammerJumpVerticalBase: 'aiTuneHammerJumpVerticalBase',
  hammerJumpVerticalAnticipation: 'aiTuneHammerJumpVerticalAnticipation',
};

/**
 * Group B fields are centralized but intentionally NOT surfaced in the UI yet.
 * They are excluded from the settings-default seed and from schema rows, so they
 * stay `undefined` in settings and resolve from their engine defaults.
 */
export const GROUP_B_TUNE_FIELDS: ReadonlySet<keyof AIBehaviorTuning> = new Set([
  'predictionAnticipationBonus',
  'predictionLandingWeight',
  'lungeChanceGroundBase',
  'lungeChanceGroundAnticipation',
  'lungeChanceAirborneBase',
  'lungeChanceAirborneAnticipation',
  'reactChanceBase',
  'reactChanceAnticipation',
  'hammerJumpReachBase',
  'hammerJumpReachAnticipation',
  'hammerJumpVerticalBase',
  'hammerJumpVerticalAnticipation',
]);

/** Fields exposed to the user (Group A) — everything that is not Group B. */
export const EXPOSED_AI_TUNE_FIELDS = (
  Object.keys(DEFAULT_AI_BEHAVIOR_TUNING) as (keyof AIBehaviorTuning)[]
).filter((field) => !GROUP_B_TUNE_FIELDS.has(field));

/**
 * Build the `{ aiTune*: defaultValue }` seed for `DEFAULT_ADMIN_SETTINGS`, for
 * the exposed (Group A) fields only. Keeps the persisted defaults in lockstep
 * with the engine defaults so a slider always starts at the true value.
 */
export function buildExposedTuneDefaults(): Partial<UniversalSettings> {
  const seed: Partial<UniversalSettings> = {};
  for (const field of EXPOSED_AI_TUNE_FIELDS) {
    (seed as Record<string, number>)[AI_TUNE_SETTING_KEYS[field]] = DEFAULT_AI_BEHAVIOR_TUNING[field];
  }
  return seed;
}

/**
 * Resolve the effective behavior tuning by overlaying any `settings.aiTune*`
 * overrides on top of the defaults. A field falls back to its default whenever
 * the matching setting is `undefined` (or not a finite number).
 */
export function resolveBehaviorTuning(settings: Partial<UniversalSettings> | undefined): AIBehaviorTuning {
  if (!settings) {
    return { ...DEFAULT_AI_BEHAVIOR_TUNING };
  }
  const resolved = { ...DEFAULT_AI_BEHAVIOR_TUNING };
  (Object.keys(AI_TUNE_SETTING_KEYS) as (keyof AIBehaviorTuning)[]).forEach((field) => {
    const settingKey = AI_TUNE_SETTING_KEYS[field];
    const override = settings[settingKey];
    if (typeof override === 'number' && Number.isFinite(override)) {
      resolved[field] = override;
    }
  });
  return resolved;
}
