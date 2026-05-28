import type { MatchStateMultipliers } from './aiTuning';

/** Seconds per slow/fast tempo band before alternation. */
export const TEMPO_CYCLE_DURATION = 9;

/** How long post-kill spawn pressure persists (slightly under respawn countdown). */
export const POST_KILL_PRESSURE_DURATION = 2.75;

export const TEMPO_SLOW_MULT = 1.38;
export const TEMPO_FAST_MULT = 0.62;

/** Mid-range standoff band starts above danger zone. */
export const STANDOFF_RANGE_MIN_OFFSET = 1.5;
export const STANDOFF_RANGE_MAX_OFFSET = 5.5;

export type TempoPhase = 'slow' | 'fast';

export interface PostKillPressure {
  victimId: string;
  spawnX: number;
  spawnZ: number;
  timerRemaining: number;
  lungeKill: boolean;
}

export interface BotPsychState {
  postKill?: PostKillPressure;
  tempoPhase: TempoPhase;
  tempoTimer: number;
  standoffTimer: number;
}

export function createBotPsychState(): BotPsychState {
  return {
    tempoPhase: 'fast',
    tempoTimer: TEMPO_CYCLE_DURATION * 0.5,
    standoffTimer: 0,
  };
}

export function isPsychPressureEnabled(difficulty: string, pressureAggression: number): boolean {
  if (difficulty === 'easy') {
    return false;
  }
  return pressureAggression >= 15;
}

export function notifyBotKill(
  state: BotPsychState,
  input: {
    victimId: string;
    spawnX: number;
    spawnZ: number;
    lungeKill: boolean;
    duration?: number;
  }
): void {
  state.postKill = {
    victimId: input.victimId,
    spawnX: input.spawnX,
    spawnZ: input.spawnZ,
    timerRemaining: input.duration ?? POST_KILL_PRESSURE_DURATION,
    lungeKill: input.lungeKill,
  };
  state.standoffTimer = 0;
}

export function tickBotPsychState(state: BotPsychState, dt: number): void {
  if (state.postKill) {
    state.postKill.timerRemaining = Math.max(0, state.postKill.timerRemaining - dt);
    if (state.postKill.timerRemaining <= 0) {
      state.postKill = undefined;
    }
  }

  state.tempoTimer -= dt;
  if (state.tempoTimer <= 0) {
    state.tempoPhase = state.tempoPhase === 'slow' ? 'fast' : 'slow';
    state.tempoTimer = TEMPO_CYCLE_DURATION;
  }
}

export function getActivePostKillPressure(state: BotPsychState): PostKillPressure | undefined {
  if (!state.postKill || state.postKill.timerRemaining <= 0) {
    return undefined;
  }
  return state.postKill;
}

export function getEffectiveReactionLatency(
  baseLatency: number,
  state: BotPsychState,
  enabled: boolean
): number {
  if (!enabled) {
    return baseLatency;
  }
  const mult = state.tempoPhase === 'slow' ? TEMPO_SLOW_MULT : TEMPO_FAST_MULT;
  return Math.max(0.01, baseLatency * mult);
}

export function isInStandoffBand(
  distanceToTarget: number,
  dangerZone: number
): boolean {
  return (
    distanceToTarget > dangerZone + STANDOFF_RANGE_MIN_OFFSET &&
    distanceToTarget <= dangerZone + STANDOFF_RANGE_MAX_OFFSET
  );
}

export function accumulateStandoffTimer(
  currentTimer: number,
  inStandoffBand: boolean,
  dt: number
): number {
  if (!inStandoffBand) {
    return 0;
  }
  return currentTimer + dt;
}

export function getStandoffCommitChance(
  standoffTimer: number,
  playstyleFactor: number,
  multipliers: MatchStateMultipliers
): number {
  const base = 0.06 + standoffTimer * 0.14 * (0.55 + playstyleFactor * 0.45);
  const scaled = base * multipliers.matchPointCommitBias * multipliers.aggressionMult;
  return Math.min(0.88, Math.max(0, scaled));
}

export function shouldForceStandoffCommit(
  standoffTimer: number,
  playstyleFactor: number,
  multipliers: MatchStateMultipliers,
  rng: number
): boolean {
  if (standoffTimer < 0.35) {
    return false;
  }
  return rng < getStandoffCommitChance(standoffTimer, playstyleFactor, multipliers);
}

/** Forward speed multiplier vs generic spawn-guard pacing. */
export function getPostKillApproachSpeed(
  lungeKill: boolean,
  pressureAggression: number
): number {
  const t = pressureAggression / 100;
  const base = 4.2 + t * 1.4;
  return lungeKill ? base + 0.8 : base;
}

export function shouldTelegraphSwordAtSpawn(
  lungeKill: boolean,
  distanceToSpawn: number
): boolean {
  return lungeKill && distanceToSpawn <= 7.5;
}

export function getPostKillHoldDistance(): number {
  return 4.8;
}
