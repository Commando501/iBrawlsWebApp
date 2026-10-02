import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_MATCH_CASES, completeMatchKey, completeMatchInputs, completeMatchCoverage,
  completeMatchFrame, compareCompleteMatchFrame, runCompleteMatchTrace, type CompleteMatchTrace } from './grifballCompleteMatchParity';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { createComposedValidationMatch } from './grifballComposedMatch';

// Full positive gameplay coverage runs once in the aggregate execution-parity
// test, which also publishes it for the CLI. These are contract/negative controls.
async function metadataFixture() {
  return Promise.all(COMPLETE_MATCH_CASES.map(async variant => {
    const input = structuredClone(await completeMatchInputs(variant));
    return { protocol: 'autonomous-complete-match-v1', name: completeMatchKey(variant), input,
      ticks: 300, frameCount: 301, goals: 2, resets: 1, kills: 1, revivals: 1,
      termination: 'match-end', verdict: 'pass', runtimeCheck: { id: input.job.id, state: 'completed', verdict: 'pass', summary: 'synthetic metadata', evidence: [] }, endTick: 300, phase: 'matchEnd', differenceCount: 0, differences: [],
      continuations: ['initial', 'countdown', 'first-kill', 'round-reset-1'].map((reason, i) =>
        ({ reason, startTick: i * 60, verifiedTicks: 30 })),
      frames: [{ tick: 0 }, { tick: 300 }], frameEvidence: { kind: 'sampled-frames-v1', retainedCount: 2,
        fullTraceSHA256: 'a'.repeat(64), encoding: 'synthetic metadata control' } } as CompleteMatchTrace;
  }));
}

test('required complete-match inventory rejects missing, duplicate and foreign metadata', async () => {
  const traces = await metadataFixture();
  assert.deepEqual(completeMatchCoverage(traces), { required: 20, completed: 20, errors: [] });
  assert.ok(completeMatchCoverage(traces.slice(1)).errors.some(e => e.includes('missing case')), 'missing case');
  assert.ok(completeMatchCoverage([...traces, traces[0]]).errors.some(e => e.includes('duplicate')), 'duplicate case');
  traces[0].name = 'foreign';
  assert.ok(completeMatchCoverage(traces).errors.some(e => e.includes('foreign')), 'foreign case');
});

for (const defect of ['cap', 'divergence', 'stripped-difference-count', 'replay', 'replay-interval', 'missing-replay',
  'kill', 'revival', 'reset', 'goal', 'nonfinite', 'frames', 'seed', 'opponent', 'frozen-seeds', 'frozen-opponents', 'horizon', 'input', 'terminal-tick', 'runtime', 'sample', 'hash'] as const)
  test(`complete-match coverage rejects ${defect}`, async () => {
    const traces = await metadataFixture(), trace = traces[0];
    if (defect === 'runtime') trace.runtimeCheck = null;
    if (defect === 'sample') trace.frames.pop();
    if (defect === 'hash') trace.frameEvidence.fullTraceSHA256 = 'bad';
    if (defect === 'cap') trace.termination = 'simulation-cap';
    if (defect === 'divergence') trace.differenceCount = 1;
    if (defect === 'stripped-difference-count') trace.differences.push({ tick: 20, field: 'HP', live: 1, headless: 0 });
    if (defect === 'replay') trace.continuations[0].verifiedTicks = 29;
    if (defect === 'replay-interval') trace.continuations[0].startTick = 299;
    if (defect === 'missing-replay') trace.continuations.pop();
    if (defect === 'kill') trace.kills = 0;
    if (defect === 'revival') trace.revivals = 0;
    if (defect === 'reset') trace.resets = 0;
    if (defect === 'goal') trace.goals = 1;
    if (defect === 'nonfinite') trace.goals = NaN;
    if (defect === 'frames') trace.frameCount--;
    if (defect === 'seed') trace.input.job.seed++;
    if (defect === 'opponent') trace.input.job.opponent = 'patient';
    if (defect === 'frozen-seeds') trace.input.fixture.specification.seeds.push(999);
    if (defect === 'frozen-opponents') trace.input.fixture.specification.opponents.push('patient');
    if (defect === 'horizon') trace.input.job.simulationTicks++;
    if (defect === 'input') trace.input.job.inputHash = 'foreign';
    if (defect === 'terminal-tick') trace.endTick!--;
    assert.ok(completeMatchCoverage(traces).errors.length > 0, defect);
  });

test('complete matches cover all supplied goal maps and bounded configuration variants in both mirrors', async () => {
  assert.equal(COMPLETE_MATCH_CASES.length, 20);
  assert.equal(new Set(COMPLETE_MATCH_CASES.map(completeMatchKey)).size, 20);
  assert.deepEqual([...new Set(COMPLETE_MATCH_CASES.map(v => v.difficulty))].sort(), ['easy', 'hard', 'nightmare', 'normal']);
  assert.deepEqual([...new Set(COMPLETE_MATCH_CASES.map(v => v.opponent ?? 'balanced'))].sort(), ['aggressive', 'balanced', 'patient']);
  assert.deepEqual([...new Set(COMPLETE_MATCH_CASES.map(v => v.seed ?? 101))].sort(), [101, 102, 103, 104]);
  for (const mapId of ['championship_stadium', 'forerunner_canyon', 'synthwave_grid_arena', 'rainy_industrial_streets', 'winter_glacier_rink'])
    for (const mirrored of [false, true]) assert.ok(COMPLETE_MATCH_CASES.some(v =>
      v.mapId === mapId && v.roster === 'scripted-4v4' && v.difficulty === 'normal' && v.mirrored === mirrored), `${mapId}/${mirrored}`);
  for (const variant of COMPLETE_MATCH_CASES) {
    assert.ok(COMPLETE_MATCH_CASES.some(v => completeMatchKey(v) === completeMatchKey({ ...variant, mirrored: !variant.mirrored })));
    const { fixture, job } = await completeMatchInputs(variant);
    assert.equal(job.seed, variant.seed ?? 101); assert.equal(job.opponent, variant.opponent ?? 'balanced');
    assert.deepEqual(fixture.specification.seeds, [job.seed]); assert.deepEqual(fixture.specification.opponents, [job.opponent]);
    assert.equal(fixture.specification.roster, variant.roster); assert.equal(fixture.specification.difficulty, variant.difficulty);
    assert.equal(job.focalTeam, variant.mirrored ? 'red' : 'blue');
    const rival = job.config.teams[variant.mirrored ? 'blue' : 'red']!;
    assert.equal(rival.adaptationEnabled, false);
    assert.equal(rival.styleAggression, job.opponent === 'aggressive' ? .85 : job.opponent === 'patient' ? .2 : .5);
    assert.equal(rival.stylePatience, job.opponent === 'aggressive' ? .2 : job.opponent === 'patient' ? .8 : .5);
  }
});

for (const mirrored of [false, true]) test(`local start and a real simulation cap stay explicit ${mirrored}`, async () => {
  const variant = COMPLETE_MATCH_CASES.find(v => v.roster === 'local-4v4' && v.mirrored === mirrored)!;
  const { fixture, job } = await completeMatchInputs(variant), host = createAutonomousValidationRuntime(fixture, job);
  const { checkpoint } = createComposedValidationMatch(fixture, job);
  try {
    const frame = completeMatchFrame(host, checkpoint);
    assert.deepEqual(compareCompleteMatchFrame(frame), []);
    assert.equal(frame.headless.actors[0].shield, 0, 'initial local player has no respawn shield');
    for (const field of ['hp', 'kills', 'shield', 'weaponPhase', 'alive'] as const) {
      const bad = structuredClone(frame);
      const actor = bad.headless.actors[0];
      if (field === 'weaponPhase') actor.weaponPhase = 'recovering';
      else if (field === 'alive') actor.alive = !actor.alive;
      else actor[field] += 1;
      assert.ok(compareCompleteMatchFrame(bad).some(d => d.field.endsWith('.' + field)), field);
    }
    const nonfinite = structuredClone(frame); nonfinite.headless.actors[0].pos.x = NaN;
    assert.ok(compareCompleteMatchFrame(nonfinite).length > 0, 'nonfinite state');
  } finally { host.runtime.dispose(); }
  const trace = await runCompleteMatchTrace(fixture, { ...job, simulationTicks: 2 });
  assert.equal(trace.termination, 'simulation-cap'); assert.equal(trace.ticks, 2);
  assert.equal(trace.frameCount, 3); assert.equal(trace.differenceCount, 0);
  assert.ok(completeMatchCoverage([trace]).errors.length > 0, 'a cap cannot satisfy complete-match coverage');
});
