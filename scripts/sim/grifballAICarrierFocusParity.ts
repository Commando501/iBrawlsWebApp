import { runFrameObjectiveTrace, type RunnerCombatCase } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

export interface AICarrierFocusCase {
  hp: 1 | 2 | 3;
  reverse: boolean;
  mirror: boolean;
  runner: RunnerCombatCase & { secondAttack: 'slash' | 'lunge' };
}
export const AI_CARRIER_FOCUS_CASES: AICarrierFocusCase[] = [];
for (const attack of ['slash', 'lunge'] as const) for (const secondAttack of ['slash', 'lunge'] as const)
  for (const hp of [1, 2, 3] as const) for (const reverse of [false, true]) for (const mirror of [false, true])
    AI_CARRIER_FOCUS_CASES.push({ hp, reverse, mirror, runner: { attack, secondAttack, counter: true,
      speed: 130, punchSpeed: .04, enemyHp: 1, shield: false, mainRunner: mirror, mainAttacker: !mirror } });
for (const control of [{ counter: false }, { shield: true }, { enemyHp: 2 as const }, { punchSpeed: .24 as const }])
  for (const reverse of [false, true]) AI_CARRIER_FOCUS_CASES.push({ hp: 3, reverse, mirror: reverse,
    runner: { attack: 'lunge', secondAttack: 'slash', counter: true, speed: 130, punchSpeed: .04,
      enemyHp: 1, shield: false, mainRunner: reverse, mainAttacker: !reverse, ...control } });

/** Independent authored contact schedule: roster flights bracket the carrier's
 * movement decision; skeletal slashes and a surviving counter land afterward. */
export function validateAICarrierFocus(trace: ReturnType<typeof runFrameObjectiveTrace>, spec: AICarrierFocusCase) {
  const record = parityRecorder(), r = spec.runner;
  const runnerId = r.mainRunner ? 'main_ai' : 'target';
  const attackers = [{ id: r.mainAttacker ? 'main_ai' : 'attacker', attack: r.attack, z: -1.5, hit: false, hp: r.enemyHp, kills: 0, deaths: 0 },
    { id: 'support', attack: r.secondAttack, z: -1.5, hit: false, hp: r.enemyHp, kills: 0, deaths: 0 }];
  const order = spec.reverse ? [attackers[1], null, attackers[0]] : [attackers[0], null, attackers[1]];
  const step = 5.8 * r.speed / 100 / 60, impact = r.punchSpeed === .04 ? 8 : 26;
  let hp: number = spec.hp, z = 0, counter = false, kills = 0;
  const damage = (a: typeof attackers[number]) => {
    if (hp <= 0) return;
    hp--;
    if (hp === 0) a.kills++;
  };
  record.compare(0, 'expected.frameCount', trace.frames.length, 120);
  record.compare(0, 'expected.ticks', trace.ticks, 120);
  for (const [index, frame] of trace.frames.entries()) {
    const tick = frame.tick;
    record.compare(tick, 'expected.consecutiveTick', tick, index + 1);
    for (const a of order) {
      if (!a) {
        if (hp <= 0) continue;
        if (tick === 4 && r.counter && !r.shield) counter = true;
        if (!counter || tick < 4 || tick > impact) z += step;
      } else if (tick >= 4 && a.attack === 'lunge' && !a.hit && a.hp > 0 && hp > 0) {
        a.z += .4;
        if (Math.abs(z - a.z) <= 1.5) { a.hit = true; damage(a); }
      }
    }
    if (tick === 4) for (const a of order) if (a && a.attack === 'slash') damage(a);
    if (tick === impact && counter && hp > 0) for (const a of attackers) {
      // A grounded roster punch projects 1.8 units backward at height 1.2;
      // the standing target center is 0.825 and the sphere radius is 1.5.
      if (!r.shield && Math.hypot(z - 1.8 - a.z, 1.2 - .825) <= 1.5) {
        a.hp--;
        if (a.hp === 0) { a.deaths++; kills++; }
      }
    }
    for (const side of ['live', 'headless'] as const) {
      const f = frame[side], actors = side === 'live' ? frame.liveCrowd : frame.simCrowd;
      record.compare(tick, `expected.${side}.health`, f.hp, hp);
      record.compare(tick, `expected.${side}.deaths`, f.runnerDeaths, Number(hp === 0));
      record.compare(tick, `expected.${side}.holder`, f.ball.holderId, hp > 0 ? runnerId : null);
      record.compare(tick, `expected.${side}.ballState`, f.ball.state, hp > 0 ? 'held' : 'loose');
      record.compare(tick, `expected.${side}.position.x`, f.runnerPos[0], 0, 1e-6);
      record.compare(tick, `expected.${side}.position.z`, f.runnerPos[2], z * (spec.mirror ? -1 : 1), 1e-6);
      record.compare(tick, `expected.${side}.goals`, f.goals, 0);
      const combat = side === 'live' ? frame.liveRunner : frame.simRunner;
      record.compare(tick, `expected.${side}.runnerKills`, combat?.kills, kills);
      for (const a of attackers) {
        const actual = actors?.find(c => c.id === a.id);
        record.compare(tick, `expected.${side}.${a.id}.health`, actual?.hp, a.hp);
        record.compare(tick, `expected.${side}.${a.id}.kills`, actual?.kills, a.kills);
        record.compare(tick, `expected.${side}.${a.id}.deaths`, actual?.deaths, a.deaths);
      }
    }
  }
  record.compare(trace.ticks, 'expected.counterRequests', 'counters' in trace ? trace.counters : undefined, Number(counter));
  return record.result();
}

export function runAICarrierFocusTrace(spec: AICarrierFocusCase, snapshotAt?: number) {
  const trace = runFrameObjectiveTrace({ player: false, goal: false, lunge: spec.runner.attack === 'lunge',
    hp: spec.hp, reverse: spec.reverse, mirror: spec.mirror }, snapshotAt, undefined, undefined, spec.runner);
  if (!('counters' in trace)) throw new Error('AI carrier focus trace requires counter observations');
  const expected = validateAICarrierFocus(trace, spec);
  return { ...trace, name: `ai-carrier-focus/${JSON.stringify(spec)}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runAICarrierFocusParity = () => AI_CARRIER_FOCUS_CASES.map(spec => runAICarrierFocusTrace(spec));
