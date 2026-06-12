import { LIVE_CONFIG_KEY_SET } from "./liveConfigKeys";
import {
  handleAccountRequest,
  requireSessionAccountId,
  resolveAdminAccount,
  getRegisteredDisplayNameOwner,
} from "./accounts";
import { normalizeRegisteredDisplayName, resolvePublicDisplayName } from "./displayNames";
import { toAnalyticsDataPoint } from "./telemetrySchema";
import {
  createLobbyChatRateLimitState,
  type LobbyChatRateLimitState,
  validateLobbyChatMessage,
} from "./lobbyChatRateLimit";

export interface Env {
  GAME_LOBBY: DurableObjectNamespace;
  DB: D1Database;
  ADMIN_TOKEN?: string;
  // Optional so deployments without the binding (or older configs) don't break.
  TELEMETRY?: AnalyticsEngineDataset;
  REPLAYS?: R2Bucket;
}

// Bearer-token admin check, shared by config publish + replay export endpoints.
function isAdmin(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(env.ADMIN_TOKEN && token && tokensMatch(token, env.ADMIN_TOKEN));
}

// Hard cap on a single replay upload (bounds abuse of the open POST). A 20-min
// 8-player Grifball replay is ~18-25 MB gzipped, so 64 MB leaves comfortable margin.
const MAX_REPLAY_UPLOAD_BYTES = 64 * 1024 * 1024;

const CONFIG_ID = "multiplayer_preset";

// ── Telemetry helpers ────────────────────────────────────────────────────────

function telemetryNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function telemetryStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// Validate + normalize an incoming telemetry payload. Returns null when the body
// is malformed (missing anon id or fingerprint), which the caller rejects 400.
// Also caps string lengths and coerces numbers to bound abuse of the open POST.
function sanitizeTelemetry(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.anonId !== "string" || o.anonId.length === 0) return null;
  if (!o.player || typeof o.player !== "object") return null;
  const p = o.player as Record<string, unknown>;
  return {
    anonId: telemetryStr(o.anonId, 64),
    ts: telemetryNum(o.ts),
    appVersion: telemetryStr(o.appVersion, 32),
    liveConfigVersion: telemetryNum(o.liveConfigVersion),
    fingerprintSchema: telemetryNum(o.fingerprintSchema),
    map: telemetryStr(o.map, 32),
    mode: telemetryStr(o.mode, 32),
    aiDifficulty: telemetryStr(o.aiDifficulty, 32),
    aiArchetype: telemetryStr(o.aiArchetype, 32),
    gameMode: telemetryStr(o.gameMode, 32),
    scorePlayer: telemetryNum(o.scorePlayer),
    scoreEnemy: telemetryNum(o.scoreEnemy),
    playerKills: telemetryNum(o.playerKills),
    playerDeaths: telemetryNum(o.playerDeaths),
    durationSeconds: telemetryNum(o.durationSeconds),
    // Match context
    isMultiplayer: telemetryNum(o.isMultiplayer),
    opponentCount: telemetryNum(o.opponentCount),
    multikills: telemetryNum(o.multikills),
    sprees: telemetryNum(o.sprees),
    // Raw per-match action volumes
    lungeAttempts: telemetryNum(o.lungeAttempts),
    lungeHits: telemetryNum(o.lungeHits),
    hammerAttacks: telemetryNum(o.hammerAttacks),
    weaponSwaps: telemetryNum(o.weaponSwaps),
    dashes: telemetryNum(o.dashes),
    countersAttempted: telemetryNum(o.countersAttempted),
    countersLanded: telemetryNum(o.countersLanded),
    damageDealtCount: telemetryNum(o.damageDealtCount),
    damageReceivedCount: telemetryNum(o.damageReceivedCount),
    player: {
      avgLungeDistance: telemetryNum(p.avgLungeDistance),
      lungeFrequency: telemetryNum(p.lungeFrequency),
      dodgeBiasX: telemetryNum(p.dodgeBiasX),
      dodgeBiasZ: telemetryNum(p.dodgeBiasZ),
      counterRate: telemetryNum(p.counterRate),
      approachSpeed: telemetryNum(p.approachSpeed),
      edgeProximity: telemetryNum(p.edgeProximity),
      reactionTime: telemetryNum(p.reactionTime),
      sampleCount: telemetryNum(p.sampleCount),
    },
  };
}

function getLobbyStub(env: Env): DurableObjectStub {
  const id = env.GAME_LOBBY.idFromName("global-lobby");
  return env.GAME_LOBBY.get(id);
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// Re-emit a DO response body with CORS + JSON headers attached.
async function withCorsJson(r: Response, cors: Record<string, string>): Promise<Response> {
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

interface GameConfigRow {
  version: number;
  label: string | null;
  payload: string;
}

// Constant-time-ish string compare to avoid leaking token length/contents via timing.
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Drop unknown / identity keys; keep only governed mechanic keys.
function sanitizeConfigSettings(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (LIVE_CONFIG_KEY_SET.has(key)) out[key] = value;
  }
  return out;
}

interface Room {
  host: GameWebSocket;
  clients: GameWebSocket[]; // Array of up to MAX_ROOM_CLIENTS guest clients
  observers: Set<GameWebSocket>;
  keys: string[];
  lobbyConfig: MatchLobbyConfig;
  passwordHash?: string;
  inviteTokens: Map<string, string>;
  matchStarted: boolean;
  quickplayReserved?: boolean;
}

type MatchLobbyAccess = "open" | "private" | "password";
type MatchLobbyGameMode = "sandbox" | "grifball";
type ModelSystem = "v1" | "v2" | "v3";
type VisualModelPolicy = ModelSystem;

const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = "v2";

interface MatchLobbyConfig {
  access: MatchLobbyAccess;
  gameMode: MatchLobbyGameMode;
  selectedMap: string;
  customMap?: unknown;
  maxPlayers: number;
  allowObservers: boolean;
  matchTimerSeconds: number;
  winTarget: number;
  visualModelPolicy: VisualModelPolicy;
}

interface MatchLobbySummary {
  access: MatchLobbyAccess;
  gameMode: MatchLobbyGameMode;
  selectedMap: string;
  customMapName?: string;
  maxPlayers: number;
  allowObservers: boolean;
  matchTimerSeconds: number;
  winTarget: number;
  visualModelPolicy: VisualModelPolicy;
  hasPassword: boolean;
  inProgress?: boolean;
}

interface GameWebSocket extends WebSocket {
  id?: string;
  accountId?: string;
  onlineInstanceId?: string;
  publicDisplayName?: string;
  playerState?: 'menu' | 'solo' | 'multi';
  roomCode?: string;
  spaceAvailable?: boolean;
  playerName?: string;
  playerHue?: number;
  playerLoadout?: unknown;
  playerCount?: number;
  maxPlayers?: number;
  lobbyStartedAt?: number;
  lobby?: MatchLobbySummary;
  lobbyChatRateLimit?: LobbyChatRateLimitState;
}

const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_ROOM_CLIENTS = 7;
const MAX_ROOM_PLAYERS = 1 + MAX_ROOM_CLIENTS;
const DEFAULT_IBRAWLS_KILL_TARGET = 25;
const DEFAULT_GRIFBALL_GOAL_TARGET = 5;
const DEFAULT_MATCH_TIMER_SECONDS = 522;
const SIGNED_IN_ELSEWHERE_CLOSE_CODE = 4001;
const SIGNED_IN_ELSEWHERE_MESSAGE = "Signed in elsewhere. This page was taken offline to prevent account cloning.";

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeModelSystem(value: unknown): ModelSystem | undefined {
  return value === "v1" || value === "v2" || value === "v3" ? value : undefined;
}

function normalizeVisualModelPolicy(value: unknown): VisualModelPolicy {
  return value === "v1" || value === "v2" ? value : DEFAULT_VISUAL_MODEL_POLICY;
}

export function normalizeMatchLobbyConfig(input: unknown): MatchLobbyConfig {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const gameMode = raw.gameMode === "grifball" ? "grifball" : "sandbox";
  const fallbackTarget = gameMode === "grifball" ? DEFAULT_GRIFBALL_GOAL_TARGET : DEFAULT_IBRAWLS_KILL_TARGET;
  const access = raw.access === "private" || raw.access === "password" ? raw.access : "open";
  return {
    access,
    gameMode,
    selectedMap: normalizeString(raw.selectedMap, "hangar", 64),
    customMap: raw.customMap ?? null,
    maxPlayers: clampInt(raw.maxPlayers, MAX_ROOM_PLAYERS, 1, MAX_ROOM_PLAYERS),
    allowObservers: raw.allowObservers !== false,
    matchTimerSeconds: clampInt(raw.matchTimerSeconds, DEFAULT_MATCH_TIMER_SECONDS, 60, 60 * 60),
    winTarget: clampInt(raw.winTarget, fallbackTarget, 1, 100),
    visualModelPolicy: normalizeVisualModelPolicy(raw.visualModelPolicy),
  };
}

function sanitizeLobbyPassword(password: unknown): string | undefined {
  if (typeof password !== "string") return undefined;
  const normalized = password.trim().slice(0, 64);
  return normalized.length > 0 ? normalized : undefined;
}

function hashLobbyPassword(password: string): string {
  let hash = 2166136261;
  for (let i = 0; i < password.length; i += 1) {
    hash ^= password.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createInviteToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getCustomMapName(customMap: unknown): string | undefined {
  if (!customMap || typeof customMap !== "object") return undefined;
  const name = (customMap as Record<string, unknown>).name;
  if (typeof name !== "string") return undefined;
  const normalized = name.trim().slice(0, 64);
  return normalized.length > 0 ? normalized : undefined;
}

export function createMatchLobbySummary(
  config: MatchLobbyConfig,
  { hasPassword = config.access === "password", inProgress = false }: { hasPassword?: boolean; inProgress?: boolean } = {},
): MatchLobbySummary {
  return {
    access: config.access,
    gameMode: config.gameMode,
    selectedMap: config.selectedMap,
    customMapName: getCustomMapName(config.customMap),
    maxPlayers: config.maxPlayers,
    allowObservers: config.allowObservers,
    matchTimerSeconds: config.matchTimerSeconds,
    winTarget: config.winTarget,
    visualModelPolicy: config.visualModelPolicy,
    hasPassword,
    inProgress,
  };
}

function buildPresenceLobbySummary(value: unknown): MatchLobbySummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return createMatchLobbySummary(normalizeMatchLobbyConfig(raw), {
    hasPassword: Boolean(raw.hasPassword),
    inProgress: Boolean(raw.inProgress),
  });
}

function getRoomPlayerCount(room: Room): number {
  return 1 + room.clients.length;
}

function hasRoomPlayerSpace(room: Room): boolean {
  return getRoomPlayerCount(room) < room.lobbyConfig.maxPlayers;
}

function getInviteTokenBypass(room: Room, clientId: string, inviteToken: unknown): boolean {
  return typeof inviteToken === "string" && room.inviteTokens.get(clientId) === inviteToken;
}

function normalizePlayerName(name: unknown): string | undefined {
  return normalizeRegisteredDisplayName(name) ?? undefined;
}

function normalizePlayerHue(hue: unknown): number | undefined {
  if (typeof hue !== "number" || !Number.isFinite(hue)) return undefined;
  return Math.max(0, Math.min(360, Math.round(hue)));
}

const LOADOUT_PRESETS: Record<string, Set<string>> = {
  helmet: new Set(["mark-vi", "odst", "recon", "eva", "gungnir", "eod", "hayabusa", "cqb"]),
  torso: new Set(["mark-vi", "scout", "recon", "eod", "hayabusa"]),
  arm: new Set(["mark-vi", "odst", "recon", "eod", "hayabusa"]),
  leg: new Set(["mark-vi", "jump-jet", "odst", "eod", "hayabusa"]),
  hammerPreset: new Set(["default", "akelas", "akelus", "paegaas", "sepulotez", "halbashi", "eektah-fel", "gravity-axe", "gravity-mace", "fist-of-rukt"]),
  swordPreset: new Set(["default", "halo-ce", "halo-2", "halo-3", "reach", "anniversary", "halo-4", "h2a-blue", "h2a-pink", "halo-5", "infinite"]),
};

const CUSTOM_ARMOR_SLOTS = new Set(["helmet", "torso", "arm", "leg"]);
const CUSTOM_ARMOR_MAX_SELECTED_BYTES = 128_000;
const CUSTOM_ARMOR_SLOT_MAX_VOXELS: Record<string, number> = {
  helmet: 900,
  torso: 1600,
  arm: 900,
  leg: 1000,
};
const LARGE_CUSTOM_ARMOR_SLOT_MAX_VOXELS: Record<string, number> = {
  helmet: 1200,
  torso: 3800,
  arm: 1600,
  leg: 2000,
};
const CUSTOM_ARMOR_ROLE_SET = new Set(["primary", "secondary", "accent", "visor", "dark", "highlight", "fixed"]);
const CUSTOM_ARMOR_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeCharacterModelType(value: unknown, modelSystem?: unknown): "medium" | "large" {
  if (modelSystem === "v1" || modelSystem === "v3") return "medium";
  return value === "large" ? "large" : "medium";
}

function sanitizeCustomArmorSnapshot(
  snapshot: unknown,
  expectedSlot: string,
  expectedModelType: "medium" | "large"
): unknown | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  const raw = snapshot as Record<string, unknown>;
  if (raw.version !== 1 || raw.slot !== expectedSlot) return undefined;
  if (!Array.isArray(raw.voxels)) return undefined;
  const modelType = normalizeCharacterModelType(raw.modelType, "v2");
  if (modelType !== expectedModelType) return undefined;
  const maxVoxels = (modelType === "large" ? LARGE_CUSTOM_ARMOR_SLOT_MAX_VOXELS : CUSTOM_ARMOR_SLOT_MAX_VOXELS)[expectedSlot] ?? 0;
  const seen = new Set<string>();
  const voxels: Record<string, unknown>[] = [];
  for (const value of raw.voxels) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const voxel = value as Record<string, unknown>;
    if (!Number.isInteger(voxel.x) || !Number.isInteger(voxel.y) || !Number.isInteger(voxel.z)) continue;
    const key = `${voxel.x},${voxel.y},${voxel.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = typeof voxel.role === "string" && CUSTOM_ARMOR_ROLE_SET.has(voxel.role) ? voxel.role : "primary";
    const out: Record<string, unknown> = {
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      role,
    };
    if (role === "fixed" && typeof voxel.color === "string" && CUSTOM_ARMOR_HEX_COLOR.test(voxel.color)) {
      out.color = voxel.color;
    }
    if (voxel.emissive === true) out.emissive = true;
    voxels.push(out);
    if (voxels.length >= maxVoxels) break;
  }
  if (voxels.length === 0) return undefined;
  const sanitized = {
    version: 1,
    id: typeof raw.id === "string" ? raw.id.slice(0, 80) : `remote_${expectedSlot}`,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 32) || "Custom Armor" : "Custom Armor",
    slot: expectedSlot,
    modelType,
    sourcePreset: typeof raw.sourcePreset === "string" ? raw.sourcePreset.slice(0, 32) : undefined,
    voxels,
    thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail.slice(0, 160) : undefined,
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
  return JSON.stringify(sanitized).length <= CUSTOM_ARMOR_MAX_SELECTED_BYTES ? sanitized : undefined;
}

export function normalizePlayerLoadout(loadout: unknown): unknown | undefined {
  if (!loadout || typeof loadout !== "object" || Array.isArray(loadout)) return undefined;
  const raw = loadout as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(LOADOUT_PRESETS)) {
    const value = raw[key];
    if (typeof value === "string" && allowed.has(value)) out[key] = value;
  }
  const modelSystem = normalizeModelSystem(raw.modelSystem);
  if (modelSystem) out.modelSystem = modelSystem;
  const modelType = normalizeCharacterModelType(raw.modelType, raw.modelSystem);
  if (out.modelSystem === "v2") out.modelType = modelType;
  if (raw.paintJob && typeof raw.paintJob === "object" && !Array.isArray(raw.paintJob)) {
    const paintPayload = JSON.stringify(raw.paintJob);
    if (paintPayload.length <= 48_000) out.paintJob = raw.paintJob;
  }
  if (raw.customArmor && typeof raw.customArmor === "object" && !Array.isArray(raw.customArmor)) {
    const customArmor: Record<string, unknown> = {};
    for (const slot of CUSTOM_ARMOR_SLOTS) {
      const snapshot = sanitizeCustomArmorSnapshot((raw.customArmor as Record<string, unknown>)[slot], slot, modelType);
      if (snapshot) customArmor[slot] = snapshot;
    }
    if (Object.keys(customArmor).length > 0) out.customArmor = customArmor;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function applyGameplayIdentity(socket: GameWebSocket, message: any) {
  const hue = normalizePlayerHue(message?.hue);
  const loadout = normalizePlayerLoadout(message?.loadout);
  if (hue !== undefined) socket.playerHue = hue;
  if (loadout) socket.playerLoadout = loadout;
}

const PUBLIC_ROOM_CODE_PATTERN = /^(?:\d{6}|QP_\d{6})$/i;

function normalizePublicRoomCode(roomCode: unknown): string | undefined {
  if (typeof roomCode !== "string") return undefined;
  const normalized = roomCode.trim();
  return PUBLIC_ROOM_CODE_PATTERN.test(normalized) ? normalized.toUpperCase() : undefined;
}

function normalizePresenceId(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}

// 1. Entrypoint Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Common CORS Headers. Authorization + If-None-Match are needed for the
    // cross-origin config API (publish auth + ETag revalidation); ETag must be
    // exposed so the browser lets the client read it for caching.
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, Upgrade",
      "Access-Control-Expose-Headers": "ETag",
    };

    // Handle CORS preflight options
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // ── Accounts (D1-backed): registration, login, recovery, profile, cloud save ──
    const accountResponse = await handleAccountRequest(request, env, corsHeaders);
    if (accountResponse) return accountResponse;

    // ── Live Tuning / Official Multiplayer Preset (D1-backed) ──────────────────

    // GET /api/config — public read of the authoritative gameplay preset.
    if (url.pathname === "/api/config" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT version, label, payload FROM game_config WHERE id = ?"
        )
          .bind(CONFIG_ID)
          .first<GameConfigRow>();

        if (!row) {
          return new Response(JSON.stringify({ error: "Config not initialized" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const etag = `"v${row.version}"`;
        // ETag short-circuit: client already has this version.
        if (request.headers.get("If-None-Match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": "no-cache", ...corsHeaders },
          });
        }

        const body = JSON.stringify({
          version: row.version,
          label: row.label ?? "",
          settings: JSON.parse(row.payload),
        });
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: etag,
            "Cache-Control": "no-cache",
            ...corsHeaders,
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to read config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // POST /api/admin/config — publish a new official preset. Requires an admin
    // ACCOUNT session (self-promoted via /api/account/promote), not the shared token.
    if (url.pathname === "/api/admin/config" && request.method === "POST") {
      const adminAccount = await resolveAdminAccount(request, env);
      if (!adminAccount) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      let parsed: { settings?: unknown; label?: unknown };
      try {
        parsed = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
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
        )
          .bind(CONFIG_ID)
          .first<{ version: number }>();
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
          ).bind(CONFIG_ID, nextVersion, label, payload, now),
        ]);

        // Poke the lobby DO so connected clients get a "config_changed" nudge.
        try {
          const doId = env.GAME_LOBBY.idFromName("global-lobby");
          const stub = env.GAME_LOBBY.get(doId);
          ctx.waitUntil(
            stub.fetch(`https://do/internal/config-bump?version=${nextVersion}`)
          );
        } catch (e) {
          // Broadcast is best-effort; clients also re-fetch on lobby entry.
        }

        return new Response(JSON.stringify({ ok: true, version: nextVersion }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to publish config", detail: String(err) }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // ── Match telemetry (anonymous gameplay data → Analytics Engine) ──────────
    // Adaptive admission lives in the lobby DO; the entrypoint validates and
    // forwards. Both endpoints are public (no admin token) but the open POST is
    // size-/shape-validated and rate-governed by the DO.

    // GET /api/telemetry/policy — current admission probability for client self-sampling.
    if (url.pathname === "/api/telemetry/policy" && request.method === "GET") {
      const stub = getLobbyStub(env);
      const r = await stub.fetch("https://do/internal/telemetry-policy");
      return withCorsJson(r, corsHeaders);
    }

    // POST /api/telemetry/match — submit one match's anonymous fingerprint + outcome.
    if (url.pathname === "/api/telemetry/match" && request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
      }
      const clean = sanitizeTelemetry(body);
      if (!clean) {
        return jsonResponse({ error: "Invalid telemetry payload" }, 400, corsHeaders);
      }
      const stub = getLobbyStub(env);
      const r = await stub.fetch("https://do/internal/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      return withCorsJson(r, corsHeaders);
    }

    // ── Replay corpus (gzipped blobs → R2, manifest → D1) ─────────────────────
    // Upload is public (clients contribute sampled matches automatically); it is size-
    // capped and rate-limited per-anon + per-IP via the lobby DO. list/object are
    // admin-gated for the offline download script.

    // POST /api/replay/upload?id=&sha256=&... — raw gzipped replay JSON is the body.
    if (url.pathname === "/api/replay/upload" && request.method === "POST") {
      if (!env.REPLAYS) {
        return jsonResponse({ error: "Replay storage not configured" }, 503, corsHeaders);
      }
      const p = url.searchParams;
      const id = (p.get("id") || "").slice(0, 64);
      const sha256 = (p.get("sha256") || "").toLowerCase();
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(sha256)) {
        return jsonResponse({ error: "Invalid id or sha256" }, 400, corsHeaders);
      }
      // Rate-limit the open upload BEFORE buffering the (large) body or touching R2/D1.
      // The lobby DO holds a shared per-anon + per-IP sliding window. Fail-open if the
      // DO is briefly unreachable so legitimate uploads aren't lost to a transient hiccup.
      const uploadAnonId = (p.get("anonId") || "").slice(0, 64);
      const uploadIp = request.headers.get("CF-Connecting-IP") || "";
      try {
        const admitRes = await getLobbyStub(env).fetch("https://do/internal/replay-admit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anonId: uploadAnonId, ip: uploadIp }),
        });
        const decision = (await admitRes.json().catch(() => ({ admitted: true }))) as {
          admitted?: boolean;
          retryAfterSeconds?: number;
        };
        if (decision.admitted === false) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded" }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(decision.retryAfterSeconds ?? 60),
                ...corsHeaders,
              },
            },
          );
        }
      } catch {
        /* fail-open: never drop a legit upload on a DO hiccup */
      }
      const body = await request.arrayBuffer();
      if (body.byteLength === 0) {
        return jsonResponse({ error: "Empty body" }, 400, corsHeaders);
      }
      if (body.byteLength > MAX_REPLAY_UPLOAD_BYTES) {
        return jsonResponse({ error: "Replay too large" }, 413, corsHeaders);
      }
      const key = `replays/${id}.json.gz`;
      try {
        await env.REPLAYS.put(key, body, {
          httpMetadata: { contentType: "application/gzip" },
          customMetadata: { sha256 },
        });
        await env.DB.prepare(
          `INSERT INTO replay_index
             (id, anon_id, created_at, duration_s, players, map, mode, game_mode, r2_key, size_bytes, sha256, schema_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             created_at = excluded.created_at,
             size_bytes = excluded.size_bytes,
             sha256 = excluded.sha256`,
        )
          .bind(
            id,
            uploadAnonId || null,
            Date.now(),
            Number(p.get("duration")) || 0,
            Number(p.get("players")) || 0,
            (p.get("map") || "").slice(0, 32),
            (p.get("mode") || "").slice(0, 32),
            (p.get("gameMode") || "").slice(0, 32),
            key,
            body.byteLength,
            sha256,
            Number(p.get("schemaVersion")) || 0,
          )
          .run();
        return jsonResponse({ ok: true, id, key, size: body.byteLength }, 200, corsHeaders);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to store replay", detail: String(err) },
          500,
          corsHeaders,
        );
      }
    }

    // GET /api/replay/list — admin: enumerate the manifest for the download script.
    if (url.pathname === "/api/replay/list" && request.method === "GET") {
      if (!isAdmin(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }
      const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 10000);
      try {
        const rows = await env.DB.prepare(
          `SELECT id, anon_id, created_at, duration_s, players, map, mode, game_mode,
                  r2_key, size_bytes, sha256, schema_version
             FROM replay_index ORDER BY created_at DESC LIMIT ?`,
        )
          .bind(limit)
          .all();
        return jsonResponse({ ok: true, replays: rows.results ?? [] }, 200, corsHeaders);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to list replays", detail: String(err) },
          500,
          corsHeaders,
        );
      }
    }

    // GET /api/replay/object?id=... — admin: stream a gzipped replay blob from R2.
    if (url.pathname === "/api/replay/object" && request.method === "GET") {
      if (!isAdmin(request, env)) {
        return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
      }
      if (!env.REPLAYS) {
        return jsonResponse({ error: "Replay storage not configured" }, 503, corsHeaders);
      }
      const id = (url.searchParams.get("id") || "").slice(0, 64);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
        return jsonResponse({ error: "Invalid id" }, 400, corsHeaders);
      }
      const obj = await env.REPLAYS.get(`replays/${id}.json.gz`);
      if (!obj) {
        return jsonResponse({ error: "Not found" }, 404, corsHeaders);
      }
      return new Response(obj.body, {
        status: 200,
        headers: { "Content-Type": "application/gzip", ...corsHeaders },
      });
    }

    // Route matchmaking, WebSocket, and IP requests to the same global Durable Object instance
    // to maintain a centralized state (lobby, chat, matchmaking, etc.)
    if (
      url.pathname === "/ws" ||
      url.pathname === "/" || 
      url.pathname === "/api/my-ip"
    ) {
      const doId = env.GAME_LOBBY.idFromName("global-lobby");
      const stub = env.GAME_LOBBY.get(doId);
      
      // Forward the request to the Durable Object
      const response = await stub.fetch(request);
      
      // For WebSocket upgrades, we MUST return the DO response object directly 
      // to preserve the native upgraded `webSocket` property!
      if (request.headers.get("Upgrade") === "websocket") {
        return response;
      }

      // Inject CORS headers into standard HTTP responses
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

// 2. Durable Object Coordinator
export class GameLobby implements DurableObject {
  state: DurableObjectState;
  env: Env;
  
  // In-memory data structures preserved as long as clients are connected
  rooms = new Map<string, Room>();
  socketToRoom = new Map<GameWebSocket, Room>();
  sessions = new Set<GameWebSocket>();

  // Quick Play matchmaking structures
  quickPlayQueue = new Set<GameWebSocket>();
  waitingQuickPlayClients = new Map<string, GameWebSocket>();
  lobbyStartedAtByRoomCode = new Map<string, number>();

  // ── Telemetry admission governor ───────────────────────────────────────────
  // Sliding window of recent submissions (ephemeral; resets on DO eviction, which
  // just means a brief window of full admission — acceptable). Below the active-
  // sender threshold every match is admitted; above it, admission scales as
  // threshold / activeSenders so the effective volume stays ~threshold.
  telemetryWindow: { t: number; anonId: string }[] = [];
  readonly TELEMETRY_WINDOW_MS = 5 * 60_000;
  readonly TELEMETRY_ACTIVE_THRESHOLD = 50;
  readonly TELEMETRY_MIN_PROBABILITY = 0.02;

  computeAdmissionProbability(now: number): number {
    const cutoff = now - this.TELEMETRY_WINDOW_MS;
    this.telemetryWindow = this.telemetryWindow.filter((e) => e.t >= cutoff);
    const distinct = new Set(this.telemetryWindow.map((e) => e.anonId)).size;
    if (distinct <= this.TELEMETRY_ACTIVE_THRESHOLD) return 1;
    return Math.max(this.TELEMETRY_MIN_PROBABILITY, this.TELEMETRY_ACTIVE_THRESHOLD / distinct);
  }

  // ── Replay upload rate limiter ─────────────────────────────────────────────
  // The upload endpoint is public and unauthenticated (clients contribute every match),
  // and each blob is large, so it needs an abuse ceiling. Sliding window per anon AND
  // per IP (ephemeral; resets on DO eviction, which just re-opens the window briefly —
  // acceptable). Only ADMITTED uploads are recorded, so a flood past the cap keeps
  // getting rejected without growing the window. With client sampling at 0.25, a real
  // player uploads well under these caps; they only bite automated abuse.
  replayWindow: { t: number; anonId: string; ip: string }[] = [];
  readonly REPLAY_WINDOW_MS = 10 * 60_000;
  readonly REPLAY_MAX_PER_ANON = 8;
  readonly REPLAY_MAX_PER_IP = 20;

  admitReplayUpload(
    now: number,
    anonId: string,
    ip: string,
  ): { admitted: boolean; retryAfterSeconds: number } {
    const cutoff = now - this.REPLAY_WINDOW_MS;
    this.replayWindow = this.replayWindow.filter((e) => e.t >= cutoff);
    const anonCount = anonId
      ? this.replayWindow.filter((e) => e.anonId === anonId).length
      : 0;
    const ipCount = ip ? this.replayWindow.filter((e) => e.ip === ip).length : 0;
    if (anonCount >= this.REPLAY_MAX_PER_ANON || ipCount >= this.REPLAY_MAX_PER_IP) {
      // Time until the oldest relevant entry ages out of the window.
      const relevant = this.replayWindow.filter(
        (e) => (anonId && e.anonId === anonId) || (ip && e.ip === ip),
      );
      const oldest = relevant.reduce((min, e) => Math.min(min, e.t), now);
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.REPLAY_WINDOW_MS - now) / 1000));
      return { admitted: false, retryAfterSeconds };
    }
    this.replayWindow.push({ t: now, anonId, ip });
    return { admitted: true, retryAfterSeconds: 0 };
  }

  writeTelemetryDataPoint(body: Record<string, unknown>): void {
    if (!this.env.TELEMETRY) return;
    try {
      // Positional layout comes from the canonical schema (single source of truth
      // shared with the offline analysis); see worker/src/telemetrySchema.ts.
      this.env.TELEMETRY.writeDataPoint(toAnalyticsDataPoint(body));
    } catch {
      /* AE write is best-effort; never fail the request on telemetry */
    }
  }

  getSocketId(socket: GameWebSocket): string {
    return String(socket.id || "");
  }

  getActivePublicDisplayNames(exclude?: GameWebSocket): Set<string> {
    const names = new Set<string>();
    this.sessions.forEach(socket => {
      if (socket === exclude) return;
      if (socket.publicDisplayName) names.add(socket.publicDisplayName);
    });
    return names;
  }

  getSocketPublicDisplayName(socket: GameWebSocket): string {
    const socketId = this.getSocketId(socket);
    return socket.publicDisplayName || normalizePlayerName(socket.playerName) || `Client ${socketId}`;
  }

  async updateSocketDisplayName(socket: GameWebSocket, requestedName: unknown): Promise<void> {
    const baseName = normalizePlayerName(requestedName);
    socket.playerName = baseName;
    if (!baseName) {
      socket.publicDisplayName = undefined;
      return;
    }

    const ownerAccountId = await getRegisteredDisplayNameOwner(this.env, baseName);
    socket.publicDisplayName = resolvePublicDisplayName({
      requestedName: baseName,
      accountId: socket.accountId,
      registeredOwnerAccountId: ownerAccountId,
      activeDisplayNames: this.getActivePublicDisplayNames(socket),
    });
  }

  getRoomPublicCode(room: Room): string | undefined {
    for (const key of room.keys) {
      const publicCode = normalizePublicRoomCode(key);
      if (publicCode) return publicCode;
    }
    return undefined;
  }

  getLobbyStartedAt(roomCode: string): number {
    const existing = this.lobbyStartedAtByRoomCode.get(roomCode);
    if (existing) return existing;
    const startedAt = Date.now();
    this.lobbyStartedAtByRoomCode.set(roomCode, startedAt);
    return startedAt;
  }

  pruneInactiveLobbyStartTimes(activeRoomCodes: Set<string>) {
    for (const roomCode of this.lobbyStartedAtByRoomCode.keys()) {
      if (!activeRoomCodes.has(roomCode)) {
        this.lobbyStartedAtByRoomCode.delete(roomCode);
      }
    }
  }

  getSocketParticipantEntry(socket: GameWebSocket, role: "host" | "client" | "observer", spawnSlot?: number) {
    const socketId = this.getSocketId(socket);
    return {
      clientId: socketId,
      role,
      spawnSlot,
      playerName: this.getSocketPublicDisplayName(socket),
      hue: normalizePlayerHue(socket.playerHue),
      loadout: normalizePlayerLoadout(socket.playerLoadout),
    };
  }

  getRoomPlayerEntries(room: Room) {
    return [
      this.getSocketParticipantEntry(room.host, "host", 0),
      ...room.clients.map((client, index) => this.getSocketParticipantEntry(client, "client", index + 1)),
    ];
  }

  getRoomParticipantEntries(room: Room) {
    return [
      ...this.getRoomPlayerEntries(room),
      ...Array.from(room.observers).map(observer => this.getSocketParticipantEntry(observer, "observer")),
    ];
  }

  getOtherRoomPlayerEntries(room: Room, selfId: string) {
    return this.getRoomPlayerEntries(room).filter(player => player.clientId !== selfId);
  }

  getOtherRoomParticipantEntries(room: Room, selfId: string) {
    return this.getRoomParticipantEntries(room).filter(player => player.clientId !== selfId);
  }

  getRoomSpawnSlot(room: Room, socket: GameWebSocket): number {
    const socketId = this.getSocketId(socket);
    if (room.host === socket || this.getSocketId(room.host) === socketId) return 0;
    const index = room.clients.findIndex(client => client === socket || this.getSocketId(client) === socketId);
    return index >= 0 ? index + 1 : 0;
  }

  // Helper to clean up dead sockets from the quickplay queue
  cleanQuickPlayQueue() {
    for (const socket of this.quickPlayQueue) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.quickPlayQueue.delete(socket);
      }
    }
  }

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal poke from the entrypoint after an admin publishes a new config.
    // Broadcast a lightweight version ping; clients re-fetch GET /api/config.
    if (url.pathname === "/internal/config-bump") {
      const version = Number(url.searchParams.get("version")) || 0;
      this.broadcastConfigChanged(version);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rate-limit decision for a public replay upload (per-anon + per-IP sliding window).
    if (url.pathname === "/internal/replay-admit" && request.method === "POST") {
      let info: { anonId?: unknown; ip?: unknown } = {};
      try {
        info = (await request.json()) as { anonId?: unknown; ip?: unknown };
      } catch {
        /* treat as empty identifiers → still subject to the IP/anon caps */
      }
      const anonId = typeof info.anonId === "string" ? info.anonId.slice(0, 64) : "";
      const ip = typeof info.ip === "string" ? info.ip.slice(0, 64) : "";
      const decision = this.admitReplayUpload(Date.now(), anonId, ip);
      return new Response(JSON.stringify(decision), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Current admission probability (no side effects) for client self-sampling.
    if (url.pathname === "/internal/telemetry-policy") {
      return new Response(
        JSON.stringify({ admissionProbability: this.computeAdmissionProbability(Date.now()) }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Record a telemetry submission, decide admission, and (if admitted) write it
    // to Analytics Engine. Returns the decision + the probability the client should
    // adopt for its own self-sampling next time.
    if (url.pathname === "/internal/telemetry" && request.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        /* treat as empty; still report current probability */
      }
      const now = Date.now();
      if (typeof body.anonId === "string" && body.anonId.length > 0) {
        this.telemetryWindow.push({ t: now, anonId: body.anonId });
      }
      const admissionProbability = this.computeAdmissionProbability(now);
      const admitted = Math.random() < admissionProbability;
      if (admitted) this.writeTelemetryDataPoint(body);
      return new Response(
        JSON.stringify({ ok: true, admitted, admissionProbability }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Express "/api/my-ip" replacement
    if (url.pathname === "/api/my-ip") {
      // Cloudflare automatically injects the client's public IP in the CF-Connecting-IP header
      const clientIp = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
      return new Response(
        JSON.stringify({ 
          ip: clientIp,
          lanIp: "127.0.0.1" // Worker environment runs in serverless, so internal LAN IP of host doesn't apply
        }), 
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Handle WebSocket upgrade request
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    // Create a new WebSocket client/server pair using robust native properties
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    // Connect the socket server end to the Durable Object
    const connectionType = url.searchParams.get("type") || "lobby";
    const nameParam = url.searchParams.get("name");
    const onlineInstanceId = normalizePresenceId(url.searchParams.get("onlineInstanceId"));
    const accountToken = url.searchParams.get("accountToken");
    const claimedAccountId = normalizePresenceId(url.searchParams.get("accountId"));
    let accountId: string | undefined;
    if (accountToken) {
      const accountRequest = new Request(request.url, {
        headers: { Authorization: `Bearer ${accountToken}` },
      });
      const resolvedAccountId = await requireSessionAccountId(accountRequest, this.env);
      if (!resolvedAccountId || (claimedAccountId && claimedAccountId !== resolvedAccountId)) {
        return new Response("Invalid account session", { status: 401 });
      }
      accountId = resolvedAccountId;
    }
    await this.handleSession(serverSocket, connectionType, nameParam, accountId, onlineInstanceId);

    // Return the 101 Switching Protocols response to upgrade the client connection
    return new Response(null, {
      status: 101,
      webSocket: clientSocket,
    });
  }

  closeDuplicateAccountLocations(currentSocket: GameWebSocket) {
    const accountId = currentSocket.accountId;
    const onlineInstanceId = currentSocket.onlineInstanceId;
    if (!accountId || !onlineInstanceId) return;

    this.sessions.forEach(client => {
      if (client === currentSocket || client.readyState !== WebSocket.OPEN) return;
      if (client.accountId !== accountId) return;
      if (client.onlineInstanceId === onlineInstanceId) return;

      try {
        client.send(JSON.stringify({
          type: "signed_in_elsewhere",
          message: SIGNED_IN_ELSEWHERE_MESSAGE,
        }));
      } catch(e) {}
      try {
        client.close(SIGNED_IN_ELSEWHERE_CLOSE_CODE, SIGNED_IN_ELSEWHERE_MESSAGE);
      } catch(e) {}
    });
  }

  async handleSession(
    ws: WebSocket,
    connectionType: string,
    nameParam: string | null,
    accountId?: string,
    onlineInstanceId?: string,
  ) {
    const gameWs = ws as GameWebSocket;
    
    // Accept the WebSocket connection inside the Worker
    gameWs.accept();
    this.sessions.add(gameWs);

    // Generate unique random socket ID (same as original backend)
    const wsId = Math.random().toString(36).substring(2, 9);
    gameWs.id = wsId;
    gameWs.accountId = accountId;
    gameWs.onlineInstanceId = onlineInstanceId;
    (gameWs as any).connectionType = connectionType;
    gameWs.playerState = 'menu';
    gameWs.roomCode = undefined;
    gameWs.spaceAvailable = false;
    await this.updateSocketDisplayName(gameWs, nameParam);
    gameWs.playerCount = undefined;
    gameWs.maxPlayers = undefined;
    gameWs.lobbyStartedAt = undefined;
    gameWs.lobbyChatRateLimit = createLobbyChatRateLimitState();
    
    console.log(`New WebSocket connection received. Assigned Socket ID: ${wsId}, Type: ${connectionType}, Name: ${nameParam}, Account: ${accountId ? "signed-in" : "guest"}`);

    this.closeDuplicateAccountLocations(gameWs);

    // Send immediate welcome greeting carrying the socket's client identity
    gameWs.send(JSON.stringify({ type: "welcome", clientId: wsId, playerName: this.getSocketPublicDisplayName(gameWs) }));
    
    // Broadcast active roster update to everyone connected
    this.updatePresence();

    gameWs.addEventListener("message", async (event) => {
      try {
        const rawMessage = event.data as string;
        const message = JSON.parse(rawMessage);

        switch (message.type) {
          case "update_status": {
            const { status, roomCode, spaceAvailable, name, playerCount, maxPlayers } = message;
            const normalizedRoomCode = status === 'multi' ? normalizePublicRoomCode(roomCode) : undefined;
            console.log(`Client ${wsId} updating playerState to: ${status}, roomCode: ${normalizedRoomCode}, spaceAvailable: ${spaceAvailable}, players: ${playerCount}/${maxPlayers}`);
            gameWs.playerState = status;
            gameWs.roomCode = normalizedRoomCode;
            gameWs.spaceAvailable = spaceAvailable;
            await this.updateSocketDisplayName(gameWs, name);
            gameWs.lobby = status === 'multi' ? buildPresenceLobbySummary(message.lobby) : undefined;
            gameWs.playerCount = typeof playerCount === 'number' && Number.isFinite(playerCount)
              ? Math.max(0, Math.min(MAX_ROOM_PLAYERS, Math.floor(playerCount)))
              : undefined;
            gameWs.maxPlayers = typeof maxPlayers === 'number' && Number.isFinite(maxPlayers)
              ? Math.max(1, Math.min(MAX_ROOM_PLAYERS, Math.floor(maxPlayers)))
              : undefined;
            gameWs.lobbyStartedAt = normalizedRoomCode ? this.getLobbyStartedAt(normalizedRoomCode) : undefined;
            this.updatePresence();
            break;
          }

          case "lobby_chat": {
            gameWs.lobbyChatRateLimit = gameWs.lobbyChatRateLimit ?? createLobbyChatRateLimitState();
            const chat = validateLobbyChatMessage(
              message,
              gameWs.lobbyChatRateLimit,
              this.getSocketPublicDisplayName(gameWs),
            );
            if (chat.ok === false) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: chat.message }));
              } catch(e) {}
              break;
            }
            console.log(`Lobby chat message from ${wsId} (${chat.sender}): ${chat.text}`);
            const chatPayload = JSON.stringify({
              type: "lobby_chat",
              id: Math.random().toString(36).substring(2, 9),
              sender: chat.sender,
              text: chat.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              clientId: wsId
            });
            this.sessions.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(chatPayload);
                } catch(e) {}
              }
            });
            break;
          }

          case "ping": {
            const { timestamp } = message;
            try {
              gameWs.send(JSON.stringify({ type: "pong", timestamp }));
            } catch(e) {}
            break;
          }

          case "send_invite": {
            const { targetId, roomCode } = message;
            const publicRoomCode = normalizePublicRoomCode(roomCode);
            console.log(`Direct invite from ${wsId} to ${targetId} referencing room ${publicRoomCode ?? "[redacted]"}`);
            let destSocket: GameWebSocket | null = null;
            for (const client of this.sessions) {
              if (client.id === targetId) {
                destSocket = client;
                break;
              }
            }
            const inviteRoom = publicRoomCode ? this.rooms.get(publicRoomCode) : undefined;
            const inviteToken = inviteRoom ? createInviteToken() : undefined;
            if (inviteRoom && inviteToken) {
              inviteRoom.inviteTokens.set(targetId, inviteToken);
            }
            if (destSocket && destSocket.readyState === WebSocket.OPEN && publicRoomCode) {
              try {
                destSocket.send(JSON.stringify({
                  type: "receive_invite",
                  fromId: wsId,
                  roomCode: publicRoomCode,
                  inviteToken
                }));
              } catch(e) {}
            }
            break;
          }

          case "decline_invite": {
            const { targetId } = message;
            console.log(`Direct invite declined from ${wsId} targeting original host ${targetId}`);
            let destSocket: GameWebSocket | null = null;
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
              } catch(e) {}
            }
            break;
          }

          case "quickplay_join": {
            console.log(`Client ${wsId} requested Quick Play matchmaking.`);
            
            // 1. Search for any hosted match with an open player slot (not reserved)
            let foundRoomKey: string | null = null;
            for (const room of this.rooms.values()) {
              if (
                !room.matchStarted &&
                room.lobbyConfig.access === "open" &&
                !room.passwordHash &&
                hasRoomPlayerSpace(room) &&
                !room.quickplayReserved
              ) {
                const publicRoomCode = this.getRoomPublicCode(room);
                if (!publicRoomCode) continue;
                foundRoomKey = publicRoomCode;
                room.quickplayReserved = true; // Mark it as reserved
                break;
              }
            }

            if (foundRoomKey) {
              console.log(`Quick Play Matchmaker found open hosted lobby for client ${wsId} under key: ${foundRoomKey}`);
              try {
                gameWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: foundRoomKey }));
              } catch(e) {}
              break;
            }

            // 2. Clean dead sockets in queue and check if anyone else is waiting
            this.cleanQuickPlayQueue();

            if (this.quickPlayQueue.size > 0) {
              const peerWs = this.quickPlayQueue.values().next().value;
              if (peerWs) {
                this.quickPlayQueue.delete(peerWs);

                if (peerWs.readyState === WebSocket.OPEN) {
                  const qpRoomCode = "QP_" + Math.floor(100000 + Math.random() * 900000).toString();
                  console.log(`Quick Play Matchmaker pairing client ${wsId} with peer ${peerWs.id}. Generated Room Code: ${qpRoomCode}`);

                  // Send matching coordinates
                  try {
                    peerWs.send(JSON.stringify({ type: "quickplay_host", roomCode: qpRoomCode }));
                  } catch(e) {}
                  this.waitingQuickPlayClients.set(qpRoomCode, gameWs);
                  
                  // Let the joining player know we are configuring the arena
                  try {
                    gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
                  } catch(e) {}
                  break;
                }
              }
            }

            // 3. No matches or peers available, enter queue
            this.quickPlayQueue.add(gameWs);
            console.log(`Client ${wsId} entered the Quick Play queue.`);
            try {
              gameWs.send(JSON.stringify({ type: "quickplay_queued" }));
            } catch(e) {}
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
            await this.updateSocketDisplayName(gameWs, message.playerName);
            applyGameplayIdentity(gameWs, message);
            const lobbyConfig = normalizeMatchLobbyConfig(message.lobbyConfig);
            const password = sanitizeLobbyPassword(message.password);
            if (lobbyConfig.access === "password" && !password) {
              gameWs.send(JSON.stringify({ type: "error", message: "Password lobbies require a password." }));
              return;
            }
            const keysToRegister = [];
            if (ip) keysToRegister.push(ip);
            if (lanIp && lanIp !== '127.0.0.1') keysToRegister.push(lanIp);
            if (customId) keysToRegister.push(customId);

            console.log(`Registering host with keys: ${keysToRegister.join(", ")}`);

            // Create a Room instance shared across registration keys
            const room: Room = {
              host: gameWs,
              clients: [],
              observers: new Set<GameWebSocket>(),
              keys: keysToRegister,
              lobbyConfig,
              passwordHash: password ? hashLobbyPassword(password) : undefined,
              inviteTokens: new Map<string, string>(),
              matchStarted: false,
            };

            // Register room under all given keys
            keysToRegister.forEach(key => {
              const existing = this.rooms.get(key);
              if (existing) {
                if (existing.host !== gameWs) {
                  try { existing.host.close(); } catch(e) {}
                }
                if (existing.clients) {
                  existing.clients.forEach(c => {
                    try { c.close(); } catch(e) {}
                  });
                }
              }
              this.rooms.set(key, room);
            });

            this.socketToRoom.set(gameWs, room);
            try {
            gameWs.send(JSON.stringify({
              type: "hosted",
              keys: keysToRegister,
              clientId: wsId,
              role: "host",
              spawnSlot: 0,
              playerName: this.getSocketPublicDisplayName(gameWs),
              lobbyConfig,
            }));
            } catch(e) {}

            // Trigger the waiting Quick Play client if this is a custom quickplay room code
            if (customId && this.waitingQuickPlayClients.has(customId)) {
              const guestWs = this.waitingQuickPlayClients.get(customId);
              this.waitingQuickPlayClients.delete(customId);
              if (guestWs && guestWs.readyState === WebSocket.OPEN) {
                console.log(`Quick Play Host registered. Dispatching match found to guest client ${guestWs.id}`);
                try {
                  guestWs.send(JSON.stringify({ type: "quickplay_match_found", roomCode: customId }));
                } catch(e) {}
              }
            }
            break;
          }

          case "join": {
            const { targetIpOrId, isObserver, inviteToken } = message;
            await this.updateSocketDisplayName(gameWs, message.playerName);
            applyGameplayIdentity(gameWs, message);
            console.log(`Client attempting to join room matching: ${targetIpOrId} (isObserver: ${isObserver})`);

            const normalizedTargetCode = normalizePublicRoomCode(targetIpOrId);
            let room = this.rooms.get(normalizedTargetCode || targetIpOrId);
            
            // Local network fallback (same as original server.ts)
            if (!room && this.rooms.size > 0) {
              const singleKey = Array.from(this.rooms.keys())[0];
              room = this.rooms.get(singleKey);
              console.log(`Fallback: Lobby lookup under "${targetIpOrId}" not found. Auto-paired with active lobby (key: ${singleKey})`);
            }

            if (!room) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match not found for: ${targetIpOrId}` }));
              } catch(e) {}
              return;
            }

            const inviteBypass = getInviteTokenBypass(room, wsId, inviteToken);
            if (room.passwordHash && !inviteBypass) {
              const password = sanitizeLobbyPassword(message.password);
              if (!password || hashLobbyPassword(password) !== room.passwordHash) {
                try {
                  gameWs.send(JSON.stringify({ type: "error", message: "Lobby password is incorrect." }));
                } catch(e) {}
                return;
              }
            }

            if (isObserver) {
              if (!room.lobbyConfig.allowObservers) {
                try {
                  gameWs.send(JSON.stringify({ type: "error", message: "This lobby does not allow observers." }));
                } catch(e) {}
                return;
              }
              room.observers.add(gameWs);
              this.socketToRoom.set(gameWs, room);
              console.log(`Client ${wsId} connected as observer to room.`);
              try {
                gameWs.send(JSON.stringify({ 
                  type: "connected", 
                  clientId: wsId,
                  playerName: this.getSocketPublicDisplayName(gameWs),
                  role: "observer", 
                  hostClientId: room.host.id, 
                  clientClientId: room.clients.length > 0 ? room.clients[0].id : undefined,
                  otherPlayerIds: [
                    room.host.id,
                    ...room.clients.map(c => c.id)
                  ],
                  otherPlayers: this.getRoomPlayerEntries(room),
                  participants: this.getOtherRoomParticipantEntries(room, wsId),
                  lobbyConfig: room.lobbyConfig,
                  matchStarted: room.matchStarted,
                }));
                if (room.matchStarted) {
                  gameWs.send(JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig }));
                }
              } catch (e) {}
              
              // Notify host and clients
              const obsJoinedPayload = JSON.stringify({
                type: "observer_joined",
                observerId: wsId,
                role: "observer",
                playerName: this.getSocketPublicDisplayName(gameWs),
                hue: normalizePlayerHue(gameWs.playerHue),
                loadout: normalizePlayerLoadout(gameWs.playerLoadout),
              });
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(obsJoinedPayload); } catch (e) {}
              }
              room.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) {
                  try { c.send(obsJoinedPayload); } catch (e) {}
                }
              });
              break;
            }

            if (!hasRoomPlayerSpace(room)) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: `Match is already full (${room.lobbyConfig.maxPlayers}/${room.lobbyConfig.maxPlayers} players present).` }));
              } catch(e) {}
              return;
            }

            if (!room.clients.includes(gameWs) && !room.clients.some((c: any) => c.id === wsId)) {
              room.clients.push(gameWs);
            }
            room.quickplayReserved = false;
            this.socketToRoom.set(gameWs, room);

            // Notify both parties that they have paired successfully
            try {
              gameWs.send(JSON.stringify({ 
                type: "connected", 
                clientId: wsId,
                playerName: this.getSocketPublicDisplayName(gameWs),
                role: "client", 
                hostClientId: room.host.id, 
                clientClientId: wsId,
                spawnSlot: this.getRoomSpawnSlot(room, gameWs),
                otherPlayerIds: [
                  room.host.id,
                  ...room.clients.filter(c => c.id !== wsId).map(c => c.id)
                ],
                otherPlayers: this.getOtherRoomPlayerEntries(room, wsId),
                participants: this.getOtherRoomParticipantEntries(room, wsId),
                lobbyConfig: room.lobbyConfig,
                matchStarted: room.matchStarted,
              }));
              if (room.matchStarted) {
                gameWs.send(JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig }));
              }
            } catch (e) {}

            // Notify host and all other clients of this new player joining
            const clientJoinedPayload = JSON.stringify({
              type: "player_joined",
              role: "client",
              clientId: wsId,
              spawnSlot: this.getRoomSpawnSlot(room, gameWs),
              playerName: this.getSocketPublicDisplayName(gameWs),
              hue: normalizePlayerHue(gameWs.playerHue),
              loadout: normalizePlayerLoadout(gameWs.playerLoadout),
            });

            if (room.clients.length === 1) {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try {
                  room.host.send(JSON.stringify({
                    type: "connected",
                    clientId: this.getSocketId(room.host),
                    playerName: this.getSocketPublicDisplayName(room.host),
                    role: "host",
                    hostClientId: this.getSocketId(room.host),
                    spawnSlot: 0,
                    clientClientId: wsId,
                    otherPlayerIds: [
                      wsId
                    ],
                    otherPlayers: this.getOtherRoomPlayerEntries(room, this.getSocketId(room.host)),
                    participants: this.getOtherRoomParticipantEntries(room, this.getSocketId(room.host)),
                    lobbyConfig: room.lobbyConfig,
                    matchStarted: room.matchStarted,
                  }));
                } catch (e) {}
              }
            } else {
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(clientJoinedPayload); } catch (e) {}
              }
            }

            room.clients.forEach(client => {
              if (client !== gameWs && client.readyState === WebSocket.OPEN) {
                try { client.send(clientJoinedPayload); } catch (e) {}
              }
            });
            break;
          }

          case "start_match": {
            const room = this.socketToRoom.get(gameWs);
            if (!room || room.host !== gameWs) {
              try {
                gameWs.send(JSON.stringify({ type: "error", message: "Only the host can start this match." }));
              } catch(e) {}
              break;
            }
            room.matchStarted = true;
            const payload = JSON.stringify({ type: "match_start", lobbyConfig: room.lobbyConfig });
            [room.host, ...room.clients, ...Array.from(room.observers)].forEach(socket => {
              if (socket.readyState === WebSocket.OPEN) {
                try { socket.send(payload); } catch(e) {}
              }
            });
            this.updatePresence();
            break;
          }

          case "sync": {
            // Forward gameplay simulation sync data directly to all other parties in the same Room
            let room = this.socketToRoom.get(gameWs);
            if (!room) {
              for (const r of Array.from(this.rooms.values())) {
                if (
                  r.host === gameWs || 
                  r.clients.includes(gameWs) || 
                  r.observers.has(gameWs) || 
                  (r.host && r.host.id === wsId) || 
                  r.clients.some((c: any) => c.id === wsId)
                ) {
                  room = r;
                  this.socketToRoom.set(gameWs, r);
                  break;
                }
              }
            }
            if (!room) return;

            const isHost = (gameWs === room.host || gameWs.id === room.host.id);
            const isClient = room.clients.includes(gameWs) || room.clients.some((c: any) => c.id === wsId);
            const senderRole = isHost ? 'host' : (isClient ? 'client' : 'observer');

            // Package coordination parameters with sender role tag and senderId
            let parsedMessage = message;
            try {
              parsedMessage = {
                ...message,
                senderRole,
                senderId: wsId,
                playerName: this.getSocketPublicDisplayName(gameWs),
              };
            } catch (err) {}
            const syncPayload = JSON.stringify(parsedMessage);

            if (isHost) {
              // Send to all clients
              room.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  try { client.send(syncPayload); } catch (e) {}
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  try { obs.send(syncPayload); } catch (e) {}
                }
              });
            } else if (isClient) {
              // Send to host
              if (room.host && room.host.readyState === WebSocket.OPEN) {
                try { room.host.send(syncPayload); } catch (e) {}
              }
              // Send to all other clients
              room.clients.forEach(client => {
                if (client !== gameWs && client.id !== wsId && client.readyState === WebSocket.OPEN) {
                  try { client.send(syncPayload); } catch (e) {}
                }
              });
              // Send to observers
              room.observers.forEach(obs => {
                if (obs.readyState === WebSocket.OPEN) {
                  try { obs.send(syncPayload); } catch (e) {}
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

      // Clean up Quick Play matchmaking states
      this.quickPlayQueue.delete(gameWs);
      for (const [code, clientWs] of this.waitingQuickPlayClients.entries()) {
        if (clientWs === gameWs) {
          this.waitingQuickPlayClients.delete(code);
        }
      }
      
      const room = this.socketToRoom.get(gameWs);
      if (room) {
        // If it is an observer, safely clean it up
        if (room.observers.has(gameWs)) {
          room.observers.delete(gameWs);
          this.socketToRoom.delete(gameWs);
          const observerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            role: "observer",
            reason: "An observer left the match."
          });
          if (room.host && room.host.readyState === WebSocket.OPEN) {
            try { room.host.send(observerLeftPayload); } catch (e) {}
          }
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(observerLeftPayload); } catch (e) {}
            }
          });
          this.updatePresence();
          return;
        }

        const isHost = (gameWs === room.host);
        
        if (isHost) {
          // Tell all clients and observers that the host left and match dissolved
          const disconnectPayload = JSON.stringify({ type: "disconnected", reason: "Host left the match." });
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(disconnectPayload);
                client.close();
              } catch (e) {}
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              try {
                obs.send(disconnectPayload);
                obs.close();
              } catch (e) {}
            }
          });
          
          // Remove room listings from memory
          room.keys.forEach(key => {
            this.rooms.delete(key);
          });
          
          // Remove socket bindings
          this.socketToRoom.delete(room.host);
          room.clients.forEach(client => this.socketToRoom.delete(client));
          room.observers.forEach(obs => this.socketToRoom.delete(obs));
        } else {
          // Client left
          room.clients = room.clients.filter(c => c !== gameWs && c.id !== wsId);
          this.socketToRoom.delete(gameWs);

          // Tell host and other clients that this player left
          const playerLeftPayload = JSON.stringify({
            type: "player_left",
            leftPlayerId: wsId,
            reason: "A player left the match."
          });

          if (room.host && room.host.readyState === WebSocket.OPEN) {
            try { room.host.send(playerLeftPayload); } catch (e) {}
          }
          room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(playerLeftPayload); } catch (e) {}
            }
          });
          room.observers.forEach(obs => {
            if (obs.readyState === WebSocket.OPEN) {
              try { obs.send(playerLeftPayload); } catch (e) {}
            }
          });
        }
      }

      // Update active roster information for all surviving connections
      this.updatePresence();
    });

    gameWs.addEventListener("error", (err) => {
      console.error("WebSocket socket error:", err);
    });
  }

  // Broadcast a "config_changed" version nudge to every connected session.
  broadcastConfigChanged(version: number) {
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
    const lobbyClients = Array.from(this.sessions)
      .filter((client: any) => client.connectionType === 'lobby');
    const onlineCount = lobbyClients.length;
    const activeRoomCodes = new Set<string>();

    lobbyClients.forEach((client) => {
      const roomCode = normalizePublicRoomCode(client.roomCode);
      if (client.playerState === 'multi' && roomCode) {
        activeRoomCodes.add(roomCode);
      }
    });
    this.pruneInactiveLobbyStartTimes(activeRoomCodes);

    const clientPayloads = lobbyClients
      .map((client) => {
        const state = client.playerState || 'menu';
        const roomCode = normalizePublicRoomCode(client.roomCode);
        const lobby = client.lobby;
        const visibleRoomCode = lobby?.access === "private" ? undefined : roomCode;
        return {
          id: client.id,
          name: normalizePlayerName(client.playerName),
          publicDisplayName: this.getSocketPublicDisplayName(client),
          state,
          roomCode: visibleRoomCode,
          spaceAvailable: client.spaceAvailable !== undefined ? client.spaceAvailable : false,
          playerCount: client.playerCount,
          maxPlayers: client.maxPlayers,
          lobbyStartedAt: state === 'multi' && visibleRoomCode ? this.getLobbyStartedAt(visibleRoomCode) : undefined,
          lobby,
        };
      })
      .filter(c => Boolean(c.id));

    const presencePayload = JSON.stringify({
      type: "presence",
      onlineCount,
      clients: clientPayloads
    });

    this.sessions.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(presencePayload);
        } catch (err) {
          console.error("Error broadcasting presence", err);
        }
      }
    });
  }
}
