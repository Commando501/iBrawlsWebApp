import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from './profiles';
import { createSuitePlan } from './plan';
import { correctnessGate, reproducibilityGate } from './gates';
import { trialCheck, type TrialResult } from './runner';
import { LOCAL_INPUT_PROTOCOL } from './localPlayerInput';

async function fixture() {
  const manifest = createSuiteManifest('standard');
  manifest.cases = [{ ...manifest.cases.find(c => c.roster === 'scripted-3v4')!, roster: 'local-4v4', seeds: [101], opponents: ['balanced'] }];
  manifest.candidate = structuredClone(manifest.baseline);
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  const results: TrialResult[] = plan.jobs.map(job => ({ jobId: job.id, termination: 'match-end',
    check: trialCheck(job.id, 'match-end', 'test evidence'),
    start: { tick: 0, phase: 'countdown', round: 1, scores: { blue: 0, red: 0 }, clock: 500, holder: null, ballState: 'idle', alive: ['player'] },
    end: { tick: 300, phase: 'matchEnd', round: 1, scores: { blue: 1, red: 1 }, clock: 495, holder: null, ballState: 'idle', alive: ['player'] },
    trace: [], droppedTraceEntries: 0, metrics: null, simulationCost: { samples: 300, meanMs: 1, maxMs: 2 },
    behavior: { version: 1, ticks: 300, pickups: 2, throws: 0, recoveries: 0, respawns: 1, goals: { blue: 1, red: 1 }, roleReleases: 0, staleRoleTicks: 0 },
    deterministic: { version: 1, algorithm: 'sha256-pages-v1', ticks: 301, hash: 'a'.repeat(64), error: null },
    localPlayer: { protocol: LOCAL_INPUT_PROTOCOL, inputTicks: 300, movementRequests: 200, attackRequests: 10, attackStarts: 3,
      pickupRequests: 15, distanceMoved: 12.5, possessions: 1, carrierTicks: 50, kills: 1, deaths: 1, respawns: 1, goals: 1 } }));
  return { plan, results };
}

test('mixed correctness and exact replay accept coherent local observations', async () => {
  const { plan, results } = await fixture();
  assert.equal(correctnessGate(plan, results).check.verdict, 'pass');
  assert.equal(reproducibilityGate(plan, results, true).check.verdict, 'pass');
});

test('missing local evidence cannot pass mixed correctness or replay even with matching hashes', async () => {
  const { plan, results } = await fixture(); delete results[0].localPlayer;
  assert.equal(correctnessGate(plan, results).check.verdict, 'inconclusive');
  assert.equal(reproducibilityGate(plan, results, true).check.verdict, 'inconclusive');
});

test('mixed correctness rejects impossible input, lifecycle, possession and scoring observations', async () => {
  const { plan, results } = await fixture();
  for (const patch of [{ inputTicks: 299 }, { movementRequests: 301 }, { attackStarts: 11 }, { possessions: 3 },
    { goals: 2 }, { respawns: 2 }, { deaths: -1 }, { distanceMoved: NaN }, { protocol: 'unknown' }]) {
    const altered = structuredClone(results); Object.assign(altered[0].localPlayer!, patch);
    assert.equal(correctnessGate(plan, altered).check.verdict, 'fail', JSON.stringify(patch));
  }
  const altered = structuredClone(results); altered[0].start!.alive = [];
  assert.equal(correctnessGate(plan, altered).check.verdict, 'fail');
});

test('mixed replay compares local outcomes as well as deterministic state hashes', async () => {
  const { plan, results } = await fixture(); results[1].localPlayer!.distanceMoved += .01;
  assert.equal(reproducibilityGate(plan, results, true).check.verdict, 'fail');
});

test('malformed local evidence cannot pass identical replay controls', async () => {
  const { plan, results } = await fixture();
  for (const result of results) result.localPlayer!.attackStarts = 11;
  assert.equal(reproducibilityGate(plan, results, true).check.verdict, 'fail');
});
