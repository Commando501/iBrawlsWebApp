import {
  denormalizeCentroid,
  kmeans,
  normalizeFeatures,
  type FingerprintFeature,
  type Row,
} from './stats';

/**
 * Phase 4: turn clustered player fingerprints into candidate AI archetypes.
 *
 * Output is structurally compatible with `AIPersonalityDef` in
 * `src/game/aiPersonalities.ts` (knobOverrides + flags) so a reviewed candidate can
 * be pasted straight into `AI_ARCHETYPES`. The feature→knob mapping below is a
 * documented STARTING heuristic, not ground truth — always review before shipping,
 * and follow the Custom AI Behavior exposure convention (panel + presets +
 * RosterSlotConfig + archetype fill) when adding a new archetype.
 */

export interface CandidateArchetypeKnobs {
  aiReactionLatency: number;
  aiAnticipationFactor: number;
  aiMovementComplexity: number;
  aiWeaponSwapIQ: number;
  aiPlaystyle: number;
  aiWeaponPrioritization: number;
}

export interface CandidateArchetypeFlags {
  skipPressure: boolean;
  feintBias: number;
  spacingBand: number;
}

export interface CandidateArchetype {
  id: string;
  label: string;
  description: string;
  knobOverrides: CandidateArchetypeKnobs;
  flags: CandidateArchetypeFlags;
  /** Fraction of the analyzed population in this cluster. */
  share: number;
  matches: number;
  centroid: Record<FingerprintFeature, number>;
}

const clampPercent = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Map one fingerprint centroid to archetype knobs + flags (documented heuristic). */
export function centroidToArchetype(
  fp: Record<FingerprintFeature, number>,
): { knobOverrides: CandidateArchetypeKnobs; flags: CandidateArchetypeFlags } {
  const dodgeMagnitude = Math.hypot(fp.dodgeBiasX, fp.dodgeBiasZ);
  // Mixup-ness peaks when weapon choice is balanced (lungeFrequency ~0.5).
  const mixupness = 0.5 - Math.abs(fp.lungeFrequency - 0.5);

  const aiPlaystyle = clampPercent((fp.approachSpeed * 0.6 + (1 - fp.edgeProximity) * 0.4) * 100);

  const knobOverrides: CandidateArchetypeKnobs = {
    // Sword-lunge-heavy players → sword-leaning AI (0 = hammer, 100 = sword).
    aiWeaponPrioritization: clampPercent(fp.lungeFrequency * 100),
    aiPlaystyle,
    // Mirror the observed human reaction time directly.
    aiReactionLatency: round2(clamp(fp.reactionTime, 0.05, 1.2)),
    // Strong counter-game → higher decision IQ and anticipation.
    aiWeaponSwapIQ: clampPercent(40 + fp.counterRate * 120),
    aiAnticipationFactor: round2(clamp(0.25 + fp.counterRate, 0, 1)),
    // Evasive, off-edge movers → more movement complexity.
    aiMovementComplexity: clampPercent(35 + dodgeMagnitude * 50 + (1 - fp.edgeProximity) * 15),
  };

  const flags: CandidateArchetypeFlags = {
    skipPressure: aiPlaystyle < 45,
    feintBias: round2(clamp(0.8 + mixupness * 1.4, 0.5, 1.6)),
    // Longer observed lunge distance → wider preferred standoff.
    spacingBand: round2(clamp(0.8 + ((fp.avgLungeDistance - 4) / 10) * 0.6, 0.8, 1.4)),
  };

  return { knobOverrides, flags };
}

/** Cluster fingerprints and emit candidate archetypes sorted by population share. */
export function buildCandidateArchetypes(rows: Row[], k = 4): CandidateArchetype[] {
  if (rows.length === 0) return [];
  const { points, means, stds } = normalizeFeatures(rows);
  const { centroids, sizes } = kmeans(points, k);

  return centroids
    .map((centroid, i) => {
      const fp = denormalizeCentroid(centroid, means, stds);
      const { knobOverrides, flags } = centroidToArchetype(fp);
      const matches = sizes[i] ?? 0;
      return {
        id: `discovered_${i + 1}`,
        label: `Discovered ${i + 1}`,
        description:
          `Auto-generated from a cluster of ${matches} real players ` +
          `(lungeFreq ${round2(fp.lungeFrequency)}, counterRate ${round2(fp.counterRate)}, ` +
          `approach ${round2(fp.approachSpeed)}). Review before shipping.`,
        knobOverrides,
        flags,
        matches,
        share: rows.length > 0 ? matches / rows.length : 0,
        centroid: Object.fromEntries(
          Object.entries(fp).map(([key, value]) => [key, round2(value)]),
        ) as Record<FingerprintFeature, number>,
      };
    })
    .sort((a, b) => b.matches - a.matches);
}
