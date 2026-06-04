import type { ImbalanceFlag } from './stats';

/**
 * Phase 3: translate imbalance flags into conservative, human-readable tuning
 * suggestions. These are advisory only — a person reviews them and publishes the
 * actual change via the existing `/api/admin/config` live-config pipeline. We never
 * auto-publish from analysis.
 */

export interface TuningSuggestion {
  dimension: string;
  value: string;
  matches: number;
  winRate: number;
  verdict: 'ai-too-weak' | 'ai-too-strong';
  rationale: string;
}

export function suggestTuning(flags: ImbalanceFlag[]): TuningSuggestion[] {
  return flags
    .filter((f) => f.verdict === 'ai-too-weak' || f.verdict === 'ai-too-strong')
    .map((f) => {
      const pct = (f.winRate * 100).toFixed(0);
      const verdict = f.verdict as 'ai-too-weak' | 'ai-too-strong';
      const rationale =
        verdict === 'ai-too-weak'
          ? `Players win ${pct}% vs "${f.value}" — AI is too weak. Consider raising skill: ` +
            `+aiWeaponSwapIQ, +aiAnticipationFactor, -aiReactionLatency.`
          : `Players win only ${pct}% vs "${f.value}" — AI is too strong. Consider easing: ` +
            `-aiWeaponSwapIQ, -aiAnticipationFactor, +aiReactionLatency.`;
      return {
        dimension: f.dimension,
        value: f.value,
        matches: f.matches,
        winRate: f.winRate,
        verdict,
        rationale,
      };
    });
}
