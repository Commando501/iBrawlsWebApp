// Synchronous simulation scope: cosmetic/render randomness never consumes this stream.
let active: { random: () => number; seconds: number; epoch: number } | null = null;
export const simulationRandom = (): number => active ? active.random() : Math.random();
export const simulationTimestamp = (): number => active ? active.epoch + active.seconds * 1000 : Date.now();
export const simulationSeconds = (): number => active ? active.seconds : performance.now() / 1000;
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
export function withSimulationRandom<T>(random: () => number, seconds: number, tick: () => T, epoch = 1_000_000): T {
  const previous = active; active = { random, seconds, epoch };
  try { return tick(); } finally { active = previous; }
}
