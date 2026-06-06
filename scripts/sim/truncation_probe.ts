import { evaluate } from '../../src/sim/harness/rollout';
import { randomPolicy } from '../../src/sim/harness/randomPolicy';
import { heuristicPolicy } from '../../src/sim/harness/heuristicPolicy';

const settings = { grifballGoalTarget: 3 };
const maxTicks = 60 * 60 * 6;
const cases: [string, typeof randomPolicy, typeof randomPolicy][] = [
  ['random vs random', randomPolicy, randomPolicy],
  ['heuristic vs random', heuristicPolicy, randomPolicy],
];
for (const [name, blue, red] of cases) {
  const r = evaluate({ blue, red, matches: 40, baseSeed: 1, settings, maxTicks });
  console.log(
    name.padEnd(22),
    'timeouts', `${r.timeouts}/${r.matches}`,
    'avgTicks', r.avgTicks.toFixed(0),
    `(~${(r.avgTicks / 3600).toFixed(1)}min)`
  );
}
