import { AIRBORNE_RUNNER_POSES } from './grifballAirborneRunnerParity';
import { runFrameObjectiveTrace } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

export const AIRBORNE_FOCUS_CASES = (Object.keys(AIRBORNE_RUNNER_POSES) as (keyof typeof AIRBORNE_RUNNER_POSES)[]).flatMap((pose, index) =>
  (['slash', 'lunge'] as const).flatMap(secondAttack => ([1, 2, 3] as const).flatMap(hp => [false, true].map(reverse =>
    ({ pose, secondAttack, hp, reverse, mirror: reverse, main: reverse, motion: (['retreat', 'cross', 'approach'] as const)[index % 3] })))));
export type AirborneFocusCase = typeof AIRBORNE_FOCUS_CASES[number];

/** Authored kinematics and sampled contact order, independent of both engines.
 * Local movement precedes all roster flights; skeletal melee follows them. */
export function validateAirborneFocus(trace: Pick<ReturnType<typeof runFrameObjectiveTrace>, 'frames'>, spec: AirborneFocusCase) {
  const record = parityRecorder(), pose = AIRBORNE_RUNNER_POSES[spec.pose], sign = spec.mirror ? -1 : 1;
  const motion = spec.motion === 'cross' ? [1, 0] : [0, spec.motion === 'approach' ? -1 : 1];
  const runner = { x: 0, y: pose.runnerHeight as number, z: 0, vy: pose.runnerVelocityY as number, hp: spec.hp as number };
  const actors = [{ id: spec.main ? 'main_ai' : 'attacker', attack: 'lunge', y: pose.attackerHeight as number,
    vy: pose.attackerVelocityY as number, z: -1.5, flight: false, startY: 0, outcome: undefined as string | undefined, kills: 0 },
  { id: 'support', attack: spec.secondAttack, y: 0, vy: 0, z: -1.5, flight: false, startY: 0, outcome: undefined as string | undefined, kills: 0 }];
  const order = spec.reverse ? [...actors].reverse() : actors;
  const contacts: { tick: number; id: string; lethal: boolean }[] = [];
  const hit = (actor: typeof actors[number], tick: number) => {
    runner.hp = 0;
    if (runner.hp === 0) actor.kills++;
    contacts.push({ tick, id: actor.id, lethal: runner.hp === 0 });
  };
  const fall = (body: { y: number; vy: number }) => {
    if (body.y > 0 || body.vy !== 0) {
      body.vy -= .3; body.y += body.vy / 60;
      if (body.y <= 0) { body.y = 0; body.vy = 0; }
    }
  };
  record.compare(0, 'expected.frameCount', trace.frames.length, 120);
  for (let tick = 1; tick <= 120; tick++) {
    if (tick === 4) for (const a of actors) if (a.attack === 'lunge') {
      a.flight = true; a.startY = a.y; a.vy = Math.max(0, a.vy);
    }
    if (runner.hp > 0) {
      runner.x += motion[0] * 7.54 / 60; runner.z += motion[1] * 7.54 / 60;
      fall(runner);
    }
    for (const a of order) {
      fall(a);
      if (a.flight) {
        a.z += .4;
        if (runner.hp <= 0) a.outcome = 'target_dead';
        else if (Math.hypot(runner.x, runner.y - a.y, runner.z - a.z) <= 1.5) {
          hit(a, tick); a.outcome = 'hit';
        } else if (Math.hypot(a.z + 1.5, a.y - a.startY) > 16 + 1e-9 || (tick - 3) / 60 > .8) a.outcome = 'miss_timeout';
        if (a.outcome) { a.flight = false; a.vy = Math.min(a.vy, 0); }
      }
    }
    if (tick === 4) for (const a of order) if (a.attack === 'slash' && runner.hp > 0 &&
      Math.hypot(runner.x, a.y + 1.2 - runner.y - .825, a.z + 3.2 * .3 - runner.z) <= 2) hit(a, tick);
    const frame = trace.frames[tick - 1];
    record.compare(tick, 'expected.tick', frame?.tick, tick);
    for (const side of ['live', 'headless'] as const) {
      const f = frame?.[side], crowd = side === 'live' ? frame?.liveCrowd : frame?.simCrowd;
      record.compare(tick, `expected.${side}.health`, f?.hp, runner.hp);
      record.compare(tick, `expected.${side}.deaths`, f?.runnerDeaths, Number(runner.hp === 0));
      record.compare(tick, `expected.${side}.holder`, f?.ball.holderId, runner.hp > 0 ? 'player' : null);
      record.compare(tick, `expected.${side}.ballState`, f?.ball.state, runner.hp > 0 ? 'held' : 'loose');
      record.compare(tick, `expected.${side}.weapon`, f?.weapon, runner.hp > 0 ? 'ball' : 'hammer');
      record.compare(tick, `expected.${side}.goals`, f?.goals, 0);
      for (const [index, axis] of (['x', 'y', 'z'] as const).entries())
        record.compare(tick, `expected.${side}.runner.${axis}`, f?.runnerPos[index], runner[axis] * (axis === 'y' ? 1 : sign), 1e-6);
      for (const a of actors) {
        const actual = crowd?.find(c => c.id === a.id);
        record.compare(tick, `expected.${side}.${a.id}.health`, actual?.hp, 1);
        record.compare(tick, `expected.${side}.${a.id}.deaths`, actual?.deaths, 0);
        record.compare(tick, `expected.${side}.${a.id}.kills`, actual?.kills, a.kills);
        record.compare(tick, `expected.${side}.${a.id}.flight`, actual?.lunging, a.flight);
        record.compare(tick, `expected.${side}.${a.id}.x`, actual?.pos[0], 0, 1e-6);
        record.compare(tick, `expected.${side}.${a.id}.y`, actual?.pos[1], a.y, 1e-6);
        record.compare(tick, `expected.${side}.${a.id}.z`, actual?.pos[2], a.z * sign, 1e-6);
      }
    }
  }
  return { ...record.result(), contacts };
}

export function runAirborneFocusTrace(spec: AirborneFocusCase, snapshotAt?: number) {
  const trace = runFrameObjectiveTrace({ player: true, goal: false, lunge: true, hp: spec.hp, mirror: spec.mirror, reverse: spec.reverse },
    snapshotAt, undefined, undefined, { airborne: AIRBORNE_RUNNER_POSES[spec.pose], secondAttack: spec.secondAttack,
      motion: spec.motion, mainAttacker: spec.main, attack: 'lunge', counter: false, speed: 130, punchSpeed: .04, enemyHp: 1, shield: false });
  if (!('counters' in trace) || trace.counters !== 0) throw new Error('Airborne focus fixture must retain its no-counter input');
  const expected = validateAirborneFocus(trace, spec);
  return { ...trace, name: `airborne-focus/${JSON.stringify(spec)}`, scenario: spec, expectedContacts: expected.contacts,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runAirborneFocusParity = () => AIRBORNE_FOCUS_CASES.map(s => runAirborneFocusTrace(s));
