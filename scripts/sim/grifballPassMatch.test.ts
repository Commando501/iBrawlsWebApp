import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_MATCH_CASES, runPassMatchTrace } from './grifballPassMatch';

for (const spec of PASS_MATCH_CASES) test(`passing match ${spec.opening}/${spec.seed}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runPassMatchTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.at(-1)!.phase, 'matchEnd');
  assert.equal(trace.ticks - trace.frames.find(f => f.phase === 'matchEnd')!.tick, 181);
  // These fixed examples explicitly exercise passing again after a reset.
  if (spec.opening === 'clear' && spec.seed === 17 && spec.main && !spec.reverse) assert.ok(trace.passesAfterReset > 0);
});

test('complete passing matches cover both seeds, teams, actor orders and carrier identities', () => {
  assert.equal(PASS_MATCH_CASES.length, 48);
  assert.equal(new Set(PASS_MATCH_CASES.map(s => `${s.opening}/${s.seed}/${s.team}/${s.reverse}/${s.main}`)).size, 48);
});
for (const opening of ['clear', 'closing-charge', 'disabled'] as const) test(`complete passing match repeats: ${opening}`, () => {
  const spec = PASS_MATCH_CASES.find(s => s.opening === opening && s.seed === 17 && s.main)!;
  assert.deepEqual(runPassMatchTrace(spec), runPassMatchTrace(spec));
});
