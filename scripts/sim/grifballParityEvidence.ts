import { createHash } from 'node:crypto';

export const PARITY_FRAME_SAMPLE_LIMIT = 32;
const encodeScalar = (_key: string, value: unknown) => {
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
    return { $number: Object.is(value, -0) ? '-0' : String(value) };
  return value;
};
interface FrameTrace {
  frames: readonly unknown[];
  differences?: readonly { tick: number }[];
  failures?: readonly { tick: number }[];
}

/** Run all validation before calling this. Only retained evidence is sampled;
 * failures and other metadata remain intact, and direct trace runners stay full. */
export function compactExecutionTrace<T extends FrameTrace>(trace: T) {
  const { frames, ...metadata } = trace;
  const selected = new Set<number>();
  const keep = (index: number) => {
    if (index >= 0 && index < frames.length && selected.size < PARITY_FRAME_SAMPLE_LIMIT) selected.add(index);
  };
  keep(0); keep(frames.length - 1);
  const failureTicks = new Set([...(trace.differences ?? []), ...(trace.failures ?? [])].map(f => f.tick));
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (frame && typeof frame === 'object' && 'tick' in frame && failureTicks.has(Number(frame.tick))) {
      keep(index); keep(index - 1); keep(index + 1);
    }
  }
  const samples = frames.length <= PARITY_FRAME_SAMPLE_LIMIT ? frames.length : 8;
  for (let sample = 0; sample < samples; sample++)
    keep(Math.floor(sample * (frames.length - 1) / Math.max(1, samples - 1)));
  const hash = createHash('sha256');
  const retained: unknown[] = [];
  hash.update('[');
  for (let index = 0; index < frames.length; index++) {
    const encoded = JSON.stringify(frames[index], encodeScalar);
    if (index) hash.update(',');
    hash.update(encoded);
    if (selected.has(index)) retained.push(JSON.parse(encoded));
  }
  hash.update(']');
  return { ...metadata, frameCount: frames.length, frames: retained,
    frameEvidence: { kind: 'sampled-frames-v1' as const, retainedCount: retained.length,
      fullTraceSHA256: hash.digest('hex'),
      encoding: 'JSON frame array in execution order; $number preserves nonfinite/signed-zero values; $undefined preserves missing values' } };
}

export const compactExecutionTraces = <T extends FrameTrace>(traces: readonly T[]) => traces.map(compactExecutionTrace);
