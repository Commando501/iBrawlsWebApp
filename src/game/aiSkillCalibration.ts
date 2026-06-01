import type { AIMatchContext } from './aiMatchContext';

/** Rolling window of completed engagement snapshots. */
export const CALIBRATION_WINDOW_SIZE = 10;

/** Max ± drift applied to reaction, anticipation, and lunge aggression. */
export const MAX_CALIBRATION_DRIFT = 0.125;

/** Seconds after a dodge before resolving success if the lunge ends cleanly. */
export const DODGE_RESOLVE_DELAY = 0.35;

/** Seconds after a lunge ends before resolving a failed counter attempt. */
export const COUNTER_RESOLVE_DELAY = 0.5;

export interface EngagementSnapshot {
  botKill: number;
  botDeath: number;
  dodgeAttempts: number;
  dodgeSuccesses: number;
  counterAttempts: number;
  counterSuccesses: number;
  secondsSincePrevDeath?: number;
}

export interface BotCalibrationState {
  snapshots: EngagementSnapshot[];
  lastDeathTimestamp?: number;
  pendingDodge?: { elapsed: number };
  pendingCounter?: { elapsed: number };
}

export interface SkillCalibrationMultipliers {
  reactionLatencyMult: number;
  anticipationFactorMult: number;
  aggressiveLungeMult: number;
}

export const NEUTRAL_CALIBRATION_MULTIPLIERS: SkillCalibrationMultipliers = {
  reactionLatencyMult: 1,
  anticipationFactorMult: 1,
  aggressiveLungeMult: 1,
};

const STANDARD_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'nightmare']);

export function isSkillCalibrationEnabled(difficulty: string): boolean {
  if (!STANDARD_DIFFICULTIES.has(difficulty)) {
    return false;
  }
  return difficulty !== 'easy';
}

export function createBotCalibrationState(): BotCalibrationState {
  return { snapshots: [] };
}

export function getOrCreateBotCalibrationState(
  context: AIMatchContext,
  botId: string
): BotCalibrationState {
  let state = context.skillCalibration.get(botId);
  if (!state) {
    state = createBotCalibrationState();
    context.skillCalibration.set(botId, state);
  }
  return state;
}

function pushSnapshot(
  state: BotCalibrationState,
  snapshot: EngagementSnapshot,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  state.snapshots.push(snapshot);
  while (state.snapshots.length > windowSize) {
    state.snapshots.shift();
  }
}

function finalizeOpenCounters(state: BotCalibrationState): EngagementSnapshot {
  return {
    botKill: 0,
    botDeath: 0,
    dodgeAttempts: 0,
    dodgeSuccesses: 0,
    counterAttempts: 0,
    counterSuccesses: 0,
  };
}

function appendSnapshot(
  state: BotCalibrationState,
  patch: Partial<EngagementSnapshot>,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const base = finalizeOpenCounters(state);
  pushSnapshot(state, {
    botKill: patch.botKill ?? base.botKill,
    botDeath: patch.botDeath ?? base.botDeath,
    dodgeAttempts: patch.dodgeAttempts ?? base.dodgeAttempts,
    dodgeSuccesses: patch.dodgeSuccesses ?? base.dodgeSuccesses,
    counterAttempts: patch.counterAttempts ?? base.counterAttempts,
    counterSuccesses: patch.counterSuccesses ?? base.counterSuccesses,
    secondsSincePrevDeath: patch.secondsSincePrevDeath,
  }, windowSize);
  state.pendingCounter = undefined;
}

export function recordCalibrationKill(
  context: AIMatchContext,
  botId: string,
  nowSeconds: number,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  appendSnapshot(state, { botKill: 1 }, windowSize);
  void nowSeconds;
}

export function recordCalibrationDeath(
  context: AIMatchContext,
  botId: string,
  nowSeconds: number,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  const secondsSincePrevDeath =
    state.lastDeathTimestamp !== undefined
      ? Math.max(0, nowSeconds - state.lastDeathTimestamp)
      : undefined;
  state.lastDeathTimestamp = nowSeconds;
  appendSnapshot(state, { botDeath: 1, secondsSincePrevDeath }, windowSize);
}

export function recordCalibrationDodgeAttempt(context: AIMatchContext, botId: string): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  state.pendingDodge = { elapsed: 0 };
}

export function recordCalibrationDodgeFailed(
  context: AIMatchContext,
  botId: string,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  if (!state.pendingDodge) {
    return;
  }
  appendSnapshot(state, { dodgeAttempts: 1, dodgeSuccesses: 0 }, windowSize);
  state.pendingDodge = undefined;
}

export function recordCalibrationDodgeSucceeded(
  context: AIMatchContext,
  botId: string,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  if (!state.pendingDodge) {
    return;
  }
  appendSnapshot(state, { dodgeAttempts: 1, dodgeSuccesses: 1 }, windowSize);
  state.pendingDodge = undefined;
}

export function tickCalibrationPendingDodge(
  context: AIMatchContext,
  botId: string,
  dt: number,
  targetIsLunging: boolean,
  dodgeResolveDelay: number = DODGE_RESOLVE_DELAY,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = context.skillCalibration.get(botId);
  if (!state?.pendingDodge) {
    return;
  }

  state.pendingDodge.elapsed += dt;
  if (targetIsLunging) {
    return;
  }

  if (state.pendingDodge.elapsed >= dodgeResolveDelay) {
    recordCalibrationDodgeSucceeded(context, botId, windowSize);
  }
}

export function recordCalibrationCounterAttempt(context: AIMatchContext, botId: string): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  state.pendingCounter = { elapsed: 0 };
}

export function recordCalibrationCounterSuccess(
  context: AIMatchContext,
  botId: string,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  if (!state.pendingCounter) {
    return;
  }
  appendSnapshot(state, { counterAttempts: 1, counterSuccesses: 1 }, windowSize);
  state.pendingCounter = undefined;
}

export function recordCalibrationCounterFailed(
  context: AIMatchContext,
  botId: string,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = getOrCreateBotCalibrationState(context, botId);
  if (!state.pendingCounter) {
    return;
  }
  appendSnapshot(state, { counterAttempts: 1, counterSuccesses: 0 }, windowSize);
  state.pendingCounter = undefined;
}

export function tickCalibrationPendingCounter(
  context: AIMatchContext,
  botId: string,
  dt: number,
  targetIsLunging: boolean,
  counterResolveDelay: number = COUNTER_RESOLVE_DELAY,
  windowSize: number = CALIBRATION_WINDOW_SIZE,
): void {
  const state = context.skillCalibration.get(botId);
  if (!state?.pendingCounter) {
    return;
  }

  state.pendingCounter.elapsed += dt;
  if (targetIsLunging) {
    state.pendingCounter.elapsed = 0;
    return;
  }

  if (state.pendingCounter.elapsed >= counterResolveDelay) {
    recordCalibrationCounterFailed(context, botId, windowSize);
  }
}

function clampBias(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Positive bias = player is dominating; negative = bot is dominating. */
export function computeCalibrationBias(state: BotCalibrationState): number {
  if (state.snapshots.length === 0) {
    return 0;
  }

  let kills = 0;
  let deaths = 0;
  let dodgeAttempts = 0;
  let dodgeSuccesses = 0;
  let counterAttempts = 0;
  let counterSuccesses = 0;
  const deathIntervals: number[] = [];

  for (const snap of state.snapshots) {
    kills += snap.botKill;
    deaths += snap.botDeath;
    dodgeAttempts += snap.dodgeAttempts;
    dodgeSuccesses += snap.dodgeSuccesses;
    counterAttempts += snap.counterAttempts;
    counterSuccesses += snap.counterSuccesses;
    if (snap.secondsSincePrevDeath !== undefined) {
      deathIntervals.push(snap.secondsSincePrevDeath);
    }
  }

  let bias = 0;

  const kdRatio = (kills + 0.5) / (deaths + 0.5);
  bias -= (kdRatio - 1) * 0.35;

  if (dodgeAttempts > 0) {
    const dodgeRate = dodgeSuccesses / dodgeAttempts;
    bias += (dodgeRate - 0.5) * 0.25;
  }

  if (counterAttempts > 0) {
    const counterRate = counterSuccesses / counterAttempts;
    bias += (counterRate - 0.5) * 0.2;
  }

  if (deathIntervals.length > 0) {
    const avgInterval =
      deathIntervals.reduce((sum, value) => sum + value, 0) / deathIntervals.length;
    bias += clampBias((8 - avgInterval) / 8) * 0.2;
  }

  return clampBias(bias);
}

export function computeCalibrationMultipliers(
  state: BotCalibrationState,
  maxDrift: number = MAX_CALIBRATION_DRIFT,
): SkillCalibrationMultipliers {
  const bias = computeCalibrationBias(state);
  if (Math.abs(bias) < 0.05) {
    return NEUTRAL_CALIBRATION_MULTIPLIERS;
  }

  const magnitude = Math.min(Math.abs(bias), 1) * maxDrift;

  if (bias > 0) {
    return {
      reactionLatencyMult: 1 - magnitude,
      anticipationFactorMult: 1 + magnitude,
      aggressiveLungeMult: 1 + magnitude,
    };
  }

  return {
    reactionLatencyMult: 1 + magnitude,
    anticipationFactorMult: 1 - magnitude,
    aggressiveLungeMult: 1 - magnitude,
  };
}

export function applyCalibrationMultipliers(input: {
  reactionLatency: number;
  anticipationFactor: number;
  aggressiveLungeMult: number;
  multipliers: SkillCalibrationMultipliers;
}): {
  reactionLatency: number;
  anticipationFactor: number;
  aggressiveLungeMult: number;
} {
  return {
    reactionLatency: Math.max(0.01, input.reactionLatency * input.multipliers.reactionLatencyMult),
    anticipationFactor: Math.max(
      0,
      Math.min(1, input.anticipationFactor * input.multipliers.anticipationFactorMult)
    ),
    aggressiveLungeMult: Math.max(
      0.1,
      input.aggressiveLungeMult * input.multipliers.aggressiveLungeMult
    ),
  };
}
