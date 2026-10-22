export interface TipoffCollectorCandidate {
  botId: string;
  arrival: number;
  rejection: string | null;
}

export interface TipoffCollectorDecision {
  baselineId: string;
  previousId: string | null;
  selectedId: string | null;
  advantage: number;
  changed: boolean;
  reason: string;
  candidates: TipoffCollectorCandidate[];
}

/** One ready collector owns the opening. Small arrival changes must not keep
 * swapping its job with a supporting teammate. Eligibility belongs to the caller. */
export function chooseTipoffCollector(
  candidates: TipoffCollectorCandidate[],
  baselineId: string,
  previousId: string | null,
  advantage: number,
): TipoffCollectorDecision {
  const ordered = [...candidates].sort((a, b) => a.botId.localeCompare(b.botId));
  const eligible = ordered.filter((c) => !c.rejection && Number.isFinite(c.arrival));
  const fastest = [...eligible].sort((a, b) => a.arrival - b.arrival || a.botId.localeCompare(b.botId))[0];
  const incumbent = eligible.find((c) => c.botId === previousId);
  let selected = fastest;
  let reason = 'Choose the earliest ready collector; teammates keep separate coverage.';
  if (!fastest) reason = 'No ready collector is available; hold the opening lanes without a pickup order.';
  else if (incumbent && incumbent.arrival <= fastest.arrival + advantage + 1e-9) {
    selected = incumbent;
    reason = 'Keep the ready collector; no teammate beats the handoff margin.';
  } else if (incumbent) reason = 'Hand collection to a ready teammate with a meaningfully earlier arrival.';
  else if (previousId) reason = 'The previous collector is unavailable; hand collection to a ready teammate.';
  return {
    baselineId,
    previousId,
    selectedId: selected?.botId ?? null,
    advantage,
    changed: !!previousId && selected?.botId !== previousId,
    reason,
    candidates: ordered,
  };
}
