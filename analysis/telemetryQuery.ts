import {
  analyticsSqlSelectColumns,
  TELEMETRY_BLOB_FIELDS,
  TELEMETRY_DOUBLE_FIELDS,
  TELEMETRY_INDEX_FIELDS,
} from '../worker/src/telemetrySchema';

/**
 * Analytics Engine SQL API client (read side of the telemetry loop).
 *
 * Docs: https://developers.cloudflare.com/analytics/analytics-engine/sql-api/
 * Auth: an account-scoped API token with the "Account Analytics: Read" permission.
 * This is offline tooling — never ship these credentials to the client.
 */

const DATASET = 'ibrawls_match_telemetry';

export interface AeCredentials {
  accountId: string;
  apiToken: string;
}

/** One match row, columns aliased back to schema field names. */
export type MatchRow = Record<
  | (typeof TELEMETRY_INDEX_FIELDS)[number]
  | (typeof TELEMETRY_BLOB_FIELDS)[number]
  | (typeof TELEMETRY_DOUBLE_FIELDS)[number],
  string | number
>;

/** Read credentials from the environment (CF_ACCOUNT_ID / CF_AE_API_TOKEN). */
export function credentialsFromEnv(
  env: Record<string, string | undefined>,
): AeCredentials | null {
  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CF_AE_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/** Build the canonical SELECT over the telemetry dataset (optionally time-bounded). */
export function buildMatchQuery(opts: { sinceDays?: number; limit?: number } = {}): string {
  const where =
    opts.sinceDays && opts.sinceDays > 0
      ? `WHERE timestamp > NOW() - INTERVAL '${Math.floor(opts.sinceDays)}' DAY`
      : '';
  const limit = opts.limit && opts.limit > 0 ? `LIMIT ${Math.floor(opts.limit)}` : 'LIMIT 10000';
  return `SELECT ${analyticsSqlSelectColumns()} FROM ${DATASET} ${where} ${limit}`.trim();
}

/** Run a SQL query against the AE SQL API and return the parsed rows. */
export async function runAnalyticsQuery<T = MatchRow>(
  creds: AeCredentials,
  sql: string,
): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AE SQL query failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { data?: T[] };
  return json.data ?? [];
}

/** Convenience: fetch recent match rows. */
export async function fetchMatchRows(
  creds: AeCredentials,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<MatchRow[]> {
  return runAnalyticsQuery<MatchRow>(creds, buildMatchQuery(opts));
}
