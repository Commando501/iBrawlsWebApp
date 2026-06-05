/**
 * Canonical Analytics Engine schema for match telemetry — the SINGLE SOURCE OF TRUTH
 * for the positional column layout.
 *
 * Analytics Engine stores data points positionally: the index, `blob1..blobN`, and
 * `double1..doubleN`. The Worker writes them via `toAnalyticsDataPoint()` and the
 * offline analysis reads them via `analyticsSqlSelectColumns()` — both derived from
 * the SAME ordered arrays below, so the producer and consumer can never drift.
 *
 * APPEND-ONLY RULE: never reorder or remove fields (it would silently re-map every
 * historical row). Add new fields to the END of the relevant array and bump
 * `TELEMETRY_FINGERPRINT_SCHEMA` on the client so analysis can segment by version.
 */

// AE allows exactly ONE index, and it is the dimension AE guarantees representation
// along when it adaptively samples to bound cost. We pack the low-cardinality sampling
// dimensions into a single COMPOSITE key so AE keeps a representative sample PER
// (gameMode, aiDifficulty) — this is what lets the offline analysis sample by game mode
// without a rare mode being sampled away. Cardinality stays low (≈ modes × difficulties
// ≈ 10 combos). The same fields are ALSO stored as blobs (below) so SQL queries filter
// on them directly without ever parsing the composite.
export const TELEMETRY_SAMPLING_KEY_FIELDS = ['gameMode', 'aiDifficulty'] as const;
// ASCII Unit Separator — cannot appear in sanitized blob values, so the composite key
// round-trips unambiguously if a consumer ever needs to split it.
export const TELEMETRY_SAMPLING_KEY_SEPARATOR = '\x1f';
// SQL alias for the composite index column (index1).
export const TELEMETRY_INDEX_ALIAS = 'samplingKey';

// Categorical / string context. AE stores blobs as strings.
// APPEND-ONLY: aiDifficulty was appended (schema v2) when the AE index became a
// composite sampling key — it lives in the index (for sampling) AND here (for filtering).
export const TELEMETRY_BLOB_FIELDS = [
  'anonId',
  'appVersion',
  'liveConfigVersion',
  'map',
  'mode',
  'aiArchetype',
  'gameMode',
  'aiDifficulty',
] as const;

// Numeric outcome + behavior-fingerprint features. AE stores doubles as numbers.
export const TELEMETRY_DOUBLE_FIELDS = [
  // Match outcome
  'scorePlayer',
  'scoreEnemy',
  'playerKills',
  'playerDeaths',
  'durationSeconds',
  // Local-player behavior fingerprint (PlayerModelSnapshot)
  'avgLungeDistance',
  'lungeFrequency',
  'dodgeBiasX',
  'dodgeBiasZ',
  'counterRate',
  'approachSpeed',
  'edgeProximity',
  'reactionTime',
  'sampleCount',
  // Trailing meta
  'fingerprintSchema',
  // Match context
  'isMultiplayer',
  'opponentCount',
  'multikills',
  'sprees',
  // Raw per-match action volumes (counts)
  'lungeAttempts',
  'lungeHits',
  'hammerAttacks',
  'weaponSwaps',
  'dashes',
  'countersAttempted',
  'countersLanded',
  'damageDealtCount',
  'damageReceivedCount',
] as const;

export type TelemetrySamplingKeyField = (typeof TELEMETRY_SAMPLING_KEY_FIELDS)[number];
export type TelemetryBlobField = (typeof TELEMETRY_BLOB_FIELDS)[number];
export type TelemetryDoubleField = (typeof TELEMETRY_DOUBLE_FIELDS)[number];
export type TelemetryColumn =
  | typeof TELEMETRY_INDEX_ALIAS
  | TelemetryBlobField
  | TelemetryDoubleField;

/** Structurally compatible with AnalyticsEngineDataPoint (no worker-types dep). */
export interface AnalyticsDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

// Resolve a field's value from a telemetry body, transparently reaching into the
// nested `player` fingerprint (field names never collide between the two levels).
function resolveValue(body: Record<string, unknown>, field: string): unknown {
  const top = body[field];
  if (top !== undefined) return top;
  const player = body.player as Record<string, unknown> | undefined;
  return player ? player[field] : undefined;
}

function asBlob(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function asDouble(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Build the composite AE index (sampling key) from the low-cardinality dimensions. */
export function buildSamplingKey(body: Record<string, unknown>): string {
  return TELEMETRY_SAMPLING_KEY_FIELDS.map((f) => asBlob(resolveValue(body, f))).join(
    TELEMETRY_SAMPLING_KEY_SEPARATOR,
  );
}

/** Map a (sanitized) telemetry body to a positional AE data point. */
export function toAnalyticsDataPoint(body: Record<string, unknown>): AnalyticsDataPoint {
  return {
    // Single composite index — AE retains a representative sample per (gameMode,
    // aiDifficulty) so the corpus stays segmentable by game mode.
    indexes: [buildSamplingKey(body)],
    blobs: TELEMETRY_BLOB_FIELDS.map((f) => asBlob(resolveValue(body, f))),
    doubles: TELEMETRY_DOUBLE_FIELDS.map((f) => asDouble(resolveValue(body, f))),
  };
}

/**
 * Build the `SELECT` projection for the AE SQL API, aliasing positional columns
 * (`index1`, `blob1`, `double1`, …) back to their schema field names.
 */
export function analyticsSqlSelectColumns(): string {
  // The single AE index is the composite sampling key; gameMode/aiDifficulty are also
  // projected from blobs below, so queries filter on those rather than parsing index1.
  const parts: string[] = [`index1 AS ${TELEMETRY_INDEX_ALIAS}`];
  TELEMETRY_BLOB_FIELDS.forEach((f, i) => parts.push(`blob${i + 1} AS ${f}`));
  TELEMETRY_DOUBLE_FIELDS.forEach((f, i) => parts.push(`double${i + 1} AS ${f}`));
  return parts.join(', ');
}
