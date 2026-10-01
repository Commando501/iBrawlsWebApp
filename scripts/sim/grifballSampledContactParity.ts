import { LUNGE_PARITY_ACTORS, runLungeParityTrace } from './grifballLungeParity';
import { runPlayerLungeParityTrace } from './grifballPlayerLungeParity';
import { parityRecorder } from './grifballMultiActorParity';

// A 1.49 lateral offset intersects the radius-1.5 swept path, but at z=2.2
// neither adjacent 0.4-unit sample is inside. z=2 is the positive control.
export const SAMPLED_CONTACT_POSES = [
  { name: 'sample-hit', x: 1.49, z: 2 },
  { name: 'between-samples', x: 1.49, z: 2.2 },
  { name: 'outside-path', x: 1.51, z: 2.2 },
] as const;
export const SAMPLED_CONTACT_CASES = SAMPLED_CONTACT_POSES.flatMap(pose => [
  ...LUNGE_PARITY_ACTORS.flatMap(({ id, targetId }) => [false, true].flatMap(observer => [false, true].map(reverse =>
    ({ pose, player: false, id, targetId, observer, reverse, mirror: false })))),
  ...[false, true].flatMap(main => [false, true].flatMap(reverse => [false, true].map(mirror =>
    ({ pose, player: true, id: 'player', targetId: main ? 'main_ai' : 'target', observer: false, reverse, mirror })))),
]);
export type SampledContactCase = typeof SAMPLED_CONTACT_CASES[number];
type Sample = { hp: number; targetHp: number; lunging: boolean; x: number; z: number };
type Frame = { tick: number; live: Sample; headless: Sample };

export function sampledContactExpectation(spec: SampledContactCase) {
  const step = 24 / 60, radius = 1.5;
  const travelEnd = Math.floor(16 / step) + 1;
  let hitTick = 0;
  for (let tick = 1; tick <= travelEnd; tick++) {
    if (Math.hypot(spec.pose.x, spec.pose.z - tick * step) <= radius) { hitTick = tick; break; }
  }
  return { hitTick, finishTick: hitTick || travelEnd, sweptPathIntersects: Math.abs(spec.pose.x) <= radius };
}

/** The oracle reads authored coordinates, never either engine's contact result. */
export function validateSampledContact(frames: readonly Frame[], spec: SampledContactCase) {
  const expected = sampledContactExpectation(spec), record = parityRecorder();
  const ticks = spec.player ? 120 : 300, sign = spec.mirror ? -1 : 1, hp = spec.player ? 2 : 20;
  record.compare(0, 'expected.frameCount', frames.length, ticks);
  for (let tick = 1; tick <= ticks; tick++) {
    const f = frames[tick - 1];
    record.compare(tick, 'expected.tick', f?.tick, tick);
    for (const side of ['live', 'headless'] as const) {
      const actual = f?.[side];
      record.compare(tick, `expected.${side}.health`, actual?.hp, hp);
      record.compare(tick, `expected.${side}.targetHealth`, actual?.targetHp, hp - Number(expected.hitTick > 0 && tick >= expected.hitTick));
      record.compare(tick, `expected.${side}.flight`, actual?.lunging, tick < expected.finishTick);
      record.compare(tick, `expected.${side}.x`, actual?.x, 0, 1e-6);
      record.compare(tick, `expected.${side}.z`, actual?.z, sign * .4 * Math.min(tick, expected.finishTick), 1e-6);
    }
  }
  return { ...record.result(), expected };
}

export function runSampledContactTrace(spec: SampledContactCase, snapshotAt?: number) {
  const expected = sampledContactExpectation(spec);
  const frames: Frame[] = [];
  let paired: ReturnType<ReturnType<typeof parityRecorder>['result']>;
  if (spec.player) {
    const trace = runPlayerLungeParityTrace({ kind: 'hit-two', mainTarget: spec.targetId === 'main_ai',
      reverse: spec.reverse, mirror: spec.mirror, geometry: { name: spec.pose.name, targetZ: spec.pose.z,
        afterLockX: spec.pose.x, expectedHit: expected.hitTick > 0, finishTick: expected.finishTick } }, 'live-mixed-v1', snapshotAt);
    paired = trace;
    for (const f of trace.frames) {
      const target = f.actors.find(a => a.id === spec.targetId)!;
      const sample = (side: 'live' | 'headless'): Sample => ({ hp: f[side].hp, targetHp: target[side].hp,
        lunging: f[side].lunging, x: f[side].pos[0], z: f[side].pos[2] });
      frames.push({ tick: f.tick, live: sample('live'), headless: sample('headless') });
    }
  } else {
    const trace = runLungeParityTrace({ name: spec.pose.name, target: { x: spec.pose.x, z: spec.pose.z },
      hits: Number(expected.hitTick > 0), expectedFirstHitTick: expected.hitTick, reverseOrder: spec.reverse },
    spec.id, spec.observer, 'live-roster-v2', spec.targetId);
    paired = trace;
    for (const f of trace.frames) frames.push({ tick: f.tick,
      live: { hp: f.live.hp, targetHp: f.live.targetHp, lunging: f.live.lunging, x: f.live.pos[0], z: f.live.pos[2] },
      headless: { hp: f.headless.hp, targetHp: f.headless.targetHp, lunging: f.headless.lunging, x: f.headless.pos.x, z: f.headless.pos.z } });
  }
  const independent = validateSampledContact(frames, spec);
  return { name: `sampled-contact/${JSON.stringify(spec)}`, scenario: spec, frames, expected: independent.expected,
    differenceCount: paired.differenceCount + independent.differenceCount,
    differences: [...paired.differences, ...independent.differences].slice(0, 64) };
}
export const runSampledContactParity = () => SAMPLED_CONTACT_CASES.map(s => runSampledContactTrace(s));
