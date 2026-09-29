import { runFrameObjectiveTrace, type FrameObjectiveCase, type RunnerCombatCase } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';
export interface RunnerCombatSpec { frame: FrameObjectiveCase; runner: RunnerCombatCase }
export const RUNNER_COMBAT_CASES: RunnerCombatSpec[] = [];
for (const attack of ['none', 'slash', 'lunge'] as const) for (const counter of [false, true])
  for (const hp of [1, 2]) for (const enemyHp of [1, 2] as const) for (const reverse of [false, true])
    for (const mirror of [false, true]) for (const speed of [100, 130] as const)
      for (const punchSpeed of (counter ? [.04, .24] : [.04]) as (.04 | .24)[]) for (const shield of [false, true])
        RUNNER_COMBAT_CASES.push({ frame: { player: false, goal: false, lunge: attack === 'lunge', hp, reverse, mirror },
          runner: { attack, counter, speed, punchSpeed, enemyHp, shield } });
export function runRunnerCombatTrace(spec: RunnerCombatSpec, snapshotAt?: number) {
  const trace = runFrameObjectiveTrace(spec.frame, snapshotAt, undefined, undefined, spec.runner);
  const record = parityRecorder(), { frame, runner } = spec;
  const incoming = runner.attack !== 'none', dead = incoming && frame.hp === 1;
  const counterStarted = runner.counter && !(dead && runner.attack === 'lunge' && !frame.reverse);
  const punchHit = counterStarted && !dead && !runner.shield;
  const impactTick = runner.punchSpeed === .04 ? 8 : 26;
  const enemyDead = punchHit && runner.enemyHp === 1;
  // A 130%-speed carrier moving first escapes the initial lunge contact by one tick;
  // pausing for the counter removes that extra movement. Slashes land after both moves.
  const contactTick = runner.attack === 'lunge' && frame.reverse && !runner.counter && runner.speed === 130 ? 5 : 4;
  record.compare(120, 'expected.counterRequests', 'counters' in trace ? trace.counters : undefined, counterStarted ? 1 : 0);
  for (const side of ['live', 'headless'] as const) {
    for (const f of trace.frames) {
      const received = incoming && f.tick >= contactTick;
      const dealt = punchHit && f.tick >= impactTick;
      record.compare(f.tick, `expected.${side}.health`, f[side].hp, frame.hp - Number(received));
      record.compare(f.tick, `expected.${side}.enemyHealth`, f[side].attackerHp, runner.enemyHp - Number(dealt));
      record.compare(f.tick, `expected.${side}.possession`, f[side].ball.holderId, dead && received ? null : 'target');
      record.compare(f.tick, `expected.${side}.deaths`, f[side].runnerDeaths, dead && received ? 1 : 0);
      let movingTicks = dead ? Math.min(f.tick, contactTick) : f.tick;
      if (dead && received && runner.attack === 'lunge' && !frame.reverse) movingTicks--;
      if (counterStarted) movingTicks -= Math.max(0, Math.min(movingTicks, impactTick) - 3);
      record.compare(f.tick, `expected.${side}.position`, f[side].runnerPos[2], (frame.mirror ? -1 : 1) * movingTicks * 5.8 * runner.speed / 100 / 60, 1e-6);
    }
    record.compare(120, `expected.${side}.noGoal`, trace.frames.at(-1)![side].goals, 0);
  }
  // Both punch durations hold position through impact, then resume movement during recovery.
  for (const side of ['liveRunner', 'simRunner'] as const) {
    const last = trace.frames.at(-1)![side]!;
    record.compare(120, `expected.${side}.kills`, last.kills, enemyDead ? 1 : 0);
    record.compare(120, `expected.${side}.enemyDeaths`, last.enemyDeaths, enemyDead ? 1 : 0);
    record.compare(120, `expected.${side}.enemyKills`, last.enemyKills, dead ? 1 : 0);
  }
  const expected = record.result();
  return { ...trace, differenceCount: trace.differenceCount + expected.differenceCount, differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runRunnerCombatParity = () => RUNNER_COMBAT_CASES.map(c => runRunnerCombatTrace(c));
