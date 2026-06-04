/**
 * Local-only telemetry consent + anonymous identity.
 *
 * Consent gates ALL gameplay-data upload (default OFF until the player opts in).
 * The anon id is a random, non-identifying join key so population analysis can
 * group a player's matches without accounts or any PII. Neither value is part of
 * `UniversalSettings`, so they never touch the live-config allowlist.
 */

const CONSENT_KEY = 'ibrawls_telemetry_consent';
const ANON_ID_KEY = 'ibrawls_anon_id';

export function getTelemetryConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTelemetryConsent(enabled: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore disabled / full storage */
  }
}

/** Returns a stable anonymous id for this browser, creating one on first use. */
export function getOrCreateAnonId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon_unknown';
  }
}
