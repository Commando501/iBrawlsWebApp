/**
 * Anonymous identity for always-on data collection (tech demo).
 *
 * The anon id is a random, non-identifying join key so population analysis can group a
 * player's matches without accounts or any PII. It is not part of `UniversalSettings`,
 * so it never touches the live-config allowlist. Collection is always-on and disclosed
 * via an in-app notice (see App.tsx) rather than gated by a consent toggle.
 */

const ANON_ID_KEY = 'ibrawls_anon_id';

/** Returns a stable anonymous id for this browser, creating one on first use. */
export function getOrCreateAnonId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon_unknown';
  }
}
