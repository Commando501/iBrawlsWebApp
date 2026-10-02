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

/** Long autonomous matches validate before recording. Hash every frame, but
 * retain a bounded, progressively thinned history and the final/failing frame. */
export function createParityFrameRecorder() {
  const hash = createHash('sha256');
  hash.update('[');
  let count = 0, stride = 1, finished = false;
  let samples: { index: number; frame: unknown }[] = [], last: unknown;
  return {
    add(frame: unknown) {
      if (finished) throw new Error('Parity recorder already finished');
      const encoded = JSON.stringify(frame, encodeScalar);
      if (count) hash.update(',');
      hash.update(encoded);
      last = JSON.parse(encoded);
      if (count % stride === 0) samples.push({ index: count, frame: last });
      if (samples.length >= PARITY_FRAME_SAMPLE_LIMIT) {
        stride *= 2;
        samples = samples.filter(sample => sample.index % stride === 0);
      }
      count++;
    },
    finish() {
      if (finished || !count) throw new Error('Parity recorder requires an unfinished nonempty trace');
      finished = true; hash.update(']');
      if (samples.at(-1)?.index !== count - 1) samples.push({ index: count - 1, frame: last });
      return { frameCount: count, frames: samples.map(sample => sample.frame),
        frameEvidence: { kind: 'sampled-frames-v1' as const, retainedCount: samples.length,
          fullTraceSHA256: hash.digest('hex'),
          encoding: 'JSON frame array in execution order; $number preserves nonfinite/signed-zero values; $undefined preserves missing values' } };
    },
  };
}

// Keep the evidence inventory explicit: counting only arrays whose first trace
// has metadata can hide an empty family or a family with stripped metadata.
const V74_SAMPLED_FAMILIES = [
  'passContestTraces', 'mapContestTraces', 'mapRoutingTraces', 'mapMobilityTraces',
  'mobilityDecisionTraces', 'matchDecisionTraces', 'roundDecisionTraces', 'revivalDecisionTraces',
  'opposedDecisionTraces', 'pressureDecisionTraces', 'passDecisionTraces', 'decisionIntegrationTraces',
  'traces', 'botTraces', 'lungeTraces', 'sampledContactTraces', 'geometryTraces', 'motionTraces',
  'movingContactTraces', 'multiActorTraces', 'spawnTraces', 'mixedSpawnTraces', 'mixedContactTraces',
  'playerLungeTraces', 'mixedLifecycleTraces', 'opposedFlightTraces', 'carrierFlightTraces',
  'airborneCarrierFlightTraces', 'turningFlightTraces', 'shieldedFlightTraces', 'airborneFlightTraces',
  'objectiveTraces', 'frameObjectiveTraces', 'passInputTraces', 'chargeCombatTraces',
  'carrierCrowdTraces', 'carrierRecoveryTraces', 'runnerCombatTraces', 'playerRunnerTraces',
  'airborneRunnerTraces', 'focusFireTraces', 'roundFrameTraces', 'roundCombatTraces',
  'roundFlightTraces', 'roundPlayerFlightTraces', 'fullRosterFrameTraces',
] as const;

export const SAMPLED_PARITY_FAMILIES = {
  'live-functions-vs-headless-step-v74': V74_SAMPLED_FAMILIES,
  'live-functions-vs-headless-step-v75': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces'],
  'live-functions-vs-headless-step-v76': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces'],
  'live-functions-vs-headless-step-v77': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces'],
  'live-functions-vs-headless-step-v78': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces'],
  'live-functions-vs-headless-step-v79': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces', 'airborneViewTraces'],
  'live-functions-vs-headless-step-v80': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces', 'airborneViewTraces'],
  'live-functions-vs-headless-step-v81': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces', 'airborneViewTraces', 'completeMatchTraces'],
  'live-functions-vs-headless-step-v82': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces', 'airborneViewTraces', 'completeMatchTraces'],
  'live-functions-vs-headless-step-v83': [...V74_SAMPLED_FAMILIES, 'objectiveInputTraces', 'plannedMatchTraces', 'landingTurnoverTraces', 'airborneViewTraces', 'completeMatchTraces', 'autonomousMobilityTraces'],
} as const;

/** Structural audit of retained evidence, including saved reports. This does not
 * rerun gameplay, verify a full-history hash from samples, or grant acceptance. */
export function validateSampledParityEvidence(details: unknown): string[] {
  if (!details || typeof details !== 'object') return ['Missing parity details'];
  const record = details as Record<string, unknown>;
  const protocol = record.protocol;
  if (typeof protocol !== 'string' || !Object.hasOwn(SAMPLED_PARITY_FAMILIES, protocol))
    return [`Unsupported sampled-evidence protocol: ${String(protocol)}`];
  const expected: readonly string[] = SAMPLED_PARITY_FAMILIES[protocol as keyof typeof SAMPLED_PARITY_FAMILIES];
  const errors: string[] = [];
  for (const [name, value] of Object.entries(record)) {
    // Legacy compatibility intentionally retains full histories as diagnostics.
    if (name !== 'legacyCompatibility' && !expected.includes(name) && Array.isArray(value) &&
      value.some(trace => trace && typeof trace === 'object' && ('frames' in trace || 'frameEvidence' in trace)))
      errors.push(`${name}: unregistered frame family`);
  }
  for (const name of expected) {
    const traces = record[name];
    if (!Array.isArray(traces) || traces.length === 0) {
      errors.push(`${name}: missing or empty family`);
      continue;
    }
    traces.forEach((trace, index) => {
      const path = `${name}[${index}]`;
      if (!trace || typeof trace !== 'object') { errors.push(`${path}: missing trace`); return; }
      const { frames, frameCount, frameEvidence } = trace;
      if (!Number.isSafeInteger(frameCount) || frameCount <= 0)
        errors.push(`${path}: invalid full frame count`);
      if (!Array.isArray(frames) || frames.length === 0 || frames.length > PARITY_FRAME_SAMPLE_LIMIT || frames.length > frameCount)
        errors.push(`${path}: invalid retained frames`);
      if (!frameEvidence || frameEvidence.kind !== 'sampled-frames-v1' ||
        !Array.isArray(frames) || frameEvidence.retainedCount !== frames.length ||
        typeof frameEvidence.fullTraceSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(frameEvidence.fullTraceSHA256))
        errors.push(`${path}: invalid frame evidence`);
    });
  }
  return errors;
}
