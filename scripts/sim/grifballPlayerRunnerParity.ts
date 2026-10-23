import { runFrameObjectiveTrace, type RunnerCombatCase } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';
import { checkPunchTrace } from './grifballPunchTraceChecks';

const CONTESTS = [
  { attack: 'none', counter: true, enemyHp: 1, shield: false },
  { attack: 'slash', counter: true, enemyHp: 2, shield: false },
  { attack: 'lunge', counter: true, enemyHp: 1, shield: false },
  { attack: 'lunge', counter: true, enemyHp: 2, shield: true },
  { attack: 'lunge', counter: false, enemyHp: 1, shield: false },
] as const;
export interface PlayerRunnerCase { hp: 1 | 2; reverse: boolean; mirror: boolean; runner: RunnerCombatCase }
export const PLAYER_RUNNER_CASES: PlayerRunnerCase[] = [];
for (const contest of CONTESTS) for (const motion of ['retreat', 'cross', 'approach'] as const)
  for (const hp of [1, 2] as const) for (const speed of [100, 130] as const)
    for (const punchSpeed of (contest.counter ? [.04, .24] : [.04]) as (.04 | .24)[])
      for (const mainAttacker of [false, true]) for (const mirror of [false, true]) for (const reverse of [false, true])
        PLAYER_RUNNER_CASES.push({ hp, mirror, reverse, runner: { ...contest, motion, speed, punchSpeed, mainAttacker } });

/** Local input yields horizontal movement while a locked punch lunges. */
export function runPlayerRunnerTrace(spec: PlayerRunnerCase, snapshotAt?: number) {
  const { runner: r, hp } = spec;
  const trace = runFrameObjectiveTrace({ player: true, goal: false, lunge: r.attack === 'lunge',
    hp, reverse: spec.reverse, mirror: spec.mirror }, snapshotAt, undefined, undefined, r);
  if (r.counter) {
    const expected = checkPunchTrace(trace, hp, r.enemyHp, r.speed, r.shield);
    return { ...trace, name: `player-runner/${JSON.stringify(spec)}`, scenario: spec,
      differenceCount: trace.differenceCount + expected.differenceCount,
      differences: [...trace.differences, ...expected.differences].slice(0, 64) };
  }
  const record = parityRecorder();
  const hitTick = r.attack === 'none' ? 0 : r.attack === 'lunge' && r.motion === 'retreat' && r.speed === 130 ? 5 : 4;
  const clash = hitTick > 0 && r.counter && !r.shield;
  const dead = hitTick > 0 && !clash;
  const impactTick = clash ? hitTick : r.punchSpeed === .04 ? 8 : 26;
  const step = 5.8 * r.speed / 100 / 60;
  const motion = r.motion === 'cross' ? [1, 0] : [0, r.motion === 'approach' ? -1 : 1];
  // Independent standing-body sphere: local eye 1.65, body center .825,
  // punch center 1.8 ahead and radius 1.5. Canonical player aim remains -Z.
  const enemyZ = -1.5 + (r.attack === 'lunge' ? .4 * (hitTick - 3) : 0);
  const punchHits = !!r.counter && !dead && !r.shield && Math.hypot(motion[0] * step * impactTick,
    .825, motion[1] * step * impactTick - 1.8 - enemyZ) <= 1.5;
  record.compare(120, 'expected.counterRequests', 'counters' in trace ? trace.counters : undefined, Number(r.counter));
  for (const frame of trace.frames) for (const side of ['live', 'headless'] as const) {
    const f = frame[side], hit = dead && frame.tick >= hitTick;
    const punched = punchHits && frame.tick >= impactTick;
    record.compare(frame.tick, `expected.${side}.health`, f.hp, hit ? 0 : hp);
    record.compare(frame.tick, `expected.${side}.enemyHealth`, f.attackerHp, r.enemyHp - Number(punched));
    record.compare(frame.tick, `expected.${side}.holder`, f.ball.holderId, dead && hit ? null : 'player');
    record.compare(frame.tick, `expected.${side}.deaths`, f.runnerDeaths, Number(dead && hit));
    record.compare(frame.tick, `expected.${side}.goals`, f.goals, 0);
    const steps = dead ? Math.min(frame.tick, hitTick) : frame.tick;
    const mirror = spec.mirror ? -1 : 1;
    record.compare(frame.tick, `expected.${side}.x`, f.runnerPos[0], mirror * motion[0] * step * steps, 1e-6);
    record.compare(frame.tick, `expected.${side}.z`, f.runnerPos[2], mirror * motion[1] * step * steps, 1e-6);
    const combat = side === 'live' ? frame.liveRunner! : frame.simRunner!;
    record.compare(frame.tick, `expected.${side}.kills`, combat.kills, Number(punched && r.enemyHp === 1));
    record.compare(frame.tick, `expected.${side}.enemyDeaths`, combat.enemyDeaths, Number(punched && r.enemyHp === 1));
    record.compare(frame.tick, `expected.${side}.enemyKills`, combat.enemyKills, Number(dead && hit));
  }
  const expected = record.result();
  return { ...trace, name: `player-runner/${JSON.stringify(spec)}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runPlayerRunnerParity = () => PLAYER_RUNNER_CASES.map(spec => runPlayerRunnerTrace(spec));
