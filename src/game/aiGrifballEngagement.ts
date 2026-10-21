import type { GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TankingMemory } from './aiGrifballTanking';
import type { TeamTactics } from './grifballTacticsConfig';
import { GRIFBALL_ENGAGEMENT_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from './grifballPlayerStyles';

export interface EngagementPersistenceDecision {
  style: GrifballPlayerStyle; strength: number; preference: string;
  teamCommitSeconds: number; commitSeconds: number; teamReleaseSeconds: number; releaseSeconds: number;
  commitRemaining: number; releaseRemaining: number;
}

/** These are planner clocks, never weapon cooldowns or guaranteed attack rights. */
export function grifballEngagementTiming(snapshot: GrifballTacticalSnapshot, id: string, tuning: TeamTactics): EngagementPersistenceDecision {
  const bot = snapshot.players.find(p => p.id === id), carrier = snapshot.players.find(p => p.id === snapshot.holderId);
  const strength = bot?.scripted && carrier?.team === bot.team && tuning.enabled && tuning.spaceEnabled && tuning.tankingEnabled
    ? tuning.engagementAgencyStrength : 0;
  const style = resolveGrifballPlayerStyle(snapshot.tactics?.botStyles, id), preference = GRIFBALL_ENGAGEMENT_PREFERENCES[style];
  const scale = (seconds: number, factor: number) => Math.min(3, Math.max(0, seconds * (1 + (factor - 1) * strength)));
  return { style, strength, preference: preference.reason, teamCommitSeconds: tuning.tankCommitSeconds,
    commitSeconds: scale(tuning.tankCommitSeconds, preference.commit), teamReleaseSeconds: tuning.tankReleaseSeconds,
    releaseSeconds: scale(tuning.tankReleaseSeconds, preference.release), commitRemaining: 0, releaseRemaining: 0 };
}

/** Preserve elapsed time when an active individualized clock changes in the Lab.
 * Enabling the feature affects new windows; expired windows never restart. */
export function syncGrifballEngagementTiming(snapshot: GrifballTacticalSnapshot, tuning: TeamTactics, memory: TankingMemory): void {
  const durations = memory.individualDurations;
  if (!durations) return;
  if (durations.commit !== undefined) {
    if (memory.primaryId && memory.commitment > 0) {
      const next = grifballEngagementTiming(snapshot, memory.primaryId, tuning);
      memory.commitment = Math.max(0, next.commitSeconds - Math.max(0, durations.commit - memory.commitment));
      if (next.strength > 0 && memory.commitment > 0) durations.commit = next.commitSeconds;
      else delete durations.commit;
    } else delete durations.commit;
  }
  for (const [id, duration] of Object.entries(durations.releases)) {
    if (memory.releaseRemaining[id] > 0) {
      const next = grifballEngagementTiming(snapshot, id, tuning);
      memory.releaseRemaining[id] = Math.max(0, next.releaseSeconds - Math.max(0, duration - memory.releaseRemaining[id]));
      if (next.strength > 0 && memory.releaseRemaining[id] > 0) durations.releases[id] = next.releaseSeconds;
      else delete durations.releases[id];
      if (!memory.releaseRemaining[id]) delete memory.releaseRemaining[id];
    } else delete durations.releases[id];
  }
  if (durations.commit === undefined && !Object.keys(durations.releases).length) delete memory.individualDurations;
}

export function startGrifballTankCommitment(memory: TankingMemory, timing: EngagementPersistenceDecision): void {
  memory.commitment = timing.commitSeconds;
  if (timing.strength > 0 && timing.commitSeconds > 0)
    (memory.individualDurations ??= { releases: {} }).commit = timing.commitSeconds;
  else if (memory.individualDurations) delete memory.individualDurations.commit;
}

export function startGrifballTankRelease(memory: TankingMemory, id: string, timing: EngagementPersistenceDecision): void {
  memory.releaseRemaining[id] = timing.releaseSeconds;
  if (timing.strength > 0 && timing.releaseSeconds > 0)
    (memory.individualDurations ??= { releases: {} }).releases[id] = timing.releaseSeconds;
  else if (memory.individualDurations) delete memory.individualDurations.releases[id];
}
