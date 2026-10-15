import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { autonomousMobilityCoverage, runAutonomousMobilityParity, AUTONOMOUS_MOBILITY_PAIRS } from './grifballAutonomousMobilityParity';

let pending: ReturnType<typeof runAutonomousMobilityParity> | undefined;
const matrix = () => pending ??= runAutonomousMobilityParity();

test('autonomous mobility and airborne carrier encounters agree through restored continuations', async t => {
  const result = await matrix();
  if (process.env.GRIFBALL_MOBILITY_OUT) writeFileSync(process.env.GRIFBALL_MOBILITY_OUT, JSON.stringify(result));
  assert.deepEqual(result.coverage, { required: 80, completed: 80, errors: [] });
  t.diagnostic(JSON.stringify({ cases: result.traces.length, frames: result.traces.reduce((n, r) => n + r.frameCount, 0),
    restored: result.traces.reduce((n, r) => n + r.restoredFrames, 0) }));
});

test('mobility coverage rejects absent, duplicate, divergent and missing-behavior evidence', async () => {
  const { traces } = await matrix();
  const rejected = (value: typeof traces, reason: string) => assert.ok(autonomousMobilityCoverage(value).errors.length > 0, reason);
  rejected(traces.slice(1), 'missing case'); rejected([...traces, traces[0]], 'duplicate case');
  for (const defect of ['differences', 'count', 'frames', 'replay', 'hash', 'spec', 'input', 'dash', 'jump', 'landing', 'carrier', 'flight', 'launch'] as const) {
    const copy = structuredClone(traces);
    if (defect === 'differences') copy[0].differences.push({ tick: 183, field: 'position', live: 0, headless: 1 });
    if (defect === 'count') copy[0].differenceCount = 1;
    if (defect === 'frames') copy[0].frameCount--;
    if (defect === 'replay') copy[0].restoredFrames--;
    if (defect === 'hash') copy[0].frameEvidence.fullTraceSHA256 = '';
    if (defect === 'spec') copy[0].spec.seed = 999;
    if (defect === 'input') copy[0].input.job.seed++;
    const stripped = ['dash', 'jump', 'landing'].includes(defect) ? defect : defect === 'carrier' ? 'carrier-moving-airborne'
      : defect === 'flight' ? 'opposed-flight-at-carrier' : defect === 'launch' ? 'lunge' : null;
    if (stripped) for (const trace of copy) trace.witnesses = trace.witnesses.filter(w => w.kind !== stripped);
    rejected(copy, defect);
  }
});

test('every quiet mobility condition retains its own fully observed sword-threat companion', async () => {
  const { traces } = await matrix();
  assert.equal(traces.filter(t => t.spec.profile !== 'loose-opposed').length, 72, 'original case inventory');
  for (const [quiet, threat] of AUTONOMOUS_MOBILITY_PAIRS) for (const original of traces.filter(t => t.spec.profile === quiet)) {
    const companion = traces.find(t => t.spec.profile === threat && t.spec.seed === original.spec.seed &&
      t.spec.mirrored === original.spec.mirrored && t.spec.reversed === original.spec.reversed)!;
    assert.ok(companion, original.name);
    for (const kind of ['jump', 'landing']) {
      assert.ok(companion.witnesses.some(w => w.kind === kind), companion.name + '/' + kind);
      const removed = traces.map(t => t === companion ? { ...t, witnesses: t.witnesses.filter(w => w.kind !== kind) } : t);
      assert.ok(autonomousMobilityCoverage(removed).errors.includes(companion.name + ': missing ' + kind),
        'other conditions cannot replace ' + companion.name + '/' + kind);
    }
    if (quiet === 'loose') {
      const first = companion.frames[0] as { live: { ball: { holderId: string | null; state: string } };
        headless: { ball: { holderId: string | null; state: string } } };
      for (const host of [first.live, first.headless]) {
        assert.equal(host.ball.holderId, null);
        assert.equal(host.ball.state, 'idle');
      }
      assert.equal(companion.authoredFlights.length, 4);
    }
  }
});
