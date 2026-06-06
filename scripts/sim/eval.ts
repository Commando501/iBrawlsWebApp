/**
 * Baseline evaluation (plan Verification #6, TS side). Plays heuristic vs random over K
 * matches (and the mirror) and prints win-rate / goal-diff / length. Confirms the env
 * rewards real Grifball skill before any learning runs. Run: `npm run sim:eval [matches]`.
 */

import { evaluate } from '../../src/sim/harness/rollout';
import { heuristicPolicy } from '../../src/sim/harness/heuristicPolicy';
import { randomPolicy } from '../../src/sim/harness/randomPolicy';

const matches = Number(process.argv[2] ?? 100);
const settings = { grifballGoalTarget: 3 };
const maxTicks = 60 * 60 * 6;

const a = evaluate({ blue: heuristicPolicy, red: randomPolicy, matches, baseSeed: 1, settings, maxTicks });
const b = evaluate({ blue: randomPolicy, red: heuristicPolicy, matches, baseSeed: 10_000, settings, maxTicks });

const heuristicWins = a.blueWins + b.redWins;
const total = a.matches + b.matches;
const winRate = heuristicWins / total;

console.log(`# Baseline eval: heuristic vs random over ${total} matches (both sides)\n`);
console.log(`heuristic win rate : ${(winRate * 100).toFixed(1)}%`);
console.log(`avg |goal diff|    : ${((Math.abs(a.avgGoalDiff) + Math.abs(b.avgGoalDiff)) / 2).toFixed(2)}`);
console.log(`avg match length   : ${(((a.avgTicks + b.avgTicks) / 2) / 3600).toFixed(1)} sim-min`);
console.log(`timeouts           : ${a.timeouts + b.timeouts}`);
console.log(winRate > 0.9 ? '\nPASS: heuristic dominates (>90%).' : '\nWARN: heuristic win rate below 90%.');
