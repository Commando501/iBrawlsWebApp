import { runMixedContactParityTrace, type MixedContactCase, type MixedContactMovement } from './grifballMixedContactParity';
import { parityRecorder } from './grifballMultiActorParity';

const MOVEMENTS = ['approach', 'retreat', 'escape', 'enter', 'leave', 'both', 'reverse-walk'] as const;
export type MovingMixedContactCase = Omit<MixedContactCase, 'kind' | 'motion'> & { movement: typeof MOVEMENTS[number] };
export const MOVING_MIXED_CONTACT_CASES: MovingMixedContactCase[] = MOVEMENTS.flatMap(movement =>
  (['slash', 'slam', 'swipe'] as const).flatMap(attack => [false, true].flatMap(reverse =>
    (['lunger', 'target', 'melee'] as const).flatMap(mainRole => [false, true].map(observer =>
      ({ movement, attack, reverse, mainRole, observer }))))));

const walk = (z: number) => ({ walk: [{ tick: 1, direction: { x: 0, z } }] });
const dash = (z: number) => ({ dash: { tick: 1, direction: { x: 0, z } } });
function movementInputs(name: MovingMixedContactCase['movement']): MixedContactMovement {
  switch (name) {
    case 'approach': return { target: walk(-1) };
    case 'retreat': return { target: walk(1) };
    case 'escape': return { target: dash(1) };
    case 'enter': return { melee: dash(1), meleeStartZ: -1 };
    case 'leave': return { melee: dash(-1) };
    case 'both': return { target: walk(1), melee: dash(1), meleeStartZ: -1 };
    case 'reverse-walk': return { target: { walk: [...walk(1).walk, { tick: 5, direction: { x: 0, z: -1 } }] } };
  }
}

/** Independent authored geometry and clocks; never reads either engine's state to
 * choose an expected hit. Default dash consumes its sixteenth expiry step at 60 Hz. */
export function validateMovingMixedContact(trace: Pick<ReturnType<typeof runMixedContactParityTrace>, 'frames'>, spec: MovingMixedContactCase) {
  const record = parityRecorder(), { movement, attack, reverse, mainRole } = spec;
  const targetZ = (n: number) => 4.2 + (movement === 'approach' ? -5.2 * n / 60
    : movement === 'retreat' || movement === 'both' ? 5.2 * n / 60
    : movement === 'escape' ? .4 * Math.min(n, 16)
    : movement === 'reverse-walk' ? 5.2 * (Math.min(n, 4) - Math.max(0, n - 4)) / 60 : 0);
  const meleeZ = (n: number) => movement === 'enter' || movement === 'both' ? -1 + .4 * Math.min(n, 16)
    : movement === 'leave' ? 2.2 - .4 * Math.min(n, 16) : 2.2;
  // Target movement is seen this tick only when it precedes the lunger in roster order.
  let contact = 0;
  for (let n = 1; n <= 40; n++) if (Math.abs(targetZ(n - Number(!reverse)) - .4 * n) <= 1.5) {
    contact = n; break;
  }
  if (!contact) throw new Error('Moving mixed-contact fixture must reach its target');
  // Standing medium bodies: slash projects .6 with radius 2; configured hammer
  // reach is 2 with radius 1.5. Vertical offset is 1.2 - .825, lateral offset .3.
  const meleeHit = Math.hypot(.3, .375, targetZ(7) - meleeZ(7) - (attack === 'slash' ? .6 : 2))
    <= (attack === 'slash' ? 2 : 1.5);
  const deathTick = meleeHit ? Math.max(7, contact) : 0;
  const killer = meleeHit ? contact > 7 ? 'lunger' : 'melee' : null;
  const targetStop = deathTick ? deathTick - Number(killer === 'lunger' && !reverse) : 120;
  const roles = ['lunger', 'target', 'melee', 'extra'] as const;
  record.compare(120, 'expected.frameCount', trace.frames.length, 120);
  for (let tick = 1; tick <= 120; tick++) {
    const frame = trace.frames[tick - 1];
    record.compare(tick, 'expected.tick', frame?.tick, tick);
    for (const role of roles) {
      const id = role === mainRole ? 'main_ai' : role;
      const dead = role === 'target' && deathTick > 0 && tick >= deathTick;
      const hp = role === 'target' ? 2 - Number(tick >= contact) - Number(meleeHit && tick >= 7) : 20;
      const z = role === 'target' ? targetZ(Math.min(tick, targetStop)) : role === 'melee' ? meleeZ(tick)
        : role === 'lunger' ? .4 * Math.min(tick, contact) : -10;
      // Death freezes roster pose and last velocity; respawn owns their reset.
      const priorZ = role === 'target' ? targetZ(Math.min(tick, targetStop) - 1) : role === 'melee' ? meleeZ(tick - 1) : z;
      const vz = role === 'lunger' ? tick < contact ? 24 : 0
        : role === 'extra' ? 0 : (z - priorZ) * 60;
      for (const side of ['live', 'headless'] as const) {
        const actor = frame?.[side].find(c => c.id === id);
        record.compare(tick, `expected.${id}.${side}.hp`, actor?.hp, hp);
        record.compare(tick, `expected.${id}.${side}.kills`, actor?.kills, Number(role === killer && tick >= deathTick));
        record.compare(tick, `expected.${id}.${side}.deaths`, actor?.deaths, Number(dead));
        record.compare(tick, `expected.${id}.${side}.flight`, actor?.lunging, role === 'lunger' && tick < contact);
        const pos = actor?.pos, vel = actor?.vel;
        record.compare(tick, `expected.${id}.${side}.z`, Array.isArray(pos) ? pos[2] : pos?.z, z, 1e-6);
        record.compare(tick, `expected.${id}.${side}.vz`, Array.isArray(vel) ? vel[2] : vel?.z, vz, 1e-6);
        const dashing = role === 'target' && movement === 'escape'
          || role === 'melee' && ['enter', 'leave', 'both'].includes(movement);
        if (dashing) {
          record.compare(tick, `expected.${id}.${side}.dashRemaining`, actor?.dashRemaining, Math.max(0, .25 - tick / 60), 1e-6);
          record.compare(tick, `expected.${id}.${side}.dashCooldown`, actor?.dashCooldown, Math.max(0, 2 - tick / 60), 1e-6);
        }
        if (role === 'lunger' && tick >= contact) record.compare(tick, `expected.${side}.outcome`, actor?.outcome, 'hit');
      }
    }
  }
  return { ...record.result(), contact, meleeHit, deathTick, killer };
}

export function runMovingMixedContactTrace(spec: MovingMixedContactCase, snapshotAt?: number) {
  const movement = movementInputs(spec.movement);
  const trace = runMixedContactParityTrace({ ...spec, kind: 'same-frame-two' }, snapshotAt, movement);
  const expected = validateMovingMixedContact(trace, spec);
  return { ...trace, name: `moving-mixed/${Object.values(spec).join('/')}`, scenario: spec, movement,
    expected: { contact: expected.contact, meleeHit: expected.meleeHit, deathTick: expected.deathTick, killer: expected.killer },
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runMovingMixedContactParity = () => MOVING_MIXED_CONTACT_CASES.map(spec => runMovingMixedContactTrace(spec));
