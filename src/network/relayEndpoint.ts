/** One endpoint policy for lobby/gameplay sockets and their accompanying APIs. */
export const MATCHMAKER_URL_STORAGE_KEY = 'ibrawls_matchmaker_url';
export const DEFAULT_REMOTE_RELAY_URL = 'wss://ibrawlswebapp.commando501.workers.dev/ws';
const LEGACY_REMOTE_RELAY_HOST = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';

export interface RelayPageLocation {
  protocol: string;
  host: string;
  hostname?: string;
}

export interface RelayEndpointOptions {
  savedUrl?: string | null;
  envUrl?: string | null;
  location?: RelayPageLocation;
}

/** Accept HTTP links as well as WebSocket links, without ever double-prefixing them. */
export function normalizeRelayWsUrl(input: string, pageProtocol = 'https:'): string {
  const value = input.trim();
  if (!value || /\s/.test(value)) throw new Error('Enter a valid relay URL without spaces.');
  let candidate = value;
  if (candidate.startsWith('//')) {
    candidate = `${pageProtocol === 'http:' ? 'ws:' : 'wss:'}${candidate}`;
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    candidate = `${pageProtocol === 'http:' ? 'ws' : 'wss'}://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid relay host, such as wss://relay.example/ws.');
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('Relay URLs must use http, https, ws, or wss.');
  }
  if (!url.hostname || url.username || url.password || url.hash || /^\/\/(?:https?|wss?):/i.test(url.pathname)) {
    throw new Error('Relay URLs cannot contain credentials, fragments, or a second URL.');
  }
  // A previous input handler could persist ws://https://host. Never use that as host "https".
  if (['http', 'https', 'ws', 'wss'].includes(url.hostname) && url.pathname.startsWith('//')) {
    throw new Error('Enter the relay URL with only one protocol.');
  }
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (url.pathname === '/') url.pathname = '/ws';
  if (url.pathname.endsWith('/ws/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

function getDefaultRelayUrl(location?: RelayPageLocation): string {
  if (!location) return DEFAULT_REMOTE_RELAY_URL;
  const hostname = location.hostname ?? new URL(`${location.protocol}//${location.host}`).hostname;
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  const pagesHost = hostname === 'ibrawlswebapp.pages.dev' || hostname.endsWith('.ibrawlswebapp.pages.dev');
  if (localHost || pagesHost || hostname === LEGACY_REMOTE_RELAY_HOST) return DEFAULT_REMOTE_RELAY_URL;
  return normalizeRelayWsUrl(`${location.protocol}//${location.host}/ws`, location.protocol);
}

function normalizeSavedRelayUrl(input: string, pageProtocol?: string): string {
  // Repair only the unambiguous double protocol created by the old URL input.
  const repaired = input.trim().replace(/^wss?:\/\/(?=https?:\/\/)/i, '');
  const normalized = normalizeRelayWsUrl(repaired, pageProtocol);
  const url = new URL(normalized);
  // Migrate the retired built-in endpoint, but leave deliberate custom paths/query strings alone.
  if (url.hostname === LEGACY_REMOTE_RELAY_HOST && !url.port && url.pathname === '/ws' && !url.search) {
    return DEFAULT_REMOTE_RELAY_URL;
  }
  return normalized;
}

/** Saved custom URL takes precedence over build configuration; invalid saved data cannot break startup. */
export function resolveRelayWsUrl({ savedUrl, envUrl, location }: RelayEndpointOptions = {}): string {
  if (savedUrl) {
    try { return normalizeSavedRelayUrl(savedUrl, location?.protocol); } catch { /* try build configuration */ }
  }
  if (envUrl) {
    try { return normalizeRelayWsUrl(envUrl, location?.protocol); } catch { /* use the known deployment */ }
  }
  return getDefaultRelayUrl(location);
}

export function getRelayWsUrl(): string {
  let savedUrl: string | null = null;
  try { savedUrl = localStorage.getItem(MATCHMAKER_URL_STORAGE_KEY); } catch { /* storage can be disabled */ }
  return resolveRelayWsUrl({
    savedUrl,
    envUrl: (import.meta as ImportMeta & { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL,
    location: typeof window === 'undefined' ? undefined : window.location,
  });
}

/** Socket query parameters are not API paths or REST credentials. */
export function relayHttpBase(wsUrl: string): string {
  const url = new URL(normalizeRelayWsUrl(wsUrl));
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/ws\/?$/i, '').replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export interface RelaySocketIdentity {
  type: 'lobby' | 'gameplay';
  onlineInstanceId: string;
  name?: string;
  accountId?: string;
  accountToken?: string | null;
}

export function buildRelaySocketUrl(baseUrl: string, identity: RelaySocketIdentity): string {
  const url = new URL(normalizeRelayWsUrl(baseUrl));
  // Replace any stale connection identity carried in a saved URL, including duplicate query keys.
  for (const key of ['type', 'onlineInstanceId', 'name', 'accountId', 'accountToken']) url.searchParams.delete(key);
  url.searchParams.set('type', identity.type);
  url.searchParams.set('onlineInstanceId', identity.onlineInstanceId);
  if (identity.name) url.searchParams.set('name', identity.name);
  if (identity.accountId) url.searchParams.set('accountId', identity.accountId);
  if (identity.accountId && identity.accountToken) url.searchParams.set('accountToken', identity.accountToken);
  return url.toString();
}

export function redactRelaySocketUrl(value: string): string {
  // Keep this tolerant of invalid URLs because it is also used in connection diagnostics.
  return value.replace(/([?&](?:accountToken|token|password|inviteToken)=)[^&#]*/gi, '$1[redacted]');
}
