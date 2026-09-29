import { ROUND_FRAME_CASES, runRoundFrameTrace, type RoundFlightCase } from './grifballRoundFrameParity';
import { parityRecorder } from './grifballMultiActorParity';

export const ROUND_FLIGHT_CASES = ROUND_FRAME_CASES.filter(c => !c.player).flatMap(round =>
  ([3, 16, 17] as const).flatMap(impactTick => ([1, 3] as const).flatMap(hp => [false, true].map(pause =>
    ({ round, combat: { attack: 'lunge', impactTick, hp, pause } satisfies RoundFlightCase })))));

export function runRoundFlightTrace(spec: typeof ROUND_FLIGHT_CASES[number], snapshotAt?: number) {
  const trace = runRoundFrameTrace(spec.round, snapshotAt, spec.combat), record = parityRecorder();
  const { round, combat } = spec;
  const early = combat.impactTick === 3;
  const hit = early || !combat.pause && (round.winner || combat.impactTick === 16);
  const finishAt = early ? 3 : combat.pause ? round.winner ? null : 23 : round.winner ? combat.impactTick : combat.impactTick === 16 ? 16 : 17;
  for (const side of ['live', 'headless'] as const) {
    const victimAt = (tick: number) => trace.frames[tick - 1][side].actors.find(a => a.id === 'victim')!;
    const flightAt = (tick: number) => trace.frames[tick - 1][side].combat!;
    const finish = trace.frames.find(f => !f[side].combat!.active);
    record.compare(120, `expected.${side}.finishTick`, finish?.tick ?? null, finishAt);
    record.compare(120, `expected.${side}.outcome`, flightAt(120).outcome, finishAt === null ? null : hit ? 'hit' : 'miss_timeout');
    record.compare(120, `expected.${side}.health`, victimAt(120).hp, combat.hp - Number(hit));
    record.compare(120, `expected.${side}.kills`, flightAt(120).kills, Number(hit && combat.hp === 1));
    record.compare(120, `expected.${side}.deaths`, flightAt(120).deaths, Number(hit && combat.hp === 1));
    if (finishAt !== null) {
      record.compare(finishAt, `expected.${side}.reloadStarts`, flightAt(finishAt).finishReload, .39, 1e-6);
      record.compare(finishAt, `expected.${side}.deathTimer`, victimAt(finishAt).respawn, hit && combat.hp === 1 ? 3 : 0, 1e-6);
      if (hit) record.compare(finishAt - 1, `expected.${side}.beforeContact`, victimAt(finishAt - 1).hp, combat.hp);
    }
    if (combat.pause && !early) {
      for (let tick = 5; tick <= (round.winner ? 120 : 22); tick++) {
        record.compare(tick, `expected.${side}.pausedClock`, flightAt(tick).time, 4 / 60, 1e-6);
        record.compare(tick, `expected.${side}.pausedVelocity`, JSON.stringify(trace.frames[tick - 1][side].actors.find(a => a.id === 'injured')!.vel), '[0,0,0]');
      }
    }
    record.compare(120, `expected.${side}.originPreserved`, JSON.stringify(flightAt(120).origin), '{"x":0,"y":0,"z":0}');
    record.compare(120, `expected.${side}.headingPreserved`, JSON.stringify(flightAt(120).direction), JSON.stringify({ x: 0, y: 0, z: round.mirror ? -1 : 1 }));
  }
  const extra = record.result();
  return { ...trace, differenceCount: trace.differenceCount + extra.differenceCount, differences: [...trace.differences, ...extra.differences].slice(0, 64) };
}
export const runRoundFlightParity = () => ROUND_FLIGHT_CASES.map(c => runRoundFlightTrace(c));
