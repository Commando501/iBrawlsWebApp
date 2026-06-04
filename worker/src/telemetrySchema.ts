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

// One low-cardinality grouping key (AE allows a single index).
export const TELEMETRY_INDEX_FIELDS = ['aiDifficulty'] as const;

// Categorical / string context. AE stores blobs as strings.
export const TELEMETRY_BLOB_FIELDS = [
  'anonId',
  'appVersion',
  'liveConfigVersion',
  'map',
  'mode',
  'aiArchetype',
  'gameMode',
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

export type TelemetryIndexField = (typeof TELEMETRY_INDEX_FIELDS)[number];
export type TelemetryBlobField = (typeof TELEMETRY_BLOB_FIELDS)[number];
export type TelemetryDoubleField = (typeof TELEMETRY_DOUBLE_FIELDS)[number];
export type TelemetryColumn = TelemetryIndexField | TelemetryBlobField | TelemetryDoubleField;

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

/** Map a (sanitized) telemetry body to a positional AE data point. */
export function toAnalyticsDataPoint(body: Record<string, unknown>): AnalyticsDataPoint {
  return {
    indexes: TELEMETRY_INDEX_FIELDS.map((f) => asBlob(resolveValue(body, f))),
    blobs: TELEMETRY_BLOB_FIELDS.map((f) => asBlob(resolveValue(body, f))),
    doubles: TELEMETRY_DOUBLE_FIELDS.map((f) => asDouble(resolveValue(body, f))),
  };
}

/**
 * Build the `SELECT` projection for the AE SQL API, aliasing positional columns
 * (`index1`, `blob1`, `double1`, …) back to their schema field names.
 */
export function analyticsSqlSelectColumns(): string {
  const parts: string[] = [];
  TELEMETRY_INDEX_FIELDS.forEach((f, i) => parts.push(`index${i + 1} AS ${f}`));
  TELEMETRY_BLOB_FIELDS.forEach((f, i) => parts.push(`blob${i + 1} AS ${f}`));
  TELEMETRY_DOUBLE_FIELDS.forEach((f, i) => parts.push(`double${i + 1} AS ${f}`));
  return parts.join(', ');
}
