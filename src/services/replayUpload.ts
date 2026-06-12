import { resolveHttpBase } from './liveConfig';
import { getOrCreateAnonId } from './telemetryConsent';
import { getTelemetryAdmissionProbability } from './matchTelemetry';
import type { ReplayFile } from '../types';
import { sanitizeCharacterLoadoutForNetwork } from '../components/customArmor';

/**
 * Replay contribution (behavior-cloning corpus).
 *
 * Lossless: the replay JSON is gzipped with the browser-native `CompressionStream`
 * (standard gzip → byte-identical on decompression) and tagged with a SHA-256 of the
 * (PII-stripped) JSON, so the offline download step can verify nothing was corrupted
 * in compression / transit / storage. Read-only on the source replay — the local
 * Theater copy is untouched.
 *
 * Collection is always-on (tech demo) but SAMPLED: replays are large (~18 MB), so
 * auto-upload fires for only a fraction of matches (base rate × the server admission
 * governor) to bound user bandwidth and R2 growth. Player names are stripped before
 * upload — behavior signal is kept, identifiable data is not.
 */

export const REPLAY_SCHEMA_VERSION = 3;

/** Base fraction of matches auto-uploaded (multiplied by the admission governor). */
export const REPLAY_BASE_SAMPLE_RATE = 0.25;

export interface ReplayUploadResult {
  ok: boolean;
  id?: string;
  size?: number;
  reason?: 'empty' | 'unsupported' | 'dropped-sampled';
  error?: string;
}

export interface ReplayUploadMeta {
  id: string;
  sha256: string;
  anonId: string;
  duration: number;
  players: number;
  map: string;
  mode: string;
  gameMode: string;
  schemaVersion: number;
}

/** Sanitize a replay id into the server's accepted key charset/length. */
export function toUploadId(rawId: string): string {
  let id = (rawId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (id.length < 8) {
    id = `rp_${id}${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g, '');
  }
  return id.slice(0, 64);
}

/** Count combatants in a replay (player + ai, or player + otherPlayers). */
export function countReplayPlayers(replay: ReplayFile): number {
  const frame = replay.frames.find((f) => f.player || f.ai || f.otherPlayers?.length);
  if (!frame) return 0;
  let n = frame.player ? 1 : 0;
  if (frame.ai) n += 1;
  if (frame.otherPlayers) n += frame.otherPlayers.length;
  return n;
}

/**
 * Return a PII-stripped clone for upload: player/opponent names removed (top-level
 * and per-frame roster). Behavioral signal is fully preserved; the source replay is
 * untouched. The anonymous id travels separately as upload metadata.
 */
export function stripReplayPII(replay: ReplayFile): ReplayFile {
  const clone: ReplayFile = structuredClone(replay);
  clone.playerName = '';
  clone.opponentName = '';
  for (const frame of clone.frames) {
    if (frame.otherPlayers) {
      for (const op of frame.otherPlayers) op.playerName = '';
    }
  }
  if (clone.visualLoadouts) {
    clone.visualLoadouts = Object.fromEntries(
      Object.entries(clone.visualLoadouts)
        .map(([id, loadout]) => [id, sanitizeCharacterLoadoutForNetwork(loadout) as Record<string, unknown> | undefined])
        .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]))
    );
  }
  return clone;
}

/** Pure builder for the upload query string (unit tested). */
export function buildReplayUploadQuery(meta: ReplayUploadMeta): string {
  const p = new URLSearchParams();
  p.set('id', meta.id);
  p.set('sha256', meta.sha256);
  p.set('anonId', meta.anonId);
  p.set('duration', String(meta.duration));
  p.set('players', String(meta.players));
  p.set('map', meta.map);
  p.set('mode', meta.mode);
  p.set('gameMode', meta.gameMode);
  p.set('schemaVersion', String(meta.schemaVersion));
  return p.toString();
}

async function gzipString(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Gzip + hash + upload one replay (PII stripped). Always uploads when called — use
 * this for the manual "Contribute" button or a forced upload. Resolves with a result,
 * never throws. For always-on sampled auto-upload at match end, use
 * `maybeContributeReplay`.
 */
export async function contributeReplay(replay: ReplayFile): Promise<ReplayUploadResult> {
  if (!replay.frames || replay.frames.length === 0) return { ok: false, reason: 'empty' };
  if (typeof CompressionStream === 'undefined' || !crypto?.subtle) {
    return { ok: false, reason: 'unsupported' };
  }

  // Hash/gzip the SANITIZED replay so the stored bytes and the manifest hash match.
  const json = JSON.stringify(stripReplayPII(replay));
  const [blob, sha256] = await Promise.all([gzipString(json), sha256Hex(json)]);

  const meta: ReplayUploadMeta = {
    id: toUploadId(replay.id),
    sha256,
    anonId: getOrCreateAnonId(),
    duration: replay.duration ?? 0,
    players: countReplayPlayers(replay),
    map: String(replay.mapType ?? ''),
    mode: String(replay.mode ?? ''),
    // The rules axis the training corpus segments on (grifball vs base brawl). Absent
    // on replays recorded before the field existed → treat as 'sandbox'.
    gameMode: String(replay.gameMode ?? 'sandbox'),
    schemaVersion: REPLAY_SCHEMA_VERSION,
  };

  const base = resolveHttpBase();
  try {
    const res = await fetch(`${base}/api/replay/upload?${buildReplayUploadQuery(meta)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body: blob,
      keepalive: true,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || `Upload failed (${res.status})` };
    }
    return { ok: true, id: data.id, size: data.size };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Always-on but SAMPLED auto-upload — call at match end. Uploads only a fraction of
 * matches (base rate × the server admission governor) so large replays don't hammer
 * every user's bandwidth or R2. Fire-and-forget.
 */
export async function maybeContributeReplay(replay: ReplayFile): Promise<ReplayUploadResult> {
  const probability = REPLAY_BASE_SAMPLE_RATE * getTelemetryAdmissionProbability();
  if (Math.random() >= probability) return { ok: false, reason: 'dropped-sampled' };
  return contributeReplay(replay);
}
