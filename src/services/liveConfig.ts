import { PersistedGameplaySettings } from '../settings/gameplaySettings';
import { pickLiveConfigSettings } from '../settings/liveConfigKeys';
import { getRelayWsUrl, relayHttpBase } from '../network/relayEndpoint';

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
 * Resolve the API base using the same policy as lobby and gameplay sockets.
 */
export function resolveHttpBase(): string {
  return relayHttpBase(getRelayWsUrl());
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
