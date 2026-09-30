import { canonicalJSON, hashInput } from './plan';

/** Exact IEEE-754 JSON numbers, sorted object keys/actor IDs; no rounding or timing fields. */
export interface DeterminismEvidence { version: 1; algorithm: 'sha256-pages-v1'; ticks: number; hash: string | null; error: string | null }
export class DeterministicTrace {
  private page: unknown[] = [];
  private pages: Promise<string>[] = [];
  private count = 0;
  private error: string | null = null;
  add(value: unknown) {
    // Validate now: JSON serialization must never turn NaN/Infinity into null.
    const canonical = canonicalJSON(value);
    if (this.error) return;
    this.page.push(canonical); this.count++;
    if (this.page.length === 60) this.flush();
  }
  private flush() {
    if (!this.page.length) return;
    if (this.pages.length >= 3601) { this.error = 'Deterministic trace exceeded 216000 ticks.'; this.page = []; return; }
    // Start digests immediately, keeping only their promises and 64-character results.
    this.pages.push(hashInput(this.page).catch(error => { this.error = String(error); return ''; })); this.page = [];
  }
  async finish(): Promise<DeterminismEvidence> {
    this.flush(); const pages = await Promise.all(this.pages);
    return { version: 1, algorithm: 'sha256-pages-v1', ticks: this.count,
      hash: this.error ? null : await hashInput({ ticks: this.count, pages }), error: this.error };
  }
}
export const COST_CHANNELS = ['snapshot', 'plannerRefresh', 'plannerBetween', 'coordination', 'evaluation', 'tick', 'render'] as const;
export type CostChannel = typeof COST_CHANNELS[number];
export interface Distribution { samples: number; p50Ms: number; p95Ms: number; maxMs: number }
export type TimingEvidence = { warmupTicks: 120; dropped: number;
  cold: Record<CostChannel, Distribution>; warm: Record<CostChannel, Distribution> } &
  ({ version: 1 } | { version: 2; warmupBasis: 'playing-ticks'; playingTicks: number });
export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50Ms: sorted[Math.max(0, Math.ceil(sorted.length * .5) - 1)] ?? 0,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0, maxMs: sorted.at(-1) ?? 0 };
}
/** Opt-in live instrumentation; no profiling state is copied into game snapshots. */
export class LiveTimings {
  playingTicks = 0; private dropped = 0;
  private cold = Object.fromEntries(COST_CHANNELS.map(c => [c, [] as number[]])) as Record<CostChannel, number[]>;
  private warm = Object.fromEntries(COST_CHANNELS.map(c => [c, [] as number[]])) as Record<CostChannel, number[]>;
  record(channel: CostChannel, ms: number) {
    const values = (this.playingTicks < 120 ? this.cold : this.warm)[channel];
    if (!Number.isFinite(ms) || ms < 0 || values.length >= 216000) { this.dropped++; return; }
    values.push(ms);
  }
  finish(): TimingEvidence {
    const summarize = (v: Record<CostChannel, number[]>) => Object.fromEntries(COST_CHANNELS.map(c => [c, distribution(v[c])])) as Record<CostChannel, Distribution>;
    return { version: 2, warmupBasis: 'playing-ticks', playingTicks: this.playingTicks,
      warmupTicks: 120, dropped: this.dropped, cold: summarize(this.cold), warm: summarize(this.warm) };
  }
}
export const liveTimings = new WeakMap<object, LiveTimings>();
export interface BehaviorEvidence { version: 1; ticks: number; pickups: number; throws: number; recoveries: number;
  respawns: number; goals: { blue: number; red: number }; roleReleases: number; staleRoleTicks: number }
