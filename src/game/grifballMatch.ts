import { type UniversalSettings } from '../types';
import { type TeamId } from './teamScoring';
import { createInitialBall, type GrifballBall, type Vec3 } from './grifballBall';

/**
 * Round-based Grifball match flow:
 *   countdown → playing → scored → (next round countdown | matchEnd)
 *
 * Pure state + timers. Scoring, pickups and respawns are detected by the caller
 * (which owns combatant positions and the map) and pushed in via {@link registerGoal};
 * this module only owns the phase machine and round/win bookkeeping.
 */
export type GrifballPhase = 'countdown' | 'playing' | 'scored' | 'matchEnd';

export interface GrifballMatchState {
  phase: GrifballPhase;
  /** Seconds elapsed in the current countdown / scored hold. */
  phaseTimer: number;
  roundNumber: number;
  goalTarget: number;
  lastScoringTeam: TeamId | null;
  winningTeam: TeamId | null;
  ball: GrifballBall;
}

export interface GrifballMatchConfig {
  goalTarget: number;
  countdownDuration: number;
  roundResetDelay: number;
}

export function resolveMatchConfig(settings: UniversalSettings): GrifballMatchConfig {
  return {
    goalTarget: settings.grifballGoalTarget ?? 5,
    countdownDuration: settings.grifballCountdownDuration ?? 3,
    roundResetDelay: settings.grifballRoundResetDelay ?? 4,
  };
}

export function createInitialGrifballMatchState(
  settings: UniversalSettings,
  home: Vec3 = { x: 0, y: 0, z: 0 }
): GrifballMatchState {
  const config = resolveMatchConfig(settings);
  return {
    phase: 'countdown',
    phaseTimer: 0,
    roundNumber: 1,
    goalTarget: config.goalTarget,
    lastScoringTeam: null,
    winningTeam: null,
    ball: createInitialBall(home),
  };
}

export interface GrifballTickResult {
  /** Countdown just ended — the ball is now live and scoring is enabled. */
  startedPlaying: boolean;
  /** Scored hold elapsed with no winner — reposition for the next round. */
  roundReset: boolean;
  /** Scored hold elapsed with a winner — the match is over. */
  matchEnded: boolean;
}

const EMPTY_RESULT: GrifballTickResult = {
  startedPlaying: false,
  roundReset: false,
  matchEnded: false,
};

/** Advance phase timers. Does not move the ball (see tickBallPhysics). */
export function tickGrifballMatch(
  state: GrifballMatchState,
  dt: number,
  config: GrifballMatchConfig
): GrifballTickResult {
  if (state.phase === 'countdown') {
    state.phaseTimer += dt;
    if (state.phaseTimer >= config.countdownDuration) {
      state.phase = 'playing';
      state.phaseTimer = 0;
      return { ...EMPTY_RESULT, startedPlaying: true };
    }
    return EMPTY_RESULT;
  }

  if (state.phase === 'scored') {
    state.phaseTimer += dt;
    if (state.phaseTimer >= config.roundResetDelay) {
      state.phaseTimer = 0;
      if (state.winningTeam) {
        state.phase = 'matchEnd';
        return { ...EMPTY_RESULT, matchEnded: true };
      }
      state.phase = 'countdown';
      state.roundNumber += 1;
      return { ...EMPTY_RESULT, roundReset: true };
    }
    return EMPTY_RESULT;
  }

  return EMPTY_RESULT;
}

/**
 * Register a goal for `scoringTeam`. `newGoalTotal` is that team's running goal
 * count (from team scoring, the score source of truth) and decides the win.
 * Only meaningful while `playing`; ignored otherwise.
 */
export function registerGoal(
  state: GrifballMatchState,
  scoringTeam: TeamId,
  newGoalTotal: number,
  config: GrifballMatchConfig
): boolean {
  if (state.phase !== 'playing') return false;
  state.lastScoringTeam = scoringTeam;
  state.phase = 'scored';
  state.phaseTimer = 0;
  if (newGoalTotal >= config.goalTarget) {
    state.winningTeam = scoringTeam;
  }
  return true;
}

/** Is scoring / pickup currently active? */
export function isGrifballLive(state: GrifballMatchState): boolean {
  return state.phase === 'playing';
}
