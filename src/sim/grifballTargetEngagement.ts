import { normalizeTargetEngagementFrameState } from '../components/grifball/aiEngagementFrameRuntime';
import { registerBotEngagement } from '../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { resolveAICombatDangerZone } from '../game/aiCombatDecision';
import type { AIMatchContext } from '../game/aiMatchContext';
import { tickCalibrationPendingCounter, tickCalibrationPendingDodge } from '../game/aiSkillCalibration';
import type { resolveSimGrifballAdaptiveTuning } from './grifballAdaptiveTuning';
import { getSimGrifballObservationActors, resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { recordSimGrifballEngagementObservations } from './grifballEngagementObservations';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import type { SimState } from './simState';

export interface SimTargetEngagementMemory extends TacticalAIMemory {
  swayTimer: number;
  coordCommitTimer: number;
}
export interface SimTargetEngagementOwner {
  memory: SimTargetEngagementMemory;
  matchContext: AIMatchContext;
}

function validateOwner(owner: SimTargetEngagementOwner) {
  if (!owner || !owner.memory || ![owner.memory.timer ?? 0, owner.memory.swayTimer,
    owner.memory.coordCommitTimer, owner.memory.cooldownMultiplier].every(Number.isFinite) ||
    !(owner.matchContext?.coordinator?.engagements instanceof Map))
    throw new Error('Invalid target engagement owner');
}

/** Call in prepare, after target selection and before engagement gravity. Only
 * caller-owned memory changes. Flight must be explicitly selected; objective
 * and no-target turns retain their boundaries. Enter engagement only on true. */
export function beginSimGrifballTargetEngagement(state: SimState, botId: string, targetId: string,
  scriptedBots: Readonly<Record<string, string>>, owner: SimTargetEngagementOwner, dt = 1 / 60, committedFlight = false): boolean {
  validateOwner(owner);
  if (!getSimGrifballObservationActors(state, botId, targetId, scriptedBots, dt, committedFlight)) return false;
  registerBotEngagement(owner.matchContext.coordinator, botId, targetId);
  normalizeTargetEngagementFrameState(owner.memory);
  return true;
}

/** Call in resolve, after engagement gravity and before tactical/feint/combo
 * priorities. Adopt prepared clocks and approach models once using the same
 * context as beginTurn's adaptive prelude. Feint clocks remain in the combo
 * adapter; AI timer/sway clocks remain at the later movement boundary. */
export function observeSimGrifballTargetEngagement(state: SimState, botId: string, targetId: string,
  scriptedBots: Readonly<Record<string, string>>,
  adaptive: NonNullable<ReturnType<typeof resolveSimGrifballAdaptiveTuning>>,
  owner: SimTargetEngagementOwner & { nowSeconds: number; isObserverMode: boolean; committedFlight?: true }, dt = 1 / 60) {
  validateOwner(owner);
  const { matchContext, memory } = owner;
  if (!adaptive || adaptive.psychState !== matchContext.psychState.get(botId) ||
    !(matchContext.skillCalibration instanceof Map) || !(matchContext.playerModels instanceof Map) ||
    !Number.isFinite(owner.nowSeconds) || owner.nowSeconds < 0 || typeof owner.isObserverMode !== 'boolean')
    throw new Error('Target engagement requires the current adaptive context and match clock');
  const actors = getSimGrifballObservationActors(state, botId, targetId, scriptedBots, dt, !!owner.committedFlight);
  if (!actors) return null;
  if (matchContext.coordinator.engagements.get(botId) !== targetId || memory.aiState === 'SPAWN_GUARDING')
    throw new Error('Target engagement must begin before observation');
  const spacingFactor = (1.35 - .60 * adaptive.playstyleFactor) *
    adaptive.matchMultipliers.spacingMult * adaptive.personalityFlags.spacingBand;
  const resolvedDangerZone = resolveAICombatDangerZone(state.settings, actors.target.weapon) * spacingFactor;
  const observation = resolveSimGrifballCombatObservation(state, botId, targetId, scriptedBots, adaptive, dt, {
    aiState: memory.aiState, swayTimer: memory.swayTimer, coordCommitTimer: memory.coordCommitTimer,
    psychEnabled: adaptive.psychEnabled, standoffTimer: adaptive.psychState.standoffTimer, resolvedDangerZone,
  }, !!owner.committedFlight)!;
  const behavior = resolveBehaviorTuning(state.settings);
  // Live tactical target observations count committed overhead swings as a
  // lunging threat as well as actual sword flight. Do not use isLunging alone.
  const targetIsLunging = observeSimTacticalWeaponTarget(state, actors.target).isLunging;
  if (adaptive.calibrationEnabled) {
    tickCalibrationPendingDodge(matchContext, botId, dt, targetIsLunging, behavior.dodgeResolveDelay, behavior.calibrationWindowSize);
    tickCalibrationPendingCounter(matchContext, botId, dt, targetIsLunging, behavior.counterResolveDelay, behavior.calibrationWindowSize);
  }
  memory.coordCommitTimer = observation.preparation!.coordCommitTimer;
  adaptive.psychState.standoffTimer = observation.preparation!.standoffTimer;
  recordSimGrifballEngagementObservations(state, botId, scriptedBots, observation, owner, dt);
  return { observation, spacingFactor, resolvedDangerZone, targetIsLunging };
}
