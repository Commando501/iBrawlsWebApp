/**
 * Pure statistics over match telemetry rows (no I/O — fully unit tested).
 *
 * Powers Phase 3 (population distributions, win-rate by difficulty/archetype, and
 * imbalance flags that feed live-config tuning) and Phase 4 (z-score normalization
 * + deterministic k-means for clustering playstyles into candidate archetypes).
 */

export type Row = Record<string, number | string>;

/** Behavior-fingerprint features used for playstyle clustering (excludes outcome
 *  and the `sampleCount` confidence counter). */
export const FINGERPRINT_FEATURES = [
  'avgLungeDistance',
  'lungeFrequency',
  'dodgeBiasX',
  'dodgeBiasZ',
  'counterRate',
  'approachSpeed',
  'edgeProximity',
  'reactionTime',
] as const;

export type FingerprintFeature = (typeof FINGERPRINT_FEATURES)[number];

export function num(row: Row, key: string): number {
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : 0;
}

export interface FeatureSummary {
  mean: number;
  std: number;
  min: number;
  max: number;
}

/** Per-feature mean/std/min/max — the population "shape" to make AI human-like. */
export function summarizeFeatures(rows: Row[]): Record<string, FeatureSummary> {
  const out: Record<string, FeatureSummary> = {};
  for (const feature of FINGERPRINT_FEATURES) {
    const values = rows.map((r) => num(r, feature));
    out[feature] = summarizeValues(values);
  }
  return out;
}

export function summarizeValues(values: number[]): FeatureSummary {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance), min, max };
}

export interface DimensionWinRate {
  value: string;
  matches: number;
  playerWins: number;
  winRate: number;
  avgScoreDiff: number;
}

export function isPlayerWin(row: Row): boolean {
  return num(row, 'scorePlayer') > num(row, 'scoreEnemy');
}

/** Group rows by a categorical column (e.g. `aiDifficulty`, `aiArchetype`) and
 *  compute the PLAYER win rate per group. A balanced AI sits near 0.5. */
export function winRateByDimension(rows: Row[], key: string): DimensionWinRate[] {
  const groups = new Map<string, { matches: number; wins: number; scoreDiff: number }>();
  for (const row of rows) {
    const value = String(row[key] ?? 'unknown');
    const g = groups.get(value) ?? { matches: 0, wins: 0, scoreDiff: 0 };
    g.matches += 1;
    if (isPlayerWin(row)) g.wins += 1;
    g.scoreDiff += num(row, 'scorePlayer') - num(row, 'scoreEnemy');
    groups.set(value, g);
  }
  return Array.from(groups.entries())
    .map(([value, g]) => ({
      value,
      matches: g.matches,
      playerWins: g.wins,
      winRate: g.matches > 0 ? g.wins / g.matches : 0,
      avgScoreDiff: g.matches > 0 ? g.scoreDiff / g.matches : 0,
    }))
    .sort((a, b) => b.matches - a.matches);
}

export type ImbalanceVerdict = 'ai-too-weak' | 'ai-too-strong' | 'balanced' | 'low-sample';

export interface ImbalanceFlag {
  dimension: string;
  value: string;
  matches: number;
  winRate: number;
  verdict: ImbalanceVerdict;
}

/**
 * Flag groups whose player win-rate falls outside the target band. A high player
 * win-rate means the AI is too weak for that cohort (and vice versa). Groups below
 * `minSample` are reported as low-sample (not yet actionable).
 */
export function flagImbalances(
  winRates: DimensionWinRate[],
  dimension: string,
  band: [number, number] = [0.45, 0.55],
  minSample = 30,
): ImbalanceFlag[] {
  const [low, high] = band;
  return winRates.map((w) => {
    let verdict: ImbalanceVerdict;
    if (w.matches < minSample) verdict = 'low-sample';
    else if (w.winRate > high) verdict = 'ai-too-weak';
    else if (w.winRate < low) verdict = 'ai-too-strong';
    else verdict = 'balanced';
    return {
      dimension,
      value: w.value,
      matches: w.matches,
      winRate: w.winRate,
      verdict,
    };
  });
}

// ── Clustering (Phase 4) ─────────────────────────────────────────────────────

export interface NormalizedPoints {
  points: number[][];
  means: number[];
  stds: number[];
}

/** Z-score normalize fingerprint features so no single feature dominates distance. */
export function normalizeFeatures(rows: Row[]): NormalizedPoints {
  const means: number[] = [];
  const stds: number[] = [];
  for (const feature of FINGERPRINT_FEATURES) {
    const s = summarizeValues(rows.map((r) => num(r, feature)));
    means.push(s.mean);
    stds.push(s.std || 1); // guard zero-variance features
  }
  const points = rows.map((r) =>
    FINGERPRINT_FEATURES.map((feature, i) => (num(r, feature) - means[i]) / stds[i]),
  );
  return { points, means, stds };
}

function distanceSq(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += (a[i] - b[i]) ** 2;
  return d;
}

/** Deterministic farthest-point seeding (k-means++ style without randomness). */
function seedCentroids(points: number[][], k: number): number[][] {
  const centroids: number[][] = [points[0].slice()];
  while (centroids.length < k) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < points.length; i += 1) {
      const nearest = Math.min(...centroids.map((c) => distanceSq(points[i], c)));
      if (nearest > bestDist) {
        bestDist = nearest;
        bestIdx = i;
      }
    }
    centroids.push(points[bestIdx].slice());
  }
  return centroids;
}

export interface KMeansResult {
  assignments: number[];
  centroids: number[][];
  iterations: number;
  sizes: number[];
}

/** Deterministic Lloyd's k-means. Returns centroids in normalized feature space. */
export function kmeans(points: number[][], k: number, maxIterations = 50): KMeansResult {
  if (points.length === 0 || k <= 0) {
    return { assignments: [], centroids: [], iterations: 0, sizes: [] };
  }
  const effectiveK = Math.min(k, points.length);
  let centroids = seedCentroids(points, effectiveK);
  const dim = points[0].length;
  let assignments = new Array(points.length).fill(0);
  let iterations = 0;

  for (; iterations < maxIterations; iterations += 1) {
    let changed = false;
    for (let i = 0; i < points.length; i += 1) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distanceSq(points[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }

    const sums = centroids.map(() => new Array(dim).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < points.length; i += 1) {
      const c = assignments[i];
      counts[c] += 1;
      for (let d = 0; d < dim; d += 1) sums[c][d] += points[i][d];
    }
    centroids = centroids.map((old, c) =>
      counts[c] > 0 ? sums[c].map((s: number) => s / counts[c]) : old,
    );

    if (!changed) {
      iterations += 1;
      break;
    }
  }

  const sizes = centroids.map((_, c) => assignments.filter((a) => a === c).length);
  return { assignments, centroids, iterations, sizes };
}

/** Convert a normalized centroid back to real fingerprint-feature values. */
export function denormalizeCentroid(
  centroid: number[],
  means: number[],
  stds: number[],
): Record<FingerprintFeature, number> {
  const out = {} as Record<FingerprintFeature, number>;
  FINGERPRINT_FEATURES.forEach((feature, i) => {
    out[feature] = centroid[i] * stds[i] + means[i];
  });
  return out;
}
