import { UniversalSettings } from '../types';
import { resolveRosterSlotForCombatant, LegacyRosterProps } from './rosterSlotConfig';
import { resolveGrifballTeam } from './grifballTeams';

/** Known team ids for the current 2-team mode; string allows N teams later. */
export type TeamId = 'blue' | 'red' | (string & {});

export const PLAYER_TEAM: TeamId = 'blue';
export const DEFAULT_AI_TEAM: TeamId = 'red';

export const TEAM_IDS: readonly TeamId[] = [PLAYER_TEAM, DEFAULT_AI_TEAM];

export interface TeamTally {
  score: number;
  kills: number;
  deaths: number;
  respawnTimer: number;
  /** Grifball objective goals (kept separate from kill `score`). */
  goals: number;
}

export function createEmptyTeamTally(): TeamTally {
  return { score: 0, kills: 0, deaths: 0, respawnTimer: 0, goals: 0 };
}

export interface TeamScoresState {
  blue: TeamTally;
  red: TeamTally;
  [team: string]: TeamTally;
}

export function createEmptyTeamScores(teams: readonly TeamId[] = TEAM_IDS): TeamScoresState {
  const scores = {} as TeamScoresState;
  for (const id of teams) {
    scores[id] = createEmptyTeamTally();
  }
  return scores;
}

export function getTeamTally(scores: TeamScoresState, teamId: TeamId): TeamTally {
  if (!scores[teamId]) {
    scores[teamId] = createEmptyTeamTally();
  }
  return scores[teamId];
}

export function opponentTeamId(localTeam: TeamId): TeamId {
  return localTeam === PLAYER_TEAM ? DEFAULT_AI_TEAM : PLAYER_TEAM;
}

/** Local player's team from sandbox / multiplayer role. */
export function localPlayerTeamFromRole(
  role: 'host' | 'client' | 'observer' | null | undefined
): TeamId {
  return role === 'client' ? DEFAULT_AI_TEAM : PLAYER_TEAM;
}

/** Resolve which team a combatant belongs to (roster slot override or defaults). */
export function resolveCombatantTeam(
  combatantId: string,
  settings: UniversalSettings,
  legacy: LegacyRosterProps
): TeamId {
  if (combatantId === 'player') return PLAYER_TEAM;
  // Grifball forces a balanced 4v4 split regardless of sandbox roster overrides.
  if (settings.gameMode === 'grifball') return resolveGrifballTeam(combatantId);
  const slot = resolveRosterSlotForCombatant(combatantId, settings, legacy);
  return slot.team || DEFAULT_AI_TEAM;
}

export function awardTeamKill(scores: TeamScoresState, teamId: TeamId): void {
  const tally = getTeamTally(scores, teamId);
  tally.score += 1;
  tally.kills += 1;
}

export function recordTeamDeath(scores: TeamScoresState, teamId: TeamId): void {
  getTeamTally(scores, teamId).deaths += 1;
}

/** Award a Grifball objective goal to a team; returns the team's new goal total. */
export function awardTeamGoal(scores: TeamScoresState, teamId: TeamId): number {
  const tally = getTeamTally(scores, teamId);
  tally.goals += 1;
  return tally.goals;
}

export function setTeamRespawnTimer(
  scores: TeamScoresState,
  teamId: TeamId,
  seconds: number
): void {
  getTeamTally(scores, teamId).respawnTimer = seconds;
}

export function resetTeamScores(scores: TeamScoresState, teams: readonly TeamId[] = TEAM_IDS): void {
  for (const id of teams) {
    scores[id] = createEmptyTeamTally();
  }
}

/** Perspective-aware score context for HUD, win conditions, and AI tuning. */
export function teamScoresToMatchContext(
  scores: TeamScoresState,
  localTeam: TeamId,
  killsToWin?: number
): { scorePlayer: number; scoreEnemy: number; killsToWin?: number } {
  const opponent = opponentTeamId(localTeam);
  return {
    scorePlayer: getTeamTally(scores, localTeam).score,
    scoreEnemy: getTeamTally(scores, opponent).score,
    killsToWin,
  };
}

type TeamScoreBridgeHost = {
  teamScores: TeamScoresState;
  localPlayerTeam: TeamId;
  scorePlayer: number;
  scoreEnemy: number;
  playerKills: number;
  enemyKills: number;
  playerDeaths: number;
  enemyDeaths: number;
  playerRespawnTimer: number;
  enemyRespawnTimer: number;
};

const LEGACY_TEAM_FIELD_MAP: {
  legacy: keyof TeamScoreBridgeHost;
  teamKey: keyof TeamTally;
  perspective: 'local' | 'opponent';
}[] = [
  { legacy: 'scorePlayer', teamKey: 'score', perspective: 'local' },
  { legacy: 'scoreEnemy', teamKey: 'score', perspective: 'opponent' },
  { legacy: 'playerKills', teamKey: 'kills', perspective: 'local' },
  { legacy: 'enemyKills', teamKey: 'kills', perspective: 'opponent' },
  { legacy: 'playerDeaths', teamKey: 'deaths', perspective: 'local' },
  { legacy: 'enemyDeaths', teamKey: 'deaths', perspective: 'opponent' },
  { legacy: 'playerRespawnTimer', teamKey: 'respawnTimer', perspective: 'local' },
  { legacy: 'enemyRespawnTimer', teamKey: 'respawnTimer', perspective: 'opponent' },
];

/**
 * Install getter/setter bridges so legacy scorePlayer/scoreEnemy/enemy* fields
 * forward into the canonical per-team tally (source-of-truth flip).
 */
export function installLegacyTeamScoreBridges(host: TeamScoreBridgeHost): void {
  const resolveTeam = (perspective: 'local' | 'opponent'): TeamId =>
    perspective === 'local' ? host.localPlayerTeam : opponentTeamId(host.localPlayerTeam);

  for (const { legacy, teamKey, perspective } of LEGACY_TEAM_FIELD_MAP) {
    Object.defineProperty(host, legacy, {
      get() {
        const teamId = resolveTeam(perspective);
        return getTeamTally(host.teamScores, teamId)[teamKey];
      },
      set(value: number) {
        const teamId = resolveTeam(perspective);
        getTeamTally(host.teamScores, teamId)[teamKey] = value;
      },
      configurable: true,
      enumerable: true,
    });
  }
}

/** Absolute-team accessors for combatants on a fixed team (e.g. main_ai on red). */
export function teamTallyFieldAccessor(
  getState: () => TeamScoreBridgeHost,
  teamId: TeamId,
  field: keyof TeamTally
): { get: () => number; set: (v: number) => void } {
  return {
    get: () => getTeamTally(getState().teamScores, teamId)[field],
    set: (v: number) => {
      getTeamTally(getState().teamScores, teamId)[field] = v;
    },
  };
}
