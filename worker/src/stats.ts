// Player stat persistence — generic counter storage per account.
//
// The client accumulates gameplay stat changes as a delta of `sums` (counters
// to add) and `maxes` (personal bests to fold with max), optionally broken out
// per mode. The worker folds deltas into the stored totals WITHOUT knowing any
// stat ids, so shipping a new stat in the client requires no backend change.
//
// Routes (dispatched from accounts.ts):
//   GET  /api/account/stats         -> { stats: { totals, modes } | null }
//   POST /api/account/stats/ingest  -> body StatDelta; returns merged totals
import { requireSessionAccountId, type AccountsEnv } from "./accounts";

type CounterMap = Record<string, number>;

interface StatsPayload {
  totals: CounterMap;
  modes: Record<string, CounterMap>;
}

interface DeltaModeEntry {
  sums: CounterMap;
  maxes: CounterMap;
}

interface StatDelta {
  sums: CounterMap;
  maxes: CounterMap;
  modes: Record<string, DeltaModeEntry>;
}

// Abuse guards: cap counter key count and key length so a hostile client
// cannot grow the row unboundedly.
const MAX_KEYS_PER_MAP = 512;
const MAX_KEY_LENGTH = 128;
const MAX_MODES = 16;
const MAX_COUNTER_VALUE = 1_000_000_000_000;

function sanitizeCounterMap(raw: unknown, limit = MAX_KEYS_PER_MAP): CounterMap {
  const out: CounterMap = {};
  if (!raw || typeof raw !== "object") return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= limit) break;
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    out[key] = Math.min(value, MAX_COUNTER_VALUE);
    count++;
  }
  return out;
}

export function sanitizeDelta(raw: unknown): StatDelta {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const modes: Record<string, DeltaModeEntry> = {};
  if (body.modes && typeof body.modes === "object") {
    let modeCount = 0;
    for (const [mode, entry] of Object.entries(body.modes as Record<string, unknown>)) {
      if (modeCount >= MAX_MODES) break;
      if (typeof mode !== "string" || mode.length === 0 || mode.length > 64) continue;
      if (!entry || typeof entry !== "object") continue;
      modes[mode] = {
        sums: sanitizeCounterMap((entry as Record<string, unknown>).sums),
        maxes: sanitizeCounterMap((entry as Record<string, unknown>).maxes),
      };
      modeCount++;
    }
  }
  return {
    sums: sanitizeCounterMap(body.sums),
    maxes: sanitizeCounterMap(body.maxes),
    modes,
  };
}

function parseStoredPayload(raw: string | null | undefined): StatsPayload {
  if (!raw) return { totals: {}, modes: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<StatsPayload> | null;
    const modes: Record<string, CounterMap> = {};
    if (parsed?.modes && typeof parsed.modes === "object") {
      for (const [mode, counters] of Object.entries(parsed.modes)) {
        modes[mode] = sanitizeCounterMap(counters);
      }
    }
    return { totals: sanitizeCounterMap(parsed?.totals), modes };
  } catch {
    return { totals: {}, modes: {} };
  }
}

function foldInto(target: CounterMap, sums: CounterMap, maxes: CounterMap): void {
  for (const [key, value] of Object.entries(sums)) {
    target[key] = Math.min((target[key] ?? 0) + value, MAX_COUNTER_VALUE);
  }
  for (const [key, value] of Object.entries(maxes)) {
    target[key] = Math.max(target[key] ?? 0, value);
  }
}

export function applyDeltaToPayload(payload: StatsPayload, delta: StatDelta): StatsPayload {
  foldInto(payload.totals, delta.sums, delta.maxes);
  for (const [mode, entry] of Object.entries(delta.modes)) {
    const target = (payload.modes[mode] ??= {});
    foldInto(target, entry.sums, entry.maxes);
  }
  return payload;
}

type Cors = Record<string, string>;

function json(body: unknown, status: number, cors: Cors): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function handleGetStats(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const accountId = await requireSessionAccountId(request, env);
  if (!accountId) return json({ error: "Not authenticated." }, 401, cors);
  const row = await env.DB.prepare("SELECT payload, updated_at FROM player_stats WHERE account_id = ?")
    .bind(accountId)
    .first<{ payload: string; updated_at: number }>();
  if (!row) return json({ stats: null }, 200, cors);
  return json({ stats: parseStoredPayload(row.payload), updatedAt: row.updated_at }, 200, cors);
}

async function handleIngestStats(request: Request, env: AccountsEnv, cors: Cors): Promise<Response> {
  const accountId = await requireSessionAccountId(request, env);
  if (!accountId) return json({ error: "Not authenticated." }, 401, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }
  const delta = sanitizeDelta(body);

  const row = await env.DB.prepare("SELECT payload FROM player_stats WHERE account_id = ?")
    .bind(accountId)
    .first<{ payload: string }>();
  const merged = applyDeltaToPayload(parseStoredPayload(row?.payload), delta);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO player_stats (account_id, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  )
    .bind(accountId, JSON.stringify(merged), now)
    .run();

  return json({ ok: true, stats: merged, updatedAt: now }, 200, cors);
}

/** Returns a Response for /api/account/stats* routes, or null otherwise. */
export async function handleStatsRequest(
  request: Request,
  env: AccountsEnv,
  cors: Cors
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/account/stats" && request.method === "GET") {
    return handleGetStats(request, env, cors);
  }
  if (path === "/api/account/stats/ingest" && request.method === "POST") {
    return handleIngestStats(request, env, cors);
  }
  return null;
}
