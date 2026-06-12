import { resolveHttpBase } from './liveConfig';
import { getStoredToken } from './account';
import type { StatCounterMap, StatDelta, StatModeKey } from '../stats/statTypes';

/**
 * Cloud stats client — mirrors the tolerant `{ ok, data?, error? }` shape of
 * services/account.ts. Stats are optional everywhere: a missing backend or a
 * logged-out user simply leaves the profile local.
 */

export interface CloudStatsPayload {
  totals: StatCounterMap;
  modes: Partial<Record<StatModeKey, StatCounterMap>>;
}

export interface StatsApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<StatsApiResult<T>> {
  const token = getStoredToken();
  if (!token) return { ok: false, error: 'Not signed in.' };
  const base = resolveHttpBase();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return { ok: false, error: (data && data.error) || `Request failed (${res.status})` };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, error: `Network error: ${String(err)}` };
  }
}

export async function fetchCloudStats(): Promise<StatsApiResult<{ stats: CloudStatsPayload | null }>> {
  return request('/api/account/stats', 'GET');
}

export async function ingestStatDelta(
  delta: StatDelta
): Promise<StatsApiResult<{ ok: boolean; stats: CloudStatsPayload }>> {
  return request('/api/account/stats/ingest', 'POST', delta);
}
