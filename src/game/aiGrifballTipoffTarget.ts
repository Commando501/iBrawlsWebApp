import {
  GRIFBALL_TIPOFF_TARGET_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

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
}

/** Rank only safe challenges. Preferences cannot purchase a timing or spacing
 * exception, and a remote target cannot win on style alone. */
export function chooseTipoffTarget(
  candidates: TipoffTargetCandidate[],
  strength: number,
  styles: Readonly<Record<string, GrifballPlayerStyle>> | undefined,
  botId: string,
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
  const selected = bids
    .filter((c) => c.withinWindow)
    .sort((a, b) => a.score - b.score || a.eta - b.eta || a.targetId.localeCompare(b.targetId))[0];
  return {
    style,
    strength,
    baselineId: ordered[0]?.targetId ?? null,
    teamId: team?.targetId ?? null,
    selectedId: selected?.targetId ?? null,
    changedChoice: selected?.targetId !== ordered[0]?.targetId,
    changedByStyle: selected?.targetId !== team?.targetId,
    reason: selected
      ? GRIFBALL_TIPOFF_TARGET_PREFERENCES[style].reason
      : 'No safe opening challenge; keep the separate screen lane.',
    candidates: bids,
  };
}
