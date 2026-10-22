import type { GrifballTacticalPlayer } from './aiGrifballTeamPlan';
import {
  GRIFBALL_TIPOFF_SCREEN_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

const striking = new Set([
  'swing_up',
  'swing_down',
  'slashing',
  'melee_up',
  'melee_down',
  'melee_swing',
  'lunging',
  'windup',
  'active',
]);

/** Visible commitments must finish before a replacement is sent into the clash. */
export function tipoffScreenReadiness(player: GrifballTacticalPlayer): 'committed' | 'ready' | 'unavailable' {
  if (striking.has(player.space?.phase ?? '')) return 'committed';
  return player.space?.phase === 'ready' && (player.height ?? 0) <= 0.01 && player.space.mobileIn <= 0
    ? 'ready'
    : 'unavailable';
}

export interface TipoffScreenDecision {
  previousId: string | null;
  selectedId: string | null;
  reason: string;
  agency?: {
    strength: number;
    baselineId: string | null;
    changedChoice: boolean;
    bids: {
      botId: string;
      style: GrifballPlayerStyle;
      arrival: number;
      adjustment: number;
      score: number;
      withinWindow: boolean;
      recoveryOpening: boolean;
    }[];
  };
}

/** Candidates are already ordered by incumbent, route arrival and stable ID.
 * Collector/reserve allocation and team containment remain the caller's gates. */
export function chooseTipoffScreen(
  candidates: {
    player: GrifballTacticalPlayer;
    reachable: boolean;
    holding: boolean;
    arrival?: number;
    recoveryOpening?: boolean;
  }[],
  previousId: string | null,
  permitted: boolean,
  preferences?: { strength: number; styles: Readonly<Record<string, GrifballPlayerStyle>> },
): TipoffScreenDecision {
  const incumbent = candidates.find((c) => c.player.id === previousId);
  let selectedId: string | null = null;
  let reason: string;
  const agency: TipoffScreenDecision['agency'] =
    preferences && preferences.strength > 0
      ? { strength: preferences.strength, baselineId: null, changedChoice: false, bids: [] }
      : undefined;
  if (!permitted) {
    reason = 'Team coverage or regrouping prevents a screen assignment.';
  } else if (incumbent && tipoffScreenReadiness(incumbent.player) === 'committed') {
    selectedId = incumbent.holding ? null : incumbent.player.id;
    reason = 'Let the current screen finish its visible attack before sending a replacement.';
  } else if (candidates.some((c) => tipoffScreenReadiness(c.player) === 'committed')) {
    // A regroup/personal wait may have cleared the old screen assignment while
    // its physical action continues. Losing that role must not erase the strike.
    reason = 'Let the visible support attack finish before assigning a new screen.';
  } else {
    const eligible = candidates.filter((c) => !c.holding && c.reachable && tipoffScreenReadiness(c.player) === 'ready');
    let selected = eligible[0];
    // The incumbent owns the role while eligible. Styles only bid at a vacancy,
    // among supports no more than 0.35 seconds behind the fastest arrival.
    if (agency && selected && selected.player.id !== previousId) {
      agency.baselineId = selected.player.id;
      const fastest = Math.min(...eligible.map((c) => c.arrival ?? Infinity));
      agency.bids = eligible.map((c) => {
        const style = resolveGrifballPlayerStyle(preferences!.styles, c.player.id);
        const arrival = c.arrival ?? Infinity;
        const recoveryOpening = !!c.recoveryOpening;
        const adjustment =
          agency.strength *
          (style === 'opportunist' && !recoveryOpening ? 0 : GRIFBALL_TIPOFF_SCREEN_PREFERENCES[style].bias);
        return {
          botId: c.player.id,
          style,
          arrival,
          adjustment,
          score: arrival + adjustment,
          withinWindow: Number.isFinite(arrival) && arrival <= fastest + 0.35 + 1e-9,
          recoveryOpening,
        };
      });
      const winner = agency.bids
        .filter((b) => b.withinWindow)
        .sort((a, b) => a.score - b.score || a.arrival - b.arrival || a.botId.localeCompare(b.botId))[0];
      if (winner) selected = eligible.find((c) => c.player.id === winner.botId)!;
      agency.changedChoice = selected.player.id !== agency.baselineId;
    }
    selectedId = selected?.player.id ?? null;
    reason = !selected
      ? 'No ready support can reach the opening; hold separate coverage.'
      : selectedId === previousId
        ? 'Keep the ready screen; a recovered teammate does not take the role back.'
        : previousId
          ? 'Hand the screen role to a ready support; the previous screen returns to coverage.'
          : 'Assign one ready support to screen the opening.';
    if (agency?.changedChoice)
      reason =
        'A nearby ready support volunteers based on its Grifball style; combat permission is checked separately.';
  }
  return { previousId, selectedId, reason, ...(agency ? { agency } : {}) };
}
