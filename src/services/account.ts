import { resolveHttpBase } from './liveConfig';

/**
 * Account client — registration, persistent login, recovery, profile edits, and
 * cloud settings sync. Talks to the same Worker as Live Tuning (reuses
 * `resolveHttpBase()`). The bearer token is persisted in localStorage so the user
 * stays logged in across visits; every authed call sends it as `Authorization`.
 *
 * Accounts are optional — callers must tolerate a missing backend / logged-out
 * state. Each function returns a tolerant `{ ok, data?, error? }` shape (mirrors
 * `publishLiveConfig`) and never throws on network failure.
 */

const TOKEN_KEY = 'ibrawls_account_token';

export interface AccountInfo {
  id: string;
  email: string;
  username: string;
  recoveryCode: string;
  createdAt: number;
  usernameChangedAt: number | null;
  emailChangedAt: number | null;
  passwordChangedAt: number | null;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ── Token persistence ────────────────────────────────────────────────────────
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore disabled / full storage */
  }
}

// ── Core request helper ──────────────────────────────────────────────────────
async function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  auth = false
): Promise<ApiResult<T>> {
  const base = resolveHttpBase();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getStoredToken();
    if (!token) return { ok: false, error: 'Not signed in.' };
    headers['Authorization'] = `Bearer ${token}`;
  }

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

// ── Auth ─────────────────────────────────────────────────────────────────────
export interface AuthSuccess {
  token: string;
  account: AccountInfo;
  recoveryCode?: string;
}

export async function register(
  email: string,
  username: string,
  password: string
): Promise<ApiResult<AuthSuccess>> {
  const result = await request<AuthSuccess>('/api/account/register', 'POST', {
    email,
    username,
    password,
  });
  if (result.ok && result.data) setStoredToken(result.data.token);
  return result;
}

export async function login(
  identifier: string,
  password: string
): Promise<ApiResult<AuthSuccess>> {
  const result = await request<AuthSuccess>('/api/account/login', 'POST', {
    identifier,
    password,
  });
  if (result.ok && result.data) setStoredToken(result.data.token);
  return result;
}

export async function logout(): Promise<void> {
  await request('/api/account/logout', 'POST', {}, true);
  setStoredToken(null);
}

export async function fetchMe(): Promise<ApiResult<{ account: AccountInfo }>> {
  return request<{ account: AccountInfo }>('/api/account/me', 'GET', undefined, true);
}

export async function recover(
  email: string,
  username: string,
  code: string,
  newPassword: string
): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/account/recover', 'POST', { email, username, code, newPassword });
}

// ── Profile edits (all require the 4-digit recovery code) ──────────────────────
export async function changeUsername(
  code: string,
  newUsername: string
): Promise<ApiResult<{ account: AccountInfo }>> {
  return request('/api/account/change-username', 'POST', { code, newUsername }, true);
}

export async function changeEmail(
  code: string,
  newEmail: string
): Promise<ApiResult<{ account: AccountInfo }>> {
  return request('/api/account/change-email', 'POST', { code, newEmail }, true);
}

export async function changePassword(
  code: string,
  newPassword: string
): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/account/change-password', 'POST', { code, newPassword }, true);
}

// ── Cloud settings save ────────────────────────────────────────────────────────
export async function fetchCloudSave<T = unknown>(): Promise<ApiResult<{ save: T | null }>> {
  return request<{ save: T | null }>('/api/account/save', 'GET', undefined, true);
}

export async function pushCloudSave(save: unknown): Promise<ApiResult<{ ok: boolean }>> {
  return request('/api/account/save', 'PUT', save, true);
}
