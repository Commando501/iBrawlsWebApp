import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';

export const REVIVAL_DECISION_CASES = OPPOSED_DECISION_CASES;
/** Continue autonomous contests through death, team respawn and fresh decisions.
 * main=true retains the original carrier identity, including its revival after a hammer kill. */
export const runRevivalDecisionTrace = (spec: OpposedDecisionCase) => runOpposedDecisionTrace(spec, 'revival');
export const runRevivalDecisionIntegration = () => REVIVAL_DECISION_CASES.map(runRevivalDecisionTrace);

interface RevivalAttackTrace {
  name: string; failureCount: number;
  scenario: { team: 'blue' | 'red'; reverse: boolean; main: boolean };
  revivals: readonly { id: string; tick: number }[];
  attacks: readonly { id: string; tick: number }[];
}
/** Across the unchanged matrix, the original main/ordinary carrier must be
 * observed attacking after revival for each team and actor order. */
export function revivalAttackCoverage(traces: readonly RevivalAttackTrace[]) {
  const required = (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
    [false, true].map(main => `${team}/${reverse}/${main}`)));
  const witnesses = traces.filter(t => !t.failureCount).flatMap(t => {
    const id = t.scenario.main ? 'main_ai' : 'carrier';
    const ticks = t.attacks.filter(a => a.id === id && t.revivals.some(r => r.id === id && r.tick < a.tick)).map(a => a.tick);
    return ticks.length ? [{ group: `${t.scenario.team}/${t.scenario.reverse}/${t.scenario.main}`, trace: t.name, ticks }] : [];
  });
  return { witnesses, missing: required.filter(group => !witnesses.some(w => w.group === group)) };
}
