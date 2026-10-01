import { runMixedLifecycleTrace } from './grifballMixedLifecycleParity';
import { parityRecorder } from './grifballMultiActorParity';

const SHIELDS = {
  player: { player: 1, roster: 0 },
  roster: { player: 0, roster: 1 },
  both: { player: 1, roster: 1 },
  'player-expiry': { player: .05, roster: 0 },
  'roster-expiry': { player: 0, roster: .05 },
  'both-expiry': { player: .05, roster: .05 },
} as const;
export const SHIELDED_FLIGHT_CASES = (Object.keys(SHIELDS) as (keyof typeof SHIELDS)[]).flatMap(shield =>
  (['player', 'roster'] as const).flatMap(first => [1, 2].flatMap(hp => [false, true].flatMap(trade =>
    [false, true].flatMap(main => [false, true].flatMap(mirror => [false, true].map(reverse =>
      ({ shield, first, hp, trade, main, mirror, reverse }))))))));

/** Committed grounded flights, not autonomous attack selection. Live physics always
 * updates the player first; reverse changes simulator storage, not that contract. */
export function runShieldedFlightTrace(spec: typeof SHIELDED_FLIGHT_CASES[number], snapshotAt?: number) {
  const { shield, first, hp, trade } = spec, shields = SHIELDS[shield];
  const trace = runMixedLifecycleTrace({ kind: 'hit-one', ...spec }, snapshotAt,
    { first, playerHp: hp, botHp: hp, trade, reload: .6, shields });
  const record = parityRecorder();
  // Independent contact schedule: 0.4 units per flight step, 1.5 contact radius.
  // A shielded roster target cancels player flight immediately. The roster then
  // reaches the stationary player at 8/7; otherwise mutual contact is at 5/4.
  const singleContact = first === 'player' ? 8 : 7;
  const mutualContact = first === 'player' ? 5 : 4;
  // A missed grounded flight ends strictly beyond 16, on the 41st 0.4-unit step.
  let playerHit = 0, botHit = 0, playerEnd = 1, botEnd = Math.floor(16 / .4) + 1;
  if (shield === 'player') {
    botHit = playerEnd = 5;
    if (hp === 1) botEnd = 5;
  } else if (shield === 'roster' || shield === 'roster-expiry' || shield === 'both-expiry') {
    playerHit = botEnd = singleContact;
    if (shield !== 'roster' && trade) botHit = singleContact;
  } else if (shield === 'player-expiry') {
    playerHit = trade || first === 'roster' || hp > 1 ? mutualContact : 0;
    botHit = trade ? mutualContact : first === 'player' || hp > 1 ? 5 : 0;
    playerEnd = first === 'roster' && (trade || hp === 1) ? 4 : 5;
    botEnd = mutualContact;
  }
  const playerRevive = hp === 1 && playerHit ? playerHit + 181 : 0;
  // Player contact precedes this frame's roster respawn update; roster contact follows it.
  const botRevive = hp === 1 && botHit ? botHit + (shields.roster === 0 && botHit === 5 ? 180 : 181) : 0;
  for (const [side, hit, end, revive, initial, opponentRevive, opponentHit] of [
    ['live', playerHit, playerEnd, playerRevive, shields.player, botRevive, botHit],
    ['headless', playerHit, playerEnd, playerRevive, shields.player, botRevive, botHit],
    ['liveBot', botHit, botEnd, botRevive, shields.roster, playerRevive, playerHit],
    ['simBot', botHit, botEnd, botRevive, shields.roster, playerRevive, playerHit],
  ] as const) {
    const isPlayer = side === 'live' || side === 'headless';
    for (const frame of trace.frames) {
      const { tick } = frame, actor = frame[side];
      const expectedHp = hp - Number(hit > 0 && tick >= hit && (!revive || tick < revive));
      record.compare(tick, `expected.${side}.hp`, actor.hp, expectedHp);
      record.compare(tick, `expected.${side}.lunging`, actor.lunging, tick < end);
      record.compare(tick, `expected.${side}.deaths`, actor.deaths, Number(hp === 1 && hit > 0 && tick >= hit));
      record.compare(tick, `expected.${side}.kills`, actor.kills, Number(hp === 1 && opponentHit > 0 && tick >= opponentHit));
      const expectedShield = revive && tick >= revive
        ? Math.max(0, .5 - (tick - revive + Number(!isPlayer)) / 60) : Math.max(0, initial - tick / 60);
      record.compare(tick, `expected.${side}.shield`, actor.shield, expectedShield, 1e-6);
      if (revive && tick >= revive) {
        const occupied = opponentRevive > 0 && (opponentRevive < revive || opponentRevive === revive && !isPlayer);
        record.compare(tick, `expected.${side}.spawnX`, actor.pos[0], occupied ? 10 : -10, 1e-6);
        record.compare(tick, `expected.${side}.grounded`, actor.pos[1], 0, 1e-6);
      }
    }
  }
  if (!playerRevive) {
    const ready = playerEnd + 36 - Number(!(shield === 'player-expiry' && first === 'roster' && trade));
    for (const side of ['live', 'headless'] as const) {
      record.compare(ready - 1, `expected.${side}.notReadyEarly`, trace.frames[ready - 2][side].phase, 'recovering');
      record.compare(ready, `expected.${side}.ready`, trace.frames[ready - 1][side].phase, 'idle');
    }
  }
  const expected = record.result();
  return { ...trace, name: `shielded-opposed/${Object.values(spec).join('/')}`, scenario: spec,
    differenceCount: trace.differenceCount + expected.differenceCount,
    differences: [...trace.differences, ...expected.differences].slice(0, 64) };
}
export const runShieldedFlightParity = () => SHIELDED_FLIGHT_CASES.map(spec => runShieldedFlightTrace(spec));
