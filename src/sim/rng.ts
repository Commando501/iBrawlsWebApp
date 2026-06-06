/**
 * Seeded, deterministic PRNG for the headless simulation.
 *
 * The live game uses `Math.random` in ~91 call sites; the sim replaces every one
 * of them with an injected {@link Rng} so a (seed + action sequence) reproduces an
 * identical match across runs and process restarts. **No `Math.random` may ever be
 * imported or called under `src/sim/`** — that invariant is what makes RL replayable.
 *
 * Algorithm: mulberry32 — a tiny, fast, well-distributed 32-bit generator. State is
 * a single uint32 so the whole RNG is trivially serializable for `SimState` snapshots.
 */

export interface Rng {
  /** Uniform float in [0, 1). Mirrors `Math.random()`. */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Random sign, -1 or +1. */
  sign(): number;
  /** True with probability `p` (default 0.5). */
  chance(p?: number): boolean;
  /** Current internal state — serialize this to snapshot the stream. */
  getState(): number;
  /** Restore a previously captured state. */
  setState(state: number): void;
}

/** Coerce any seed (including fractional / negative) into a uint32. */
export function normalizeSeed(seed: number): number {
  // >>> 0 forces uint32; the `| 0` first handles non-integer seeds deterministically.
  return (Math.trunc(seed) | 0) >>> 0;
}

/**
 * Create a mulberry32 RNG seeded by `seed`. Two RNGs with the same seed emit the
 * exact same sequence.
 */
export function createRng(seed: number): Rng {
  let state = normalizeSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
    chance: (p = 0.5) => next() < p,
    getState: () => state,
    setState: (s: number) => {
      state = s >>> 0;
    },
  };
}
