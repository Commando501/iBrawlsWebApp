import type { runFrameObjectiveTrace } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

/** The old stationary splash oracle cannot describe a moving, locked jab.
 * Keep cross-host comparisons in runFrameObjectiveTrace and independently check
 * damage/credit/travel bounds here. Exact contact, lunge distance, magnetism and
 * hit/miss witnesses live in ballPunch.test.ts and ballPunchRuntime.test.ts. */
export function checkPunchTrace(trace: ReturnType<typeof runFrameObjectiveTrace>, hp: number, enemyHp: number, speed: number, shield: boolean) {
  const record = parityRecorder();
  for (const frame of trace.frames) for (const side of ['live', 'headless'] as const) {
    const f = frame[side], combat = side === 'live' ? frame.liveRunner! : frame.simRunner!;
    const damage = enemyHp - f.attackerHp;
    record.compare(frame.tick, `punch.${side}.singleDamage`, damage === 0 || damage === 1, true);
    record.compare(frame.tick, `punch.${side}.swordLethality`, f.hp === hp || f.hp === 0, true);
    record.compare(frame.tick, `punch.${side}.runnerDeaths`, f.runnerDeaths, Number(f.hp === 0));
    record.compare(frame.tick, `punch.${side}.kills`, combat.kills, Number(f.attackerHp === 0));
    record.compare(frame.tick, `punch.${side}.enemyDeaths`, combat.enemyDeaths, Number(f.attackerHp === 0));
    record.compare(frame.tick, `punch.${side}.enemyKills`, combat.enemyKills, Number(f.hp === 0));
    record.compare(frame.tick, `punch.${side}.noGoal`, f.goals, 0);
    record.compare(frame.tick, `punch.${side}.boundedTravel`, Math.hypot(f.runnerPos[0], f.runnerPos[2]) <=
      frame.tick * 5.8 * speed / 100 / 60 + 1.8 + 1e-6, true);
    if (shield || frame.tick < 4) record.compare(frame.tick, `punch.${side}.protected`, damage, 0);
  }
  return record.result();
}
