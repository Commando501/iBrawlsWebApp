import type { FieldPoint, GrifballAssignment, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { TeamTactics } from './grifballTacticsConfig';
import type { SpaceRouters } from './aiGrifballRunner';
import { assessGrifballSupportPosition, supportRouteClearance } from './aiGrifballSupportPosition';

export interface TipoffLaneOption {
  lane: number;
  point: FieldPoint;
  arrival: number;
  rejection: string | null;
}
export interface TipoffLaneCandidate {
  botId: string;
  baselineLane: number;
  previousLane: number | null;
  options: TipoffLaneOption[];
}
export interface TipoffLaneDecision {
  previousLane: number | null;
  baselineLane: number;
  selectedLane: number;
  retained: boolean;
  changed: boolean;
  reason: string;
  previousRejection: string | null;
  point: FieldPoint;
  arrival: number;
}

/** Retain valid reservations first, then give replacements unused lanes. Commit
 * the complete allocation together so a partial failure cannot double-book one. */
export function chooseTipoffLanes(candidates: TipoffLaneCandidate[]): Map<string, TipoffLaneDecision> {
  const ordered = [...candidates].sort((a, b) => a.botId.localeCompare(b.botId));
  const selected = new Map<string, TipoffLaneOption>(),
    used = new Set<number>();
  const initial = ordered.every((c) => c.previousLane === null);
  if (initial)
    for (const c of ordered) {
      const option = c.options.find((o) => o.lane === c.baselineLane)!;
      selected.set(c.botId, option);
      used.add(option.lane);
    }
  const eligible = (o: TipoffLaneOption) => !o.rejection && Number.isFinite(o.arrival);
  for (const c of ordered) {
    const old = c.options.find((o) => o.lane === c.previousLane);
    if (old && eligible(old) && !used.has(old.lane)) {
      selected.set(c.botId, old);
      used.add(old.lane);
    }
  }
  // More constrained replacements choose first; route arrival and stable IDs
  // resolve ties without depending on roster/map iteration order.
  const pending = ordered
    .filter((c) => !selected.has(c.botId))
    .sort(
      (a, b) =>
        a.options.filter((o) => eligible(o) && !used.has(o.lane)).length -
          b.options.filter((o) => eligible(o) && !used.has(o.lane)).length || a.botId.localeCompare(b.botId),
    );
  for (const c of pending) {
    const option = c.options
      .filter((o) => eligible(o) && !used.has(o.lane))
      .sort(
        (a, b) =>
          a.arrival - b.arrival ||
          Number(b.lane === c.baselineLane) - Number(a.lane === c.baselineLane) ||
          a.lane - b.lane,
      )[0];
    if (!option) break;
    selected.set(c.botId, option);
    used.add(option.lane);
  }
  const complete = selected.size === ordered.length;
  return new Map(
    ordered.map((c) => {
      const option = complete ? selected.get(c.botId)! : c.options.find((o) => o.lane === c.baselineLane)!;
      const old = c.options.find((o) => o.lane === c.previousLane);
      const retained = complete && option.lane === c.previousLane;
      const previousRejection =
        c.previousLane === null
          ? null
          : !old
            ? 'Previous lane is outside the current formation.'
            : (old.rejection ??
              (!Number.isFinite(old.arrival)
                ? 'Previous lane is unreachable.'
                : option.lane !== c.previousLane
                  ? 'Previous lane could not be reserved in a complete allocation.'
                  : null));
      return [
        c.botId,
        {
          previousLane: c.previousLane,
          baselineLane: c.baselineLane,
          selectedLane: option.lane,
          retained,
          changed: option.lane !== c.baselineLane,
          reason: initial
            ? 'Start with the ordinary lateral formation.'
            : !complete
              ? 'No complete safe lane allocation; keep the ordinary team formation.'
              : retained
                ? 'Keep the existing lateral lane through the role handoff.'
                : 'Take a reachable unoccupied lateral lane.',
          previousRejection,
          point: { ...option.point },
          arrival: option.arrival,
        },
      ];
    }),
  );
}

/** Run before screen challenges are scored so combat sees the selected lanes.
 * Depth still belongs to the current role and regroup/containment policy. */
export function planTipoffLanes(input: {
  snapshot: GrifballTacticalSnapshot;
  remaining: GrifballAssignment[];
  slots: Map<GrifballAssignment, FieldPoint>;
  previous: Map<string, GrifballAssignment>;
  tuning: TeamTactics;
  routers: SpaceRouters;
  collectorId: string;
  spacing: number;
  firstSide: number;
  point: (depth: number, side: number) => FieldPoint;
  depth: (a: GrifballAssignment) => number;
}): Map<string, TipoffLaneDecision> {
  const { snapshot, remaining, slots, previous, tuning, routers, collectorId, spacing, firstSide, point, depth } =
    input;
  const collector = snapshot.players.find((p) => p.id === collectorId);
  const route = collector && routers.get(collector.id)?.(snapshot.ball);
  const path = collector && route && route.status !== 'blocked' ? [collector.pos, ...route.points] : undefined;
  const lanes = Array.from({ length: Math.ceil(remaining.length / 2) }, (_, i) => [i + 1, -i - 1]).flat();
  const fixed = [...slots].filter(([a]) => !remaining.includes(a)).map(([, p]) => p);
  const decisions = chooseTipoffLanes(
    remaining.map((a, i) => {
      const baselineLane = firstSide * (i % 2 ? -1 : 1) * (1 + Math.floor(i / 2));
      const old = previous.get(a.botId);
      const previousLane =
        old?.team === a.team && old.tipoff && ['screen', 'support'].includes(old.tipoff.job)
          ? (old.tipoff.laneSelection?.selectedLane ?? null)
          : null;
      const teamPoint = slots.get(a)!;
      return {
        botId: a.botId,
        baselineLane,
        previousLane,
        options: lanes.map((lane) => {
          const candidate = point(depth(a), lane * spacing);
          const assessment = assessGrifballSupportPosition({
            snapshot,
            botId: a.botId,
            tuning: { ...tuning, separation: spacing },
            routers,
            teamPoint,
            preferredPoint: candidate,
            reserved: [...fixed, ...snapshot.players.filter((p) => p.team === a.team && !p.scripted).map((p) => p.pos)],
          });
          const rejection = !path
            ? 'No reachable collector route.'
            : supportRouteClearance(candidate, path) + 1e-9 < Math.min(spacing, supportRouteClearance(teamPoint, path))
              ? 'The lane crowds the collector route.'
              : (assessment.rejection ?? null);
          return { lane, point: candidate, arrival: assessment.preferredArrival, rejection };
        }),
      };
    }),
  );
  for (const a of remaining) slots.set(a, { ...decisions.get(a.botId)!.point });
  return decisions;
}
