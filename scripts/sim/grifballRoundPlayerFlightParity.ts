import { ROUND_FRAME_CASES, runRoundFrameTrace, type RoundPlayerFlightCase } from './grifballRoundFrameParity';
import { parityRecorder } from './grifballMultiActorParity';
export const ROUND_PLAYER_FLIGHT_CASES = ROUND_FRAME_CASES.filter(c => !c.player).flatMap(round =>
  ([3, 16, 17] as const).flatMap(impactTick => ([1, 3] as const).flatMap(hp => [false, true].map(mainTarget =>
    ({ round, flight: { impactTick, hp, mainTarget } satisfies RoundPlayerFlightCase })))));

export function runRoundPlayerFlightTrace(spec: typeof ROUND_PLAYER_FLIGHT_CASES[number], snapshotAt?: number) {
  const trace = runRoundFrameTrace(spec.round, snapshotAt, undefined, spec.flight), record = parityRecorder();
  const { round, flight } = spec;
  const hit = round.winner || flight.impactTick <= 16;
  for (const side of ['live', 'headless'] as const) {
    const at = (tick: number) => trace.frames[tick - 1][side];
    const victimAt = (tick: number) => at(tick).actors.find(a => a.id === (flight.mainTarget ? 'main_ai' : 'victim'))!;
    record.compare(120, `expected.${side}.finish`, trace.frames.find(f => !f[side].playerFlight!.active)?.tick, flight.impactTick);
    record.compare(120, `expected.${side}.oneEnd`, at(120).playerFlight!.ends, 1);
    record.compare(120, `expected.${side}.hit`, at(120).playerFlight!.hit, hit);
    record.compare(flight.impactTick - 1, `expected.${side}.beforeDamage`, victimAt(flight.impactTick - 1).hp, flight.hp);
    record.compare(120, `expected.${side}.health`, victimAt(120).hp, flight.hp - Number(hit));
    record.compare(120, `expected.${side}.kills`, at(120).playerFlight!.kills, Number(hit && flight.hp === 1));
    record.compare(120, `expected.${side}.deaths`, at(120).playerFlight!.deaths, Number(hit && flight.hp === 1));
    record.compare(flight.impactTick, `expected.${side}.deathTimer`, victimAt(flight.impactTick).respawn, hit && flight.hp === 1 ? 3 - 1 / 60 : 0, 1e-6);
    record.compare(120, `expected.${side}.origin`, JSON.stringify(at(120).playerFlight!.origin), '[0,0,0]');
    for (const [axis, value] of [0, 0, round.mirror ? -1 : 1].entries())
      record.compare(120, `expected.${side}.direction.${axis}`, at(120).playerFlight!.direction[axis], value, 1e-6);
    if (!round.winner) {
      record.compare(16, `expected.${side}.resetHammer`, at(16).actors.find(a => a.id === 'player')!.weapon, 'hammer');
      record.compare(44, `expected.${side}.hammerReady`, at(44).playerFlight!.phase, 'idle');
      record.compare(45, `expected.${side}.swordRestored`, at(45).actors.find(a => a.id === 'player')!.weapon, 'sword');
    }
    const readyAt = round.winner ? flight.impactTick + 23 : flight.impactTick === 3 ? 54 : flight.impactTick === 16 ? 67 : 68;
    record.compare(readyAt - 1, `expected.${side}.stillRecovering`, at(readyAt - 1).playerFlight!.swordPhase, 'recovering');
    record.compare(readyAt, `expected.${side}.readyOnTime`, at(readyAt).playerFlight!.swordPhase, 'idle');
    if (!round.winner) {
      const heldElapsed = flight.impactTick === 3 ? 14 / 60 : flight.impactTick === 16 ? 1 / 60 : 0;
      for (let tick = 17; tick <= 44; tick++) record.compare(tick, `expected.${side}.hiddenRecoveryFrozen`, at(tick).playerFlight!.swordElapsed, heldElapsed, 1e-6);
    }
    record.compare(120, `expected.${side}.recoveryComplete`, at(120).playerFlight!.swordPhase, 'idle');
  }
  const extra = record.result();
  return { ...trace, differenceCount: trace.differenceCount + extra.differenceCount, differences: [...trace.differences, ...extra.differences].slice(0, 64) };
}
export const runRoundPlayerFlightParity = () => ROUND_PLAYER_FLIGHT_CASES.map(c => runRoundPlayerFlightTrace(c));
