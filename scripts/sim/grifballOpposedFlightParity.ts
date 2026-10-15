import { runMixedLifecycleTrace, type OpposedFlightCase } from './grifballMixedLifecycleParity';

export const OPPOSED_FLIGHT_CASES = (['player', 'roster'] as const).flatMap(first => [1, 2].flatMap(playerHp =>
  [1, 2].flatMap(botHp => [false, true].flatMap(trade => [false, true].flatMap(main =>
    [false, true].flatMap(mirror => [false, true].map(reverse => ({ main, mirror, reverse,
      opposed: { first, playerHp, botHp, trade, reload: playerHp === 2 && botHp === 2 ? .35 : .6 } satisfies OpposedFlightCase }))))))));
export const runOpposedFlightTrace = (spec: typeof OPPOSED_FLIGHT_CASES[number], snapshotAt?: number) =>
  runMixedLifecycleTrace({ kind: 'hit-one', main: spec.main, mirror: spec.mirror, reverse: spec.reverse }, snapshotAt, spec.opposed);
export const runOpposedFlightParity = () => OPPOSED_FLIGHT_CASES.map(spec => runOpposedFlightTrace(spec));
