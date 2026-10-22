import type { GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TipoffMemory } from './aiGrifballTipoff';
import { resolveTeamTactics, type GrifballTacticsConfig } from './grifballTacticsConfig';

export interface TipoffRecovery {
  startedAt: number;
  duration: number;
  affectedIds: string[];
  reason: string;
}
export interface TipoffRecoveryDecision extends TipoffRecovery {
  remaining: number;
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
    }
    const recovery = memory.recovery?.[team];
    if (recovery) {
      // Reducing the control takes effect immediately. Increasing it never
      // extends an existing recovery, even after a serialized continuation.
      recovery.duration = Math.min(recovery.duration, tuning.tipoffRegroupSeconds);
      if (memory.elapsed + 1e-9 >= recovery.startedAt + recovery.duration) delete memory.recovery![team];
    }
  }
  if (memory.recovery && !Object.keys(memory.recovery).length) delete memory.recovery;
}
