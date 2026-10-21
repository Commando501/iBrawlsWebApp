import { runFrameObjectiveTrace, type RunnerCombatCase } from './grifballFrameObjectiveParity';
import { parityRecorder } from './grifballMultiActorParity';

export interface FocusFireCase {
  hp: 1 | 2 | 3;
  mirror: boolean;
  reverse: boolean;
  runner: RunnerCombatCase & { secondAttack: 'slash' | 'lunge' };
}
export const FOCUS_FIRE_CASES: FocusFireCase[] = [];
for (const motion of ['retreat', 'cross', 'approach'] as const) for (const hp of [1, 2, 3] as const)
  for (const attack of ['slash', 'lunge'] as const) for (const secondAttack of ['slash', 'lunge'] as const)
    for (const mirror of [false, true]) for (const reverse of [false, true])
      FOCUS_FIRE_CASES.push({ hp, mirror, reverse, runner: { motion, attack, secondAttack,
        mainAttacker: true, speed: 130, counter: true, punchSpeed: .04, enemyHp: 1, shield: false } });
for (const control of [
  { counter: false }, { shield: true }, { enemyHp: 2 as const }, { punchSpeed: .24 as const },
]) for (const reverse of [false, true]) FOCUS_FIRE_CASES.push({ hp: 3, mirror: reverse, reverse,
  runner: { motion: 'retreat', attack: 'slash', secondAttack: 'lunge', mainAttacker: true,
    speed: 130, counter: true, punchSpeed: .04, enemyHp: 1, shield: false, ...control } });

/** Simultaneous commitments deliberately share an origin: ordering and health
 * consumption, rather than autonomous spacing, are the behavior under test. */
export function runFocusFireTrace(spec: FocusFireCase, snapshotAt?: number) {
  const { runner: r } = spec;
  const trace = runFrameObjectiveTrace({ player: true, goal: false, lunge: r.attack === 'lunge',
    hp: spec.hp, mirror: spec.mirror, reverse: spec.reverse }, snapshotAt, undefined, undefined, r);
  const record = parityRecorder();
  const attackers = [{ id: 'main_ai', attack: r.attack }, { id: 'support', attack: r.secondAttack }];
  const order = spec.reverse ? [...attackers].reverse() : attackers;
  const contacts = order.map((a, index) => ({ ...a, index,
    tick: a.attack === 'lunge' && r.motion === 'retreat' ? 5 : 4,
    phase: a.attack === 'lunge' ? 0 : 1,
  })).sort((a, b) => a.tick - b.tick || a.phase - b.phase || a.index - b.index);
  const clash = r.counter && !r.shield;
  const lethal = contacts[clash ? 1 : 0];
  const impact = clash ? contacts[0].tick : r.punchSpeed === .04 ? 8 : 26;
  const step = 5.8 * 1.3 / 60;
  const motion = r.motion === 'cross' ? [1, 0] : [0, r.motion === 'approach' ? -1 : 1];
  const direction = spec.mirror ? -1 : 1;
  const punchHits = (id: string) => {
    const a = contacts.find(a => a.id === id)!;
    const z = -1.5 + (a.attack === 'lunge' ? .4 * (a.tick - 3) : 0);
    return clash && id === contacts[0].id
      && Math.hypot(motion[0] * step * impact, .825, motion[1] * step * impact - 1.8 - z) <= 1.5;
  };
  record.compare(120, 'expected.counterRequests', 'counters' in trace ? trace.counters : undefined, Number(r.counter));
  for (const frame of trace.frames) for (const side of ['live', 'headless'] as const) {
    const f = frame[side], dead = !!lethal && frame.tick >= lethal.tick;
    record.compare(frame.tick, `expected.${side}.health`, f.hp, dead ? 0 : spec.hp);
    record.compare(frame.tick, `expected.${side}.deaths`, f.runnerDeaths, Number(dead));
    record.compare(frame.tick, `expected.${side}.holder`, f.ball.holderId, dead ? null : 'player');
    record.compare(frame.tick, `expected.${side}.goals`, f.goals, 0);
    const steps = lethal ? Math.min(frame.tick, lethal.tick) : frame.tick;
    for (const [axis, index] of [['x', 0], ['z', 2]] as const)
      record.compare(frame.tick, `expected.${side}.${axis}`, f.runnerPos[index],
        direction * motion[axis === 'x' ? 0 : 1] * step * steps, 1e-6);
    const actors = side === 'live' ? frame.liveCrowd : frame.simCrowd;
    let kills = 0;
    for (const a of attackers) {
      const actual = actors?.find(c => c.id === a.id);
      const punched = frame.tick >= impact && punchHits(a.id);
      const killed = punched && r.enemyHp === 1;
      kills += Number(killed);
      record.compare(frame.tick, `expected.${side}.${a.id}.hp`, actual?.hp, r.enemyHp - Number(punched));
      record.compare(frame.tick, `expected.${side}.${a.id}.deaths`, actual?.deaths, Number(killed));
      record.compare(frame.tick, `expected.${side}.${a.id}.kills`, actual?.kills, Number(dead && lethal?.id === a.id));
    }
    const combat = side === 'live' ? frame.liveRunner : frame.simRunner;
    record.compare(frame.tick, `expected.${side}.playerKills`, combat?.kills, kills);
  }
  const expected = record.result();
  return { ...trace, name: `moving-focus-fire/${JSON.stringify(spec)}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runFocusFireParity = () => FOCUS_FIRE_CASES.map(spec => runFocusFireTrace(spec));
