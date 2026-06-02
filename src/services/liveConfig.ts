import { PersistedGameplaySettings } from '../settings/gameplaySettings';
import { pickLiveConfigSettings } from '../settings/liveConfigKeys';

/**
 * Live Tuning client — fetches, caches, and publishes the Official Multiplayer Preset.
 *
 * GET /api/config is the source of truth (ETag-cached). The lobby WebSocket sends a
 * lightweight `{type:"config_changed", version}` nudge so connected clients re-fetch.
 * A copy is cached in localStorage so offline mode has the last-known ruleset.
 */

export interface LiveConfig {
  version: number;
  label: string;
  settings: Partial<PersistedGameplaySettings>;
}

const CACHE_KEY = 'grifball_live_config';
const ETAG_KEY = 'grifball_live_config_etag';

/**
 * Resolve the HTTP(S) base for the config API. Mirrors the matchmaker-URL host
 * resolution in App.tsx (`getSavedMatchmakerUrl`) but yields an http(s) origin with
 * no `/ws` suffix, so config requests hit the same Worker that relays multiplayer.
 */
export function resolveHttpBase(): string {
  const wsToHttp = (ws: string): string => {
    let u = ws.trim();
    u = u.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    u = u.replace(/\/ws\/?$/i, '');
    return u.replace(/\/$/, '');
  };

  try {
    const saved = localStorage.getItem('ibrawls_matchmaker_url');
    if (saved) return wsToHttp(saved);
  } catch {
    /* ignore */
  }

  const envWsUrl = (import.meta as any).env?.VITE_WS_URL as string | undefined;
  if (envWsUrl) return wsToHttp(envWsUrl);

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  let host = window.location.host;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    host = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';
  } else if (host.includes('ibrawlswebapp.pages.dev')) {
    host = 'ibrawlswebapp.commando501.workers.dev';
  }
  return `${protocol}//${host}`;
}

/** Synchronous read of the last cached config (startup / offline). */
export function getCachedLiveConfig(): LiveConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === 'number' && parsed.settings) {
      return parsed as LiveConfig;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(config: LiveConfig, etag: string | null): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
    if (etag) localStorage.setItem(ETAG_KEY, etag);
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Fetch the official preset. Sends `If-None-Match` from the cached ETag; on a 304
 * returns the cached copy. Falls back to cache (then null) on network failure so
 * callers never throw on a missing backend.
 */
export async function fetchLiveConfig(): Promise<LiveConfig | null> {
  const base = resolveHttpBase();
  let etag: string | null = null;
  try {
    etag = localStorage.getItem(ETAG_KEY);
  } catch {
    /* ignore */
  }

  try {
    const res = await fetch(`${base}/api/config`, {
      method: 'GET',
      headers: etag ? { 'If-None-Match': etag } : {},
    });

    if (res.status === 304) {
      return getCachedLiveConfig();
    }
    if (!res.ok) {
      return getCachedLiveConfig();
    }

    const data = (await res.json()) as LiveConfig;
    const config: LiveConfig = {
      version: data.version,
      label: data.label ?? '',
      settings: pickLiveConfigSettings(data.settings ?? {}),
    };
    writeCache(config, res.headers.get('ETag'));
    return config;
  } catch {
    return getCachedLiveConfig();
  }
}

export interface PublishResult {
  ok: boolean;
  version?: number;
  error?: string;
}

/**
 * Publish a new official preset. Requires the shared admin token. Only the
 * governed mechanic keys are sent (identity keys are stripped).
 */
export async function publishLiveConfig(
  token: string,
  settings: Partial<PersistedGameplaySettings>,
  label: string
): Promise<PublishResult> {
  const base = resolveHttpBase();
  try {
    const res = await fetch(`${base}/api/admin/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        settings: pickLiveConfigSettings(settings),
        label,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as PublishResult;
    if (!res.ok) {
      return { ok: false, error: data.error || `Publish failed (${res.status})` };
    }
    return { ok: true, version: data.version };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
