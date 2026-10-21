import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

export const PASS_RECOVERY_OPENINGS = {
  // Reviewed contact-aware timing: these are fixed regression expectations,
  // not values derived from the trace under test. Players can redirect a throw
  // before settling; the old ballistic-only times were 96/132/109/68.
  interception: { defender: { x: 3, z: 6 }, cover: { x: 40, z: -18 }, escort: { x: -14, z: 0 }, releaseSpeed: 17.5, settleTick: 153, pickupTick: 153, stolen: true },
  overthrow: { defender: { x: 27, z: 8 }, cover: { x: 40, z: -18 }, releaseSpeed: 26, settleTick: 136, pickupTick: 136, stolen: true },
  'distant-opponent': { defender: { x: -35, z: 12 }, cover: { x: 40, z: -18 }, releaseSpeed: 17.5, settleTick: 126, pickupTick: 126, stolen: false },
  'short-pass': { defender: { x: -11, z: 8 }, cover: { x: 40, z: -18 }, releaseSpeed: 9, settleTick: 73, pickupTick: 73, stolen: false },
} as const;
export interface PassRecoveryCase { opening: keyof typeof PASS_RECOVERY_OPENINGS; team: 'blue' | 'red'; reverse: boolean; main: boolean }
export const PASS_RECOVERY_CASES: PassRecoveryCase[] = (Object.keys(PASS_RECOVERY_OPENINGS) as PassRecoveryCase['opening'][])
  .flatMap(opening => (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ opening, team, reverse, main })))));

/** A controlled unsafe release is the stimulus, not an autonomous passing decision.
 * Both teams then use the live planner, movement, pickup, combat and lifecycle owners. */
export function runPassRecoveryTrace(spec: PassRecoveryCase) {
  const opening = PASS_RECOVERY_OPENINGS[spec.opening];
  const trace = runOpposedDecisionTrace({ mode: 'contested', ...spec, seed: 17 }, 'pass-recovery', undefined, opening);
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected }); }
  };
  const defenderId = spec.main ? 'main_ai' : 'defender', expectedHolder = opening.stolen ? defenderId : 'escort';
  const sign = spec.team === 'blue' ? 1 : -1;
  const initial = trace.releaseState!, first = trace.frames[0], pickup = trace.pickups[0];
  for (const [key, value] of Object.entries(trace.combatSettings!))
    check(0, `default combat setting: ${key}`, value, DEFAULT_ADMIN_SETTINGS[key as keyof typeof DEFAULT_ADMIN_SETTINGS]);
  check(0, 'controlled release enters real thrown physics', initial.ball.state, 'thrown');
  check(0, 'controlled release removes the old holder', initial.ball.holderId, null);
  check(0, 'release restores old carrier hammer', initial.weapon, 'hammer');
  check(0, 'release restores old carrier base health', initial.maxHp, DEFAULT_ADMIN_SETTINGS.maxHP);
  check(0, 'authored intended receiver is retained initially', initial.flight?.receiverId, 'escort');
  check(1, 'first frame advances horizontal flight once', Math.abs(first.ball.pos.x - (-20 + opening.releaseSpeed / 60) * sign) < 1e-9, true);
  check(1, 'first frame advances gravity once', Math.abs(first.ball.vel.y - (opening.releaseSpeed * .35 - 18 / 60)) < 1e-9, true);
  check(1, 'release metadata survives the first planning refresh', first.pass?.flight?.receiverId, 'escort');
  for (const frame of trace.frames.filter(f => f.tick < opening.settleTick)) {
    check(frame.tick, 'ball remains thrown before the known settling boundary', frame.ball.state, 'thrown');
    check(frame.tick, 'no pickup while the ball is still thrown', frame.ball.holderId, null);
  }
  check(0, 'first recovery is by the expected team member', pickup?.id, expectedHolder);
  check(0, 'first recovery occurs at the independent expected boundary', pickup?.tick, opening.pickupTick);
  if (pickup) {
    const atPickup = trace.frames[pickup.tick - 1], after = trace.frames[pickup.tick];
    const actor = atPickup.actors.find(a => a.id === pickup.id)!;
    const team = actor.team;
    check(pickup.tick, 'pickup follows a live AI request', atPickup.recoveryIntents?.find(i => i.id === pickup.id)?.pickup, true);
    check(pickup.tick, 'pickup is within default radius', pickup.distance <= DEFAULT_ADMIN_SETTINGS.grifballPickupRadius! + 1e-6, true);
    check(pickup.tick, 'pickup grants the ball weapon and runner health', actor.weapon === 'ball' && actor.hp === DEFAULT_ADMIN_SETTINGS.grifballRunnerHealth && actor.maxHp === DEFAULT_ADMIN_SETTINGS.grifballRunnerHealth, true);
    check(pickup.tick, 'no automatic return or intervening holder before recovery', trace.frames.slice(0, pickup.tick - 1).every(f =>
      f.ball.holderId === null && (f.ball.state === 'thrown' || f.ball.state === 'loose')), true);
    check(pickup.tick, 'first outcome is an interception only when the opponent wins', (team !== spec.team), opening.stolen);
    check(after.tick, 'new holder becomes the only runner', JSON.stringify(after.assignments.filter(a => a.role === 'runner').map(a => a.id)), JSON.stringify([pickup.id]));
    check(after.tick, 'old pass flight clears after either team recovers', after.pass?.flight, null);
    check(after.tick, 'old charge clears after either team recovers', after.pass?.charge, null);
    check(after.tick, 'stale receive orders clear after possession changes', after.assignments.every(a => !a.receive), true);
    check(after.tick, 'new possessing team assigns support', after.assignments.some(a => a.id !== pickup.id &&
      after.actors.find(p => p.id === a.id)?.team === team && !['runner', 'retriever'].includes(a.role)), true);
    check(after.tick, 'defending team redirects its orders to the new carrier', after.assignments.filter(a =>
      after.actors.find(p => p.id === a.id)?.team !== team).every(a => a.defense?.targetId === pickup.id), true);
    const goalX = team === 'blue' ? 47 : -47, distanceAtPickup = Math.hypot(actor.pos[0] - goalX, actor.pos[2]);
    check(pickup.tick, 'new runner makes real goalward progress', trace.frames.slice(pickup.tick, pickup.tick + 60).some(f => {
      const p = f.actors.find(a => a.id === pickup.id)!;
      return f.ball.holderId === pickup.id && p.hp > 0 && Math.hypot(p.pos[0] - goalX, p.pos[2]) < distanceAtPickup - .5;
    }), true);
    if (opening.stolen) {
      check(1, 'opponent receives an autonomous recovery assignment', first.assignments.find(a => a.id === defenderId)?.role, 'retriever');
      check(1, 'opponent anticipates the landing point ahead of the current ball',
        Math.abs(first.assignments.find(a => a.id === defenderId)!.destination!.x - first.ball.pos.x) > 5, true);
      const start = opening.defender;
      check(pickup.tick, 'interceptor moves from its authored start', Math.hypot(actor.pos[0] - start.x * sign, actor.pos[2] - start.z * sign) > 2, true);
      check(pickup.tick, 'nearby requesting opponent still cannot catch an unsettled pass', trace.frames.slice(0, pickup.tick - 1).some(f => {
        const p = f.actors.find(a => a.id === defenderId)!;
        return f.ball.state === 'thrown' && f.recoveryIntents?.find(i => i.id === defenderId)?.pickup &&
          Math.hypot(p.pos[0] - f.ball.pos.x, p.pos[2] - f.ball.pos.z) <= DEFAULT_ADMIN_SETTINGS.grifballPickupRadius!;
      }), true);
      check(after.tick, 'intended receiver becomes a defender against the interceptor', after.assignments.find(a => a.id === 'escort')?.defense?.targetId, defenderId);
      check(after.tick, 'old throwing team retains a last defender', after.assignments.some(a => a.defense?.mode === 'last-defender' &&
        after.actors.find(p => p.id === a.id)?.team === spec.team), true);
    }
  }
  const end = trace.frames.at(-1)!;
  check(trace.ticks, 'kill credit conserved', end.actors.reduce((n, a) => n + a.kills, 0), trace.deaths.length);
  check(trace.ticks, 'death credit conserved', end.actors.reduce((n, a) => n + a.deaths, 0), trace.deaths.length);
  const sampleTicks = new Set([1, opening.settleTick - 1, opening.settleTick, opening.pickupTick, opening.pickupTick + 1, opening.pickupTick + 30]);
  return { ...trace, name: `${spec.opening}/${trace.name}`, scenario: spec,
    initialRecovery: { outcome: opening.stolen ? 'interception' : 'reception', id: pickup?.id ?? null, tick: pickup?.tick ?? null },
    recoverySamples: trace.frames.filter(f => sampleTicks.has(f.tick)) };
}

export const runPassRecovery = () => PASS_RECOVERY_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runPassRecoveryTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length, finalFrame: frames.at(-1)! };
});
