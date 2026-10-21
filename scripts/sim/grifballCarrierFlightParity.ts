import { runMixedLifecycleTrace, type OpposedFlightCase } from './grifballMixedLifecycleParity';
import { parityRecorder } from './grifballMultiActorParity';

// Pair each contact case with a mirrored, reversed main-AI variant without
// multiplying every identity permutation into the already broad parity suite.
export const CARRIER_FLIGHT_CASES = (['player', 'roster'] as const).flatMap(actor =>
  [1, 2].flatMap(hp => (['player', 'roster'] as const).flatMap(first =>
    [false, true].flatMap(trade => [false, true].map(variant => ({
      main: variant, mirror: variant, reverse: variant,
      opposed: { first, playerHp: 2, botHp: 2, trade, reload: .6, pickup: { actor, hp } } satisfies OpposedFlightCase,
    }))))));

export function runCarrierFlightTrace(spec: typeof CARRIER_FLIGHT_CASES[number], snapshotAt?: number, turnView = false) {
  const trace = runMixedLifecycleTrace({ kind: 'hit-one', main: spec.main, mirror: spec.mirror, reverse: spec.reverse }, snapshotAt, { ...spec.opposed, turnView });
  const record = parityRecorder(), { pickup, first, trade } = spec.opposed;
  const holder = pickup.actor === 'player' ? 'player' : spec.main ? 'main_ai' : 'attacker';
  // At 24 units/second the authored 5/4.6-unit separation reaches the
  // sampled 1.5-unit contact radius on tick five/four, respectively.
  const firstContact = first === 'player' ? 5 : 4;
  // A ball holder cannot supply a sword counter. A surviving sword opponent
  // can still counter the carrier's later hit through recent attack history.
  const carrierDead = true;
  const deathTick = pickup.actor === 'player' && first === 'roster'
    || pickup.actor === 'roster' && first === 'roster' && trade ? 4 : 5;
  const otherHp = pickup.actor !== first ? 2 : 1;
  for (const [playerSide, botSide, ballSide] of [['live', 'liveBot', 'liveBall'], ['headless', 'simBot', 'simBall']] as const) {
    const carrierSide = pickup.actor === 'player' ? playerSide : botSide;
    const otherSide = pickup.actor === 'player' ? botSide : playerSide;
    record.compare(1, `expected.${ballSide}.unclaimed`, trace.frames[0][ballSide]!.holderId, null);
    record.compare(2, `expected.${ballSide}.pickup`, trace.frames[1][ballSide]!.holderId, holder);
    record.compare(2, `expected.${carrierSide}.runnerHealth`, trace.frames[1][carrierSide].hp, pickup.hp);
    for (const side of [playerSide, botSide]) {
      record.compare(firstContact - 1, `expected.${side}.beforeContact`, trace.frames[firstContact - 2][side].lunging, true);
      record.compare(5, `expected.${side}.flightEnded`, trace.frames[4][side].lunging, false);
    }
    record.compare(120, `expected.${carrierSide}.health`, trace.frames[119][carrierSide].hp, carrierDead ? 0 : 1);
    record.compare(120, `expected.${otherSide}.health`, trace.frames[119][otherSide].hp, otherHp);
    record.compare(300, `expected.${carrierSide}.deaths`, trace.frames[299][carrierSide].deaths, Number(carrierDead));
    record.compare(300, `expected.${otherSide}.kills`, trace.frames[299][otherSide].kills, Number(carrierDead));
    record.compare(300, `expected.${carrierSide}.kills`, trace.frames[299][carrierSide].kills, 0);
    record.compare(300, `expected.${otherSide}.deaths`, trace.frames[299][otherSide].deaths, 0);
    if (carrierDead) {
      // A roster death in player physics precedes the respawn tick. A death
      // in its own reciprocal trade occurs after that tick, like player death.
      const deathBeforeRosterTick = pickup.actor === 'roster' && !(trade && first === 'roster');
      const reviveTick = deathTick + (deathBeforeRosterTick ? 180 : 181);
      record.compare(deathTick, `expected.${ballSide}.drop`, trace.frames[deathTick - 1][ballSide]!.state, 'loose');
      record.compare(reviveTick - 1, `expected.${carrierSide}.notRevivedEarly`, trace.frames[reviveTick - 2][carrierSide].hp, 0);
      record.compare(reviveTick, `expected.${carrierSide}.revived`, trace.frames[reviveTick - 1][carrierSide].hp, 1);
      record.compare(reviveTick, `expected.${carrierSide}.shield`, trace.frames[reviveTick - 1][carrierSide].shield,
        pickup.actor === 'player' ? .5 : .5 - 1 / 60, 1e-6);
    }
    for (const frame of trace.frames.filter(f => f.tick >= 6)) {
      record.compare(frame.tick, `expected.${ballSide}.ownership`, frame[ballSide]!.holderId, carrierDead ? null : holder);
      record.compare(frame.tick, `expected.${ballSide}.state`, frame[ballSide]!.state, carrierDead ? 'loose' : 'held');
    }
  }
  const expected = record.result();
  return { ...trace, name: `carrier-flight/${JSON.stringify(spec)}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}

export const runCarrierFlightParity = () => CARRIER_FLIGHT_CASES.map(spec => runCarrierFlightTrace(spec));
