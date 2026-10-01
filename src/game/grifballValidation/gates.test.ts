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
import { writeParityEvidence } from '../../../scripts/sim/grifballValidationArtifacts';
import type { SuitePlan } from './types';
const code = { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] };
async function fixture(matches = false) {
  const m = createSuiteManifest(matches ? 'standard' : 'quick');
  m.cases = m.cases.filter(c => matches ? c.roster === 'scripted-4v4' : c.scenario === 'pickup').slice(0, 1);
  Object.assign(m.cases[0], { seeds: [101, 102, 103], mirrored: true, opponents: ['balanced', 'patient', 'aggressive'] });
  if (matches) {
    m.quality = { primaryMeasure: 'goalMargin', minIndependentSeeds: 3, minEffect: .25, heldOut: true };
    m.candidate.defaults.styleAggression = .7;
    m.cases.push({ ...structuredClone(m.cases[0]), id: 'second-map',
      mapId: m.cases[0].mapId === 'forerunner_canyon' ? 'championship_stadium' : 'forerunner_canyon' });
  }
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
  const d = g.details as any; assert.equal(d.estimate.seeds, 3); assert.equal(d.estimate.pairedRuns, 36);
  assert.equal(d.strata.length, 6); assert.equal(d.estimate.mean, 2); assert.equal(d.completion.fraction, 1);
  for (const item of r) item.metrics = { blue: { ...item.metrics!.blue, goals: 1 }, red: { ...item.metrics!.red, goals: 1 } };
  assert.equal(qualityGate(p, r, { ...passedNull, evidence: [...passedNull.evidence] }, protocol).check.verdict, 'inconclusive');
  for (const [i, item] of r.entries()) if (p.jobs[i].variant === 'baseline') item.metrics![p.jobs[i].focalTeam].goals += 2;
  assert.equal(qualityGate(p, r, { ...passedNull, evidence: [...passedNull.evidence] }, protocol).check.verdict, 'fail');
});

test('quality cannot infer generalization from a single map or repeated cases on that map', async () => {
  const p = await fixture(true), check = { ...passedNull, evidence: [...passedNull.evidence] };
  for (const duplicate of [false, true]) {
    const manifest = structuredClone(p.manifest);
    if (duplicate) manifest.cases[1].mapId = manifest.cases[0].mapId;
    else manifest.cases = manifest.cases.slice(0, 1);
    const singleMap = await createSuitePlan(manifest, code);
    const result = qualityGate(singleMap, results(singleMap), check, protocol);
    assert.equal(result.check.verdict, 'inconclusive');
    assert.match(result.check.summary, /two distinct maps/);
  }
});

for (const [label, deltas, verdict] of [
  ['confirmed regression', [-1, -1, -1], 'fail'],
  ['no improvement', [0, 0, 0], 'inconclusive'],
  ['uncertain positive mean', [-1, 1, 3], 'inconclusive'],
] as const) test(`quality rejects pooled wins hiding a stratum with ${label}`, async () => {
  const p = await fixture(true), r = results(p), check = { ...passedNull, evidence: [...passedNull.evidence] };
  for (const [i, job] of p.jobs.entries()) {
    if (job.caseId !== 'second-map' || job.opponent !== 'aggressive' || job.variant !== 'candidate') continue;
    const delta = deltas[job.seed - 101], rival = job.focalTeam === 'blue' ? 'red' : 'blue';
    r[i].metrics![job.focalTeam].goals = 1 + Math.max(0, delta);
    r[i].metrics![rival].goals = 1 + Math.max(0, -delta);
  }
  const result = qualityGate(p, r, check, protocol), details = result.details as any;
  assert.ok(details.estimate.low > p.manifest.quality!.minEffect, 'pooled estimate alone would pass');
  assert.equal(result.check.verdict, verdict);
  assert.match(result.check.summary, /second-map.*aggressive/);
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
  for (const item of r) { const timing = new LiveTimings(); timing.playingTicks = 200; for (let i = 0; i < 30; i++) for (const channel of COST_CHANNELS) timing.record(channel, 2); item.timings = timing.finish(); }
  assert.equal(performanceGate(p, r, env, protocol).check.verdict, 'pass');
  const current = r[0].timings!;
  r[0].timings = { version: 1, warmupTicks: 120, dropped: current.dropped, cold: current.cold, warm: current.warm };
  assert.equal(performanceGate(p, r, env, protocol).check.verdict, 'inconclusive', 'old countdown-based timings cannot certify warm cost');
  r[0].timings = current;
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
  const report = runExecutionParity();
  if (process.env.GRIFBALL_VALIDATION_PARITY_OUT) writeParityEvidence(process.env.GRIFBALL_VALIDATION_PARITY_OUT, report);
  assert.equal(report.check.verdict, 'inconclusive');
  const details = report.details as any;
  assert.deepEqual(await fixture(), before, 'parity must not mutate cached authored maps used by later plans');
  assert.equal(details.traces.length, PARITY_TRACE_CASES.length); assert.ok(details.gaps.length);
  assert.deepEqual(details.combatExecution, ['live-player-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1']);
  assert.ok(details.traces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.rosterMatchTraces.length, 32);
  assert.ok(details.rosterMatchTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-roster-match' && t.finalFrame.phase === 'matchEnd' && t.finalFrame.actors.length === t.scenario.teamSize * 2 && t.frameCount === Math.max(t.terminalTick, t.deaths.at(-1)?.tick ?? 0) + 181));
  assert.equal(new Set(details.rosterMatchTraces.map((t: any) => t.mapId)).size, 2);
  assert.equal(new Set(details.rosterMatchTraces.map((t: any) => t.scenario.teamSize)).size, 2);
  assert.ok(details.rosterMatchTraces.some((t: any) => t.passesAfterReset > 0));
  assert.equal(details.passRecoveryTraces.length, 32);
  assert.ok(details.passRecoveryTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-pass-recovery' && t.frameCount === 600));
  assert.equal(details.passRecoveryTraces.reduce((n: number, t: any) => n + t.frameCount, 0), 19200);
  assert.equal(details.passRecoveryTraces.filter((t: any) => t.initialRecovery.outcome === 'interception').length, 16);
  assert.equal(details.passRecoveryTraces.filter((t: any) => t.initialRecovery.outcome === 'reception').length, 16);
  assert.equal(details.earnedTankTraces.length, 32);
  assert.ok(details.earnedTankTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-earned-tank-contest' && t.frameCount === 300));
  assert.equal(details.earnedTankTraces.reduce((n: number, t: any) => n + t.frameCount, 0), 9600);
  assert.equal(new Set(details.earnedTankTraces.map((t: any) => t.scenario.opening)).size, 4);
  assert.equal(details.tankContestTraces.length, 64);
  assert.ok(details.tankContestTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-tank-contest' && t.frameCount === 300));
  assert.equal(details.tankContestTraces.reduce((n: number, t: any) => n + t.frameCount, 0), 19200);
  assert.equal(new Set(details.tankContestTraces.map((t: any) => t.scenario.opening)).size, 8);
  assert.equal(details.rosterContestTraces.length, 64);
  assert.ok(details.rosterContestTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-roster-contest' && t.frameCount === 1800 && t.finalFrame.actors.length === t.scenario.teamSize * 2));
  assert.equal(details.rosterContestTraces.reduce((n: number, t: any) => n + t.frameCount, 0), 115200);
  assert.equal(new Set(details.rosterContestTraces.map((t: any) => t.scenario.profile)).size, 4);
  assert.equal(new Set(details.rosterContestTraces.map((t: any) => t.scenario.teamSize)).size, 2);
  assert.equal(details.mapPassMatchTraces.length, 40);
  assert.ok(details.mapPassMatchTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-pass-match' && t.finalFrame.phase === 'matchEnd' && t.frameCount === t.ticks && t.ticks - t.terminalTick === 181 && t.passes.length > 0));
  assert.equal(new Set(details.mapPassMatchTraces.map((t: any) => t.mapId)).size, 5);
  for (const id of ['forerunner_canyon', 'synthwave_grid_arena', 'rainy_industrial_streets']) {
    assert.ok(details.mapPassMatchTraces.filter((t: any) => t.mapId === id).every((t: any) => t.passGeometry.blockedCandidateSamples > 0));
  }
  assert.equal(details.passMatchTraces.length, 48);
  assert.ok(details.passMatchTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-pass-match' && t.finalFrame.phase === 'matchEnd' && t.frameCount === t.ticks && t.ticks - t.terminalTick === 181));
  assert.equal(new Set(details.passMatchTraces.map((t: any) => t.scenario.seed)).size, 2);
  assert.ok(details.passMatchTraces.every((t: any) => t.scenario.opening === 'disabled' ? t.passes.length === 0
    : t.scenario.opening === 'clear' ? t.passes.length > 0 : t.cancellations.some((c: any) => c.elapsed > 0)));
  assert.equal(details.passContestTraces.length, 40);
  assert.ok(details.passContestTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-pass-contest'));
  assert.equal(details.passContestTraces.reduce((n: number, t: any) => n + t.frameCount, 0), 48000);
  assert.equal(new Set(details.passContestTraces.map((t: any) => t.scenario.opening)).size, 5);
  assert.equal(details.mapMatchTraces.length, 40);
  assert.ok(details.mapMatchTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-match' && t.finalFrame.phase === 'matchEnd' && t.frameCount === t.ticks && t.ticks - t.terminalTick === 181));
  assert.equal(new Set(details.mapMatchTraces.map((t: any) => t.mapId)).size, 5);
  assert.equal(details.mapContestTraces.length, 40);
  assert.ok(details.mapContestTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-contest' && t.carrierDeaths.length > 0 && t.revivals.length > 0));
  assert.equal(details.mapContestTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 72000);
  assert.equal(new Set(details.mapContestTraces.map((t: any) => t.mapId)).size, 5);
  assert.equal(details.mapRoutingTraces.length, 40);
  assert.ok(details.mapRoutingTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-routing' && t.goalTick > t.pickupTick && t.endTick > t.goalTick));
  assert.equal(details.mapRoutingTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 57600);
  assert.equal(new Set(details.mapRoutingTraces.map((t: any) => t.mapId)).size, 5);
  assert.equal(details.mapMobilityTraces.length, 92);
  assert.ok(details.mapMobilityTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-map-mobility' && t.landingTick > 0));
  assert.equal(details.mapMobilityTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 16560);
  assert.equal(new Set(details.mapMobilityTraces.map((t: any) => t.mapId)).size, 8);
  assert.equal(details.mobilityDecisionTraces.length, 32);
  assert.deepEqual(details.dashWitnesses.missing, []);
  assert.ok(details.dashWitnesses.groundedSteps > 0 && details.dashWitnesses.cancellations > 0);
  assert.ok(details.mobilityDecisionTraces.every((t: any) => t.dash.failureCount === 0 && t.dashEvidence.frameCount > 0));
  assert.ok(details.mobilityDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-mobility-decision-integration'));
  assert.equal(details.mobilityDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 115200);
  assert.equal(details.matchDecisionTraces.length, 24);
  assert.ok(details.matchDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-match-decision-integration'));
  assert.equal(details.matchDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 181920);
  assert.equal(details.roundDecisionTraces.length, 24);
  assert.ok(details.roundDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-round-decision-integration'));
  assert.equal(details.roundDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 8640);
  assert.equal(details.revivalDecisionTraces.length, 24);
  assert.ok(details.revivalDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-revival-decision-integration'));
  assert.ok(details.revivalDecisionTraces.every((t: any) => t.activity.failureCount === 0 &&
    t.activity.dash.failureCount === 0 && t.dashEvidence.frameCount > 0 && !('dashSamples' in t)));
  assert.ok(details.revivalDecisionTraces.every((t: any) => !t.activity.required ||
    t.activity.attacks.length > 0 || t.activity.defensiveDashes.length > 0));
  assert.ok(details.revivalDecisionTraces.some((t: any) => t.activity.required &&
    t.activity.attacks.length === 0 && t.activity.defensiveDashes.length > 0));
  assert.equal(details.revivalDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 14400);
  assert.equal(details.opposedDecisionTraces.length, 24);
  assert.ok(details.opposedDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-opposed-decision-integration'));
  assert.equal(details.opposedDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 3600);
  assert.equal(details.pressureDecisionTraces.length, 24);
  assert.ok(details.pressureDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-pressure-decision-integration'));
  assert.equal(details.pressureDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 4320);
  assert.equal(details.passDecisionTraces.length, 48);
  assert.ok(details.passDecisionTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-pass-decision-integration'));
  assert.equal(details.passDecisionTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 17280);
  assert.equal(details.decisionIntegrationTraces.length, 24);
  assert.ok(details.decisionIntegrationTraces.every((t: any) => t.failureCount === 0 && t.boundary === 'live-decision-integration'));
  assert.equal(details.decisionIntegrationTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 11520);
  assert.equal(details.botTraces.length, 84);
  assert.ok(details.botTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.lungeTraces.length, 300);
  assert.ok(details.lungeTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.protocol, 'live-functions-vs-headless-step-v67');
  assert.deepEqual(details.dashWitnesses.missing, []);
  assert.ok(details.dashWitnesses.airborneSteps > 0);
  assert.ok(details.dashWitnesses.airborneLandings > 0);
  assert.deepEqual(details.revivalAttackWitnesses.missing, []);
  assert.deepEqual(details.jumpWitnesses.mobility.missing, []);
  assert.deepEqual(details.jumpWitnesses.match.missing, []);
  assert.deepEqual(details.postResetPassCoverage.missing, []);
  assert.equal(details.geometryTraces.length, 398);
  assert.ok(details.geometryTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.motionTraces.length, 216);
  assert.ok(details.motionTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.movingContactTraces.length, 224);
  assert.ok(details.movingContactTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.multiActorTraces.length, 192);
  assert.ok(details.multiActorTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.mixedSpawnTraces.length, 156);
  assert.ok(details.mixedSpawnTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.spawnTraces.length, 156);
  assert.ok(details.spawnTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.mixedContactTraces.length, 324);
  assert.ok(details.mixedContactTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.playerLungeTraces.length, 184);
  assert.ok(details.playerLungeTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.mixedLifecycleTraces.length, 168);
  assert.ok(details.mixedLifecycleTraces.every((t: any) => t.differenceCount === 0));
  const sampledFamilies = Object.values(details).filter((value: any) => Array.isArray(value) && value[0]?.frameEvidence) as any[][];
  // Includes grounded/airborne pickup and mouse-turn flight families (v62-v64).
  assert.equal(sampledFamilies.length, 45);
  for (const traces of sampledFamilies) for (const trace of traces) {
    assert.ok(trace.frameCount >= trace.frames.length);
    assert.ok(trace.frames.length <= 32);
    assert.equal(trace.frameEvidence.retainedCount, trace.frames.length);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
  assert.equal(details.focusFireTraces.length, 152);
  assert.equal(details.focusFireTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 18240);
  assert.ok(details.focusFireTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.playerRunnerTraces.length, 864);
  assert.equal(details.playerRunnerTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 103680);
  assert.ok(details.playerRunnerTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.airborneFlightTraces.length, 512);
  assert.equal(details.airborneFlightTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 153600);
  assert.ok(details.airborneFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.shieldedFlightTraces.length, 384);
  assert.equal(details.shieldedFlightTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 115200);
  assert.ok(details.shieldedFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.opposedFlightTraces.length, 128);
  assert.equal(details.turningFlightTraces.length, 48);
  assert.equal(details.turningFlightTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 14400);
  assert.ok(details.turningFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.airborneCarrierFlightTraces.length, 64);
  assert.equal(details.airborneCarrierFlightTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 19200);
  assert.ok(details.airborneCarrierFlightTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.carrierFlightTraces.length, 32);
  assert.equal(details.carrierFlightTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 9600);
  assert.ok(details.carrierFlightTraces.every((t: any) => t.differenceCount === 0));
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
  assert.equal(details.airborneRunnerTraces.length, 384);
  assert.equal(details.airborneRunnerTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 46080);
  assert.ok(details.airborneRunnerTraces.every((t: any) => t.differenceCount === 0));
  assert.equal(details.fullRosterFrameTraces.length, 240);
  assert.equal(details.fullRosterFrameTraces.reduce((sum: number, t: any) => sum + t.frameCount, 0), 48000);
  assert.ok(details.fullRosterFrameTraces.every((t: any) => t.differenceCount === 0));
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
  const timing = new LiveTimings(); timing.playingTicks = 200; liveTimings.set(state, timing);
  for (const phase of ['countdown', 'scored', 'matchEnd'] as const) {
    state.grifball.phase = phase;
    for (let i = 0; i < 30; i++) updateGrifballTeamPlanForState(state, 1 / 60, () => ({ x: 40, z: 0 }));
  }
  assert.equal(timing.finish().warm.plannerRefresh.samples, 0);
  assert.equal(timing.finish().warm.plannerBetween.samples, 90);
  liveTimings.delete(state);
});
