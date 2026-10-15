import { CARRIER_FLIGHT_CASES, runCarrierFlightTrace } from './grifballCarrierFlightParity';
import { AIRBORNE_CARRIER_FLIGHT_CASES, runAirborneCarrierFlightTrace } from './grifballAirborneCarrierFlightParity';
import { parityRecorder } from './grifballMultiActorParity';

export const TURNING_FLIGHT_CASES = [
  ...CARRIER_FLIGHT_CASES.filter(s => s.opposed.pickup.hp === 2).map(spec => ({ kind: 'grounded' as const, spec })),
  ...AIRBORNE_CARRIER_FLIGHT_CASES.filter(s => s.hp === 2).map(spec => ({ kind: 'airborne' as const, spec })),
];

/** Mouse view changes are independent of the locked launch trajectory. The
 * existing flight oracles still require contact, pickup, reload and revival. */
export function runTurningFlightTrace(s: typeof TURNING_FLIGHT_CASES[number], snapshotAt?: number) {
  const trace = s.kind === 'grounded' ? runCarrierFlightTrace(s.spec, snapshotAt, true)
    : runAirborneCarrierFlightTrace(s.spec, snapshotAt, true);
  const record = parityRecorder(), direction = s.spec.mirror ? -1 : 1;
  for (const frame of trace.frames.slice(0, 3)) for (const side of ['live', 'headless'] as const) {
    const angle = (s.spec.mirror ? Math.PI : 0) - direction * .176 * frame.tick;
    record.compare(frame.tick, `${side}.view.x`, frame[side].heading[0], Math.sin(angle), 1e-6);
    record.compare(frame.tick, `${side}.view.z`, frame[side].heading[1], Math.cos(angle), 1e-6);
    record.compare(frame.tick, `${side}.pitch`, frame[side].pitch, .088 * frame.tick, 1e-6);
    record.compare(frame.tick, `${side}.committedFlight`, frame[side].lunging, true);
    record.compare(frame.tick, `${side}.flightIgnoresLookX`, frame[side].pos[0], 0, 1e-6);
    record.compare(frame.tick, `${side}.flightIgnoresLookVelocity`, frame[side].vel[2], -direction * 24, 1e-6);
  }
  const expected = record.result();
  return { ...trace, name: `turning-flight/${JSON.stringify(s)}`, scenario: s,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runTurningFlightParity = () => TURNING_FLIGHT_CASES.map(s => runTurningFlightTrace(s));
