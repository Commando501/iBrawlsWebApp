import test from 'node:test';
import assert from 'node:assert/strict';
import { compactExecutionTrace, PARITY_FRAME_SAMPLE_LIMIT } from './grifballParityEvidence';
import { FOCUS_FIRE_CASES, runFocusFireTrace } from './grifballFocusFireParity';

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
