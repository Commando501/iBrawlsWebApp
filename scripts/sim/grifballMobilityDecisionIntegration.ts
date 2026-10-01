import { runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';
import { validateDashDecisionTrace } from './grifballDashDecisionValidation';

// Fixed contiguous development matrix, including both original seeds. Keep all
// outcomes; absence of a flight in one seed is not a physics failure.
export const MOBILITY_DECISION_CASES: OpposedDecisionCase[] = Array.from({ length: 8 }, (_, i) => i + 1).flatMap(seed => (['blue', 'red'] as const)
  .flatMap(team => [false, true].map(reverse => ({ mode: 'contested' as const, team, reverse, main: true, seed }))));

export const LANDING_TURNOVER_CASES: OpposedDecisionCase[] = (['blue', 'red'] as const).flatMap(team =>
  [false, true].flatMap(reverse => [false, true].map(main => ({ mode: 'contested' as const, team, reverse, main }))));

/** End-of-frame carrier death clears orders after movement. The living landing
 * actor must regain an order on the immediately following production AI tick. */
export function landingTurnoverRecovery(trace: Pick<ReturnType<typeof runOpposedDecisionTrace>, 'frames' | 'deaths' | 'impacts'>,
  actorId: string, landing: number) {
  const frame = trace.frames[landing - 1], previous = trace.frames[landing - 2], next = trace.frames[landing];
  const carrierId = previous?.ball.state === 'held' ? previous.ball.holderId : null;
  const before = previous?.actors.find(a => a.id === actorId), landed = frame?.actors.find(a => a.id === actorId);
  if (!frame || !previous || !next || !before || !landed || !carrierId || carrierId === actorId ||
    previous.tick !== landing - 1 || frame.tick !== landing || next.tick !== landing + 1 ||
    [previous, frame, next].some(f => f.phase !== 'playing') ||
    before.hp <= 0 || before.pos[1] <= 0 || !before.isJumping || landed.hp <= 0 || landed.pos[1] !== 0 ||
    landed.vel[1] !== 0 || landed.isJumping || landed.jumpBudget !== 0 ||
    frame.assignments.some(a => a.id === actorId) || !previous.assignments.some(a => a.id === actorId) ||
    !previous.actors.some(a => a.id === carrierId && a.hp > 0) || !frame.actors.some(a => a.id === carrierId && a.hp === 0) ||
    !trace.deaths.some(d => d.id === carrierId && d.tick === landing) ||
    !trace.impacts.some(i => i.tick === landing && i.victims.includes(carrierId)) ||
    frame.ball.state !== 'loose' || frame.ball.holderId !== null ||
    !next.actors.some(a => a.id === actorId && a.hp > 0) ||
    !next.assignments.some(a => a.id === actorId && a.target !== carrierId)) return null;
  return { landing, carrierId, reassignedAt: next.tick };
}

/** Controlled descent; attacks, damage, movement and orders use live owners. */
export function runLandingTurnoverTrace(spec: OpposedDecisionCase) {
  const trace = runOpposedDecisionTrace(spec, 'landing-turnover');
  const actorId = spec.main ? 'main_ai' : 'escort', landing = 8;
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; trace.failures.push({tick,field,actual,expected}); }
  };
  for (let tick = 1; tick <= landing; tick++) {
    const actor = trace.frames[tick - 1].actors.find(a => a.id === actorId)!;
    const height = Math.max(0, .17 - 18 * tick * (tick + 1) / (2 * 60 * 60));
    check(tick, 'controlled descent follows independent gravity', Math.abs(actor.pos[1] - height) < 1e-9, true);
    check(tick, 'controlled descent integrates velocity once', Math.abs(actor.vel[1] - (height ? -18 * tick / 60 : 0)) < 1e-9, true);
    check(tick, 'controlled descent retains airborne state until landing', actor.isJumping, tick < landing);
  }
  check(landing, 'carrier kill follows an autonomous full hammer commitment',
    trace.attacks.some(a => a.id === 'defender' && a.tick === 1 && a.kind === 'swing') &&
    trace.impacts.some(i => i.id === 'defender' && i.tick === landing && i.victims.includes('carrier')), true);
  const landingRecovery = landingTurnoverRecovery(trace, actorId, landing);
  check(landing, 'landing has verified turnover and immediate reassignment', !!landingRecovery, true);
  const before = trace.frames[landing - 1].actors.find(a => a.id === actorId)!, next = trace.frames[landing].actors.find(a => a.id === actorId)!;
  check(landing + 1, 'reassigned actor resumes real ground movement', Math.hypot(next.pos[0] - before.pos[0], next.pos[2] - before.pos[2]) > 0, true);
  return { ...trace, boundary: 'live-landing-turnover' as const, landingRecovery };
}

/** Wounded opening contest with three-HP respawns. Every subsequent jump request,
 * strike, flight, landing and return to tactical play comes from live decisions. */
export function runMobilityDecisionTrace(spec: OpposedDecisionCase) {
  const trace = runOpposedDecisionTrace(spec, 'mobility');
  const dash = validateDashDecisionTrace(trace);
  trace.failureCount += dash.failureCount;
  trace.failures.push(...dash.failures.slice(0, Math.max(0, 64 - trace.failures.length)));
  return { ...validateMobilityDecisionTrace(trace), dash };
}

export function validateMobilityDecisionTrace(trace: ReturnType<typeof runOpposedDecisionTrace>) {
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected });
    }
  };
  const mainAt = (tick: number) => trace.frames[tick - 1].actors.find(a => a.id === 'main_ai')!;
  const flights: { launch: number; landing: number; apex: number }[] = [];
  const interruptedFlights: { launch: number; death: number; revival: number | null }[] = [];
  const partialFlights: { launch: number; landing: number | null; observedThrough: number }[] = [];
  const landingReassignments: { landing: number; carrierId: string; reassignedAt: number }[] = [];
  for (const jump of trace.mainJumpImpacts) {
    const start = mainAt(jump.tick);
    // At 60 Hz, .08s windup + .04s strike takes eight updates, including
    // the update that started the attack; launch is seven ticks after request.
    check(jump.tick, 'launch follows autonomous commitment and full windup',
      trace.mainJumpRequests.some(r => r.accepted && r.tick === jump.tick - 7), true);
    check(jump.tick, 'configured launch impulse', start.vel[1], 13.7);
    check(jump.tick, 'launch consumes one air jump', start.jumpBudget, 1);
    check(jump.tick, 'launch clears its plan', start.jumpPlanned, false);
    let y = start.pos[1], vy = 13.7, apex = y, landing = 0, interrupted = 0;
    for (let tick = jump.tick + 1; tick <= Math.min(trace.ticks, jump.tick + 120); tick++) {
      // Independent semi-implicit ballistic oracle: one 18m/s² gravity step.
      vy -= 18 / 60;
      y += vy / 60;
      const actor = mainAt(tick);
      check(tick, 'single vertical integration', Math.abs(actor.pos[1] - Math.max(0, y)) < 1e-8, true);
      check(tick, 'vertical velocity follows gravity', Math.abs(actor.vel[1] - (y <= 0 ? 0 : vy)) < 1e-8, true);
      // Damage follows movement in the live frame. Validate the death frame's
      // trajectory, then require a real lethal impact and frozen dead actor.
      // A corpse is not expected to keep flying or to replenish its jump budget.
      if (actor.hp <= 0) {
        interrupted = tick;
        check(tick, 'interrupted flight has a recorded lethal impact', trace.deaths.some(d => d.id === 'main_ai' && d.tick === tick) &&
          trace.impacts.some(i => i.tick === tick && i.victims.includes('main_ai')), true);
        const revival = trace.revivals.find(r => r.id === 'main_ai' && r.tick > tick);
        check(tick, 'interrupted flight revives after the full delay or remains beyond the trace',
          tick + 181 <= trace.ticks ? revival?.tick === tick + 181 : !revival, true);
        check(tick, 'interrupted flight cannot attack while dead', !trace.attacks.some(a =>
          a.id === 'main_ai' && a.tick > tick && a.tick < (revival?.tick ?? trace.ticks + 1)), true);
        for (let deadTick = tick; deadTick < (revival?.tick ?? trace.ticks + 1); deadTick++) {
          const dead = mainAt(deadTick);
          check(deadTick, 'interrupted flight remains dead and still', dead.hp === 0 &&
            dead.pos.every((n, i) => n === actor.pos[i]) && dead.vel.every((n, i) => n === actor.vel[i]), true);
          check(deadTick, 'interrupted flight cancels weapon and plan', dead.weaponState === 'ready' && !dead.jumpPlanned, true);
        }
        if (revival) {
          const restored = mainAt(revival.tick);
          check(revival.tick, 'interrupted flight respawns grounded and ready', restored.hp === restored.maxHp &&
            restored.pos[1] === 0 && restored.vel[1] === 0 && !restored.isJumping && !restored.jumpPlanned && restored.jumpBudget === 0, true);
        }
        interruptedFlights.push({ launch: jump.tick, death: tick, revival: revival?.tick ?? null });
        break;
      }
      if (y > 0) check(tick, 'jump plan stays consumed during flight', actor.jumpPlanned, false);
      if (y <= 0) {
        landing = tick;
        check(tick, 'landing clears airborne flag', actor.isJumping, false);
        check(tick, 'landing replenishes air-jump budget', actor.jumpBudget, 0);
        break;
      }
      apex = Math.max(apex, y);
      check(tick, 'airborne flag preserved through ascent and descent', actor.isJumping, true);
      check(tick, 'no budget refill in flight', actor.jumpBudget, 1);
    }
    // The fixed recording can end during a valid flight. Keep the observed
    // trajectory checks, but never count that prefix as a completed witness.
    const expectedLandingOffset = Array.from({ length: 120 }, (_, i) => i + 1).find(n =>
      start.pos[1] + n * 13.7 / 60 - 18 * n * (n + 1) / (2 * 60 * 60) <= 0);
    const endsBeforeLanding = expectedLandingOffset !== undefined && trace.ticks < jump.tick + expectedLandingOffset;
    check(jump.tick, 'flight completes within two seconds, is interrupted by verified death, or recording ends before landing',
      landing > 0 || interrupted > 0 || endsBeforeLanding, true);
    if (!landing && !interrupted && endsBeforeLanding) partialFlights.push({ launch: jump.tick, landing: null, observedThrough: trace.ticks });
    if (landing) {
      const landed = mainAt(landing);
      const frame = trace.frames[landing - 1];
      const retained = frame.assignments.some(a => a.id === 'main_ai');
      // End-of-frame carrier reconciliation invalidates stale orders after combat.
      // A landing at that boundary must have its order rebuilt on the next AI tick.
      const reassignedAfterDeath = landingTurnoverRecovery(trace, 'main_ai', landing);
      check(landing, 'landing retains an assignment or rebuilds it immediately after verified carrier death', retained || !!reassignedAfterDeath, true);
      if (reassignedAfterDeath) landingReassignments.push(reassignedAfterDeath);
      const resumed = trace.mainJumpRequests.some(r => r.accepted && r.tick >= landing && r.tick < landing + 30) || trace.frames.slice(landing, landing + 30).some(f => {
        const actor = f.actors.find(a => a.id === 'main_ai')!;
        return actor.hp > 0 && Math.hypot(actor.pos[0] - landed.pos[0], actor.pos[2] - landed.pos[2]) > .5;
      });
      if (!resumed && trace.ticks < landing + 30) partialFlights.push({ launch: jump.tick, landing, observedThrough: trace.ticks });
      else {
        check(landing, 'living bot resumes movement or commits a fresh jump after landing', resumed, true);
        flights.push({ launch: jump.tick, landing, apex });
      }
    }
  }
  return { ...trace, name: `${trace.name}/seed-${trace.scenario.seed}`, flights, interruptedFlights, partialFlights, landingReassignments };
}
export const runMobilityDecisionIntegration = () => MOBILITY_DECISION_CASES.map(runMobilityDecisionTrace);

export function landingTurnoverCoverage(traces: readonly Pick<ReturnType<typeof runLandingTurnoverTrace>, 'scenario' | 'ticks' | 'failureCount' | 'landingRecovery'>[]) {
  const key = (s: OpposedDecisionCase) => `${s.team}/${s.reverse}/${s.main}`;
  const expected = new Set(LANDING_TURNOVER_CASES.map(key)), errors: string[] = [];
  let completed = 0;
  for (const name of expected) {
    const found = traces.filter(t => key(t.scenario) === name);
    if (found.length !== 1) { errors.push(`${name}: required exactly once`); continue; }
    const t = found[0];
    if (t.scenario.mode !== 'contested' || t.failureCount !== 0 || t.ticks !== 12 || t.landingRecovery?.landing !== 8 ||
      t.landingRecovery.carrierId !== 'carrier' || t.landingRecovery.reassignedAt !== 9)
      errors.push(`${name}: missing verified landing turnover`);
    else completed++;
  }
  for (const t of traces) if (!expected.has(key(t.scenario))) errors.push(`${key(t.scenario)}: undeclared case`);
  return {required:expected.size,completed,errors};
}
