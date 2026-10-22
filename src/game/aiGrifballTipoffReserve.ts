import type { FieldPoint, GrifballTacticalPlayer } from './aiGrifballTeamPlan';
import { tipoffScreenReadiness } from './aiGrifballTipoffScreen';

export interface TipoffReserveCandidate {
  botId: string;
  arrival: number;
  covered: boolean;
  rejection: string | null;
}

export interface TipoffReserveDecision {
  previousId: string | null;
  selectedId: string | null;
  point: FieldPoint;
  halfWidth: number;
  covered: boolean;
  reason: string;
  candidates: TipoffReserveCandidate[];
}

/** Coverage needs a ready defender in the rear lane, not just a role reservation.
 * Deeper positions count; the one-metre depth allowance avoids arrival jitter. */
export function isTipoffReserveCovering(
  player: GrifballTacticalPlayer,
  ball: FieldPoint,
  point: FieldPoint,
  halfWidth: number,
): boolean {
  if (tipoffScreenReadiness(player) !== 'ready') return false;
  const dx = point.x - ball.x,
    dz = point.z - ball.z,
    depth = Math.hypot(dx, dz);
  if (depth <= 0.001) return false;
  const x = player.pos.x - ball.x,
    z = player.pos.z - ball.z;
  return (x * dx + z * dz) / depth >= depth - 1 - 1e-9 && Math.abs(x * dz - z * dx) / depth <= halfWidth + 1e-9;
}

/** Keep an eligible reserve through small position changes and returning teammates.
 * On a vacancy, prefer established cover, then the earliest routed replacement. */
export function chooseTipoffReserve(
  candidates: TipoffReserveCandidate[],
  previousId: string | null,
  point: FieldPoint,
  halfWidth: number,
): TipoffReserveDecision {
  const ordered = [...candidates].sort((a, b) => a.botId.localeCompare(b.botId));
  const eligible = ordered.filter((c) => !c.rejection && Number.isFinite(c.arrival));
  const selected =
    eligible.find((c) => c.botId === previousId) ??
    [...eligible].sort(
      (a, b) => Number(b.covered) - Number(a.covered) || a.arrival - b.arrival || a.botId.localeCompare(b.botId),
    )[0];
  const reason = !selected
    ? 'No ready reserve can cover the rear lane; contain without a planned screen challenge.'
    : !selected.covered
      ? 'The reserve is moving into rear coverage; hold planned screen challenges until it arrives.'
      : selected.botId === previousId
        ? 'Keep the ready rear reserve; a returning teammate does not reclaim the job.'
        : previousId
          ? 'Hand rear coverage to a ready teammate; the previous reserve returns to support.'
          : 'Assign one ready teammate to the rear coverage lane.';
  return {
    previousId,
    selectedId: selected?.botId ?? null,
    point: { ...point },
    halfWidth,
    covered: selected?.covered ?? false,
    reason,
    candidates: ordered,
  };
}
