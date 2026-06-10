// Account system — registration, persistent login, recovery, profile edits, and
// per-account cloud settings. Backed by the D1 `accounts`, `sessions`, and
// `cloud_saves` tables (see migrations 0001/0002). Routed from index.ts via
// handleAccountRequest(); returns null for non-account paths so the caller can
// continue its own routing.
import {
  extractSavePlayerName,
  getPreferredRegisteredDisplayNameFromSave,
  normalizeRegisteredDisplayName,
  normalizeRegisteredDisplayNameKey,
} from "./displayNames";

export interface AccountsEnv {
  DB: D1Database;
  // Shared deployment secret used to self-promote an account to admin
  // (POST /api/account/promote). Optional so deployments without it still build.
  ADMIN_TOKEN?: string;
}

// ── Tunables ─────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year, slid forward on use
const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const RECOVERY_MAX_FAILS = 5;
const RECOVERY_LOCK_MS = 15 * 60 * 1000; // lock recovery for 15 min after repeated misses

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;

// ── Crypto helpers (Web Crypto — no external deps) ──────────────────────────
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const salt = new TextEncoder().encode(saltHex);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}

// Constant-time string compare to avoid leaking secret length/contents via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function generateRecoveryCode(): string {
  const n = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 10000);
  return n.toString().padStart(4, "0");
}

// ── Row + response shapes ────────────────────────────────────────────────────
interface AccountRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  password_salt: string;
  recovery_code: string;
  created_at: number;
  username_changed_at: number | null;
  email_changed_at: number | null;
  password_changed_at: number | null;
  recovery_fail_count: number;
  recovery_locked_until: number | null;
  is_admin: number;
}

interface DisplayNameClaimResult {
  ok: boolean;
  displayName?: string;
  error?: string;
  status?: number;
}

async function getAccountRegisteredDisplayName(env: AccountsEnv, accountId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT display_name FROM registered_display_names WHERE account_id = ?"
  )
    .bind(accountId)
    .first<{ display_name: string }>();
  return row?.display_name ?? null;
}

export async function getRegisteredDisplayNameOwner(
  env: AccountsEnv,
  displayName: unknown
): Promise<string | null> {
  const normalizedName = normalizeRegisteredDisplayNameKey(displayName);
  if (!normalizedName) return null;
  const row = await env.DB.prepare(
    "SELECT account_id FROM registered_display_names WHERE normalized_name = ? COLLATE NOCASE"
  )
    .bind(normalizedName)
    .first<{ account_id: string }>();
  return row?.account_id ?? null;
}

async function getPreferredRegisteredDisplayName(
  env: AccountsEnv,
  account: AccountRow
): Promise<string | null> {
  const saveRow = await env.DB.prepare("SELECT payload FROM cloud_saves WHERE account_id = ?")
    .bind(account.id)
    .first<{ payload: string }>();
  if (saveRow?.payload) {
    try {
      return getPreferredRegisteredDisplayNameFromSave(JSON.parse(saveRow.payload), account.username);
    } catch {
      /* ignore malformed legacy save payloads */
    }
  }
  return normalizeRegisteredDisplayName(account.username);
}

export async function claimRegisteredDisplayNameForAccount(
  env: AccountsEnv,
  accountId: string,
  requestedDisplayName: unknown,
  now = Date.now()
): Promise<DisplayNameClaimResult> {
  const displayName = normalizeRegisteredDisplayName(requestedDisplayName);
  const normalizedName = normalizeRegisteredDisplayNameKey(requestedDisplayName);
  if (!displayName || !normalizedName) {
    return { ok: false, status: 400, error: "Enter a valid display name." };
  }

  const owner = await getRegisteredDisplayNameOwner(env, displayName);
  if (owner && owner !== accountId) {
    return { ok: false, status: 409, error: "That display name is already registered." };
  }

  try {
    await env.DB.prepare(
      `INSERT INTO registered_display_names (account_id, display_name, normalized_name, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         display_name = excluded.display_name,
         normalized_name = excluded.normalized_name,
         updated_at = excluded.updated_at`
    )
      .bind(accountId, displayName, normalizedName, now)
      .run();
  } catch {
    return { ok: false, status: 409, error: "That display name is already registered." };
  }

  return { ok: true, displayName };
}

async function ensureRegisteredDisplayNameForAccount(
  env: AccountsEnv,
  account: AccountRow
): Promise<string | null> {
  const existing = await getAccountRegisteredDisplayName(env, account.id);
  if (existing) return existing;

  const preferred = await getPreferredRegisteredDisplayName(env, account);
  if (!preferred) return null;
  const claim = await claimRegisteredDisplayNameForAccount(env, account.id, preferred);
  return claim.ok ? claim.displayName ?? preferred : null;
}

// Owner-facing account view. Includes recovery_code intentionally — it is shown
// (obscured, with a reveal toggle) to the authenticated owner per the UI spec.
async function publicAccount(row: AccountRow, env: AccountsEnv) {
  const registeredDisplayName = await ensureRegisteredDisplayNameForAccount(env, row);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    registeredDisplayName,
    recoveryCode: row.recovery_code,
    createdAt: row.created_at,
    usernameChangedAt: row.username_changed_at,
    emailChangedAt: row.email_changed_at,
    passwordChangedAt: row.password_changed_at,
    isAdmin: row.is_admin === 1,
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
type Cors = Record<string, string>;

function json(body: unknown, status: number, cors: Cors): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

// Resolve the account for a valid, non-expired bearer token; slides the TTL.
export async function requireSession(request: Request, env: AccountsEnv): Promise<AccountRow | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const session = await env.DB.prepare(
    "SELECT account_id, expires_at FROM sessions WHERE token_hash = ?"
  )
    .bind(tokenHash)
    .first<{ account_id: string; expires_at: number }>();
  if (!session || session.expires_at <= now) return null;

  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(session.account_id)
    .first<AccountRow>();
  if (!account) return null;

  // Slide the session expiry forward so active users stay logged in.
  await env.DB.prepare(
    "UPDATE sessions SET expires_at = ?, last_seen = ? WHERE token_hash = ?"
  )
    .bind(now + SESSION_TTL_MS, now, tokenHash)
    .run();
  return account;
}

async function createSession(accountId: string, env: AccountsEnv): Promise<string> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(tokenHash, accountId, now, now + SESSION_TTL_MS, now)
    .run();
  return token;
}

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
}

function normalizeUsername(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const u = v.trim();
  return USERNAME_RE.test(u) ? u : null;
}

function validPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= MIN_PASSWORD_LEN && v.length <= MAX_PASSWORD_LEN;
}

// ── Endpoint handlers ────────────────────────────────────────────────────────

async function handleRegister(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const registeredDisplayName = normalizeRegisteredDisplayName(body.playerName) ?? username;
  if (!email) return json({ error: "Enter a valid email address." }, 400, cors);
  if (!username)
    return json({ error: "Username must be 3–16 letters, numbers, or underscores." }, 400, cors);
  if (!validPassword(body.password))
    return json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400, cors);
  if (!registeredDisplayName)
    return json({ error: "Enter a valid display name." }, 400, cors);

  const existing = await env.DB.prepare(
    "SELECT email, username FROM accounts WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE"
  )
    .bind(email, username)
    .first<{ email: string | null; username: string | null }>();
  if (existing) {
    const emailTaken = (existing.email || "").toLowerCase() === email;
    return json(
      { error: emailTaken ? "That email is already registered." : "That username is taken." },
      409,
      cors
    );
  }

  const existingDisplayNameOwner = await getRegisteredDisplayNameOwner(env, registeredDisplayName);
  if (existingDisplayNameOwner) {
    return json({ error: "That display name is already registered." }, 409, cors);
  }

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.password as string, salt);
  const recoveryCode = generateRecoveryCode();
  const now = Date.now();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO accounts
           (id, email, username, password_hash, password_salt, recovery_code, created_at, last_seen, recovery_fail_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).bind(id, email, username, passwordHash, salt, recoveryCode, now, now),
      env.DB.prepare(
        `INSERT INTO registered_display_names (account_id, display_name, normalized_name, updated_at)
         VALUES (?, ?, ?, ?)`
      ).bind(id, registeredDisplayName, normalizeRegisteredDisplayNameKey(registeredDisplayName), now),
    ]);
  } catch (err) {
    // The INSERT failed. Distinguish a genuine unique-index race (someone
    // registered the same email/username between our pre-check and here) from
    // any other DB error — historically this catch reported EVERYTHING as
    // "already in use", which hid real failures (e.g. schema/migration drift)
    // behind a misleading message.
    const clash = await env.DB.prepare(
      "SELECT email FROM accounts WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE"
    )
      .bind(email, username)
      .first<{ email: string | null }>();
    if (clash) {
      const emailTaken = (clash.email || "").toLowerCase() === email;
      return json(
        { error: emailTaken ? "That email is already registered." : "That username is taken." },
        409,
        cors
      );
    }
    const displayNameClash = await getRegisteredDisplayNameOwner(env, registeredDisplayName);
    if (displayNameClash) {
      return json({ error: "That display name is already registered." }, 409, cors);
    }
    // Not a duplicate — surface the real error so the failure is diagnosable
    // instead of being mislabeled as a taken email/username.
    return json({ error: "Could not create account.", detail: String(err) }, 500, cors);
  }

  // The account row is now committed. If session creation or the read-back
  // fails, do NOT report failure to the client — the account exists, and a
  // 5xx here would make the user retry into a (now genuine) "already in use".
  let token: string | null = null;
  try {
    token = await createSession(id, env);
  } catch (err) {
    console.error("register: createSession failed after account insert", err);
  }
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(id)
    .first<AccountRow>();
  return json({ token, account: account ? await publicAccount(account, env) : null, recoveryCode }, 200, cors);
}

async function handleLogin(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password)
    return json({ error: "Enter your email/username and password." }, 400, cors);

  const account = await env.DB.prepare(
    "SELECT * FROM accounts WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE"
  )
    .bind(identifier.toLowerCase(), identifier)
    .first<AccountRow>();

  const INVALID = json({ error: "Invalid credentials." }, 401, cors);
  if (!account || !account.password_hash) return INVALID;
  const candidate = await hashPassword(password, account.password_salt);
  if (!safeEqual(candidate, account.password_hash)) return INVALID;

  const token = await createSession(account.id, env);
  return json({ token, account: await publicAccount(account, env) }, 200, cors);
}

async function handleLogout(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, cors);
}

async function handleMe(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  return json({ account: await publicAccount(account, env) }, 200, cors);
}

async function handleRecover(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !username || !code || !validPassword(body.newPassword))
    return json({ error: "Provide email, username, your 4-digit code, and a new password." }, 400, cors);

  const account = await env.DB.prepare(
    "SELECT * FROM accounts WHERE email = ? COLLATE NOCASE AND username = ? COLLATE NOCASE"
  )
    .bind(email, username)
    .first<AccountRow>();

  const now = Date.now();
  // Always return a generic message on failure to avoid disclosing which factor was wrong.
  const FAIL = json({ error: "Recovery details do not match." }, 400, cors);
  if (!account) return FAIL;

  if (account.recovery_locked_until && account.recovery_locked_until > now) {
    return json(
      { error: "Too many attempts. Try again later." },
      429,
      cors
    );
  }

  if (!safeEqual(code, account.recovery_code)) {
    const fails = (account.recovery_fail_count || 0) + 1;
    const lockUntil = fails >= RECOVERY_MAX_FAILS ? now + RECOVERY_LOCK_MS : null;
    await env.DB.prepare(
      "UPDATE accounts SET recovery_fail_count = ?, recovery_locked_until = ? WHERE id = ?"
    )
      .bind(lockUntil ? 0 : fails, lockUntil, account.id)
      .run();
    return FAIL;
  }

  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.newPassword as string, salt);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE accounts SET password_hash = ?, password_salt = ?, password_changed_at = ?, recovery_fail_count = 0, recovery_locked_until = NULL WHERE id = ?"
    ).bind(passwordHash, salt, now, account.id),
    // Recovering invalidates existing sessions everywhere.
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id),
  ]);
  return json({ ok: true }, 200, cors);
}

// Shared verify-code + cooldown gate for the authenticated change-* endpoints.
function cooldownRemaining(changedAt: number | null, windowMs: number, now: number): number {
  if (!changedAt) return 0;
  const elapsed = now - changedAt;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}

async function handleChangeUsername(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);

  const newUsername = normalizeUsername(body.newUsername);
  if (!newUsername)
    return json({ error: "Username must be 3–16 letters, numbers, or underscores." }, 400, cors);

  const now = Date.now();
  const remaining = cooldownRemaining(account.username_changed_at, USERNAME_COOLDOWN_MS, now);
  if (remaining > 0) return json({ error: "Username was changed too recently.", retryAfterMs: remaining }, 429, cors);

  const clash = await env.DB.prepare(
    "SELECT id FROM accounts WHERE username = ? COLLATE NOCASE AND id != ?"
  )
    .bind(newUsername, account.id)
    .first<{ id: string }>();
  if (clash) return json({ error: "That username is taken." }, 409, cors);

  await env.DB.prepare("UPDATE accounts SET username = ?, username_changed_at = ? WHERE id = ?")
    .bind(newUsername, now, account.id)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(account.id)
    .first<AccountRow>();
  return json({ account: await publicAccount(updated!, env) }, 200, cors);
}

async function handleChangeEmail(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);

  const newEmail = normalizeEmail(body.newEmail);
  if (!newEmail) return json({ error: "Enter a valid email address." }, 400, cors);

  const now = Date.now();
  const remaining = cooldownRemaining(account.email_changed_at, EMAIL_COOLDOWN_MS, now);
  if (remaining > 0) return json({ error: "Email was changed too recently.", retryAfterMs: remaining }, 429, cors);

  const clash = await env.DB.prepare(
    "SELECT id FROM accounts WHERE email = ? COLLATE NOCASE AND id != ?"
  )
    .bind(newEmail, account.id)
    .first<{ id: string }>();
  if (clash) return json({ error: "That email is already registered." }, 409, cors);

  await env.DB.prepare("UPDATE accounts SET email = ?, email_changed_at = ? WHERE id = ?")
    .bind(newEmail, now, account.id)
    .run();
  const updated = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(account.id)
    .first<AccountRow>();
  return json({ account: await publicAccount(updated!, env) }, 200, cors);
}

async function handleChangePassword(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);

  if (!validPassword(body.newPassword))
    return json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400, cors);

  const now = Date.now();
  const remaining = cooldownRemaining(account.password_changed_at, PASSWORD_COOLDOWN_MS, now);
  if (remaining > 0) return json({ error: "Password was changed too recently.", retryAfterMs: remaining }, 429, cors);

  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.newPassword as string, salt);
  await env.DB.prepare(
    "UPDATE accounts SET password_hash = ?, password_salt = ?, password_changed_at = ? WHERE id = ?"
  )
    .bind(passwordHash, salt, now, account.id)
    .run();
  return json({ ok: true }, 200, cors);
}

// Self-promote the authenticated account to admin by presenting the deployment's
// shared ADMIN_TOKEN secret. Idempotent — re-promoting an admin is a no-op.
async function handlePromote(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!env.ADMIN_TOKEN || !token || !safeEqual(token, env.ADMIN_TOKEN))
    return json({ error: "Invalid admin code." }, 403, cors);

  if (account.is_admin !== 1) {
    await env.DB.prepare("UPDATE accounts SET is_admin = 1 WHERE id = ?").bind(account.id).run();
  }
  const updated = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?")
    .bind(account.id)
    .first<AccountRow>();
  return json({ account: await publicAccount(updated!, env) }, 200, cors);
}

// Resolve the account for a valid session ONLY when it has the admin flag set.
// Exported so the entrypoint can gate admin-only endpoints (e.g. config publish)
// on an admin account's session instead of the shared ADMIN_TOKEN secret.
export async function resolveAdminAccount(
  request: Request,
  env: AccountsEnv
): Promise<AccountRow | null> {
  const account = await requireSession(request, env);
  return account && account.is_admin === 1 ? account : null;
}

async function handleGetSave(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const row = await env.DB.prepare("SELECT payload, updated_at FROM cloud_saves WHERE account_id = ?")
    .bind(account.id)
    .first<{ payload: string; updated_at: number }>();
  if (!row) return json({ save: null }, 200, cors);
  let save: unknown = null;
  try {
    save = JSON.parse(row.payload);
  } catch {
    save = null;
  }
  return json({ save, updatedAt: row.updated_at }, 200, cors);
}

async function handlePutSave(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const account = await requireSession(request, env);
  if (!account) return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400, cors);

  const displayName = extractSavePlayerName(body);
  if (!displayName) return json({ error: "Enter a valid display name." }, 400, cors);
  const claim = await claimRegisteredDisplayNameForAccount(env, account.id, displayName);
  if (!claim.ok) {
    return json({ error: claim.error || "That display name is already registered." }, claim.status ?? 409, cors);
  }

  const payload = JSON.stringify(body);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO cloud_saves (account_id, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  )
    .bind(account.id, payload, now)
    .run();
  return json({ ok: true, updatedAt: now, account: await publicAccount(account, env) }, 200, cors);
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
// Returns a Response for any /api/account/* route, or null otherwise.
export async function handleAccountRequest(
  request: Request,
  env: AccountsEnv,
  cors: Cors
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/account/")) return null;

  const m = request.method;
  try {
    if (path === "/api/account/register" && m === "POST") return await handleRegister(request, env, cors);
    if (path === "/api/account/login" && m === "POST") return await handleLogin(request, env, cors);
    if (path === "/api/account/logout" && m === "POST") return await handleLogout(request, env, cors);
    if (path === "/api/account/me" && m === "GET") return await handleMe(request, env, cors);
    if (path === "/api/account/recover" && m === "POST") return await handleRecover(request, env, cors);
    if (path === "/api/account/change-username" && m === "POST")
      return await handleChangeUsername(request, env, cors);
    if (path === "/api/account/change-email" && m === "POST")
      return await handleChangeEmail(request, env, cors);
    if (path === "/api/account/change-password" && m === "POST")
      return await handleChangePassword(request, env, cors);
    if (path === "/api/account/promote" && m === "POST") return await handlePromote(request, env, cors);
    if (path === "/api/account/save" && m === "GET") return await handleGetSave(request, env, cors);
    if (path === "/api/account/save" && m === "PUT") return await handlePutSave(request, env, cors);
    return json({ error: "Account route not found" }, 404, cors);
  } catch (err) {
    return json({ error: "Account request failed", detail: String(err) }, 500, cors);
  }
}
