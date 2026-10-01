import { validateDashDecisionTrace } from './grifballDashDecisionValidation';
import type { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

type Trace = ReturnType<typeof runOpposedDecisionTrace>;
/** A revival must lead to renewed combat participation. A defensive witness
 * needs an observed threat and an independently verified consumed ground step;
 * a request, suspended jump, blocked dash or action by a never-revived actor is insufficient. */
export function validateRevivalActivity(trace: Trace) {
  const dash = validateDashDecisionTrace(trace);
  let failureCount = dash.failureCount;
  const failures = [...dash.failures];
  const required = trace.scenario.mode === 'contested' || trace.scenario.mode === 'hammer-first' && !trace.scenario.reverse;
  const revivedBefore = (id: string, tick: number) => trace.revivals.some(r => r.id === id && r.tick < tick);
  const attacks = trace.attacks.filter(a => revivedBefore(a.id, a.tick)).map(a => ({ tick: a.tick, id: a.id }));
  const frames = new Map(trace.frames.map(f => [f.tick, f]));
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
  const defensiveDashes = dash.failureCount ? [] : (trace.dashSamples ?? []).filter(s => {
    if (!s.requested || !s.incomingThreat || !s.target || s.target === s.id || !revivedBefore(s.id, s.tick)) return false;
    const before = frames.get(s.tick - 1)?.actors.find(a => a.id === s.id);
    const after = frames.get(s.tick)?.actors.find(a => a.id === s.id);
    const target = frames.get(s.tick - 1)?.actors.find(a => a.id === s.target);
    if (!before || !after || !target || target.team === before.team || before.hp <= 0 || after.hp <= 0 ||
      target.hp <= 0 || s.before.hp <= 0 || s.after.hp <= 0) return false;
    if (s.before.jumping || s.after.jumping || s.before.pos[1] !== 0 || s.after.pos[1] !== 0 ||
      s.before.vel[1] !== 0 || s.after.vel[1] !== 0) return false;
    return before.pos.every((p, i) => near(p, s.before.pos[i])) && after.pos.every((p, i) => near(p, s.after.pos[i])) &&
      near(s.after.remaining, trace.dashSettings!.duration - 1 / 60) &&
      Math.hypot(s.after.pos[0] - s.before.pos[0], s.after.pos[2] - s.before.pos[2]) > 1e-8;
  }).map(s => ({ tick: s.tick, id: s.id, target: s.target!, displacement:
    Math.hypot(s.after.pos[0] - s.before.pos[0], s.after.pos[2] - s.before.pos[2]) }));
  if (required && !attacks.length && !defensiveDashes.length) {
    failureCount++;
    if (failures.length < 64) failures.push({ tick: trace.ticks,
      field: 'revived actor resumes combat with an attack or verified defensive dash', actual: false, expected: true });
  }
  return { failureCount, failures, required, attacks, defensiveDashes, dash };
}
