import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationJobs, EVALUATION_STYLES } from '../grifballEvaluation';
import { PREMADE_MAPS } from '../premadeMaps';
import { toGrifballArena } from '../grifballMaps';
import { getGoalPlates } from '../grifballGoals';
import { buildGrifballSpaceGeometry, createSpaceRouter, isSpacePointOpen, isSpaceSegmentOpen } from '../grifballSpaceGeometry';
import { createValidationMap, RESERVED_VALIDATION_MAPS } from './maps';
import { resolveMatchConfig } from '../grifballMatch';
import { canonicalJSON, createSuitePlan, hashInput } from './plan';
import { createSuiteManifest } from './profiles';
import { validateManifest } from './manifest';
import { aggregateSuiteReport } from './report';
import { GATES, type CheckResult, type CodeIdentity, type SuiteEvidence, type SuiteManifest, type SuitePlan } from './types';

const code: CodeIdentity = { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src', 'scripts/sim'] };
function small(): SuiteManifest {
  const m = createSuiteManifest('quick');
  m.cases = [m.cases[0]];
  return m;
}
const pass = (id: string): CheckResult => ({ id, state: 'completed', verdict: 'pass', summary: 'Checked fixture.', evidence: ['fixture.json'] });
const complete = (p: SuitePlan): SuiteEvidence => ({ planId: p.id, jobs: p.jobs.map(j => pass(j.id)), gates: p.manifest.requiredGates.map(pass) });

test('quick and standard previews count the exact jobs, ticks, rosters and watchdogs', async () => {
  for (const profile of ['quick', 'standard'] as const) {
    const plan = await createSuitePlan(createSuiteManifest(profile), code);
    assert.equal(plan.preview.jobCount, profile === 'quick' ? 32 : 184);
    assert.equal(plan.preview.caseCount, profile === 'quick' ? 4 : 23);
    assert.equal(plan.preview.maxSimulationSeconds, profile === 'quick' ? 160 : 5280);
    assert.equal(plan.preview.maxSimulationSeconds, plan.jobs.reduce((s, j) => s + j.simulationTicks / 60, 0));
    assert.equal(plan.preview.maxJobWatchdogSeconds, plan.jobs.reduce((s, j) => s + j.watchdogSeconds, 0));
    assert.equal(new Set(plan.jobs.map(j => j.id)).size, plan.jobs.length);
    for (const c of plan.cases) {
      const roster = c.specification.roster;
      assert.equal(c.roster.length, roster === 'scripted-1v1' ? 2 : roster === 'scripted-4v4' ? 8 : 7);
      assert.equal(c.observer, 'outside-roster');
      assert.ok(c.roster.every(actor => actor.owner === 'scripted' && actor.slot.modelType === 'medium'));
      assert.ok(c.roster.every(actor => actor.effectiveKnobs.difficulty === c.specification.difficulty));
    }
  }
});

test('scheduling is canonical across input ordering and uses existing mirrored pairing', async () => {
  const m = small(); m.cases[0].opponents = ['aggressive', 'balanced', 'patient']; m.cases[0].seeds = [0xffffffff, 0];
  const p = await createSuitePlan(m, code);
  m.cases[0].seeds.reverse(); m.cases[0].opponents.reverse();
  assert.deepEqual(await createSuitePlan(m, code), p);
  const expected = createEvaluationJobs({ scenario: 'pickup', seed: 0, seeds: 1, seconds: 1,
    opponents: [...EVALUATION_STYLES], mirrored: true, baseline: m.baseline, candidate: m.candidate });
  assert.deepEqual(p.jobs.slice(0, expected.length).map(({ id, caseId, inputHash, simulationTicks, watchdogSeconds, ...job }) => job), expected);
  assert.deepEqual(p.jobs.slice(0, 4).map(j => [j.variant, j.focalTeam]),
    [['baseline', 'blue'], ['candidate', 'blue'], ['baseline', 'red'], ['candidate', 'red']]);
  const standard = createSuiteManifest('standard');
  const first = await createSuitePlan(standard, code); standard.cases.reverse();
  assert.equal((await createSuitePlan(standard, code)).id, first.id);
});

test('copies inputs before async hashing, deep freezes results, and leaves map globals editable', async () => {
  const m = small(), identity = structuredClone(code), original = structuredClone(m);
  const promise = createSuitePlan(m, identity);
  m.baseline.defaults.styleAggression = 0.91; m.cases[0].seeds.push(99); identity.scope.push('changed');
  const p = await promise;
  assert.deepEqual(p.manifest, validateManifest(original));
  assert.deepEqual(p.code.scope, [...code.scope].sort());
  assert.throws(() => { p.jobs[0].config.defaults.styleAggression = 0.11; }, TypeError);
  assert.throws(() => { p.cases[0].map.spawnPoints[0].x = 400; }, TypeError);
  assert.throws(() => { p.cases[0].roster.pop(); }, TypeError);
  assert.equal(Object.isFrozen(PREMADE_MAPS.find(m => m.id === 'championship_stadium')), false);
});

test('mechanic overrides resolve into the real gameplay contract', async () => {
  const m = small();
  Object.assign(m.mechanics, { goalTarget: 7, countdownSeconds: 2, roundResetSeconds: 1, allowThrowing: false, allowRunnerThrust: false });
  m.cases[0].difficulty = 'nightmare';
  const c = (await createSuitePlan(m, code)).cases[0];
  const config = resolveMatchConfig(c.mechanics);
  assert.equal(config.goalTarget, 7); assert.equal(config.countdownDuration, 2); assert.equal(config.roundResetDelay, 1);
  assert.equal(c.mechanics.grifballAllowThrowing, false); assert.equal(c.mechanics.grifballAllowRunnerThrust, false);
  assert.equal(c.roster[0].effectiveKnobs.reactionLatency, 0.02);
  assert.equal(c.mechanics.visualModelPolicy, 'v2');
  assert.ok(!('playerName' in c.mechanics));
});

test('reserved evaluation layouts have distinct symmetric obstacles and reachable objectives', async () => {
  const geometries = new Set(['championship_stadium', 'forerunner_canyon'].map(id => {
    const base = PREMADE_MAPS.find(map => map.id === id)!;
    return buildGrifballSpaceGeometry(toGrifballArena(base), base.arenaRadius).key;
  }));
  for (const mapId of RESERVED_VALIDATION_MAPS) {
    const manifest = small(); manifest.cases[0].mapId = mapId;
    const plan = await createSuitePlan(manifest, code), map = plan.cases[0].map;
    assert.equal(map.id, mapId);
    const geometry = buildGrifballSpaceGeometry(map, map.arenaRadius), goals = getGoalPlates(map);
    assert.equal(goals.length, 2);
    assert.equal(geometry.blockers.length, 4);
    assert.ok(!geometries.has(geometry.key)); geometries.add(geometry.key);
    assert.ok(isSpacePointOpen(geometry, { x: 0, z: 0 }));
    assert.equal(isSpaceSegmentOpen(geometry, goals[0].position, goals[1].position), false);
    for (const blocker of geometry.blockers)
      assert.ok(geometry.blockers.some(other => other.x === -blocker.x && other.z === -blocker.z &&
        other.kind === 'box' && blocker.kind === 'box' && other.hx === blocker.hx && other.hz === blocker.hz));
    for (const team of ['blue', 'red'] as const) {
      assert.equal(map.teamSpawns![team]!.length, 4);
      const goal = goals.find(goal => goal.team !== team)!.position;
      for (const spawn of map.teamSpawns![team]!) {
        assert.ok(isSpacePointOpen(geometry, spawn));
        for (const destination of [{ x: 0, z: 0 }, goal]) {
          const route = createSpaceRouter(geometry, spawn)(destination);
          assert.notEqual(route.status, 'blocked', `${mapId}: ${team} spawn must reach objectives`);
          let from = spawn;
          for (const point of route.points) {
            assert.ok(isSpaceSegmentOpen(geometry, from, point));
            from = { ...point, y: 0 };
          }
        }
      }
    }
    assert.deepEqual(await createSuitePlan(JSON.parse(JSON.stringify(manifest)), code), plan);
  }
});

test('validation map construction is isolated and default profiles keep development maps', () => {
  for (const id of ['championship_stadium', 'forerunner_canyon'] as const) {
    const original = toGrifballArena(PREMADE_MAPS.find(map => map.id === id)!);
    assert.deepEqual(createValidationMap(id), original);
    const independent = createValidationMap(id); independent.objects.length = 0;
    assert.ok(original.objects.length > 0);
  }
  for (const id of RESERVED_VALIDATION_MAPS) {
    const a = createValidationMap(id), b = createValidationMap(id);
    a.objects[0].position.x = 999; a.teamSpawns!.blue![0].x = 999;
    assert.deepEqual(createValidationMap(id), b);
    assert.ok(!PREMADE_MAPS.some(map => map.id === id));
  }
  for (const profile of ['quick', 'standard'] as const)
    assert.ok(createSuiteManifest(profile).cases.every(c => c.mapId === 'championship_stadium' || c.mapId === 'forerunner_canyon'));
});

test('content identities change with mechanics, maps, difficulty, configs and dirty source', async () => {
  const m = small(), original = await createSuitePlan(m, code);
  for (const mutate of [
    (m: SuiteManifest) => { m.mechanics.goalTarget++; },
    (m: SuiteManifest) => { m.cases[0].mapId = 'forerunner_canyon'; },
    (m: SuiteManifest) => { m.cases[0].difficulty = 'hard'; },
    (m: SuiteManifest) => { m.candidate.defaults.styleAggression = 0.95; },
  ]) {
    const changed = structuredClone(m); mutate(changed);
    const next = await createSuitePlan(changed, code);
    assert.notEqual(next.id, original.id); assert.notEqual(next.jobs[0].id, original.jobs[0].id);
  }
  const dirty = await createSuitePlan(m, { ...code, dirty: true, workingTreeHash: 'c'.repeat(64) });
  assert.notEqual(dirty.id, original.id); assert.notEqual(dirty.jobs[0].id, original.jobs[0].id);
  assert.equal(dirty.cases[0].geometryHash, original.cases[0].geometryHash);
  await assert.rejects(createSuitePlan(m, { ...code, workingTreeHash: 'unknown' }), /fingerprint/);
  assert.equal(await hashInput({ b: 2, a: 1 }), await hashInput({ a: 1, b: 2 }));
  assert.throws(() => canonicalJSON({ value: NaN }), /non-finite/);
});

const badInputs: [string, (m: any) => void][] = [
  ['unknown version', m => { m.schemaVersion = 99; }],
  ['unknown profile version', m => { m.profileVersion = 99; }],
  ['unknown field', m => { m.cases[0].seed = 12; }],
  ['missing field', m => { delete m.cases[0].mirrored; }],
  ['duplicate case', m => { m.cases.push(structuredClone(m.cases[0])); }],
  ['unsafe case ID', m => { m.cases[0].id = '../escape'; }],
  ['empty cases', m => { m.cases = []; }],
  ['unknown map', m => { m.cases[0].mapId = 'saved-map'; }],
  ['unknown scenario', m => { m.cases[0].scenario = 'respawn'; }],
  ['scenario roster mismatch', m => { m.cases[0].roster = 'scripted-4v4'; }],
  ['match scenario mismatch', m => { m.cases[0].mode = 'match'; m.cases[0].roster = 'scripted-4v4'; }],
  ['neural ownership unsupported', m => { m.cases[0].difficulty = 'neural-net'; }],
  ['fractional seed', m => { m.cases[0].seeds = [1.1]; }],
  ['seed overflow', m => { m.cases[0].seeds = [0x100000000]; }],
  ['negative seed', m => { m.cases[0].seeds = [-1]; }],
  ['duplicate seed', m => { m.cases[0].seeds = [1, 1]; }],
  ['sparse seed list', m => { m.cases[0].seeds = Array(1); }],
  ['empty opponents', m => { m.cases[0].opponents = []; }],
  ['duplicate opponents', m => { m.cases[0].opponents = ['balanced', 'balanced']; }],
  ['invalid fixed tick', m => { m.cases[0].fixedHz = 0; }],
  ['nonfinite limit', m => { m.cases[0].simulationSeconds = Infinity; }],
  ['zero watchdog', m => { m.cases[0].watchdogSeconds = 0; }],
  ['fractional goal target', m => { m.mechanics.goalTarget = 0.5; }],
  ['string boolean', m => { m.mechanics.allowThrowing = 'false'; }],
  ['invalid tactics', m => { m.candidate.defaults.styleAggression = 20; }],
  ['required gate removed', m => { m.requiredGates = ['correctness']; }],
  ['historical build unsupported', m => { m.comparison = 'historical-build'; }],
];
for (const [name, mutate] of badInputs) test(`rejects malformed manifest: ${name}`, () => {
  const m = small(); mutate(m); assert.throws(() => validateManifest(m));
});

function acceptance(): SuiteManifest {
  const m = createSuiteManifest('standard'); m.profile = 'acceptance'; m.requiredGates = [...GATES];
  m.cases = m.cases.filter(c => c.mode === 'match');
  for (const c of m.cases) { c.opponents = [...EVALUATION_STYLES]; c.seeds = [90001, 90002]; }
  m.performance = { plannerRefreshP95Ms: 4, calibrationId: 'test-calibration-only' };
  m.quality = { primaryMeasure: 'goalMargin', minIndependentSeeds: 2, minEffect: 0.1, heldOut: true };
  return m;
}
test('acceptance requires predeclared budgets and complete mirrored seed/style scheduling', () => {
  assert.equal(validateManifest(acceptance()).profile, 'acceptance');
  for (const change of [
    (m: SuiteManifest) => { m.performance = null; },
    (m: SuiteManifest) => { m.quality = null; },
    (m: SuiteManifest) => { m.cases[0].seeds = [1]; },
    (m: SuiteManifest) => { m.cases[0].mirrored = false; },
    (m: SuiteManifest) => { m.cases[0].opponents = ['balanced']; },
  ]) { const m = acceptance(); change(m); assert.throws(() => validateManifest(m)); }
});

test('missing, partial, running, cancelled and failed evidence never aggregate to pass', async () => {
  const p = await createSuitePlan(small(), code), all = complete(p);
  const empty = aggregateSuiteReport(p, { planId: p.id, jobs: [], gates: [] });
  assert.equal(empty.verdict, 'not-run'); assert.equal(empty.jobs.length, p.jobs.length); assert.equal(empty.gates.length, GATES.length);
  const partial = structuredClone(all); partial.jobs.pop();
  assert.equal(aggregateSuiteReport(p, partial).verdict, 'inconclusive');
  for (const [state, verdict] of [['running', 'not-run'], ['cancelled', 'not-run'], ['completed', 'inconclusive'], ['error', 'fail'], ['completed', 'fail']] as const) {
    const e = structuredClone(all); Object.assign(e.jobs[0], { state, verdict, evidence: [] });
    assert.equal(aggregateSuiteReport(p, e).verdict, verdict === 'fail' ? 'fail' : 'inconclusive');
  }
  const missingGate = structuredClone(all); missingGate.gates.pop();
  assert.equal(aggregateSuiteReport(p, missingGate).verdict, 'inconclusive');
  const report = aggregateSuiteReport(p, all);
  assert.equal(report.verdict, 'pass'); assert.equal(report.repositoryVerdict, 'inconclusive');
  assert.equal(report.milestone7Verdict, 'inconclusive');
  assert.throws(() => report.jobs.pop(), TypeError);
});

test('reports reject foreign, duplicate, unknown or impossible evidence', async () => {
  const p = await createSuitePlan(small(), code);
  for (const mutate of [
    (e: SuiteEvidence) => { e.planId = 'wrong'; },
    (e: SuiteEvidence) => { e.jobs.push(e.jobs[0]); },
    (e: SuiteEvidence) => { e.jobs[0].id = 'unknown'; },
    (e: SuiteEvidence) => { e.gates[0].id = 'unknown'; },
    (e: SuiteEvidence) => { e.jobs[0].state = 'queued'; },
    (e: SuiteEvidence) => { e.jobs[0].state = 'cancelled'; },
    (e: SuiteEvidence) => { e.jobs[0].state = 'error'; },
    (e: SuiteEvidence) => { e.jobs[0].verdict = 'not-run'; },
    (e: SuiteEvidence) => { e.jobs[0].evidence = []; },
    (e: SuiteEvidence) => { e.jobs[0].evidence = Array(1); },
  ]) { const e = complete(p); mutate(e); assert.throws(() => aggregateSuiteReport(p, e)); }
});

test('acceptance keeps human review separate and repository failures visible', async () => {
  const p = await createSuitePlan(acceptance(), code), all = complete(p);
  assert.equal(aggregateSuiteReport(p, all).milestone7Verdict, 'pass');
  all.gates = all.gates.filter(g => g.id !== 'human-review');
  const pending = aggregateSuiteReport(p, all);
  assert.equal(pending.automatedVerdict, 'pass'); assert.equal(pending.verdict, 'inconclusive');
  assert.equal(pending.milestone7Verdict, 'inconclusive'); assert.deepEqual(pending.missingRequired, ['human-review']);
  Object.assign(all.gates.find(g => g.id === 'repository-tests')!, { verdict: 'fail', summary: 'Existing V3 failures remain.' });
  assert.equal(aggregateSuiteReport(p, all).repositoryVerdict, 'fail'); assert.equal(aggregateSuiteReport(p, all).verdict, 'fail');
});
