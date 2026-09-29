import { runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';

export const MOBILITY_DECISION_CASES: OpposedDecisionCase[] = [1, 5].flatMap(seed => (['blue', 'red'] as const)
  .flatMap(team => [false, true].map(reverse => ({ mode: 'contested' as const, team, reverse, main: true, seed }))));

/** Wounded opening contest with three-HP respawns. Every subsequent jump request,
 * strike, flight, landing and return to tactical play comes from live decisions. */
export function runMobilityDecisionTrace(spec: OpposedDecisionCase) {
  const trace = runOpposedDecisionTrace(spec, 'mobility');
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected });
    }
  };
  const mainAt = (tick: number) => trace.frames[tick - 1].actors.find(a => a.id === 'main_ai')!;
  const flights: { launch: number; landing: number; apex: number }[] = [];
  check(trace.ticks, 'successful autonomous main launch observed', trace.mainJumpImpacts.length > 0, true);
  for (const jump of trace.mainJumpImpacts) {
    const start = mainAt(jump.tick);
    // At 60 Hz, .08s windup + .04s strike takes eight updates, including
    // the update that started the attack; launch is seven ticks after request.
    check(jump.tick, 'launch follows autonomous commitment and full windup',
      trace.mainJumpRequests.some(r => r.accepted && r.tick === jump.tick - 7), true);
    check(jump.tick, 'configured launch impulse', start.vel[1], 13.7);
    check(jump.tick, 'launch consumes one air jump', start.jumpBudget, 1);
    check(jump.tick, 'launch clears its plan', start.jumpPlanned, false);
    let y = start.pos[1], vy = 13.7, apex = y, landing = 0;
    for (let tick = jump.tick + 1; tick <= Math.min(trace.ticks, jump.tick + 120); tick++) {
      // Independent semi-implicit ballistic oracle: one 18m/s² gravity step.
      vy -= 18 / 60;
      y += vy / 60;
      const actor = mainAt(tick);
      check(tick, 'jump survives until landing', actor.hp > 0, true);
      check(tick, 'single vertical integration', Math.abs(actor.pos[1] - Math.max(0, y)) < 1e-8, true);
      check(tick, 'vertical velocity follows gravity', Math.abs(actor.vel[1] - (y <= 0 ? 0 : vy)) < 1e-8, true);
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
    check(jump.tick, 'flight completes within two seconds', landing > 0, true);
    if (landing) {
      const landed = mainAt(landing);
      check(landing, 'landing retains tactical assignment', trace.frames[landing - 1].assignments.some(a => a.id === 'main_ai'), true);
      check(landing, 'living bot resumes movement or commits a fresh jump after landing', trace.mainJumpRequests.some(r => r.accepted && r.tick >= landing && r.tick < landing + 30) || trace.frames.slice(landing, landing + 30).some(f => {
        const actor = f.actors.find(a => a.id === 'main_ai')!;
        return actor.hp > 0 && Math.hypot(actor.pos[0] - landed.pos[0], actor.pos[2] - landed.pos[2]) > .5;
      }), true);
      flights.push({ launch: jump.tick, landing, apex });
    }
  }
  return { ...trace, name: `${trace.name}/seed-${spec.seed}`, flights };
}
export const runMobilityDecisionIntegration = () => MOBILITY_DECISION_CASES.map(runMobilityDecisionTrace);
