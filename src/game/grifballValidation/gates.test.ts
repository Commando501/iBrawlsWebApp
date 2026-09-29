import { createInitialGrifballRuntimeState } from '../../components/grifball/runtimeState';
import { updateGrifballTeamPlanForState } from '../../components/grifball/grifballTeamPlanRuntime';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from './profiles';
import { createSuitePlan } from './plan';
import { correctnessGate, reproducibilityGate, createNullControlPlan, validateGateProtocol, type GateProtocol } from './gates';
import { qualityGate } from './qualityGate';
import { performanceGate } from './performanceGate';
import { DeterministicTrace, LiveTimings, COST_CHANNELS, liveTimings } from './telemetry';
import { trialCheck, type TrialResult } from './runner';
import { emptyTeamEvaluation } from '../grifballEvaluation';
import { importLabRun, labRunReport } from './labReport';
import { runExecutionParity, PARITY_TRACE_CASES } from '../../../scripts/sim/grifballExecutionParity';
import type { SuitePlan } from './types';
const code = { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] };
async function fixture(matches = false) {
  const m = createSuiteManifest(matches ? 'standard' : 'quick');
  m.cases = m.cases.filter(c => matches ? c.roster === 'scripted-4v4' : c.scenario === 'pickup').slice(0, 1);
  Object.assign(m.cases[0], { seeds: [101, 102, 103], mirrored: true, opponents: ['balanced', 'patient', 'aggressive'] });
  if (matches) { m.quality = { primaryMeasure: 'goalMargin', minIndependentSeeds: 3, minEffect: .25, heldOut: true }; m.candidate.defaults.styleAggression = .7; }
  return createSuitePlan(m, code);
}
function results(plan: SuitePlan): TrialResult[] {
  return plan.jobs.map(j => {
    const metrics = { blue: emptyTeamEvaluation(), red: emptyTeamEvaluation() };
    for (const team of ['blue', 'red'] as const) Object.assign(metrics[team], { goals: 1, possessions: 10, completedPossessions: 10,
      pressuredCarrierSeconds: 20, relevantBotSeconds: 20, assignedBotSeconds: 60 });
    if (j.variant === 'candidate') metrics[j.focalTeam].goals += 2;
    const termination = plan.cases[0].specification.mode === 'match' ? 'match-end' : 'scenario-complete';
    return { jobId: j.id, termination, check: trialCheck(j.id, termination, 'fixture'), start: null,
      end: { tick: 300, phase: 'playing', round: 1, scores: { blue: 0, red: 0 }, clock: 0, holder: null, ballState: 'idle', alive: [] },
      trace: [], droppedTraceEntries: 0, metrics, simulationCost: { samples: 300, meanMs: 1, maxMs: 2 },
      deterministic: { version: 1, algorithm: 'sha256-pages-v1', ticks: 301, hash: 'a'.repeat(64), error: null },
      behavior: { version: 1, ticks: 300, pickups: 1, throws: 1, recoveries: 1, respawns: 1, goals: { blue: 0, red: 0 }, roleReleases: 1, staleRoleTicks: 0 } };
  });
}
const protocol: GateProtocol = { version: 1, quality: { tuningSeeds: [1, 2], tuningMapIds: ['tuning-map'] },
  performance: { calibrationId: 'pilot-1', environmentHash: 'c'.repeat(64), controlledSerial: true, maxBaselineRatio: 1.2, maxNoiseRatio: 3, minRefreshSamples: 20 } };
const passedNull = { id: 'reproducibility', state: 'completed', verdict: 'pass', summary: 'control', evidence: ['null-control'] } as const;

test('deterministic trace catches intermediate state changes, orders object keys, and rejects non-finite numbers', async () => {
  const run = async (changed: boolean, reversed = false) => {
    const trace = new DeterministicTrace();
    for (let i = 0; i < 121; i++) trace.add(reversed ? { y: 1, x: changed && i === 60 ? 2 : i } : { x: changed && i === 60 ? 2 : i, y: 1 });
    return trace.finish();
  };
  assert.deepEqual(await run(false), await run(false, true)); assert.notEqual((await run(false)).hash, (await run(true)).hash);
  assert.throws(() => new DeterministicTrace().add({ x: NaN }), /finite/);
});
test('correctness fails known-bad pickup, illegal lifecycle and stale-role fixtures; missing results cannot pass', async () => {
  const p = await fixture(), r = results(p);
  assert.equal(correctnessGate(p, r).check.verdict, 'pass');
  r[0].behavior!.pickups = 0; assert.equal(correctnessGate(p, r).check.verdict, 'fail'); r[0].behavior!.pickups = 1;
  r[0].behavior!.staleRoleTicks = 1; assert.equal(correctnessGate(p, r).check.verdict, 'fail'); r[0].behavior!.staleRoleTicks = 0;
  assert.equal(correctnessGate(p, r.slice(1)).check.verdict, 'inconclusive');
  r[0].termination = 'invalid-state'; r[0].check = trialCheck(r[0].jobId, 'invalid-state', 'dead holder');
  assert.equal(correctnessGate(p, r).check.verdict, 'fail');
});
test('repeatability ignores timings, requires every pair and a pinned runtime, and detects hidden state divergence', async () => {
  const p = await fixture(), r = results(p);
  for (const item of r) item.metrics = structuredClone(r[0].metrics);
  r[1].simulationCost.maxMs = 99;
  assert.equal(reproducibilityGate(p, r, true).check.verdict, 'pass');
  assert.equal(reproducibilityGate(p, r, false).check.verdict, 'inconclusive');
  assert.equal(reproducibilityGate(p, r.slice(1), true).check.verdict, 'inconclusive');
  r[1].deterministic!.hash = 'f'.repeat(64); assert.equal(reproducibilityGate(p, r, true).check.verdict, 'fail');
  r[1].check = trialCheck(r[1].jobId, 'setup-error', 'blocked renderer'); r[1].termination = 'setup-error';
  assert.equal(reproducibilityGate(p, r, true).check.verdict, 'fail');
});
test('different configs require a frozen null control with the same maps, mechanics, seeds and source', async () => {
  const p = await fixture(true), control = await createNullControlPlan(p);
  assert.notEqual(control.id, p.id); assert.deepEqual(control.manifest.baseline, control.manifest.candidate);
  assert.deepEqual(control.manifest.cases, p.manifest.cases); assert.deepEqual(control.code, p.code);
  assert.equal(reproducibilityGate(p, results(p), true).check.verdict, 'inconclusive');
});
test('quality clusters mirrored/style legs within seeds and reports each stratum', async () => {
  const p = await fixture(true), r = results(p), g = qualityGate(p, r, { ...passedNull, evidence: [...passedNull.evidence] }, protocol);
  assert.equal(g.check.verdict, 'pass');
  const d = g.details as any; assert.equal(d.estimate.seeds, 3); assert.equal(d.estimate.pairedRuns, 18);
  assert.equal(d.strata.length, 3); assert.equal(d.estimate.mean, 2); assert.equal(d.completion.fraction, 1);
  for (const item of r) item.metrics = { blue: { ...item.metrics!.blue, goals: 1 }, red: { ...item.metrics!.red, goals: 1 } };
  assert.equal(qualityGate(p, r, { ...passedNull, evidence: [...passedNull.evidence] }, protocol).check.verdict, 'inconclusive');
  for (const [i, item] of r.entries()) if (p.jobs[i].variant === 'baseline') item.metrics![p.jobs[i].focalTeam].goals += 2;
  assert.equal(qualityGate(p, r, { ...passedNull, evidence: [...passedNull.evidence] }, protocol).check.verdict, 'fail');
});
test('quality rejects censoring, absent pairs/opportunities, tuning overlap and failed null checks', async () => {
  const p = await fixture(true), check = { ...passedNull, evidence: [...passedNull.evidence] };
  for (const mutate of [(r: TrialResult[]) => { r.pop(); }, (r: TrialResult[]) => { r[0].termination = 'simulation-cap'; },
    (r: TrialResult[]) => { r[0].metrics!.blue.completedPossessions = 0; }]) {
    const r = results(p); mutate(r); assert.equal(qualityGate(p, r, check, protocol).check.verdict, 'inconclusive');
  }
  assert.equal(qualityGate(p, results(p), check).check.verdict, 'inconclusive');
  assert.equal(qualityGate(p, results(p), { ...check, verdict: 'fail' }, protocol).check.verdict, 'inconclusive');
  assert.equal(qualityGate(p, results(p), check, { ...protocol, quality: { tuningSeeds: [101], tuningMapIds: [] } }).check.verdict, 'inconclusive');
  const r = results(p); r[0].termination = 'simulation-cap';
  assert.equal((qualityGate(p, r, check, protocol).details as any).completion.fraction, (r.length - 1) / r.length);
});
test('performance enforces calibration, absolute/paired budgets and rejects noise before making speed claims', async () => {
  const original = await fixture();
  const p = await createSuitePlan({ ...original.manifest, performance: { plannerRefreshP95Ms: 4, calibrationId: 'pilot-1' } }, code);
  const r = results(p), env = 'c'.repeat(64);
  for (const item of r) { const timing = new LiveTimings(); timing.tick = 200; for (let i = 0; i < 30; i++) for (const channel of COST_CHANNELS) timing.record(channel, 2); item.timings = timing.finish(); }
  assert.equal(performanceGate(p, r, env, protocol).check.verdict, 'pass');
  assert.equal(performanceGate(p, r, 'd'.repeat(64), protocol).check.verdict, 'inconclusive');
  r[1].timings!.warm.plannerRefresh = { samples: 30, p50Ms: 5, p95Ms: 5, maxMs: 5 };
  assert.equal(performanceGate(p, r, env, protocol).check.verdict, 'fail');
  r[1].timings!.warm.plannerRefresh.maxMs = 100;
  assert.equal(performanceGate(p, r, env, protocol).check.verdict, 'inconclusive');
  assert.throws(() => validateGateProtocol({ ...protocol, performance: { ...protocol.performance, minRefreshSamples: 0 } }));
});
test('CLI gate evidence imports as a separate reference and survives re-export without merging into local results', async () => {
  const p = await fixture(), r = results(p);
  const imported = await importLabRun(JSON.stringify({ format: 'grifball-cli-run', version: 1, plan: p, results: r, createdAt: Date.now(), status: 'completed', error: null,
    identity: { buildId: 'fixture', code, browser: 'Chromium fixture' }, selectedJobIds: p.jobs.map(j => j.id), gates: [passedNull] }));
  assert.equal(imported.source, 'imported'); assert.equal(labRunReport(imported).gates.find(g => g.id === 'reproducibility')!.verdict, 'pass');
  const again = await importLabRun(JSON.stringify(imported)); assert.deepEqual(again.cliGates, imported.cliGates); assert.notEqual(again.id, imported.id);
  const history = await importLabRun(JSON.stringify({ ...imported, cliPreviousFailures: 1 }));
  assert.equal(labRunReport(history).automatedVerdict, 'fail');
});
test('corrected player traces agree while incomplete coverage and legacy differences remain explicit', async () => {
  const before = await fixture();
  const report = runExecutionParity(); assert.equal(report.check.verdict, 'inconclusive');
  const details = report.details as any;
  assert.deepEqual(await fixture(), before, 'parity must not mutate cached authored maps used by later plans');
  assert.equal(details.traces.length, PARITY_TRACE_CASES.length); assert.ok(details.gaps.length);
  assert.deepEqual(details.combatExecution, ['live-player-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1']);
  assert.ok(details.traces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.decisionIntegrationTraces.length, 24);
  assert.ok(details.decisionIntegrationTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-decision-integration'));
  assert.equal(details.decisionIntegrationTraces.reduce((sum: number, t: any) => sum + t.frames.length, 0), 11520);
  assert.equal(details.botTraces.length, 84);
  assert.ok(details.botTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.lungeTraces.length, 300);
  assert.ok(details.lungeTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.protocol, 'live-functions-vs-headless-step-v26');
  assert.equal(details.geometryTraces.length, 398);
  assert.ok(details.geometryTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.motionTraces.length, 216);
  assert.ok(details.motionTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.movingContactTraces.length, 224);
  assert.ok(details.movingContactTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.multiActorTraces.length, 192);
  assert.ok(details.multiActorTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.spawnTraces.length, 156);
  assert.ok(details.spawnTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.mixedContactTraces.length, 324);
  assert.ok(details.mixedContactTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.playerLungeTraces.length, 128);
  assert.ok(details.playerLungeTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.mixedLifecycleTraces.length, 168);
  assert.ok(details.mixedLifecycleTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.opposedFlightTraces.length, 128);
  assert.ok(details.opposedFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.objectiveTraces.length, 236);
  assert.ok(details.objectiveTraces.every((t: any) => t.differenceCount === 0 && t.boundary === 'objective-functions'));
  assert.equal(details.frameObjectiveTraces.length, 64);
  assert.ok(details.frameObjectiveTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.passInputTraces.length, 64);
  assert.ok(details.passInputTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.roundPlayerFlightTraces.length, 480);
  assert.ok(details.roundPlayerFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.roundFlightTraces.length, 480);
  assert.ok(details.roundFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.roundCombatTraces.length, 720);
  assert.ok(details.roundCombatTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.roundFrameTraces.length, 80);
  assert.ok(details.roundFrameTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.runnerCombatTraces.length, 576);
  assert.ok(details.runnerCombatTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.carrierRecoveryTraces.length, 384);
  assert.ok(details.carrierRecoveryTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.carrierCrowdTraces.length, 384);
  assert.ok(details.carrierCrowdTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.chargeCombatTraces.length, 208);
  assert.ok(details.chargeCombatTraces.every((t: any) => t.differenceCount === 0));
  assert.ok(details.priorPlayerCompatibility.differenceCount > 0);
  assert.ok(details.priorRosterCompatibility.differenceCount > 0);
  for (const name of ['sword-hit-recovery', 'punch-hit-recovery']) {
    const trace = details.legacyCompatibility.find((t: any) => t.name === name); assert.ok(trace.differenceCount > 0); assert.equal(trace.frames.length, 240); assert.ok(trace.differences.length <= 64);
  }
});


test('inactive phase resets cannot inflate warm active planner refresh samples', () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  const timing = new LiveTimings(); timing.tick = 200; liveTimings.set(state, timing);
  for (const phase of ['countdown', 'scored', 'matchEnd'] as const) {
    state.grifball.phase = phase;
    for (let i = 0; i < 30; i++) updateGrifballTeamPlanForState(state, 1 / 60, () => ({ x: 40, z: 0 }));
  }
  assert.equal(timing.finish().warm.plannerRefresh.samples, 0);
  assert.equal(timing.finish().warm.plannerBetween.samples, 90);
  liveTimings.delete(state);
});
