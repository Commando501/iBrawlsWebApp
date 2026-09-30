import { AIRBORNE_FLIGHT_POSES } from './grifballAirborneFlightParity';
import { runMixedLifecycleTrace } from './grifballMixedLifecycleParity';
import { parityRecorder } from './grifballMultiActorParity';

export const AIRBORNE_CARRIER_FLIGHT_CASES = (['roster-rising', 'roster-falling'] as const).flatMap(motion =>
  (['player', 'roster'] as const).flatMap(actor => [1, 2].flatMap(hp =>
    (['player', 'roster'] as const).flatMap(first => [false, true].flatMap(trade =>
      [false, true].map(variant => ({ motion, actor, hp, first, trade,
        main: variant, mirror: variant, reverse: variant })))))));

export function runAirborneCarrierFlightTrace(spec: typeof AIRBORNE_CARRIER_FLIGHT_CASES[number], snapshotAt?: number, turnView = false) {
  const motion = AIRBORNE_FLIGHT_POSES[spec.motion];
  const trace = runMixedLifecycleTrace({ kind: 'hit-one', ...spec }, snapshotAt, {
    first: spec.first, playerHp: 2, botHp: 2, trade: spec.trade, reload: .6,
    motion, pickup: { actor: spec.actor, hp: spec.hp }, turnView,
  });
  const record = parityRecorder();
  const holder = spec.actor === 'player' ? 'player' : spec.main ? 'main_ai' : 'attacker';
  const gap = spec.first === 'player' ? 5 : 4.6;
  const vy = Math.max(motion.botVelocityY, motion.directionY * 24);
  const height = (n: number) => Math.max(0, motion.botHeight + vy * n / 60 - .0025 * n * (n + 1));
  // Independent sampled geometry. The player observes the previous roster pose;
  // the roster observes the current player pose. Airborne height can reverse the
  // contact order implied by the grounded fixture's initial separation.
  let contact = 0, initiator: 'player' | 'roster' = 'player';
  for (let n = 1; n <= 40; n++) {
    const playerZ = gap - .4 * n;
    if (Math.hypot(playerZ - .4 * motion.directionZ * (n - 1), height(n - 1)) <= 1.5) {
      contact = n; break;
    }
    if (Math.hypot(playerZ - .4 * motion.directionZ * n, height(n)) <= 1.5) {
      contact = n; initiator = 'roster'; break;
    }
  }
  if (!contact) throw new Error('Airborne carrier fixture must reach contact');
  const carrierDead = spec.hp === 1 || spec.trade && spec.actor !== initiator;
  const otherHp = spec.hp === 1 && spec.actor !== initiator ? 2 : 1;
  const playerEnd = contact + Number(initiator === 'roster'
    && !(spec.actor === 'player' && spec.hp === 1) && !(spec.actor === 'roster' && spec.trade));
  const deathTick = initiator === 'player' || spec.actor === 'player' && spec.hp === 1
    || spec.actor === 'roster' && spec.trade ? contact : contact + 1;
  const deathBeforeRosterTick = spec.actor === 'roster'
    && !(spec.trade && (initiator === 'roster' || spec.hp === 2));
  const reviveTick = deathTick + (deathBeforeRosterTick ? 180 : 181);
  const interrupted = initiator === 'player' && spec.trade && spec.actor === 'player';
  for (const [playerSide, botSide, ballSide] of [['live', 'liveBot', 'liveBall'], ['headless', 'simBot', 'simBall']] as const) {
    const carrierSide = spec.actor === 'player' ? playerSide : botSide;
    const otherSide = spec.actor === 'player' ? botSide : playerSide;
    record.compare(1, `expected.${ballSide}.unclaimed`, trace.frames[0][ballSide]!.holderId, null);
    record.compare(2, `expected.${ballSide}.pickup`, trace.frames[1][ballSide]!.holderId, holder);
    record.compare(2, `expected.${carrierSide}.runnerHealth`, trace.frames[1][carrierSide].hp, spec.hp);
    record.compare(2, `expected.${botSide}.airbornePickupHeight`, trace.frames[1][botSide].pos[1], height(2), 1e-6);
    for (const frame of trace.frames) {
      const { tick } = frame;
      record.compare(tick, `expected.${playerSide}.flight`, frame[playerSide].lunging, tick < playerEnd);
      record.compare(tick, `expected.${botSide}.flight`, frame[botSide].lunging, tick < contact);
      record.compare(tick, `expected.${carrierSide}.deaths`, frame[carrierSide].deaths, Number(carrierDead && tick >= deathTick));
      record.compare(tick, `expected.${otherSide}.kills`, frame[otherSide].kills, Number(carrierDead && tick >= deathTick));
      record.compare(tick, `expected.${otherSide}.deaths`, frame[otherSide].deaths, 0);
      record.compare(tick, `expected.${carrierSide}.kills`, frame[carrierSide].kills, 0);
      if (tick >= contact && !(spec.actor === 'roster' && carrierDead)) {
        // Recent-history trades must not erase an already-running roster reload.
        record.compare(tick, `expected.${botSide}.retainedReload`, frame[botSide].cooldown,
          Math.max(0, .6 - (tick - contact + Number(interrupted)) / 60), 1e-6);
      }
      if (tick > contact + 1) {
        record.compare(tick, `expected.${ballSide}.ownership`, frame[ballSide]!.holderId, carrierDead ? null : holder);
        record.compare(tick, `expected.${ballSide}.state`, frame[ballSide]!.state, carrierDead ? 'loose' : 'held');
      }
    }
    record.compare(120, `expected.${carrierSide}.health`, trace.frames[119][carrierSide].hp, carrierDead ? 0 : 1);
    record.compare(120, `expected.${otherSide}.health`, trace.frames[119][otherSide].hp, otherHp);
    if (carrierDead) {
      record.compare(deathTick, `expected.${ballSide}.drop`, trace.frames[deathTick - 1][ballSide]!.state, 'loose');
      record.compare(reviveTick - 1, `expected.${carrierSide}.notRevivedEarly`, trace.frames[reviveTick - 2][carrierSide].hp, 0);
      record.compare(reviveTick, `expected.${carrierSide}.revived`, trace.frames[reviveTick - 1][carrierSide].hp, 1);
      record.compare(reviveTick, `expected.${carrierSide}.shield`, trace.frames[reviveTick - 1][carrierSide].shield,
        spec.actor === 'player' ? .5 : .5 - 1 / 60, 1e-6);
    }
  }
  const expected = record.result();
  return { ...trace, name: `airborne-carrier-flight/${JSON.stringify(spec)}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}

export const runAirborneCarrierFlightParity = () => AIRBORNE_CARRIER_FLIGHT_CASES.map(spec => runAirborneCarrierFlightTrace(spec));
