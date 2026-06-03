var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-WhSCvl/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-WhSCvl/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/liveConfigKeys.ts
var LIVE_CONFIG_KEYS = [
  "aiAnticipationFactor",
  "aiArchetype",
  "aiDifficulty",
  "aiMovementComplexity",
  "aiPlaystyle",
  "aiReactionLatency",
  "aiTuneApproachFeintBackTimer",
  "aiTuneArenaEdgeInset",
  "aiTuneAttackStaggerStep",
  "aiTuneBaitDodgeBand",
  "aiTuneBaitDodgeDistance",
  "aiTuneBaseEvasionDetectRange",
  "aiTuneBaseGroundSpeed",
  "aiTuneCalibrationWindowSize",
  "aiTuneChargeAbortSidestepTimer",
  "aiTuneComboAdvancedWeaponSwapIq",
  "aiTuneComboMinWeaponSwapIq",
  "aiTuneCounterResolveDelay",
  "aiTuneDamageTagTtl",
  "aiTuneDefaultLungeDistance",
  "aiTuneDefaultReactionTime",
  "aiTuneDodgeResolveDelay",
  "aiTuneEvasionTriggerJitter",
  "aiTuneFeintCooldownMax",
  "aiTuneFeintCooldownMin",
  "aiTuneFeintIqGate",
  "aiTuneForcedDescentSpeed",
  "aiTuneHammerWindupSeconds",
  "aiTuneHighIqOverride",
  "aiTuneLungeFakeoutForwardTimer",
  "aiTuneMaxAirborneHeight",
  "aiTuneMaxCalibrationDrift",
  "aiTuneMechanicAwareIq",
  "aiTunePlayerModelEmaAlpha",
  "aiTunePostKillPressureDuration",
  "aiTunePriorityTargetTtl",
  "aiTuneScoreAheadThreshold",
  "aiTuneScoreCloseThreshold",
  "aiTuneSlideMaxGap",
  "aiTuneSlideMinComplexity",
  "aiTuneSlideMinGap",
  "aiTuneSlideTriggerChance",
  "aiTuneSprintChaseTargetSpeed",
  "aiTuneSprintEngageGap",
  "aiTuneStandoffRangeMaxOffset",
  "aiTuneStandoffRangeMinOffset",
  "aiTuneTempoCycleDuration",
  "aiTuneTempoFastMult",
  "aiTuneTempoSlowMult",
  "aiTuneWeaponSwapFeintDelay",
  "aiWeaponPrioritization",
  "aiWeaponSwapIQ",
  "ambientLightIntensity",
  "attackRadius",
  "attackRange",
  "dashCooldown",
  "dashDistance",
  "dashDuration",
  "directLightIntensity",
  "enableBurnDecals",
  "enableHammerSwordTrade",
  "enableSlide",
  "enableSprint",
  "enableSwordTrade",
  "gameMode",
  "grifballBallReturnTimeout",
  "grifballChargeMax",
  "grifballCountdownDuration",
  "grifballEscortSpacing",
  "grifballGoalTarget",
  "grifballPassSpeedMax",
  "grifballPassSpeedMin",
  "grifballPickupRadius",
  "grifballPunchLungeRange",
  "grifballRoundResetDelay",
  "hammerJumpAirLimit",
  "hammerJumpInputGate",
  "hammerJumpPower",
  "hammerJumpTriggerRadius",
  "hammerJumpWindow",
  "hammerMeleeReload",
  "hammerMeleeSpeed",
  "hammerReloadTime",
  "hammerSplashVfx",
  "hammerSwordTradeWindow",
  "maxHP",
  "nameVisibilityColor",
  "nameVisibilityDistance",
  "nameVisibilityFontSize",
  "nameVisibilityOpacity",
  "respawnInvulnerabilityDuration",
  "showSkybox",
  "skyboxBrightness",
  "skyboxHue",
  "slideCooldown",
  "slideDistance",
  "speedBackward",
  "speedForward",
  "speedSide",
  "speedSlide",
  "speedSprint",
  "swordLungeDistance",
  "swordLungeReload",
  "swordLungeSpeed",
  "swordLungeVfx",
  "swordSlashReload",
  "swordSlashSpeed",
  "swordTradeWindow",
  "visualizeJumpZone",
  "weaponReadyTime",
  "weaponSwapLockout"
];
var LIVE_CONFIG_KEY_SET = new Set(LIVE_CONFIG_KEYS);

// src/accounts.ts
var SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
var USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1e3;
var EMAIL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1e3;
var PASSWORD_COOLDOWN_MS = 24 * 60 * 60 * 1e3;
var PBKDF2_ITERATIONS = 1e5;
var RECOVERY_MAX_FAILS = 5;
var RECOVERY_LOCK_MS = 15 * 60 * 1e3;
var USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var MIN_PASSWORD_LEN = 8;
var MAX_PASSWORD_LEN = 200;
function toHex(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++)
    out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
__name(toHex, "toHex");
function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
__name(randomHex, "randomHex");
async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}
__name(sha256Hex, "sha256Hex");
async function hashPassword(password, saltHex) {
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
__name(hashPassword, "hashPassword");
function safeEqual(a, b) {
  if (a.length !== b.length)
    return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
__name(safeEqual, "safeEqual");
function generateRecoveryCode() {
  const n = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 1e4);
  return n.toString().padStart(4, "0");
}
__name(generateRecoveryCode, "generateRecoveryCode");
function publicAccount(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    recoveryCode: row.recovery_code,
    createdAt: row.created_at,
    usernameChangedAt: row.username_changed_at,
    emailChangedAt: row.email_changed_at,
    passwordChangedAt: row.password_changed_at
  };
}
__name(publicAccount, "publicAccount");
function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}
__name(json, "json");
function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}
__name(bearerToken, "bearerToken");
async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
async function requireSession(request, env) {
  const token = bearerToken(request);
  if (!token)
    return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const session = await env.DB.prepare(
    "SELECT account_id, expires_at FROM sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!session || session.expires_at <= now)
    return null;
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(session.account_id).first();
  if (!account)
    return null;
  await env.DB.prepare(
    "UPDATE sessions SET expires_at = ?, last_seen = ? WHERE token_hash = ?"
  ).bind(now + SESSION_TTL_MS, now, tokenHash).run();
  return account;
}
__name(requireSession, "requireSession");
async function createSession(accountId, env) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)"
  ).bind(tokenHash, accountId, now, now + SESSION_TTL_MS, now).run();
  return token;
}
__name(createSession, "createSession");
function normalizeEmail(v) {
  if (typeof v !== "string")
    return null;
  const e = v.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
}
__name(normalizeEmail, "normalizeEmail");
function normalizeUsername(v) {
  if (typeof v !== "string")
    return null;
  const u = v.trim();
  return USERNAME_RE.test(u) ? u : null;
}
__name(normalizeUsername, "normalizeUsername");
function validPassword(v) {
  return typeof v === "string" && v.length >= MIN_PASSWORD_LEN && v.length <= MAX_PASSWORD_LEN;
}
__name(validPassword, "validPassword");
async function handleRegister(request, env, cors) {
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  if (!email)
    return json({ error: "Enter a valid email address." }, 400, cors);
  if (!username)
    return json({ error: "Username must be 3\u201316 letters, numbers, or underscores." }, 400, cors);
  if (!validPassword(body.password))
    return json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400, cors);
  const existing = await env.DB.prepare(
    "SELECT email, username FROM accounts WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE"
  ).bind(email, username).first();
  if (existing) {
    const emailTaken = (existing.email || "").toLowerCase() === email;
    return json(
      { error: emailTaken ? "That email is already registered." : "That username is taken." },
      409,
      cors
    );
  }
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.password, salt);
  const recoveryCode = generateRecoveryCode();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO accounts
         (id, email, username, password_hash, password_salt, recovery_code, created_at, last_seen, recovery_fail_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(id, email, username, passwordHash, salt, recoveryCode, now, now).run();
  } catch {
    return json({ error: "That email or username is already in use." }, 409, cors);
  }
  const token = await createSession(id, env);
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first();
  return json({ token, account: publicAccount(account), recoveryCode }, 200, cors);
}
__name(handleRegister, "handleRegister");
async function handleLogin(request, env, cors) {
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password)
    return json({ error: "Enter your email/username and password." }, 400, cors);
  const account = await env.DB.prepare(
    "SELECT * FROM accounts WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE"
  ).bind(identifier.toLowerCase(), identifier).first();
  const INVALID = json({ error: "Invalid credentials." }, 401, cors);
  if (!account || !account.password_hash)
    return INVALID;
  const candidate = await hashPassword(password, account.password_salt);
  if (!safeEqual(candidate, account.password_hash))
    return INVALID;
  const token = await createSession(account.id, env);
  return json({ token, account: publicAccount(account) }, 200, cors);
}
__name(handleLogin, "handleLogin");
async function handleLogout(request, env, cors) {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  return json({ ok: true }, 200, cors);
}
__name(handleLogout, "handleLogout");
async function handleMe(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  return json({ account: publicAccount(account) }, 200, cors);
}
__name(handleMe, "handleMe");
async function handleRecover(request, env, cors) {
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !username || !code || !validPassword(body.newPassword))
    return json({ error: "Provide email, username, your 4-digit code, and a new password." }, 400, cors);
  const account = await env.DB.prepare(
    "SELECT * FROM accounts WHERE email = ? COLLATE NOCASE AND username = ? COLLATE NOCASE"
  ).bind(email, username).first();
  const now = Date.now();
  const FAIL = json({ error: "Recovery details do not match." }, 400, cors);
  if (!account)
    return FAIL;
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
    ).bind(lockUntil ? 0 : fails, lockUntil, account.id).run();
    return FAIL;
  }
  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.newPassword, salt);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE accounts SET password_hash = ?, password_salt = ?, password_changed_at = ?, recovery_fail_count = 0, recovery_locked_until = NULL WHERE id = ?"
    ).bind(passwordHash, salt, now, account.id),
    // Recovering invalidates existing sessions everywhere.
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id)
  ]);
  return json({ ok: true }, 200, cors);
}
__name(handleRecover, "handleRecover");
function cooldownRemaining(changedAt, windowMs, now) {
  if (!changedAt)
    return 0;
  const elapsed = now - changedAt;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}
__name(cooldownRemaining, "cooldownRemaining");
async function handleChangeUsername(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);
  const newUsername = normalizeUsername(body.newUsername);
  if (!newUsername)
    return json({ error: "Username must be 3\u201316 letters, numbers, or underscores." }, 400, cors);
  const now = Date.now();
  const remaining = cooldownRemaining(account.username_changed_at, USERNAME_COOLDOWN_MS, now);
  if (remaining > 0)
    return json({ error: "Username was changed too recently.", retryAfterMs: remaining }, 429, cors);
  const clash = await env.DB.prepare(
    "SELECT id FROM accounts WHERE username = ? COLLATE NOCASE AND id != ?"
  ).bind(newUsername, account.id).first();
  if (clash)
    return json({ error: "That username is taken." }, 409, cors);
  await env.DB.prepare("UPDATE accounts SET username = ?, username_changed_at = ? WHERE id = ?").bind(newUsername, now, account.id).run();
  const updated = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(account.id).first();
  return json({ account: publicAccount(updated) }, 200, cors);
}
__name(handleChangeUsername, "handleChangeUsername");
async function handleChangeEmail(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);
  const newEmail = normalizeEmail(body.newEmail);
  if (!newEmail)
    return json({ error: "Enter a valid email address." }, 400, cors);
  const now = Date.now();
  const remaining = cooldownRemaining(account.email_changed_at, EMAIL_COOLDOWN_MS, now);
  if (remaining > 0)
    return json({ error: "Email was changed too recently.", retryAfterMs: remaining }, 429, cors);
  const clash = await env.DB.prepare(
    "SELECT id FROM accounts WHERE email = ? COLLATE NOCASE AND id != ?"
  ).bind(newEmail, account.id).first();
  if (clash)
    return json({ error: "That email is already registered." }, 409, cors);
  await env.DB.prepare("UPDATE accounts SET email = ?, email_changed_at = ? WHERE id = ?").bind(newEmail, now, account.id).run();
  const updated = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(account.id).first();
  return json({ account: publicAccount(updated) }, 200, cors);
}
__name(handleChangeEmail, "handleChangeEmail");
async function handleChangePassword(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!safeEqual(code, account.recovery_code))
    return json({ error: "Incorrect security code." }, 403, cors);
  if (!validPassword(body.newPassword))
    return json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` }, 400, cors);
  const now = Date.now();
  const remaining = cooldownRemaining(account.password_changed_at, PASSWORD_COOLDOWN_MS, now);
  if (remaining > 0)
    return json({ error: "Password was changed too recently.", retryAfterMs: remaining }, 429, cors);
  const salt = randomHex(16);
  const passwordHash = await hashPassword(body.newPassword, salt);
  await env.DB.prepare(
    "UPDATE accounts SET password_hash = ?, password_salt = ?, password_changed_at = ? WHERE id = ?"
  ).bind(passwordHash, salt, now, account.id).run();
  return json({ ok: true }, 200, cors);
}
__name(handleChangePassword, "handleChangePassword");
async function handleGetSave(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  const row = await env.DB.prepare("SELECT payload, updated_at FROM cloud_saves WHERE account_id = ?").bind(account.id).first();
  if (!row)
    return json({ save: null }, 200, cors);
  let save = null;
  try {
    save = JSON.parse(row.payload);
  } catch {
    save = null;
  }
  return json({ save, updatedAt: row.updated_at }, 200, cors);
}
__name(handleGetSave, "handleGetSave");
async function handlePutSave(request, env, cors) {
  const account = await requireSession(request, env);
  if (!account)
    return json({ error: "Not authenticated." }, 401, cors);
  const body = await readJson(request);
  if (!body)
    return json({ error: "Invalid JSON body" }, 400, cors);
  const payload = JSON.stringify(body);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO cloud_saves (account_id, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).bind(account.id, payload, now).run();
  return json({ ok: true, updatedAt: now }, 200, cors);
}
__name(handlePutSave, "handlePutSave");
async function handleAccountRequest(request, env, cors) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/account/"))
    return null;
  const m = request.method;
  try {
    if (path === "/api/account/register" && m === "POST")
      return await handleRegister(request, env, cors);
    if (path === "/api/account/login" && m === "POST")
      return await handleLogin(request, env, cors);
    if (path === "/api/account/logout" && m === "POST")
      return await handleLogout(request, env, cors);
    if (path === "/api/account/me" && m === "GET")
      return await handleMe(request, env, cors);
    if (path === "/api/account/recover" && m === "POST")
      return await handleRecover(request, env, cors);
    if (path === "/api/account/change-username" && m === "POST")
      return await handleChangeUsername(request, env, cors);
    if (path === "/api/account/change-email" && m === "POST")
      return await handleChangeEmail(request, env, cors);
    if (path === "/api/account/change-password" && m === "POST")
      return await handleChangePassword(request, env, cors);
    if (path === "/api/account/save" && m === "GET")
      return await handleGetSave(request, env, cors);
    if (path === "/api/account/save" && m === "PUT")
      return await handlePutSave(request, env, cors);
    return json({ error: "Account route not found" }, 404, cors);
  } catch (err) {
    return json({ error: "Account request failed", detail: String(err) }, 500, cors);
  }
}
__name(handleAccountRequest, "handleAccountRequest");

// src/index.ts
var CONFIG_ID = "multiplayer_preset";
function tokensMatch(a, b) {
  if (a.length !== b.length)
    return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
__name(tokensMatch, "tokensMatch");
function sanitizeConfigSettings(input) {
  if (!input || typeof input !== "object")
    return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (LIVE_CONFIG_KEY_SET.has(key))
      out[key] = value;
  }
  return out;
}
__name(sanitizeConfigSettings, "sanitizeConfigSettings");
var MAX_PLAYER_NAME_LENGTH = 10;
function normalizePlayerName(name) {
  if (typeof name !== "string")
    return void 0;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : void 0;
}
__name(normalizePlayerName, "normalizePlayerName");
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, Upgrade",
      "Access-Control-Expose-Headers": "ETag"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    const accountResponse = await handleAccountRequest(request, env, corsHeaders);
    if (accountResponse)
      return accountResponse;
    if (url.pathname === "/api/config" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT version, label, payload FROM game_config WHERE id = ?"
        ).bind(CONFIG_ID).first();
        if (!row) {
          return new Response(JSON.stringify({ error: "Config not initialized" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const etag = `"v${row.version}"`;
        if (request.headers.get("If-None-Match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": "no-cache", ...corsHeaders }
          });
        }
        const body = JSON.stringify({
          version: row.version,
          label: row.label ?? "",
          settings: JSON.parse(row.payload)
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: etag,
            "Cache-Control": "no-cache",
            ...corsHeaders
          }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to read config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }
    if (url.pathname === "/api/admin/config" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.ADMIN_TOKEN || !token || !tokensMatch(token, env.ADMIN_TOKEN)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let parsed;
      try {
        parsed = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const settings = sanitizeConfigSettings(parsed.settings);
      if (Object.keys(settings).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid gameplay settings provided" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      const label = typeof parsed.label === "string" ? parsed.label.slice(0, 60) : "";
      try {
        const current = await env.DB.prepare(
          "SELECT version FROM game_config WHERE id = ?"
        ).bind(CONFIG_ID).first();
        const nextVersion = (current?.version ?? 0) + 1;
        const now = Date.now();
        const payload = JSON.stringify(settings);
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO game_config (id, version, label, payload, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, 'admin')
             ON CONFLICT(id) DO UPDATE SET
               version = excluded.version,
               label = excluded.label,
               payload = excluded.payload,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`
          ).bind(CONFIG_ID, nextVersion, label, payload, now),
          env.DB.prepare(
            `INSERT INTO config_history (config_id, version, label, payload, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, 'admin')`
          ).bind(CONFIG_ID, nextVersion, label, payload, now)
        ]);
        try {
          const doId = env.GAME_LOBBY.idFromName("global-lobby");
          const stub = env.GAME_LOBBY.get(doId);
          ctx.waitUntil(
            stub.fetch(`https://do/internal/config-bump?version=${nextVersion}`)
          );
        } catch (e) {
        }
        return new Response(JSON.stringify({ ok: true, version: nextVersion }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to publish config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }
    if (url.pathname === "/ws" || url.pathname === "/" || url.pathname === "/api/my-ip") {
      const doId = env.GAME_LOBBY.idFromName("global-lobby");
      const stub = env.GAME_LOBBY.get(doId);
      const response = await stub.fetch(request);
      if (request.headers.get("Upgrade") === "websocket") {
        return response;
      }
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
var GameLobby = class {
  state;
  env;
  // In-memory data structures preserved as long as clients are connected
  rooms = /* @__PURE__ */ new Map();
  socketToRoom = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Set();
  // Quick Play matchmaking structures
  quickPlayQueue = /* @__PURE__ */ new Set();
  waitingQuickPlayClients = /* @__PURE__ */ new Map();
  // Helper to clean up dead sockets from the quickplay queue
  cleanQuickPlayQueue() {
    for (const socket of this.quickPlayQueue) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.quickPlayQueue.delete(socket);
      }
    }
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/config-bump") {
      const version = Number(url.searchParams.get("version")) || 0;
      this.broadcastConfigChanged(version);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/api/my-ip") {
      const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
      return new Response(
        JSON.stringify({
          ip: clientIp,
          lanIp: "127.0.0.1"
          // Worker environment runs in serverless, so internal LAN IP of host doesn't apply
        }),
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];
    const connectionType = url.searchParams.get("type") || "lobby";
    const nameParam = url.searchParams.get("name");
    await this.handleSession(serverSocket, connectionType, nameParam);
    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  }
  async handleSession(ws, connectionType, nameParam) {
    const gameWs = ws;
    gameWs.accept();
    this.sessions.add(gameWs);
    const wsId = Math.random().toString(36).substring(2, 9);
    gameWs.id = wsId;
    gameWs.connectionType = connectionType;
    gameWs.playerState = "menu";
    gameWs.roomCode = void 0;
    gameWs.spaceAvailable = false;
    gameWs.playerName = normalizePlayerName(nameParam);
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}, Type: ${connectionType}, Name: ${nameParam}`);
    gameWs.send(JSON.stringify({ type: "welcome", clientId: wsId }));
    this.updatePresence();
    gameWs.addEventListener("message", (event) => {
      try {
        const rawMessage = event.data;
        const message = JSON.parse(rawMessage);
        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable, name } = message;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${roomCode}, spaceAvailable: ${spaceAvailable}`);
            gameWs.playerState = status;
            gameWs.roomCode = roomCode;
            gameWs.spaceAvailable = spaceAvailable;
            gameWs.playerName = normalizePlayerName(name);
            this.updatePresence();
            break;
          }
          case "lobby_chat": {
            const { text, sender } = message;
            console.log(`Lobby chat message from ${wsId} (${sender}): ${text}`);
            const chatPayload = JSON.stringify({
              type: "lobby_chat",
              id: Math.random().toString(36).substring(2, 9),
              sender: sender || `Client ${wsId}`,
              text,
              timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              clientId: wsId
            });
            this.sessions.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(chatPayload);
                } catch (e) {
                }
              }
            });
            break;
          }
          case "ping": {
            const { timestamp } = message;
            try {
              gameWs.send(JSON.stringify({ type: "pong", timestamp }));
            } catch (e) {
            }
            break;
          }
          case "send_invite": {
            const { targetId, roomCode } = message;
            console.log(`Direct invite from ${wsId} to ${targetId} referencing room ${roomCode}`);
            let destSocket = null;
            for (const client of this.sessions) {
              if (client.id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              try {
                destSocket.send(JSON.stringify({
                  type: "receive_invite",
                  fromId: wsId,
                  roomCode
                }));
              } catch (e) {
              }
            }
            break;
          }
          case "decline_invite": {
            const { targetId } = message;
            console.log(`Direct invite declined from ${wsId} targeting original host ${targetId}`);
            let destSocket = null;
            for (const client of this.sessions) {
              if (client.id === targetId) {
                destSocket = client;
                break;
              }
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN) {
              try {
                destSocket.send(JSON.stringify({
                  type: "invite_declined",
                  fromId: wsId
                }));
              } catch (e) {
              }
            }
            break;
          }
          case "quickplay_join": {
            console.log(`Client ${wsId} requested Quick Play matchmaking.`);
            let foundRoomKey = null;
            for (const [key, room] of this.rooms.entries()) {
              if (room.clients.length === 0 && !room.quickplayReserved) {
                foundRoomKey = key;
                room.quickplayReserved = true;
                break;
              }
            }
            if (foundRoomKey) {
              console.log(`Quick Play Matchmaker found open hosted lobby for client ${wsId} under key: ${foundRoomKey}`);
              try {
                gameWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: foundRoomKey }));
              } catch (e) {
              }
              break;
            }
            this.cleanQuickPlayQueue();
            if (this.quickPlayQueue.size > 0) {
              const peerWs = this.quickPlayQueue.values().next().value;
              if (peerWs) {
                this.quickPlayQueue.delete(peerWs);
                if (peerWs.readyState === WebSocket.OPEN) {
                  const qpRoomCode = "QP_" + Math.floor(1e5 + Math.random() * 9e5).toString();
                  console.log(`Quick Play Matchmaker pairing client ${wsId} with peer ${peerWs.id}. Generated Room Code: ${qpRoomCode}`);
                  try {
                    peerWs.send(JSON.stringify({ type: "quickplay_host", roomCode: qpRoomCode }));
                  } catch (e) {
                  }
                  this.waitingQuickPlayClients.set(qpRoomCode, gameWs);
                  try {
                    gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
                  } catch (e) {
                  }
                  break;
                }
              }
            }
            this.quickPlayQueue.add(gameWs);
            console.log(`Client ${wsId} entered the Quick Play queue.`);
            try {
              gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
            } catch (e) {
            }
            break;
          }
          case "quickplay_leave": {
            this.quickPlayQueue.delete(gameWs);
            for (const [code, clientWs] of this.waitingQuickPlayClients.entries()) {
              if (clientWs === gameWs) {
                this.waitingQuickPlayClients.delete(code);
              }
            }
            console.log(`Client ${wsId} left Quick Play queue.`);
            break;
          }
          case "host": {
            const { ip, lanIp, customId } = message;
            const keysToRegister = [];
            if (ip)
              keysToRegister.push(ip);
            if (lanIp && lanIp !== "127.0.0.1")
              keysToRegister.push(lanIp);
            if (customId)
              keysToRegister.push(customId);
            console.log(`Registering host with keys: ${keysToRegister.join(", ")}`);
            const room = { host: gameWs, clients: [], observers: /* @__PURE__ */ new Set(), keys: keysToRegister };
            keysToRegister.forEach((key) => {
              const existing = this.rooms.get(key);
              if (existing) {
                if (existing.host !== gameWs) {
                  try {
                    existing.host.close();
                  } catch (e) {
                  }
                }
                if (existing.clients) {
                  existing.clients.forEach((c) => {
                    try {
                      c.close();
                    } catch (e) {
                    }
                  });
                }
              }
              this.rooms.set(key, room);
            });
            this.socketToRoom.set(gameWs, room);
            try {
              gameWs.send(JSON.stringify({ type: "hosted", keys: keysToRegister }));
            } catch (e) {
            }
            if (customId && this.waitingQuickPlayClients.has(customId)) {
              const guestWs = this.waitingQuickPlayClients.get(customId);
              this.waitingQuickPlayClients.delete(customId);
              if (guestWs && guestWs.readyState === WebSocket.OPEN) {
                console.log(`Quick Play Host registered. Dispatching match found to guest client ${guestWs.id}`);
                try {
                  guestWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: customId }));
                } catch (e) {
                }
              }
            }
            break;
          }
          case "join": {
            const { targetIpOrId, isObserver } = message;
            console.log(`Client attempting to join room matching: ${targetIpOrId} (isObserver: ${isObserver})`);
            let room = this.rooms.get(targetIpOrId);
            if (!room && this.rooms.size > 0) {
              const singleKey = Array.from(this.rooms.keys())[0];
              room = this.rooms.get(singleKey);
              console.log(`Fallback: Lobby lookup under "${targetIpOrId}" not found. Auto-paired with active lobby (key: ${singleKey})`);
            }
            if (!room) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match not found for: ${targetIpOrId}` }));
              } catch (e) {
              }
              return;
            }
            if (isObserver) {
              room.observers.add(gameWs);
              this.socketToRoom.set(gameWs, room);
              console.log(`Client ${wsId} connected as observer to room.`);
              try {
                gameWs.send(JSON.stringify({
                  type: "connected",
                  role: "observer",
                  hostClientId: room.host.id,
                  clientClientId: room.clients.length > 0 ? room.clients[0].id : void 0,
                  otherPlayerIds: [
                    room.host.id,
                    ...room.clients.map((c) => c.id)
                  ]
                }));
              } catch (e) {
              }
              const obsJoinedPayload = JSON.stringify({ type: "observer_joined", observerId: wsId });
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(obsJoinedPayload);
                } catch (e) {
                }
              }
              room.clients.forEach((c) => {
                if (c.readyState === WebSocket.OPEN) {
                  try {
                    c.send(obsJoinedPayload);
                  } catch (e) {
                  }
                }
              });
              break;
            }
            if (room.clients.length >= 7) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match is already full (8/8 players present).` }));
              } catch (e) {
              }
              return;
            }
            if (!room.clients.includes(gameWs) && !room.clients.some((c) => c.id === wsId)) {
              room.clients.push(gameWs);
            }
            this.socketToRoom.set(gameWs, room);
            try {
              gameWs.send(JSON.stringify({
                type: "connected",
                role: "client",
                hostClientId: room.host.id,
                clientClientId: wsId,
                otherPlayerIds: [
                  room.host.id,
                  ...room.clients.filter((c) => c.id !== wsId).map((c) => c.id)
                ]
              }));
            } catch (e) {
            }
            const clientJoinedPayload = JSON.stringify({
              type: "player_joined",
              role: "client",
              clientId: wsId,
              playerName: normalizePlayerName(gameWs.playerName) || `Client ${wsId}`
            });
            if (room.clients.length === 1) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(JSON.stringify({
                    type: "connected",
                    role: "host",
                    clientClientId: wsId,
                    otherPlayerIds: [
                      wsId
                    ]
                  }));
                } catch (e) {
                }
              }
            } else {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(clientJoinedPayload);
                } catch (e) {
                }
              }
            }
            room.clients.forEach((client) => {
              if (client !== gameWs && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(clientJoinedPayload);
                } catch (e) {
                }
              }
            });
            break;
          }
          case "sync": {
            let room = this.socketToRoom.get(gameWs);
            if (!room) {
              for (const r of Array.from(this.rooms.values())) {
                if (r.host === gameWs || r.clients.includes(gameWs) || r.observers.has(gameWs) || r.host && r.host.id === wsId || r.clients.some((c) => c.id === wsId)) {
                  room = r;
                  this.socketToRoom.set(gameWs, r);
                  break;
                }
              }
            }
            if (!room)
              return;
            const isHost = gameWs === room.host || gameWs.id === room.host.id;
            const isClient = room.clients.includes(gameWs) || room.clients.some((c) => c.id === wsId);
            const senderRole = isHost ? "host" : isClient ? "client" : "observer";
            let parsedMessage = message;
            try {
              parsedMessage = {
                ...message,
                senderRole,
                senderId: wsId
              };
            } catch (err) {
            }
            const syncPayload = JSON.stringify(parsedMessage);
            if (isHost) {
              room.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  try {
                    client.send(syncPayload);
                  } catch (e) {
                  }
                }
              });
              room.observers.forEach((obs) => {
                if (obs.readyState === WebSocket.OPEN) {
                  try {
                    obs.send(syncPayload);
                  } catch (e) {
                  }
                }
              });
            } else if (isClient) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(syncPayload);
                } catch (e) {
                }
              }
              room.clients.forEach((client) => {
                if (client !== gameWs && client.id !== wsId && client.readyState === WebSocket.OPEN) {
                  try {
                    client.send(syncPayload);
                  } catch (e) {
                  }
                }
              });
              room.observers.forEach((obs) => {
                if (obs.readyState === WebSocket.OPEN) {
                  try {
                    obs.send(syncPayload);
                  } catch (e) {
                  }
                }
              });
            }
            break;
          }
          default:
            break;
        }
      } catch (err) {
        console.error("Error processing websocket message:", err);
      }
    });
    gameWs.addEventListener("close", () => {
      console.log("WebSocket connection closed.");
      this.sessions.delete(gameWs);
      this.quickPlayQueue.delete(gameWs);
      for (const [code, clientWs] of this.waitingQuickPlayClients.entries()) {
        if (clientWs === gameWs) {
          this.waitingQuickPlayClients.delete(code);
        }
      }
      const room = this.socketToRoom.get(gameWs);
      if (room) {
        if (room.observers.has(gameWs)) {
          room.observers.delete(gameWs);
          this.socketToRoom.delete(gameWs);
          this.updatePresence();
          return;
        }
        const isHost = gameWs === room.host;
        if (isHost) {
          const disconnectPayload = JSON.stringify({ type: "disconnected", reason: "Host left the match." });
          room.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(disconnectPayload);
                client.close();
              } catch (e) {
              }
            }
          });
          room.observers.forEach((obs) => {
            if (obs.readyState === WebSocket.OPEN) {
              try {
                obs.send(disconnectPayload);
                obs.close();
              } catch (e) {
              }
            }
          });
          room.keys.forEach((key) => {
            this.rooms.delete(key);
          });
          this.socketToRoom.delete(room.host);
          room.clients.forEach((client) => this.socketToRoom.delete(client));
          room.observers.forEach((obs) => this.socketToRoom.delete(obs));
        } else {
          room.clients = room.clients.filter((c) => c !== gameWs && c.id !== wsId);
          this.socketToRoom.delete(gameWs);
          const playerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            reason: "A player left the match."
          });
          if (room.host && room.host.readyState === WebSocket.OPEN) {
            try {
              room.host.send(playerLeftPayload);
            } catch (e) {
            }
          }
          room.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(playerLeftPayload);
              } catch (e) {
              }
            }
          });
          room.observers.forEach((obs) => {
            if (obs.readyState === WebSocket.OPEN) {
              try {
                obs.send(playerLeftPayload);
              } catch (e) {
              }
            }
          });
        }
      }
      this.updatePresence();
    });
    gameWs.addEventListener("error", (err) => {
      console.error("WebSocket socket error:", err);
    });
  }
  // Broadcast a "config_changed" version nudge to every connected session.
  broadcastConfigChanged(version) {
    const payload = JSON.stringify({ type: "config_changed", version });
    this.sessions.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          console.error("Error broadcasting config_changed", err);
        }
      }
    });
  }
  // Broadcast updated presence count and clients list to everyone
  updatePresence() {
    const lobbyClients = Array.from(this.sessions).filter((client) => client.connectionType === "lobby");
    const onlineCount = lobbyClients.length;
    const clientPayloads = lobbyClients.map((client) => ({
      id: client.id,
      name: normalizePlayerName(client.playerName),
      state: client.playerState || "menu",
      roomCode: client.roomCode,
      spaceAvailable: client.spaceAvailable !== void 0 ? client.spaceAvailable : false
    })).filter((c) => Boolean(c.id));
    const presencePayload = JSON.stringify({
      type: "presence",
      onlineCount,
      clients: clientPayloads
    });
    this.sessions.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(presencePayload);
        } catch (err) {
          console.error("Error broadcasting presence", err);
        }
      }
    });
  }
};
__name(GameLobby, "GameLobby");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-WhSCvl/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-WhSCvl/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  GameLobby,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
