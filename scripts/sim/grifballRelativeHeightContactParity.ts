import { runMixedContactParityTrace, type MixedContactCase, type MixedContactVertical } from './grifballMixedContactParity';
import { parityRecorder } from './grifballMultiActorParity';

const pose = (height: number, velocityY = 0) => ({ height, velocityY });
export const RELATIVE_HEIGHT_POSES: Record<string, MixedContactVertical> = {
  'raised-target': { lunger: pose(0), target: pose(2), melee: pose(0), extra: pose(.5, -2) },
  'raised-lunger': { lunger: pose(2), target: pose(0), melee: pose(0), extra: pose(1, 2) },
  'raised-melee': { lunger: pose(0), target: pose(0), melee: pose(2), extra: pose(3) },
  'falling-target': { lunger: pose(.7), target: pose(2, -6), melee: pose(0), extra: pose(0) },
  'rising-lunger': { lunger: pose(.2, 6), target: pose(1), melee: pose(1, -2), extra: pose(2, -3) },
  'opposed-vertical': { lunger: pose(1, 6), target: pose(2, -6), melee: pose(.3, 3), extra: pose(0, 3) },
  'landing-group': { lunger: pose(.1, -3), target: pose(.4, -3), melee: pose(1, -4), extra: pose(.2, -1) },
  'split-high': { lunger: pose(4, 3), target: pose(2, -3), melee: pose(3, -6), extra: pose(5) },
  'falling-order-boundary': { lunger: pose(.7), target: pose(1.93, -6), melee: pose(0), extra: pose(0) },
};
export type RelativeHeightContactCase = Omit<MixedContactCase, 'kind' | 'motion'> & { profile: string };
export const RELATIVE_HEIGHT_CONTACT_CASES: RelativeHeightContactCase[] = Object.keys(RELATIVE_HEIGHT_POSES).flatMap((profile, index) =>
  (['slash', 'slam', 'swipe'] as const).flatMap(attack => [false, true].map(reverse => ({ profile, attack, reverse,
    mainRole: (['lunger', 'target', 'melee'] as const)[index % 3], observer: reverse }))));

/** Discrete ballistic/contact equations use only authored inputs. Each actor's
 * current height is observed according to roster order; melee follows movement. */
export function validateRelativeHeightContact(trace: Pick<ReturnType<typeof runMixedContactParityTrace>, 'frames'>, spec: RelativeHeightContactCase) {
  const record = parityRecorder(), poses = RELATIVE_HEIGHT_POSES[spec.profile];
  if (!poses) throw new Error('Unknown relative-height profile');
  const roles = ['lunger', 'target', 'melee', 'extra'] as const;
  const actors = roles.map((role, index) => ({ role, id: role === spec.mainRole ? 'main_ai' : role,
    x: [0, 0, .3, -.3][index], y: poses[role].height, z: [0, 4.2, 2.2, -10][index],
    vy: role === 'lunger' ? Math.max(0, poses[role].velocityY) : poses[role].velocityY, vz: role === 'lunger' ? 24 : 0,
    hp: role === 'target' ? 2 : 20, kills: 0, deaths: 0, flight: role === 'lunger', outcome: undefined as string | undefined }));
  const [lunger, target, melee] = actors;
  const order = spec.reverse ? [...actors].reverse() : actors;
  let contact = 0, meleeHit = false, finish = 0;
  const hit = (a: typeof lunger) => { target.hp--; if (target.hp === 0) { target.deaths++; a.kills++; } };
  record.compare(0, 'expected.frameCount', trace.frames.length, 120);
  for (let tick = 1; tick <= 120; tick++) {
    for (const a of order) if (a.hp > 0) {
      if (a.flight || a.y > 0 || a.vy !== 0) {
        a.vy -= .3; a.y += a.vy / 60;
        if (a.y <= 0) { a.y = 0; a.vy = 0; }
      }
      if (a.flight) {
        a.z += .4;
        if (target.hp <= 0) a.outcome = 'target_dead';
        else if (Math.hypot(a.x - target.x, a.y - target.y, a.z - target.z) <= 1.5) {
          hit(a); a.outcome = 'hit'; contact = tick;
        } else if (Math.hypot(a.z, a.y - poses.lunger.height) > 16 + 1e-9 || tick / 60 > .8) a.outcome = 'miss_timeout';
        if (a.outcome) { a.flight = false; a.vz = 0; a.vy = Math.min(a.vy, 0); finish = tick; }
      }
    }
    if (tick === 7 && target.hp > 0) {
      const forward = spec.attack === 'slash' ? .6 : 2, radius = spec.attack === 'slash' ? 2 : 1.5;
      meleeHit = Math.hypot(melee.x - target.x, melee.y + 1.2 - target.y - .825, melee.z + forward - target.z) <= radius;
      if (meleeHit) hit(melee);
    }
    const frame = trace.frames[tick - 1];
    record.compare(tick, 'expected.tick', frame?.tick, tick);
    for (const a of actors) for (const side of ['live', 'headless'] as const) {
      const actual = frame?.[side].find(c => c.id === a.id);
      for (const [key, value] of [['hp', a.hp], ['kills', a.kills], ['deaths', a.deaths], ['lunging', a.flight]] as const)
        record.compare(tick, `expected.${side}.${a.id}.${key}`, actual?.[key], value);
      for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
        const pos = actual?.pos;
        record.compare(tick, `expected.${side}.${a.id}.${axis}`, Array.isArray(pos) ? pos[index] : pos?.[axis], a[axis], 1e-6);
      }
      const vel = actual?.vel;
      record.compare(tick, `expected.${side}.${a.id}.vy`, Array.isArray(vel) ? vel[1] : vel?.y, a.vy, 1e-6);
      record.compare(tick, `expected.${side}.${a.id}.vz`, Array.isArray(vel) ? vel[2] : vel?.z, a.vz, 1e-6);
      if (a === lunger && finish) record.compare(tick, `expected.${side}.${a.id}.outcome`, actual?.outcome, a.outcome);
    }
  }
  return { ...record.result(), contact, finish, meleeHit, targetHp: target.hp };
}
export function runRelativeHeightContactTrace(spec: RelativeHeightContactCase, snapshotAt?: number) {
  const vertical = RELATIVE_HEIGHT_POSES[spec.profile];
  if (!vertical) throw new Error('Unknown relative-height profile');
  const trace = runMixedContactParityTrace({ ...spec, kind: 'same-frame-two' }, snapshotAt, undefined, vertical);
  const expected = validateRelativeHeightContact(trace, spec);
  return { ...trace, name: `relative-height/${JSON.stringify(spec)}`, scenario: spec, vertical,
    expected: { contact: expected.contact, finish: expected.finish, meleeHit: expected.meleeHit, targetHp: expected.targetHp },
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runRelativeHeightContactParity = () => RELATIVE_HEIGHT_CONTACT_CASES.map(spec => runRelativeHeightContactTrace(spec));
