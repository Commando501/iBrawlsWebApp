import type { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

type Trace = ReturnType<typeof runOpposedDecisionTrace>;

/** Observe the production updater without supplying movement or dash requests.
 * Airborne steering owns movement before the grounded dash branch; retain those
 * deferred commitments separately rather than calling them completed dashes. */
export function validateDashDecisionTrace(trace: Trace) {
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  let failureCount = 0, groundedSteps = 0, airborneDeferred = 0;
  const starts: { tick: number; id: string }[] = [], completions: { tick: number; id: string }[] = [];
  const cancellations: { tick: number; id: string }[] = [];
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      failureCount++;
      if (failures.length < 64) failures.push({ tick, field, actual, expected });
    }
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
  const settings = trace.dashSettings;
  check(0, 'dash observation is present', !!settings && !!trace.dashSamples?.length, true);
  if (settings) for (const { tick, id, target, requested: started, before: a, after: b } of trace.dashSamples ?? []) {
    if (started) {
      starts.push({ tick, id });
      check(tick, `${id}: dash starts after cooldown expires`, a.cooldown <= 1 / 60 + 1e-8, true);
      check(tick, `${id}: dash starts with configured duration or consumes its first step`,
        near(b.remaining, settings.duration) || near(b.remaining, settings.duration - 1 / 60), true);
      check(tick, `${id}: dash starts with configured cooldown`, near(b.cooldown, settings.cooldown), true);
      check(tick, `${id}: dash has unit horizontal direction`, near(Math.hypot(b.direction.x!, b.direction.z!), 1) && b.direction.y === 0, true);
    } else {
      check(tick, `${id}: cooldown advances once`, near(b.cooldown, Math.max(0, a.cooldown - 1 / 60)), true);
      check(tick, `${id}: no unobserved dash request`, b.remaining <= a.remaining, true);
    }
    if (started && near(b.remaining, settings.duration) || !started && a.remaining <= 0) continue;
    if (!target) {
      check(tick, `${id}: target loss cancels the committed dash`, b.remaining, 0);
      cancellations.push({ tick, id });
      continue;
    }
    if (a.jumping || b.jumping || a.pos[1] > 0 || b.pos[1] > 0) {
      if (a.remaining === b.remaining) airborneDeferred++;
      continue;
    }
    groundedSteps++;
    check(tick, `${id}: grounded dash duration advances once`, near(b.remaining, Math.max(0, (started ? settings.duration : a.remaining) - 1 / 60)), true);
    if (!started) check(tick, `${id}: committed dash direction stays fixed`, (['x', 'y', 'z'] as const).every(k =>
      a.direction[k] === b.direction[k]), true);
    const direction = started ? b.direction : a.direction;
    for (const [axis, index, bound] of [['x', 0, 51.4], ['z', 2, 22.4]] as const) {
      const velocity = direction[axis]! * settings.distance / settings.duration;
      const proposed = a.pos[index] + velocity / 60;
      const expected = Math.max(-bound, Math.min(bound, proposed));
      check(tick, `${id}: single dash ${axis} displacement`, near(b.pos[index], expected), true);
      if (Math.abs(proposed) < bound) check(tick, `${id}: configured dash ${axis} velocity`, near(b.vel[index], velocity), true);
    }
    if (b.remaining === 0) completions.push({ tick, id });
  }
  return { failureCount, failures, starts, completions, cancellations, groundedSteps, airborneDeferred };
}

export function dashDecisionCoverage(traces: readonly { scenario: { team: string; reverse: boolean };
  dash: ReturnType<typeof validateDashDecisionTrace> }[]) {
  const missing: string[] = [];
  for (const team of ['blue', 'red']) for (const reverse of [false, true]) for (const main of [false, true]) {
    if (!traces.some(t => t.scenario.team === team && t.scenario.reverse === reverse &&
      t.dash.failureCount === 0 && t.dash.completions.some(c => (c.id === 'main_ai') === main)))
      missing.push(`${team}/${reverse ? 'reverse' : 'forward'}/${main ? 'main' : 'ordinary'}`);
  }
  if (!traces.some(t => t.dash.failureCount === 0 && t.dash.cancellations.length)) missing.push('target-loss');
  return { missing, starts: traces.reduce((n, t) => n + t.dash.starts.length, 0),
    completions: traces.reduce((n, t) => n + t.dash.completions.length, 0),
    cancellations: traces.reduce((n, t) => n + t.dash.cancellations.length, 0),
    groundedSteps: traces.reduce((n, t) => n + t.dash.groundedSteps, 0),
    airborneDeferred: traces.reduce((n, t) => n + t.dash.airborneDeferred, 0) };
}
