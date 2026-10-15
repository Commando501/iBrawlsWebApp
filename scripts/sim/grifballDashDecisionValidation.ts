/** Copied updater kinematics used by both corridor and incoming-sword audits. */
export interface DashDecisionKinematics {
  pos: number[]; vel: number[]; remaining: number; cooldown: number;
  direction: { x?: number; y?: number; z?: number }; jumping: boolean;
}
export interface DashDecisionRecording {
  dashSettings?: { distance: number; duration: number; cooldown: number };
  dashSamples?: readonly { tick: number; id: string; requested: boolean; target: string | null;
    incomingThreat: boolean; before: DashDecisionKinematics; after: DashDecisionKinematics }[];
}

/** Observe the production updater without supplying movement or dash requests.
 * Suspended commitments follow an independent ballistic/drift oracle for this
 * open rectangular fixture. They are not counted as completed ground dashes. */
export function validateDashDecisionTrace(trace: DashDecisionRecording) {
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  let failureCount = 0, groundedSteps = 0, airborneDeferred = 0;
  let airborneSteps = 0;
  const airborneLandings: { tick: number; id: string }[] = [];
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
  if (settings) for (const { tick, id, target, incomingThreat, requested: started, before: a, after: b } of trace.dashSamples ?? []) {
    check(tick, `${id}: incoming threat observation is present`, typeof incomingThreat === 'boolean', true);
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
    if (!started) check(tick, `${id}: committed dash direction stays fixed`, (['x', 'y', 'z'] as const).every(k =>
      a.direction[k] === b.direction[k]), true);
    // Classify from the pre-update observation, so corrupt output cannot escape
    // the oracle by clearing its airborne flag or moving straight to the floor.
    if (!started && (a.pos[1] > 0 || a.vel[1] !== 0)) {
      // The tactical target marks both incoming swings and flights as threats.
      // Evasion can add a horizontal hop step or relaunch on the landing tick;
      // its independent steering oracle remains outside this contract.
      if (incomingThreat) { airborneDeferred++; continue; }
      airborneSteps++;
      const vy = a.vel[1] - 18 / 60;
      const y = a.pos[1] + vy / 60;
      const landed = y <= 0;
      check(tick, `${id}: airborne vertical displacement`, near(b.pos[1], Math.max(0, y)), true);
      check(tick, `${id}: airborne vertical velocity`, near(b.vel[1], landed ? 0 : vy), true);
      check(tick, `${id}: ${landed ? 'landing dash duration' : 'suspended dash duration'}`,
        near(b.remaining, landed ? Math.max(0, a.remaining - 1 / 60) : a.remaining), true);
      if (landed) {
        airborneLandings.push({ tick, id });
        check(tick, `${id}: landing clears airborne flag`, b.jumping, false);
      } else {
        check(tick, `${id}: flight preserves airborne flag`, b.jumping, a.jumping);
      }
      for (const [axis, index, bound] of [['x', 0, 51.4], ['z', 2, 22.4]] as const) {
        const drift = a.pos[index] + a.vel[index] / 60;
        let position = Math.max(-bound, Math.min(bound, drift));
        let velocity = Math.abs(drift) > bound && a.vel[index] * Math.sign(drift) > 0 ? 0 : a.vel[index];
        if (landed) {
          // Landing clears momentum, then the ground dash consumes one step.
          velocity = a.direction[axis]! * settings.distance / settings.duration;
          const proposed = position + velocity / 60;
          position = Math.max(-bound, Math.min(bound, proposed));
          if (Math.abs(proposed) > bound && velocity * Math.sign(proposed) > 0) velocity = 0;
        } else velocity *= 1 - 5 / 60;
        const label = landed ? 'landing' : 'drift';
        check(tick, `${id}: ${label} ${axis} displacement`, near(b.pos[index], position), true);
        check(tick, `${id}: ${label} ${axis} velocity`, near(b.vel[index], velocity), true);
      }
      if (landed && b.remaining === 0) completions.push({ tick, id });
      continue;
    }
    if (a.jumping || b.jumping || a.pos[1] > 0 || b.pos[1] > 0) {
      airborneDeferred++;
      continue;
    }
    groundedSteps++;
    check(tick, `${id}: grounded dash duration advances once`, near(b.remaining, Math.max(0, (started ? settings.duration : a.remaining) - 1 / 60)), true);
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
  return { failureCount, failures, starts, completions, cancellations, groundedSteps, airborneDeferred, airborneSteps, airborneLandings };
}

export function dashDecisionCoverage(traces: readonly { failureCount: number; scenario: { team: string; reverse: boolean };
  dash: ReturnType<typeof validateDashDecisionTrace> }[]) {
  const missing: string[] = [];
  const valid = traces.filter(t => t.failureCount === 0 && t.dash.failureCount === 0);
  for (const team of ['blue', 'red']) for (const reverse of [false, true]) for (const main of [false, true]) {
    if (!valid.some(t => t.scenario.team === team && t.scenario.reverse === reverse &&
      t.dash.completions.some(c => (c.id === 'main_ai') === main)))
      missing.push(`${team}/${reverse ? 'reverse' : 'forward'}/${main ? 'main' : 'ordinary'}`);
    if (!valid.some(t => t.scenario.team === team && t.scenario.reverse === reverse &&
      t.dash.airborneLandings.some(c => (c.id === 'main_ai') === main)))
      missing.push(`${team}/${reverse ? 'reverse' : 'forward'}/${main ? 'main' : 'ordinary'}/airborne-landing`);
  }
  if (!valid.some(t => t.dash.cancellations.length)) missing.push('target-loss');
  return { missing, starts: traces.reduce((n, t) => n + t.dash.starts.length, 0),
    completions: traces.reduce((n, t) => n + t.dash.completions.length, 0),
    cancellations: traces.reduce((n, t) => n + t.dash.cancellations.length, 0),
    groundedSteps: traces.reduce((n, t) => n + t.dash.groundedSteps, 0),
    airborneSteps: traces.reduce((n, t) => n + t.dash.airborneSteps, 0),
    airborneLandings: traces.reduce((n, t) => n + t.dash.airborneLandings.length, 0),
    airborneDeferred: traces.reduce((n, t) => n + t.dash.airborneDeferred, 0) };
}
