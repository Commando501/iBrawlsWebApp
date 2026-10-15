import { runMixedLifecycleTrace, type OpposedFlightMotion } from './grifballMixedLifecycleParity';
import { parityRecorder } from './grifballMultiActorParity';

const pose = (changes: Partial<OpposedFlightMotion>): OpposedFlightMotion => ({
  playerHeight: 0, playerVelocityY: 0, botHeight: 0, botVelocityY: 0, directionY: 0, directionZ: 1, ...changes,
});
export const AIRBORNE_FLIGHT_POSES = {
  'player-rising': pose({ playerHeight: 3, playerVelocityY: 6 }),
  'roster-rising': pose({ botHeight: .5, botVelocityY: 6 }),
  'roster-falling': pose({ botHeight: 2, botVelocityY: -6, directionY: -.6, directionZ: .8 }),
  'overhead-miss': pose({ botHeight: 6 }),
  'both-airborne': pose({ playerHeight: 3, playerVelocityY: 6, botHeight: 2, botVelocityY: -6, directionY: -.6, directionZ: .8 }),
  'upward-commit': pose({ directionY: .6, directionZ: .8 }),
  'retain-upward': pose({ botVelocityY: 20, directionY: .6, directionZ: .8 }),
  'downward-commit': pose({ botHeight: 3, botVelocityY: -8, directionY: -.6, directionZ: .8 }),
} as const;
export const AIRBORNE_FLIGHT_CASES = (Object.keys(AIRBORNE_FLIGHT_POSES) as (keyof typeof AIRBORNE_FLIGHT_POSES)[]).flatMap(motion =>
  (['player', 'roster'] as const).flatMap(first => [1, 2].flatMap(hp => [false, true].flatMap(trade =>
    [false, true].flatMap(main => [false, true].flatMap(mirror => [false, true].map(reverse =>
      ({ motion, first, hp, trade, main, mirror, reverse }))))))));

export function runAirborneFlightTrace(spec: typeof AIRBORNE_FLIGHT_CASES[number], snapshotAt?: number) {
  const trace = runMixedLifecycleTrace({ kind: 'hit-one', ...spec }, snapshotAt, { first: spec.first,
    playerHp: spec.hp, botHp: spec.hp, trade: spec.trade, reload: .6, motion: AIRBORNE_FLIGHT_POSES[spec.motion] });
  const record = parityRecorder(), m = AIRBORNE_FLIGHT_POSES[spec.motion];
  const vy = Math.max(m.botVelocityY, m.directionY * 24);
  // Independent discrete ballistic formula: gravity 18, dt 1/60. Player contact
  // sees the bot's previous pose; roster contact sees both current poses.
  const height = (n: number) => Math.max(0, m.botHeight + vy * n / 60 - .0025 * n * (n + 1));
  const gap = spec.first === 'player' ? 5 : 4.6;
  // Strictly beyond 16 units at 0.4 units/tick: tick 40 is the boundary,
  // tick 41 ends a missed grounded flight. Do not derive this from either engine.
  const playerTravelEnd = Math.floor(16 / .4) + 1;
  let contact = 0, initiator: 'player' | 'roster' = 'player';
  for (let n = 1; n <= playerTravelEnd; n++) {
    const playerZ = gap - .4 * n;
    if (Math.hypot(playerZ - .4 * m.directionZ * (n - 1), height(n - 1)) <= 1.5) {
      contact = n; break;
    }
    if (Math.hypot(playerZ - .4 * m.directionZ * n, height(n)) <= 1.5) {
      contact = n; initiator = 'roster'; break;
    }
  }
  const playerHit = contact && (initiator === 'roster' || spec.trade || spec.hp > 1) ? contact : 0;
  const botHit = !contact ? 0 : initiator === 'player' || spec.trade ? contact : spec.hp > 1 ? contact + 1 : 0;
  const playerEnd = contact ? initiator === 'roster' && !spec.trade && spec.hp > 1 ? contact + 1 : contact : playerTravelEnd;
  const botEnd = contact || (spec.motion === 'overhead-miss' ? 39 : spec.motion === 'retain-upward' ? 41 : 48);
  const playerRevive = spec.hp === 1 && playerHit ? playerHit + 181 : 0;
  const botRevive = spec.hp === 1 && botHit ? botHit + (initiator === 'player' ? 180 : 181) : 0;
  const interrupted = contact > 0 && initiator === 'player' && spec.trade;
  const flightSteps = botEnd - Number(interrupted);
  const endHeight = height(flightSteps);
  const endVy = endHeight > 0 ? Math.min(0, vy - .3 * flightSteps) : 0;
  for (const frame of trace.frames) {
    const { tick } = frame;
    for (const [side, hit, end, revive, otherHit] of [
      ['live', playerHit, playerEnd, playerRevive, botHit],
      ['headless', playerHit, playerEnd, playerRevive, botHit],
      ['liveBot', botHit, botEnd, botRevive, playerHit],
      ['simBot', botHit, botEnd, botRevive, playerHit],
    ] as const) {
      const actor = frame[side];
      record.compare(tick, `expected.${side}.hp`, actor.hp,
        spec.hp - Number(hit > 0 && tick >= hit && (!revive || tick < revive)));
      record.compare(tick, `expected.${side}.lunging`, actor.lunging, tick < end);
      record.compare(tick, `expected.${side}.deaths`, actor.deaths, Number(spec.hp === 1 && hit > 0 && tick >= hit));
      record.compare(tick, `expected.${side}.kills`, actor.kills, Number(spec.hp === 1 && otherHit > 0 && tick >= otherHit));
      if (side === 'live' || side === 'headless') {
        record.compare(tick, `expected.${side}.groundedFlight`, actor.pos[1], 0);
      } else if (!botRevive || tick < botHit || tick >= botRevive) {
        const fallSteps = Math.max(0, tick - flightSteps);
        const y = botRevive && tick >= botRevive ? 0 : tick < botEnd ? height(tick)
          : Math.max(0, endHeight + endVy * fallSteps / 60 - .0025 * fallSteps * (fallSteps + 1));
        record.compare(tick, `expected.${side}.altitude`, actor.pos[1], y, 1e-6);
        if (tick >= botEnd && !botRevive) {
          const bot = frame[side];
          record.compare(tick, `expected.${side}.noFlightDrift`, Math.hypot(bot.vel[0], bot.vel[2]), 0, 1e-6);
          record.compare(tick, `expected.${side}.reload`, bot.cooldown,
            Math.max(0, .6 - (tick - botEnd + Number(interrupted)) / 60), 1e-6);
        }
      }
    }
  }
  if (!playerRevive) {
    const readyTick = playerEnd + 36 - Number(!(contact && initiator === 'roster' && spec.trade));
    for (const side of ['live', 'headless'] as const) {
      record.compare(readyTick - 1, `expected.${side}.recovering`, trace.frames[readyTick - 2][side].phase, 'recovering');
      record.compare(readyTick, `expected.${side}.ready`, trace.frames[readyTick - 1][side].phase, 'idle');
    }
  }
  const expected = record.result();
  return { ...trace, name: `airborne-opposed/${Object.values(spec).join('/')}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runAirborneFlightParity = () => AIRBORNE_FLIGHT_CASES.map(spec => runAirborneFlightTrace(spec));
