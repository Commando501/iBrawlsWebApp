import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from './profiles';
import { createSuitePlan } from './plan';
import { validateGateProtocol, type GateProtocol } from './gates';
import { performanceGate } from './performanceGate';
import { alignedReplayWindows, type PerformanceReplay } from './performanceReplay';
import { COST_CHANNELS, LiveTimings } from './telemetry';
import { trialCheck, type TrialResult } from './runner';
import { emptyTeamEvaluation } from '../grifballEvaluation';

const env = 'c'.repeat(64);
const protocol: GateProtocol = { version: 2, quality: null, performance: {
  calibrationId: 'replay-fixture', environmentHash: env, controlledSerial: true,
  maxBaselineRatio: 1.2, maxNoiseRatio: 3, minRefreshSamples: 20,
  noise: { method: 'aligned-replay-windows', windowRefreshes: 8 },
} };
function timed(costs: number[]) {
  const timing = new LiveTimings();
  for (const [i, cost] of costs.entries()) {
    timing.playingTicks = 120 + i;
    for (const channel of COST_CHANNELS) timing.record(channel, cost);
  }
  return timing.finish();
}
function trial(jobId: string): TrialResult {
  const start = { tick: 0, phase: 'playing' as const, round: 1, scores: { blue: 0, red: 0 }, clock: 0,
    holder: null, ballState: 'idle' as const, alive: ['bot'] };
  return { jobId, termination: 'scenario-complete', check: trialCheck(jobId, 'scenario-complete', 'fixture'),
    start, end: { ...start, tick: 300 }, trace: [], droppedTraceEntries: 0,
    metrics: { blue: emptyTeamEvaluation(), red: emptyTeamEvaluation() },
    simulationCost: { samples: 300, meanMs: 1, maxMs: 10 },
    deterministic: { version: 1, algorithm: 'sha256-pages-v1', ticks: 301, hash: 'a'.repeat(64), error: null },
    behavior: { version: 1, ticks: 300, pickups: 1, throws: 0, recoveries: 0, respawns: 0,
      goals: { blue: 0, red: 0 }, roleReleases: 0, staleRoleTicks: 0 },
    timings: timed(Array.from({ length: 25 }, (_, i) => i === 10 ? 10 : 1)) };
}
async function fixture() {
  const manifest = createSuiteManifest('quick');
  manifest.cases = manifest.cases.slice(0, 1);
  Object.assign(manifest.cases[0], { seeds: [101], mirrored: false, opponents: ['balanced'] });
  manifest.candidate.defaults.styleAggression = .7;
  manifest.performance = { plannerRefreshP95Ms: 4, calibrationId: 'replay-fixture' };
  const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const results = plan.jobs.map(j => trial(j.id));
  const replay: PerformanceReplay = { planId: plan.id, environmentHash: env, results: structuredClone(results) };
  return { plan, results, replay };
}
test('aligned replay keeps real workload spikes and every tail sample without treating them as environmental noise', async () => {
  const { plan, results, replay } = await fixture();
  assert.equal(performanceGate(plan, results, env, validateGateProtocol(protocol), replay).check.verdict, 'pass');
  const windows = alignedReplayWindows(results[0], replay.results[0], 8);
  assert.deepEqual(windows.map(w => w.samples), [8, 8, 8, 1]);
  assert.equal(windows.reduce((sum, w) => sum + w.originalMs, 0), 34);
  assert.ok(windows.every(w => w.ratio === 1));
  const legacy = { ...protocol, version: 1 as const, performance: { ...protocol.performance!, noise: undefined } };
  assert.equal(performanceGate(plan, results, env, legacy, replay).check.verdict, 'inconclusive', 'historical rules remain unchanged');
});
test('replay protocol requires an explicit window calibration and cannot change version 1 semantics', () => {
  for (const width of [0, 1, 2.5, 65, NaN]) assert.throws(() => validateGateProtocol({ ...protocol,
    performance: { ...protocol.performance, noise: { method: 'aligned-replay-windows', windowRefreshes: width } } }));
  assert.throws(() => validateGateProtocol({ ...protocol, version: 1 }));
  assert.throws(() => validateGateProtocol({ ...protocol, performance: { ...protocol.performance, noise: undefined } }));
  assert.throws(() => validateGateProtocol({ ...protocol, performance: { ...protocol.performance,
    noise: { method: 'aligned-replay-windows', windowRefreshes: 16 } } }));
});
test('per-job replay cannot be missing, stale, foreign, duplicated or taken from a different environment', async () => {
  const { plan, results, replay } = await fixture();
  for (const bad of [undefined, { ...replay, planId: 'stale' }, { ...replay, environmentHash: 'd'.repeat(64) },
    { ...replay, results: replay.results.slice(1) }, { ...replay, results: [replay.results[0], replay.results[0]] },
    { ...replay, results: [{ ...replay.results[0], jobId: 'foreign' }] }])
    assert.equal(performanceGate(plan, results, env, protocol, bad).check.verdict, 'inconclusive');
});
const mutations: [string, (t: TrialResult) => void][] = [
  ['changed hash', t => { t.deterministic!.hash = 'f'.repeat(64); }],
  ['missing hash', t => { t.deterministic!.hash = null; }],
  ['changed intermediate behavior', t => { t.behavior!.pickups++; }],
  ['changed terminal tick', t => { t.end!.tick++; }],
  ['failed trial', t => { t.check.verdict = 'fail'; }],
  ['missing trace', t => { delete t.timings!.plannerRefreshTrace; }],
  ['truncated trace', t => { t.timings!.plannerRefreshTrace!.samples.pop(); t.timings!.plannerRefreshTrace!.dropped++; }],
  ['shifted ticks', t => { t.timings!.plannerRefreshTrace!.samples[1][0]++; }],
  ['non-finite cost', t => { t.timings!.plannerRefreshTrace!.samples[0][1] = NaN; }],
  ['negative cost', t => { t.timings!.plannerRefreshTrace!.samples[0][1] = -1; }],
  ['contradictory distribution', t => { t.timings!.warm.plannerRefresh.p95Ms = 0; }],
  ['missing timing channel', t => { t.timings!.warm.render.samples = 0; }],
  ['unresolved timer resolution', t => { t.timings = timed(Array(25).fill(0)); }],
  ['contended window', t => { t.timings = timed(Array(25).fill(10)); }],
];
for (const [name, mutate] of mutations) test(`aligned replay rejects ${name}`, async () => {
  const { plan, results, replay } = await fixture();
  mutate(replay.results[0]);
  assert.equal(performanceGate(plan, results, env, protocol, replay).check.verdict, 'inconclusive');
});
test('absolute and relative budgets apply to both original and repeated trials', async () => {
  const { plan, results, replay } = await fixture();
  for (const t of [...results, ...replay.results]) t.timings = timed(Array(25).fill(2));
  replay.results.find(r => plan.jobs.find(j => j.id === r.jobId)!.variant === 'candidate')!.timings = timed(Array(25).fill(3));
  assert.equal(performanceGate(plan, results, env, protocol, replay).check.verdict, 'fail', 'replay paired regression');
  for (const t of [...results, ...replay.results]) t.timings = timed(Array(25).fill(3));
  for (const t of replay.results) t.timings = timed(Array(25).fill(5));
  assert.equal(performanceGate(plan, results, env, protocol, replay).check.verdict, 'fail', 'replay absolute regression');
  for (const t of results) t.timings = timed(Array(25).fill(5));
  for (const t of replay.results) t.timings = timed(Array(25).fill(3));
  assert.equal(performanceGate(plan, results, env, protocol, replay).check.verdict, 'fail', 'original absolute regression');
});
