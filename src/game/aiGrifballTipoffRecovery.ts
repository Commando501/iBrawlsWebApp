import type { GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TipoffMemory } from './aiGrifballTipoff';
import { resolveTeamTactics, type GrifballTacticsConfig, type TeamTactics } from './grifballTacticsConfig';
import {
  GRIFBALL_TIPOFF_RECOVERY_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffRecovery {
  startedAt: number;
  duration: number;
  affectedIds: string[];
  reason: string;
  /** Per-bot duration caps captured at the disruption, relative to startedAt. */
  personal?: Record<string, number>;
}
export interface TipoffRecoveryDecision extends Omit<TipoffRecovery, 'personal'> {
  remaining: number;
}

export interface TipoffRecoveryAgencyDecision {
  style: GrifballPlayerStyle;
  strength: number;
  teamDuration: number;
  duration: number;
  remaining: number;
  holding: boolean;
  reason: string;
}

function preference(tuning: TeamTactics, styles: Record<string, GrifballPlayerStyle> | undefined, id: string) {
  const style = resolveGrifballPlayerStyle(styles, id);
  const profile = GRIFBALL_TIPOFF_RECOVERY_PREFERENCES[style];
  return {
    style,
    strength: tuning.tipoffRecoveryAgencyStrength,
    delay: profile.delay * tuning.tipoffRecoveryAgencyStrength,
    reason: profile.reason,
  };
}

/** Only support/screen candidates consume this preference. Pickup and rear
 * coverage remain mandatory, and the shared recovery is always a floor. */
export function resolveGrifballTipoffRecoveryAgency(
  recovery: TipoffRecovery | undefined,
  elapsed: number,
  tuning: TeamTactics,
  styles: Record<string, GrifballPlayerStyle> | undefined,
  id: string,
): TipoffRecoveryAgencyDecision | undefined {
  if (!recovery || tuning.tipoffRecoveryAgencyStrength <= 0 || tuning.tipoffRegroupSeconds <= 0) return undefined;
  const p = preference(tuning, styles, id);
  const captured =
    recovery.personal && Object.hasOwn(recovery.personal, id) ? recovery.personal[id] : recovery.duration;
  const duration = Math.max(recovery.duration, Math.min(captured, recovery.duration + p.delay));
  const remaining = Math.max(0, recovery.startedAt + duration - elapsed);
  return {
    style: p.style,
    strength: p.strength,
    teamDuration: recovery.duration,
    duration,
    remaining,
    holding: duration > recovery.duration && remaining > 1e-9,
    reason: p.reason,
  };
}

const available = (p: GrifballTacticalPlayer) =>
  !!p.space && (p.height ?? 0) <= 0.01 && p.space.mobileIn <= 0 && p.space.phase !== 'lunging';

/** Observe edges every frame, before tactical throttling. A lingering knockback
 * cannot restart the timer; a later, newly observed disruption can. */
export function observeGrifballTipoffRecovery(
  memory: TipoffMemory,
  snapshot: GrifballTacticalSnapshot,
  previous: GrifballTacticalSnapshot | null,
  assignments: Map<string, GrifballAssignment>,
  config: GrifballTacticsConfig,
): void {
  for (const team of ['blue', 'red']) {
    const tuning = resolveTeamTactics(config, team);
    if (
      !snapshot.playing ||
      !previous?.playing ||
      previous.round !== snapshot.round ||
      !memory.started ||
      memory.closed ||
      memory.elapsed > tuning.tipoffSeconds ||
      !snapshot.geometry ||
      !snapshot.goals[team] ||
      !tuning.enabled ||
      !tuning.spaceEnabled ||
      !tuning.tipoffEnabled ||
      tuning.tipoffRegroupSeconds <= 0
    ) {
      if (memory.recovery) delete memory.recovery[team];
      continue;
    }
    const oldOrder = [...assignments.values()].find((a) => a.team === team && a.tipoff)?.tipoff;
    const current = new Map(snapshot.players.filter((p) => p.team === team).map((p) => [p.id, p]));
    const lost: string[] = [],
      disrupted: string[] = [];
    // Orders prove that this team was actually coordinating the previous frame.
    // Enabling the control does not replay old casualties or initial spawn gaps.
    const oldTuning = previous.tactics && resolveTeamTactics(previous.tactics, team);
    if (
      oldOrder &&
      oldTuning?.tipoffEnabled &&
      oldTuning.enabled &&
      oldTuning.spaceEnabled &&
      oldTuning.tipoffRegroupSeconds > 0
    ) {
      for (const p of previous.players.filter((p) => p.team === team)) {
        const now = current.get(p.id);
        if (!now) lost.push(p.id);
        else if ((p.id === oldOrder.collectorId || p.id === oldOrder.reserveId) && available(p) && !available(now))
          disrupted.push(p.id);
      }
    }
    if (lost.length || disrupted.length) {
      memory.recovery ??= {};
      memory.recovery[team] = {
        startedAt: memory.elapsed,
        duration: tuning.tipoffRegroupSeconds,
        affectedIds: [...lost, ...disrupted].sort(),
        reason: [
          lost.length ? `Opening teammate unavailable: ${lost.sort().join(', ')}.` : '',
          disrupted.length ? `Collector or reserve displaced: ${disrupted.sort().join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      };
      const personal = Object.fromEntries(
        [...current.values()]
          .filter((p) => p.scripted)
          .map((p) => {
            const extra = preference(tuning, snapshot.tactics?.botStyles, p.id).delay;
            return [p.id, extra > 0 ? tuning.tipoffRegroupSeconds + extra : 0] as const;
          })
          .filter(([, duration]) => duration > 0),
      );
      if (Object.keys(personal).length) memory.recovery[team].personal = personal;
    }
    const recovery = memory.recovery?.[team];
    if (recovery) {
      // Reducing the control takes effect immediately. Increasing it never
      // extends an existing recovery, even after a serialized continuation.
      recovery.duration = Math.min(recovery.duration, tuning.tipoffRegroupSeconds);
      for (const [id, duration] of Object.entries(recovery.personal ?? {})) {
        const extra = preference(tuning, snapshot.tactics?.botStyles, id).delay;
        const capped = Math.min(duration, recovery.duration + extra);
        if (!current.get(id)?.scripted || extra <= 0 || memory.elapsed + 1e-9 >= recovery.startedAt + capped)
          delete recovery.personal![id];
        else recovery.personal![id] = capped;
      }
      if (recovery.personal && !Object.keys(recovery.personal).length) delete recovery.personal;
      if (!recovery.personal && memory.elapsed + 1e-9 >= recovery.startedAt + recovery.duration)
        delete memory.recovery![team];
    }
  }
  if (memory.recovery && !Object.keys(memory.recovery).length) delete memory.recovery;
}
