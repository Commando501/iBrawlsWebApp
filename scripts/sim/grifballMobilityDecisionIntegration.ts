import { runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';
import { validateDashDecisionTrace } from './grifballDashDecisionValidation';

// Fixed contiguous development matrix, including both original seeds. Keep all
// outcomes; absence of a flight in one seed is not a physics failure.
export const MOBILITY_DECISION_CASES: OpposedDecisionCase[] = Array.from({ length: 8 }, (_, i) => i + 1).flatMap(seed => (['blue', 'red'] as const)
  .flatMap(team => [false, true].map(reverse => ({ mode: 'contested' as const, team, reverse, main: true, seed }))));

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
      const frame = trace.frames[landing - 1], previous = trace.frames[landing - 2], next = trace.frames[landing];
      const retained = frame.assignments.some(a => a.id === 'main_ai');
      const carrierId = previous?.ball.state === 'held' ? previous.ball.holderId : null;
      // End-of-frame carrier reconciliation invalidates stale orders after combat.
      // A landing at that boundary must have its order rebuilt on the next AI tick.
      const reassignedAfterDeath = !retained && !!carrierId && carrierId !== 'main_ai'
        && previous.tick === landing - 1 && frame.tick === landing && next?.tick === landing + 1
        && previous.phase === 'playing' && frame.phase === 'playing' && next?.phase === 'playing'
        && previous.assignments.some(a => a.id === 'main_ai')
        && previous.actors.some(a => a.id === carrierId && a.hp > 0)
        && frame.actors.some(a => a.id === carrierId && a.hp === 0)
        && trace.deaths.some(d => d.id === carrierId && d.tick === landing)
        && trace.impacts.some(i => i.tick === landing && i.victims.includes(carrierId))
        && frame.ball.state === 'loose' && frame.ball.holderId === null
        && next.actors.some(a => a.id === 'main_ai' && a.hp > 0)
        && next.assignments.some(a => a.id === 'main_ai' && a.target !== carrierId);
      check(landing, 'landing retains an assignment or rebuilds it immediately after verified carrier death', retained || reassignedAfterDeath, true);
      if (reassignedAfterDeath) landingReassignments.push({ landing, carrierId, reassignedAt: next.tick });
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
