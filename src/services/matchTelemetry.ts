import { resolveHttpBase, getCachedLiveConfig } from './liveConfig';
import { getOrCreateAnonId } from './telemetryConsent';
import type { PlayerModelSnapshot } from '../game/aiPlayerModel';

/**
 * Match telemetry client (Phase 1).
 *
 * At match end we send a compact, anonymous behavior fingerprint + outcome to the
 * Worker, which forwards it to the lobby DO governor → Analytics Engine. Two guards
 * keep the free-plan budget bounded:
 *   1. Consent gate (default off) — nothing is sent without opt-in.
 *   2. Adaptive admission — the server publishes an `admissionProbability`; below the
 *      active-user threshold it is 1 (send every match), above it the client
 *      self-samples so total writes stay near the threshold. The server re-checks as
 *      a backstop. The probability is refreshed from the policy endpoint (TTL) and,
 *      for free, from each successful POST response.
 */

export const TELEMETRY_FINGERPRINT_SCHEMA = 1;

const APP_VERSION =
  ((import.meta as any)?.env?.VITE_APP_VERSION as string | undefined) ?? 'dev';
const POLICY_TTL_MS = 120_000;

export interface MatchTelemetryInput {
  map: string;
  mode: string;
  aiDifficulty: string;
  aiArchetype: string;
  gameMode: string;
  scorePlayer: number;
  scoreEnemy: number;
  playerKills: number;
  playerDeaths: number;
  durationSeconds: number;
  // Match context
  isMultiplayer: number;
  opponentCount: number;
  multikills: number;
  sprees: number;
  // Raw per-match action volumes (from the local player's PlayerModel)
  lungeAttempts: number;
  lungeHits: number;
  hammerAttacks: number;
  weaponSwaps: number;
  dashes: number;
  countersAttempted: number;
  countersLanded: number;
  damageDealtCount: number;
  damageReceivedCount: number;
  player: PlayerModelSnapshot;
}

export interface MatchTelemetryMeta {
  anonId: string;
  appVersion: string;
  liveConfigVersion: number;
}

export interface MatchTelemetry extends MatchTelemetryInput, MatchTelemetryMeta {
  ts: number;
  fingerprintSchema: number;
}

export type TelemetryResult = 'sent' | 'dropped-sampled' | 'failed';

/** Current admission probability (server-governed). Reused by replay sampling. */
export function getTelemetryAdmissionProbability(): number {
  return admissionProbability;
}

export function clamp01(n: number): number {
  // NaN → 0 (treat garbage conservatively); ±Infinity clamp normally via min/max.
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Pure payload builder (no I/O) — unit tested. */
export function buildMatchTelemetry(
  input: MatchTelemetryInput,
  meta: MatchTelemetryMeta,
  now: number = Date.now(),
): MatchTelemetry {
  return {
    ...input,
    anonId: meta.anonId,
    appVersion: meta.appVersion,
    liveConfigVersion: meta.liveConfigVersion,
    ts: now,
    fingerprintSchema: TELEMETRY_FINGERPRINT_SCHEMA,
  };
}

/** Pure self-sampling decision — `rng` is a uniform [0,1) draw. Unit tested. */
export function shouldAdmitLocally(probability: number, rng: number): boolean {
  return rng < clamp01(probability);
}

// --- Stateful orchestrator (browser I/O) -------------------------------------

let admissionProbability = 1;
let lastPolicyFetchMs = 0;

/** Test hook: reset module-level admission state between cases. */
export function _resetTelemetryAdmissionStateForTest(): void {
  admissionProbability = 1;
  lastPolicyFetchMs = 0;
}

async function refreshPolicyIfStale(base: string, now: number): Promise<void> {
  if (now - lastPolicyFetchMs < POLICY_TTL_MS) return;
  lastPolicyFetchMs = now;
  try {
    const res = await fetch(`${base}/api/telemetry/policy`, { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.admissionProbability === 'number') {
      admissionProbability = clamp01(data.admissionProbability);
    }
  } catch {
    /* keep last-known probability on network failure */
  }
}

export async function maybeSendMatchTelemetry(
  input: MatchTelemetryInput,
): Promise<TelemetryResult> {
  // Always-on collection (tech demo). Volume is bounded by the server admission
  // governor (self-sampling below), which only throttles under heavy concurrent load.
  const base = resolveHttpBase();
  const now = Date.now();
  await refreshPolicyIfStale(base, now);

  if (!shouldAdmitLocally(admissionProbability, Math.random())) return 'dropped-sampled';

  const payload = buildMatchTelemetry(
    input,
    {
      anonId: getOrCreateAnonId(),
      appVersion: APP_VERSION,
      liveConfigVersion: getCachedLiveConfig()?.version ?? 0,
    },
    now,
  );

  try {
    const res = await fetch(`${base}/api/telemetry/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Match-end fires on unmount; keepalive lets the request outlive the page.
      keepalive: true,
    });
    if (!res.ok) return 'failed';
    const data = await res.json().catch(() => ({}));
    if (typeof data?.admissionProbability === 'number') {
      admissionProbability = clamp01(data.admissionProbability);
      lastPolicyFetchMs = Date.now();
    }
    return 'sent';
  } catch {
    return 'failed';
  }
}
