/**
 * Throughput benchmark (plan Verification #5, TS side). Measures pure-TS steps/sec and
 * matches/sec for the headless engine across a batch of parallel matches, plus the
 * end-to-end VecEnv step rate. Run: `npm run sim:bench [numEnvs] [ticks]`.
 */

import { VecEnv } from '../../src/sim/server/vecEnv';
import { ACTION_DIM } from '../../src/sim/env/action';
import { playMatch } from '../../src/sim/harness/rollout';
import { heuristicPolicy } from '../../src/sim/harness/heuristicPolicy';

const numEnvs = Number(process.argv[2] ?? 64);
const ticks = Number(process.argv[3] ?? 1000);

function benchVecEnv(): void {
  const env = new VecEnv({ numEnvs, baseSeed: 1, settings: { grifballGoalTarget: 5 } });
  env.reset();
  const actions = new Int32Array(env.numEnvs * env.numAgents * ACTION_DIM);
  // Light pseudo-random actions so combat/objective code paths are exercised.
  const fill = (t: number) => { for (let i = 0; i < actions.length; i++) actions[i] = (t * 2654435761 + i) % 3; };

  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    fill(t);
    env.step(actions);
  }
  const dt = (performance.now() - t0) / 1000;
  const totalSteps = ticks * numEnvs;
  const agentSteps = totalSteps * env.numAgents;
  console.log(`VecEnv: ${numEnvs} envs × ${ticks} ticks in ${dt.toFixed(2)}s`);
  console.log(`  env-steps/sec   : ${(totalSteps / dt).toFixed(0)}`);
  console.log(`  agent-steps/sec : ${(agentSteps / dt).toFixed(0)}`);
}

function benchMatches(): void {
  const N = Math.max(8, Math.floor(numEnvs / 2));
  const t0 = performance.now();
  let totalTicks = 0;
  for (let i = 0; i < N; i++) {
    const r = playMatch({
      seed: 1000 + i,
      bluePolicy: heuristicPolicy,
      redPolicy: heuristicPolicy,
      settings: { grifballGoalTarget: 5 },
      maxTicks: 60 * 60 * 6,
    });
    totalTicks += r.ticks;
  }
  const dt = (performance.now() - t0) / 1000;
  console.log(`Full matches: ${N} heuristic-vs-heuristic games in ${dt.toFixed(2)}s`);
  console.log(`  matches/min : ${((N / dt) * 60).toFixed(0)}`);
  console.log(`  avg ticks   : ${(totalTicks / N).toFixed(0)} (~${(totalTicks / N / 3600).toFixed(1)} min sim time)`);
}

console.log(`# iBrawls sim throughput bench (numEnvs=${numEnvs}, ticks=${ticks})\n`);
benchVecEnv();
console.log();
benchMatches();
