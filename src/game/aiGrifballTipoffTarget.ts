import {
  GRIFBALL_TIPOFF_COMMITMENT_PREFERENCES,
  GRIFBALL_TIPOFF_TARGET_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffCommitmentAgencyDecision {
  style: GrifballPlayerStyle;
  strength: number;
  teamSeconds: number;
  adjustment: number;
  seconds: number;
  reason: string;
}

/** Share this duration with the planner's expiry interrupt. Live increases may
 * change the preference, but cannot extend an already captured deadline. */
export function resolveTipoffTargetCommitAgency(
  teamSeconds: number,
  strength: number,
  style: GrifballPlayerStyle,
): TipoffCommitmentAgencyDecision | undefined {
  if (!Number.isFinite(teamSeconds) || teamSeconds <= 0 || !Number.isFinite(strength) || strength <= 0)
    return undefined;
  teamSeconds = Math.min(1.5, teamSeconds);
  strength = Math.min(1, strength);
  const preference = GRIFBALL_TIPOFF_COMMITMENT_PREFERENCES[style];
  const seconds = Math.max(0, Math.min(1.5, teamSeconds + preference.adjustment * strength));
  return { style, strength, teamSeconds, adjustment: seconds - teamSeconds, seconds, reason: preference.reason };
}

export interface TipoffTargetCandidate {
  targetId: string;
  eta: number;
  response: number;
  rejection: string | null;
  contestsBall: boolean;
  threatensCollector: boolean;
  recovering: boolean;
}
export interface TipoffTargetDecision {
  style: GrifballPlayerStyle;
  strength: number;
  baselineId: string | null;
  teamId: string | null;
  selectedId: string | null;
  changedChoice: boolean;
  changedByStyle: boolean;
  reason: string;
  candidates: (TipoffTargetCandidate & { adjustment: number; score: number; withinWindow: boolean })[];
  commitment?: {
    previousId: string | null;
    preferredId: string | null;
    startedAt: number;
    deadline: number;
    remaining: number;
    retained: boolean;
    reason: string;
    agency?: TipoffCommitmentAgencyDecision;
  };
}

/** Rank only safe challenges. Preferences cannot purchase a timing or spacing
 * exception, and a remote target cannot win on style alone. */
export function chooseTipoffTarget(
  candidates: TipoffTargetCandidate[],
  strength: number,
  styles: Readonly<Record<string, GrifballPlayerStyle>> | undefined,
  botId: string,
  continuity?: { elapsed: number; seconds: number; agencyStrength?: number; previous?: TipoffTargetDecision },
): TipoffTargetDecision {
  strength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  const style = resolveGrifballPlayerStyle(styles, botId);
  const ordered = [...candidates].sort((a, b) => a.eta - b.eta || a.targetId.localeCompare(b.targetId));
  const team = ordered.find((c) => !c.rejection && Number.isFinite(c.eta));
  const bids = ordered.map((c) => {
    const preferred =
      style === 'enforcer'
        ? c.contestsBall
        : style === 'guardian'
          ? c.threatensCollector
          : style === 'opportunist'
            ? c.recovering
            : false;
    const adjustment = preferred && !c.rejection ? -0.25 * strength : 0;
    return {
      ...c,
      adjustment,
      score: c.eta + adjustment,
      withinWindow: !!team && !c.rejection && Number.isFinite(c.eta) && c.eta <= team.eta + 0.35,
    };
  });
  const preferred = bids
    .filter((c) => c.withinWindow)
    .sort((a, b) => a.score - b.score || a.eta - b.eta || a.targetId.localeCompare(b.targetId))[0];
  let selected = preferred;
  let commitment: TipoffTargetDecision['commitment'];
  if (strength > 0 && continuity && Number.isFinite(continuity.seconds) && continuity.seconds > 0) {
    const agency = resolveTipoffTargetCommitAgency(continuity.seconds, continuity.agencyStrength ?? 0, style);
    const seconds = agency?.seconds ?? Math.min(1.5, continuity.seconds);
    const elapsed = Math.max(0, continuity.elapsed);
    const previous = continuity.previous;
    const old = previous?.commitment;
    const valid =
      old &&
      Number.isFinite(old.startedAt) &&
      Number.isFinite(old.deadline) &&
      old.startedAt >= 0 &&
      old.startedAt <= elapsed &&
      old.deadline >= old.startedAt;
    const deadline = valid ? Math.min(old.deadline, old.startedAt + seconds) : elapsed;
    const incumbent = bids.find((c) => c.targetId === previous?.selectedId);
    let reason = 'Start a bounded commitment to this safe target.';
    let released = !!valid;
    if (valid) {
      if (previous!.style !== style || previous!.strength !== strength)
        reason = 'Player preference changed; reevaluate the target.';
      else if (!incumbent || incumbent.rejection)
        reason = 'Previous target is unavailable or unsafe; release the commitment.';
      else if (!incumbent.withinWindow)
        reason = 'Previous target left the near-arrival window; release the commitment.';
      else if (
        style === 'opportunist' &&
        previous!.candidates.find((c) => c.targetId === incumbent.targetId)?.recovering &&
        !incumbent.recovering
      )
        reason = 'The observed recovery opening ended; reevaluate the target.';
      else if (preferred && incumbent.score - preferred.score > 0.2 + 1e-9)
        reason = 'Another safe target is more than 0.20 s better; release the commitment.';
      else if (elapsed + 1e-9 >= deadline) reason = 'Commitment expired; choose freely until the target changes.';
      else {
        released = false;
        selected = incumbent;
        reason =
          incumbent.targetId === preferred?.targetId
            ? 'Continue the safe target without extending its commitment.'
            : 'Keep the safe target through a small change in candidate scores.';
      }
    }
    // Staying on the same opponent never rearms an expired clock. Shorter live
    // settings may shorten it; increasing the duration cannot extend it.
    const same = valid && selected && selected.targetId === previous?.selectedId;
    const startedAt = same ? old.startedAt : elapsed;
    let until = selected ? elapsed + seconds : elapsed;
    if (same) until = released ? Math.min(deadline, elapsed) : deadline;
    commitment = {
      previousId: previous?.selectedId ?? null,
      preferredId: preferred?.targetId ?? null,
      startedAt,
      deadline: until,
      remaining: Math.max(0, until - elapsed),
      retained: selected?.targetId !== preferred?.targetId,
      reason: selected ? reason : 'No safe target remains; release the commitment and hold the lane.',
      ...(agency ? { agency } : {}),
    };
  }
  return {
    style,
    strength,
    baselineId: ordered[0]?.targetId ?? null,
    teamId: team?.targetId ?? null,
    selectedId: selected?.targetId ?? null,
    changedChoice: selected?.targetId !== ordered[0]?.targetId,
    changedByStyle: selected?.targetId === preferred?.targetId && selected?.targetId !== team?.targetId,
    reason: commitment?.retained
      ? commitment.reason
      : selected
        ? GRIFBALL_TIPOFF_TARGET_PREFERENCES[style].reason
        : 'No safe opening challenge; keep the separate screen lane.',
    candidates: bids,
    ...(commitment ? { commitment } : {}),
  };
}
