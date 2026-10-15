import test from 'node:test';
import assert from 'node:assert/strict';
import { compactExecutionTrace, createParityFrameRecorder, PARITY_FRAME_SAMPLE_LIMIT, SAMPLED_PARITY_FAMILIES, validateSampledParityEvidence } from './grifballParityEvidence';
import { FOCUS_FIRE_CASES, runFocusFireTrace } from './grifballFocusFireParity';

function sampledReport(protocol: keyof typeof SAMPLED_PARITY_FAMILIES = 'live-functions-vs-headless-step-v75'): Record<string, any> {
  return { protocol, ...Object.fromEntries(SAMPLED_PARITY_FAMILIES[protocol].map(name =>
    [name, [compactExecutionTrace({ frames: [{ tick: 1 }, { tick: 2 }], differenceCount: 0 })]])) };
}

test('sampled report inventories distinguish the v74 and v75 additions', () => {
  const previous = sampledReport('live-functions-vs-headless-step-v74'), current = sampledReport();
  assert.equal(Object.keys(previous).length - 1, 46);
  assert.equal(Object.keys(current).length - 1, 47);
  assert.ok(previous.sampledContactTraces);
  assert.equal(previous.objectiveInputTraces, undefined);
  assert.ok(current.objectiveInputTraces);
  assert.deepEqual(validateSampledParityEvidence(previous), []);
  assert.deepEqual(validateSampledParityEvidence(current), []);
  previous.protocol = current.protocol;
  assert.deepEqual(validateSampledParityEvidence(previous), ['objectiveInputTraces: missing or empty family']);
});

test('v76 retains independent planned-match evidence without changing older inventories', () => {
  const previous = sampledReport(), current = sampledReport('live-functions-vs-headless-step-v76');
  assert.equal(previous.plannedMatchTraces, undefined);
  assert.equal(Object.keys(current).length - 1, 48);
  assert.deepEqual(validateSampledParityEvidence(current), []);
  previous.protocol = current.protocol;
  assert.deepEqual(validateSampledParityEvidence(previous), ['plannedMatchTraces: missing or empty family']);
});

test('v77 retains the sampled inventory while earned tank outcomes use their separate coverage contract', () => {
  const current=sampledReport('live-functions-vs-headless-step-v77');
  assert.equal(Object.keys(current).length-1,48);
  assert.deepEqual(SAMPLED_PARITY_FAMILIES[current.protocol as keyof typeof SAMPLED_PARITY_FAMILIES],
    SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v76']);
  assert.deepEqual(validateSampledParityEvidence(current),[]);
});

test('v80 retains the view family with a larger weapon coverage contract', () => {
  const current=sampledReport('live-functions-vs-headless-step-v80');
  assert.equal(Object.keys(current).length-1,50);
  assert.deepEqual(validateSampledParityEvidence(current),[]);
  assert.deepEqual(SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v80'],SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v79']);
});

test('v79 requires the airborne view geometry family', () => {
  const current=sampledReport('live-functions-vs-headless-step-v79');
  assert.equal(Object.keys(current).length-1,50);
  assert.deepEqual(validateSampledParityEvidence(current),[]);
  delete current.airborneViewTraces;
  assert.deepEqual(validateSampledParityEvidence(current),['airborneViewTraces: missing or empty family']);
});

test('v78 requires the separate controlled landing-turnover family', () => {
  const current=sampledReport('live-functions-vs-headless-step-v78');
  assert.equal(Object.keys(current).length-1,49);
  assert.deepEqual(validateSampledParityEvidence(current),[]);
  delete current.landingTurnoverTraces;
  assert.deepEqual(validateSampledParityEvidence(current),['landingTurnoverTraces: missing or empty family']);
});

for (const corruption of ['missing', 'empty', 'metadata', 'later-metadata', 'renamed', 'extra', 'count',
  'fractional-count', 'retained-count', 'hash', 'kind', 'no-frames', 'too-many-frames', 'truncated-count'] as const)
  test(`sampled report audit rejects ${corruption} without rerunning gameplay`, () => {
    const report = sampledReport(), name = 'sampledContactTraces';
    const trace = report[name][0];
    if (corruption === 'missing') delete report[name];
    if (corruption === 'empty') report[name] = [];
    if (corruption === 'metadata') delete trace.frameEvidence;
    if (corruption === 'later-metadata') report[name].push({ ...trace, frameEvidence: undefined });
    if (corruption === 'renamed') { report.replacementTraces = report[name]; delete report[name]; }
    if (corruption === 'extra') report.unregisteredTraces = report[name];
    if (corruption === 'count') trace.frameCount = NaN;
    if (corruption === 'fractional-count') trace.frameCount = 2.5;
    if (corruption === 'retained-count') trace.frameEvidence.retainedCount++;
    if (corruption === 'hash') trace.frameEvidence.fullTraceSHA256 = 'not-a-hash';
    if (corruption === 'kind') trace.frameEvidence.kind = 'unknown';
    if (corruption === 'no-frames') { trace.frames = []; trace.frameEvidence.retainedCount = 0; }
    if (corruption === 'too-many-frames') {
      trace.frames = Array.from({ length: 33 }, (_, tick) => ({ tick }));
      trace.frameCount = trace.frameEvidence.retainedCount = 33;
    }
    if (corruption === 'truncated-count') trace.frameCount = 1;
    const errors = validateSampledParityEvidence(report);
    assert.ok(errors.length > 0);
    assert.ok(errors.some(error => error.includes(corruption === 'extra' ? 'unregisteredTraces' : name)), errors.join('\n'));
  });

test('sampled report audit rejects unsupported versions and preserves diagnostic verdicts', () => {
  for (const value of [null, undefined, {}, { protocol: 'live-functions-vs-headless-step-v77' }, { protocol: 'toString' }])
    assert.ok(validateSampledParityEvidence(value).length > 0);
  const report = { check: { verdict: 'inconclusive' }, details: sampledReport() };
  report.details.legacyCompatibility = [{ frames: Array.from({ length: 240 }, (_, tick) => ({ tick })), differenceCount: 10 }];
  report.details.sampledContactTraces[0].differenceCount = 1;
  const before = structuredClone(report);
  // Evidence shape can be valid while gameplay disagrees: acceptance is separate.
  assert.deepEqual(validateSampledParityEvidence(report.details), []);
  assert.deepEqual(report, before);
});

test('compaction bounds retained frames without discarding failures or changing the full trace', () => {
  const source = { name: 'failure', differenceCount: 2, differences: [{ tick: 501, field: 'health' }, { tick: 701, field: 'ownership' }],
    frames: Array.from({ length: 1000 }, (_, i) => ({ tick: i + 1, health: i === 500 ? -1 : 1 })) };
  const before = structuredClone(source), compact = compactExecutionTrace(source);
  assert.deepEqual(source, before);
  assert.equal(compact.frameCount, 1000);
  assert.ok(compact.frames.length <= PARITY_FRAME_SAMPLE_LIMIT);
  assert.equal(compact.differenceCount, 2);
  assert.deepEqual(compact.differences, source.differences);
  const ticks = compact.frames.map((f: any) => f.tick);
  for (const tick of [1, 500, 501, 502, 700, 701, 702, 1000]) assert.ok(ticks.includes(tick));
  assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
  assert.deepEqual(JSON.parse(JSON.stringify(compact)), compact);
  const manyFailures = compactExecutionTrace({ ...source,
    differences: Array.from({ length: 64 }, (_, i) => ({ tick: 100 + i * 10, field: 'health' })) });
  assert.equal(manyFailures.frames.length, PARITY_FRAME_SAMPLE_LIMIT);
  assert.equal(manyFailures.differences.length, 64);
});

test('full-trace fingerprint detects changes outside retained samples and distinguishes special values', () => {
  const source = { frames: Array.from({ length: 100 }, (_, i) => ({ tick: i + 1, value: 1 })) };
  const first = compactExecutionTrace(source), retained = new Set(first.frames.map((f: any) => f.tick));
  const omitted = source.frames.find(f => !retained.has(f.tick))!;
  omitted.value = 2;
  const second = compactExecutionTrace(source);
  assert.deepEqual(second.frames, first.frames);
  assert.notEqual(second.frameEvidence.fullTraceSHA256, first.frameEvidence.fullTraceSHA256);
  const values = [0, -0, NaN, Infinity, -Infinity, undefined, null];
  const results = values.map(value => compactExecutionTrace({ frames: [{ tick: 1, value }] }));
  assert.equal(new Set(results.map(r => r.frameEvidence.fullTraceSHA256)).size, values.length);
  for (const result of results) assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual((results[1].frames[0] as any).value, { $number: '-0' });
  assert.deepEqual((results[5].frames[0] as any).value, { $undefined: true });
});

test('empty and short histories retain exact frame counts with stable fingerprints', () => {
  for (const length of [0, 1, 2, 31, 32]) {
    const source = { frames: Array.from({ length }, (_, tick) => ({ tick })) };
    const result = compactExecutionTrace(source);
    assert.equal(result.frameCount, length);
    assert.deepEqual(result.frames, source.frames);
    assert.deepEqual(compactExecutionTrace(source), result);
  }
});

test('real live/headless evidence retains health/credit results and can be reproduced in full', () => {
  const spec = FOCUS_FIRE_CASES.find(s => s.hp === 3 && s.runner.motion === 'retreat' && s.reverse && s.mirror)!;
  const full = runFocusFireTrace(spec), compact = compactExecutionTrace(full);
  assert.equal(full.differenceCount, 0);
  assert.equal(compact.differenceCount, 0);
  assert.equal(compact.frameCount, 120);
  assert.equal(compact.frames.length, 8);
  assert.equal((compact.frames.at(-1) as any).liveRunner.kills, 2);
  assert.deepEqual(compactExecutionTrace(runFocusFireTrace(spec)), compact);
});


for (const version of [81, 82, 83, 84]) test(`v${version} requires complete-match evidence without changing prior protocol inventories`, () => {
  const report = sampledReport(`live-functions-vs-headless-step-v${version}` as keyof typeof SAMPLED_PARITY_FAMILIES);
  assert.equal(Object.keys(report).length - 1, version >= 83 ? 52 : 51);
  assert.deepEqual(validateSampledParityEvidence(report), []);
  delete report.completeMatchTraces;
  assert.deepEqual(validateSampledParityEvidence(report), ['completeMatchTraces: missing or empty family']);
});

for (const version of [83,84]) test(`v${version} requires the autonomous mobility family`, () => {
  const report = sampledReport(`live-functions-vs-headless-step-v${version}` as keyof typeof SAMPLED_PARITY_FAMILIES);
  delete report.autonomousMobilityTraces;
  assert.deepEqual(validateSampledParityEvidence(report), ['autonomousMobilityTraces: missing or empty family']);
});

for (const count of [1, 31, 32, 1000, 54001]) test(`streamed parity evidence hashes every frame and retains bounded endpoints (${count})`, () => {
  const frames = Array.from({ length: count }, (_, tick) => ({ tick, value: tick % 2 ? -0 : tick, missing: undefined }));
  const recorder = createParityFrameRecorder();
  for (const frame of frames) recorder.add(frame);
  const actual = recorder.finish(), expected = compactExecutionTrace({ frames });
  assert.equal(actual.frameCount, count); assert.ok(actual.frames.length <= PARITY_FRAME_SAMPLE_LIMIT, 'bounded retention');
  assert.equal((actual.frames[0] as any).tick, 0); assert.equal((actual.frames.at(-1) as any).tick, count - 1);
  assert.equal(actual.frameEvidence.fullTraceSHA256, expected.frameEvidence.fullTraceSHA256);
  assert.throws(() => recorder.add({ tick: count }), /finished/);
  assert.throws(() => recorder.finish(), /unfinished/);
});

test('streaming trace hash detects an unsampled intermediate change', () => {
  const run = (changed: boolean) => { const recorder = createParityFrameRecorder();
    for (let tick = 0; tick < 1000; tick++) recorder.add({ tick, hp: changed && tick === 333 ? 0 : 1 });
    return recorder.finish(); };
  const first = run(false), second = run(true);
  assert.deepEqual(first.frames, second.frames);
  assert.notEqual(first.frameEvidence.fullTraceSHA256, second.frameEvidence.fullTraceSHA256);
  assert.throws(() => createParityFrameRecorder().finish(), /nonempty/);
});

test('v85 requires incoming sword recordings without removing earlier families', () => {
  const previous = SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v84'];
  assert.deepEqual(SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v85'], [...previous, 'incomingLungeMobilityTraces']);
  const current = sampledReport('live-functions-vs-headless-step-v85');
  assert.deepEqual(validateSampledParityEvidence(current), []);
  delete current.incomingLungeMobilityTraces;
  assert.deepEqual(validateSampledParityEvidence(current), ['incomingLungeMobilityTraces: missing or empty family']);
});

test('v86 retains every v85 family including incoming-sword recordings', () => {
  assert.deepEqual(SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v86'], SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v85']);
  const current = sampledReport('live-functions-vs-headless-step-v86');
  assert.deepEqual(validateSampledParityEvidence(current), []);
  delete current.incomingLungeMobilityTraces;
  assert.deepEqual(validateSampledParityEvidence(current), ['incomingLungeMobilityTraces: missing or empty family']);
});

test('v87 retains every family for the expanded matched mobility inventory', () => {
  assert.deepEqual(SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v87'], SAMPLED_PARITY_FAMILIES['live-functions-vs-headless-step-v86']);
  const current = sampledReport('live-functions-vs-headless-step-v87');
  assert.deepEqual(validateSampledParityEvidence(current), []);
  delete current.autonomousMobilityTraces;
  assert.deepEqual(validateSampledParityEvidence(current), ['autonomousMobilityTraces: missing or empty family']);
});
