import { validateDashDecisionTrace, type DashDecisionRecording, type DashDecisionKinematics } from './grifballDashDecisionValidation';
import type { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

type Trace = ReturnType<typeof runOpposedDecisionTrace>;
export type RevivalAttackEvidence = Pick<Trace, 'attacks' | 'revivals' | 'deaths' | 'frames'>;
export type RevivalActivityRecording = RevivalAttackEvidence &
  Pick<Trace, 'scenario' | 'ticks'> & {
    dashSettings?: DashDecisionRecording['dashSettings'];
    dashSamples?: (Omit<NonNullable<DashDecisionRecording['dashSamples']>[number], 'before' | 'after'> & {
      before: DashDecisionKinematics & { hp: number };
      after: DashDecisionKinematics & { hp: number };
    })[];
  };

/** Requests alone cannot prove renewed combat. These bounded recordings retain
 * both the actual dead-to-alive boundary and the first committed attack frame. */
export function verifiedRevivalAttacks(trace: RevivalAttackEvidence) {
  const frames = new Map(trace.frames.map(f => [f.tick, f]));
  const actor = (tick: number, id: string) => frames.get(tick)?.actors.find(a => a.id === id);
  return trace.attacks.filter(attack => {
    const { tick, id } = attack;
    if (!Number.isInteger(tick) || tick <= 1 || !['swing', 'hammer-jump'].includes(attack.kind) ||
      trace.attacks.filter(a => a.tick === tick && a.id === id).length !== 1) return false;
    const revival = trace.revivals.filter(r => r.id === id && r.tick < tick).at(-1);
    if (!revival || !Number.isInteger(revival.tick)) return false;
    const dead = actor(revival.tick - 1, id), restored = actor(revival.tick, id);
    const before = actor(tick - 1, id), after = actor(tick, id);
    if (!dead || !restored || !before || !after || dead.hp > 0 || dead.respawnTimer <= 0 ||
      restored.hp <= 0 || restored.respawnTimer !== 0 || restored.deaths !== dead.deaths ||
      revival.deaths !== restored.deaths || revival.kills !== restored.kills ||
      !trace.deaths.some(d => d.id === id && d.tick < revival.tick) ||
      trace.deaths.some(d => d.id === id && d.tick >= revival.tick && d.tick <= tick)) return false;
    if (frames.get(tick - 1)?.phase !== 'playing' || frames.get(tick)?.phase !== 'playing' ||
      before.hp <= 0 || after.hp <= 0 || before.respawnTimer !== 0 || after.respawnTimer !== 0 ||
      before.deaths !== restored.deaths || after.deaths !== restored.deaths ||
      before.weapon !== attack.weapon || after.weapon !== attack.weapon || before.weaponState !== 'ready' ||
      after.weaponState !== (attack.melee ? 'melee_up' : 'swing_up') ||
      Math.abs(after.weaponTimer - 1 / 60) >= 1e-8) return false;
    if (attack.kind === 'hammer-jump' && (attack.weapon !== 'hammer' || attack.melee ||
      !(id === 'main_ai' ? after.jumpPlanned : after.isJumping && after.vel[1] > 0))) return false;
    return true;
  }).map(({ tick, id }) => ({ tick, id }));
}
/** A revival must lead to renewed combat participation. A defensive witness
 * needs an observed threat and an independently verified consumed ground step;
 * a request, suspended jump, blocked dash or action by a never-revived actor is insufficient. */
export function validateRevivalActivity(trace: RevivalActivityRecording) {
  const dash = validateDashDecisionTrace(trace);
  let failureCount = dash.failureCount;
  const failures = [...dash.failures];
  const required = trace.scenario.mode === 'contested' || trace.scenario.mode === 'hammer-first' && !trace.scenario.reverse;
  const revivedBefore = (id: string, tick: number) => trace.revivals.some(r => r.id === id && r.tick < tick);
  const attacks = verifiedRevivalAttacks(trace);
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
