import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';
import { validateRevivalActivity, verifiedRevivalAttacks } from './grifballRevivalActivity';
import { compactExecutionTrace, compactExecutionTraces } from './grifballParityEvidence';

export const REVIVAL_DECISION_CASES = OPPOSED_DECISION_CASES;
/** Continue autonomous contests through death, team respawn and fresh decisions.
 * main=true retains the original carrier identity, including its revival after a hammer kill. */
export function runRevivalDecisionTrace(spec: OpposedDecisionCase) {
  const trace = runOpposedDecisionTrace(spec, 'revival');
  const activity = validateRevivalActivity(trace);
  return { ...trace, activity, failureCount: trace.failureCount + activity.failureCount,
    failures: [...trace.failures, ...activity.failures].slice(0, 64) };
}
export const runRevivalDecisionIntegration = () => REVIVAL_DECISION_CASES.map(runRevivalDecisionTrace);

/** Coverage needs adjacent lifecycle/commitment frames. Calculate it before
 * sampling; retained frames alone deliberately cannot certify that history. */
export function summarizeRevivalDecisionTraces(traces: readonly ReturnType<typeof runRevivalDecisionTrace>[]) {
  const revivalAttackWitnesses = revivalAttackCoverage(traces);
  const revivalDecisionTraces = compactExecutionTraces(traces.map(({ dashSamples, ...trace }) => ({
    ...trace, dashEvidence: compactExecutionTrace({ frames: dashSamples ?? [], failures: trace.activity.dash.failures }),
  })));
  return { revivalAttackWitnesses, revivalDecisionTraces };
}

interface RevivalAttackTrace extends Pick<ReturnType<typeof runOpposedDecisionTrace>, 'attacks' | 'revivals' | 'deaths' | 'frames'> {
  name: string; failureCount: number;
  scenario: { team: 'blue' | 'red'; reverse: boolean; main: boolean };
}
/** Across the unchanged matrix, the original main/ordinary carrier must be
 * observed attacking after revival for each team and actor order. */
export function revivalAttackCoverage(traces: readonly RevivalAttackTrace[]) {
  const required = (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
    [false, true].map(main => `${team}/${reverse}/${main}`)));
  const witnesses = traces.filter(t => !t.failureCount).flatMap(t => {
    const id = t.scenario.main ? 'main_ai' : 'carrier';
    const ticks = verifiedRevivalAttacks(t).filter(a => a.id === id).map(a => a.tick);
    return ticks.length ? [{ group: `${t.scenario.team}/${t.scenario.reverse}/${t.scenario.main}`, trace: t.name, ticks }] : [];
  });
  return { witnesses, missing: required.filter(group => !witnesses.some(w => w.group === group)) };
}
