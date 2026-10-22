import type { GrifballTacticalPlayer } from './aiGrifballTeamPlan';

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
}

/** Candidates are already ordered by incumbent, route arrival and stable ID.
 * Collector/reserve allocation and team containment remain the caller's gates. */
export function chooseTipoffScreen(
  candidates: { player: GrifballTacticalPlayer; reachable: boolean; holding: boolean }[],
  previousId: string | null,
  permitted: boolean,
): TipoffScreenDecision {
  const incumbent = candidates.find((c) => c.player.id === previousId);
  let selectedId: string | null = null;
  let reason: string;
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
    const selected = candidates.find((c) => !c.holding && c.reachable && tipoffScreenReadiness(c.player) === 'ready');
    selectedId = selected?.player.id ?? null;
    reason = !selected
      ? 'No ready support can reach the opening; hold separate coverage.'
      : selectedId === previousId
        ? 'Keep the ready screen; a recovered teammate does not take the role back.'
        : previousId
          ? 'Hand the screen role to a ready support; the previous screen returns to coverage.'
          : 'Assign one ready support to screen the opening.';
  }
  return { previousId, selectedId, reason };
}
