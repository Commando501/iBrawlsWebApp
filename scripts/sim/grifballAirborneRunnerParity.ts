import { runFrameObjectiveTrace } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

export const AIRBORNE_RUNNER_POSES = {
  'rising-runner': { runnerHeight: .5, runnerVelocityY: 6, attackerHeight: 0, attackerVelocityY: 0 },
  'falling-attacker': { runnerHeight: 0, runnerVelocityY: 0, attackerHeight: 2, attackerVelocityY: -6 },
  'both-airborne': { runnerHeight: 2, runnerVelocityY: -3, attackerHeight: 2, attackerVelocityY: 6 },
  'overhead-miss': { runnerHeight: 0, runnerVelocityY: 0, attackerHeight: 6, attackerVelocityY: 0 },
} as const;
export const AIRBORNE_RUNNER_CASES = (Object.keys(AIRBORNE_RUNNER_POSES) as (keyof typeof AIRBORNE_RUNNER_POSES)[]).flatMap(pose =>
  (['retreat', 'cross', 'approach'] as const).flatMap(motion => ([1, 2] as const).flatMap(hp =>
    ([100, 130] as const).flatMap(speed => [false, true].flatMap(main => [false, true].flatMap(mirror =>
      [false, true].map(reverse => ({ pose, motion, hp, speed, main, mirror, reverse }))))))));

export function runAirborneRunnerTrace(spec: typeof AIRBORNE_RUNNER_CASES[number], snapshotAt?: number) {
  const pose = AIRBORNE_RUNNER_POSES[spec.pose];
  const trace = runFrameObjectiveTrace({ player: true, goal: false, lunge: true, hp: spec.hp, mirror: spec.mirror, reverse: spec.reverse },
    snapshotAt, undefined, undefined, { airborne: pose, motion: spec.motion, mainAttacker: spec.main,
      attack: 'lunge', counter: false, speed: spec.speed, punchSpeed: .04, enemyHp: 1, shield: false });
  const record = parityRecorder();
  record.compare(120, 'expected.noCounterRequests', 'counters' in trace ? trace.counters : undefined, 0);
  // Authored forward flight starts at tick four. Integrate independent point
  // positions before the sampled 1.5-unit contact test; both actors fall at 18.
  const step = 5.8 * spec.speed / 100 / 60, sign = spec.mirror ? -1 : 1;
  const motion = spec.motion === 'cross' ? [1, 0] : [0, spec.motion === 'approach' ? -1 : 1];
  const runnerHeight = (tick: number) => Math.max(0, pose.runnerHeight + pose.runnerVelocityY * tick / 60 - .0025 * tick * (tick + 1));
  let attackerY: number = pose.attackerHeight, attackerVY: number = pose.attackerVelocityY, hitTick = 0;
  for (let tick = 1; tick <= 40; tick++) {
    if (tick === 4) attackerVY = Math.max(0, attackerVY);
    attackerVY -= .3;
    attackerY = Math.max(0, attackerY + attackerVY / 60);
    if (attackerY === 0) attackerVY = 0;
    if (tick >= 4 && Math.hypot(motion[0] * step * tick,
      runnerHeight(tick) - attackerY, motion[1] * step * tick - (-1.5 + .4 * (tick - 3))) <= 1.5) {
      hitTick = tick; break;
    }
  }
  for (const frame of trace.frames) for (const side of ['live', 'headless'] as const) {
    const hit = hitTick > 0 && frame.tick >= hitTick, dead = hit;
    const movementTicks = dead ? hitTick : frame.tick;
    const f = frame[side];
    record.compare(frame.tick, `expected.${side}.health`, f.hp, hit ? 0 : spec.hp);
    record.compare(frame.tick, `expected.${side}.attackerHealth`, f.attackerHp, 1);
    record.compare(frame.tick, `expected.${side}.holder`, f.ball.holderId, dead ? null : 'player');
    record.compare(frame.tick, `expected.${side}.weapon`, f.weapon, dead ? 'hammer' : 'ball');
    record.compare(frame.tick, `expected.${side}.deaths`, f.runnerDeaths, Number(dead));
    record.compare(frame.tick, `expected.${side}.goals`, f.goals, 0);
    record.compare(frame.tick, `expected.${side}.x`, f.runnerPos[0], sign * motion[0] * step * movementTicks, 1e-6);
    record.compare(frame.tick, `expected.${side}.z`, f.runnerPos[2], sign * motion[1] * step * movementTicks, 1e-6);
    record.compare(frame.tick, `expected.${side}.height`, f.runnerPos[1], runnerHeight(movementTicks), 1e-6);
    const combat = side === 'live' ? frame.liveRunner! : frame.simRunner!;
    record.compare(frame.tick, `expected.${side}.kills`, combat.kills, 0);
    record.compare(frame.tick, `expected.${side}.enemyKills`, combat.enemyKills, Number(dead));
    record.compare(frame.tick, `expected.${side}.enemyDeaths`, combat.enemyDeaths, 0);
  }
  const expected = record.result();
  return { ...trace, name: `airborne-runner/${JSON.stringify(spec)}`, scenario: spec, expectedHitTick: hitTick,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runAirborneRunnerParity = () => AIRBORNE_RUNNER_CASES.map(spec => runAirborneRunnerTrace(spec));
