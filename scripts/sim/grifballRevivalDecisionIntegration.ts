import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';

export const REVIVAL_DECISION_CASES = OPPOSED_DECISION_CASES;
/** Continue autonomous contests through death, team respawn and fresh decisions.
 * main=true retains the original carrier identity, including its revival after a hammer kill. */
export const runRevivalDecisionTrace = (spec: OpposedDecisionCase) => runOpposedDecisionTrace(spec, 'revival');
export const runRevivalDecisionIntegration = () => REVIVAL_DECISION_CASES.map(runRevivalDecisionTrace);
