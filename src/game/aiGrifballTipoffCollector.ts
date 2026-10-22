import {
  GRIFBALL_TIPOFF_COLLECTOR_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffCollectorCandidate {
  botId: string;
  arrival: number;
  rejection: string | null;
  /** Actual routed arrival plus this bot's pickup margin beats the enemy attack. */
  pickupSafe?: boolean;
}

export interface TipoffCollectorDecision {
  baselineId: string;
  previousId: string | null;
  selectedId: string | null;
  advantage: number;
  changed: boolean;
  reason: string;
  candidates: TipoffCollectorCandidate[];
  agency?: {
    strength: number;
    baselineId: string | null;
    changedChoice: boolean;
    bids: {
      botId: string;
      style: GrifballPlayerStyle;
      arrival: number;
      pickupSafe: boolean;
      adjustment: number;
      score: number;
      rejection: string | null;
    }[];
  };
}

/** One ready collector owns the opening. Small arrival changes must not keep
 * swapping its job with a supporting teammate. Eligibility belongs to the caller. */
export function chooseTipoffCollector(
  candidates: TipoffCollectorCandidate[],
  baselineId: string,
  previousId: string | null,
  advantage: number,
  preferences?: { strength: number; styles: Readonly<Record<string, GrifballPlayerStyle>> },
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
  const agency: TipoffCollectorDecision['agency'] =
    preferences && preferences.strength > 0
      ? { strength: preferences.strength, baselineId: selected?.botId ?? null, changedChoice: false, bids: [] }
      : undefined;
  // Styles never create a handoff. Once one is warranted, each alternative must
  // independently beat the incumbent's real arrival margin and preserve any
  // safe pickup the fastest choice could take. Scores are preferences, not ETAs.
  if (agency && fastest && selected !== incumbent) {
    agency.bids = ordered.map((c) => {
      const style = resolveGrifballPlayerStyle(preferences!.styles, c.botId);
      const pickupSafe = c.pickupSafe === true;
      const adjustment =
        agency.strength *
        (style === 'opportunist' && !pickupSafe ? 0 : GRIFBALL_TIPOFF_COLLECTOR_PREFERENCES[style].bias);
      const rejection =
        c.rejection ??
        (!Number.isFinite(c.arrival)
          ? 'No finite arrival.'
          : c.arrival > fastest.arrival + 0.35 + 1e-9
            ? 'Outside the 0.35 s arrival window.'
            : incumbent && incumbent.arrival <= c.arrival + advantage + 1e-9
              ? 'Does not beat the handoff margin.'
              : fastest.pickupSafe && !pickupSafe
                ? 'Would give up an available safe pickup.'
                : null);
      return {
        botId: c.botId,
        style,
        arrival: c.arrival,
        pickupSafe,
        adjustment,
        score: c.arrival + adjustment,
        rejection,
      };
    });
    const winner = agency.bids
      .filter((c) => !c.rejection)
      .sort((a, b) => a.score - b.score || a.arrival - b.arrival || a.botId.localeCompare(b.botId))[0];
    if (winner) selected = eligible.find((c) => c.botId === winner.botId)!;
    agency.changedChoice = selected?.botId !== agency.baselineId;
    if (agency.changedChoice)
      reason =
        'A nearby ready teammate takes collection based on its Grifball style; handoff and pickup margins remain authoritative.';
  }
  return {
    baselineId,
    previousId,
    selectedId: selected?.botId ?? null,
    advantage,
    changed: !!previousId && selected?.botId !== previousId,
    reason,
    candidates: ordered,
    ...(agency ? { agency } : {}),
  };
}
