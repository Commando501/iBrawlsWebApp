import type { CustomMapData, UniversalSettings } from '../types';
import type { GrifballMatchState } from './grifballMatch';
import type { GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { tacticalDifficulty } from './aiGrifballStyle';
import { resolveRunnerThrowAllowed } from './runnerBallSettings';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, type GrifballTacticsConfig } from './grifballTacticsConfig';
import { runnerPursuitRules } from './aiGrifballRunnerPursuit';

/** Separate from RL observation/action versions: this contract never executes policy actions. */
export const GRIFBALL_TACTICAL_CONTRACT_VERSION = 1 as const;
export type TacticalRosterMember = Pick<GrifballTacticalPlayer, 'id' | 'team' | 'scripted' | 'difficulty'> & { controller: string };
export interface TacticalFrameInput {
  match: GrifballMatchState;
  settings: UniversalSettings;
  map: CustomMapData | null;
  arenaRadius: number;
  players: GrifballTacticalPlayer[];
  /** Includes dead participants, excludes spectators. Ownership is explicit in both adapters. */
  roster: TacticalRosterMember[];
  respawns: NonNullable<GrifballTacticalSnapshot['respawns']>;
  goals: GrifballTacticalSnapshot['goals'];
  tactics?: GrifballTacticsConfig;
}
export type VersionedTacticalSnapshot = GrifballTacticalSnapshot & { contractVersion: typeof GRIFBALL_TACTICAL_CONTRACT_VERSION };
const point = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });

/** Shared, copied planner input. Adapters own engine-specific timing and spawn projection. */
export function createGrifballTacticalSnapshot(input: TacticalFrameInput): VersionedTacticalSnapshot {
  const { match, settings, map, arenaRadius, tactics = defaultGrifballTactics() } = input;
  const roster = [...input.roster].sort((a, b) => a.id.localeCompare(b.id));
  const teamDifficulty = Object.fromEntries(['blue', 'red'].map(team => {
    const bots = roster.filter(p => p.team === team && p.scripted);
    return [team, bots.length ? bots.reduce((sum, p) => sum + tacticalDifficulty(p.difficulty ?? settings.aiDifficulty), 0) / bots.length : 1];
  }));
  const ball = match.ball;
  return {
    contractVersion: GRIFBALL_TACTICAL_CONTRACT_VERSION,
    runnerPursuitRules: runnerPursuitRules(settings),
    rosterKey: JSON.stringify(roster.map(p => [p.id, p.team, p.controller, p.difficulty, p.scripted])), teamDifficulty,
    round: match.roundNumber, playing: match.phase === 'playing',
    ball: point(ball.pos), ballPhysics: { ...ball, pos: { ...ball.pos }, vel: { ...ball.vel }, home: { ...ball.home } },
    holderId: ball.state === 'held' ? ball.holderId : null,
    respawns: input.respawns.map(p => ({ ...p, pos: point(p.pos) })),
    players: input.players.map(p => ({ ...p, pos: point(p.pos), vel: point(p.vel),
      heading: p.heading ? point(p.heading) : undefined, space: p.space ? { ...p.space } : undefined })),
    goals: { blue: input.goals.blue ? point(input.goals.blue) : null, red: input.goals.red ? point(input.goals.red) : null },
    passing: { allowed: resolveRunnerThrowAllowed(settings), minSpeed: settings.grifballPassSpeedMin ?? 9,
      maxSpeed: settings.grifballPassSpeedMax ?? 26, chargeMax: settings.grifballChargeMax ?? 1.2,
      pickupRadius: settings.grifballPickupRadius ?? 1.6,
      hammerDeflection: (settings.hammerBallDeflectionEnabled ?? true) && (settings.hammerBallDeflectionStrength ?? 1) > 0,
      bounds: { arenaRadius: map?.arenaRadius ?? arenaRadius, mapShape: map?.mapShape,
        arenaHalfExtents: map?.arenaHalfExtents ? { ...map.arenaHalfExtents } : undefined, arenaCeiling: map?.arenaCeiling } },
    tactics: { ...tactics, defaults: { ...tactics.defaults }, teams: Object.fromEntries(Object.entries(tactics.teams).map(([team, tuning]) => [team, { ...tuning }])), botStyles: { ...tactics.botStyles } },
    geometry: buildGrifballSpaceGeometry(map, arenaRadius), spacing: settings.grifballEscortSpacing ?? 4,
  };
}
