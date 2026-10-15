import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVING_MIXED_CONTACT_CASES, runMovingMixedContactTrace, validateMovingMixedContact,
  runMovingMixedContactParity } from './grifballMovingMixedContactParity';
import { compactExecutionTraces } from './grifballParityEvidence';

for (const spec of MOVING_MIXED_CONTACT_CASES) test(`moving mixed contact ${Object.values(spec).join('/')}`, () => {
  const trace = runMovingMixedContactTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const spec of MOVING_MIXED_CONTACT_CASES.filter(s => s.attack === 'slash' && s.mainRole === 'target' && s.observer)) {
  for (const tick of [6, 16]) test(`moving mixed snapshot ${spec.movement}/${spec.reverse}/${tick}`, () => {
    const trace = runMovingMixedContactTrace(spec, tick);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
    assert.deepEqual(trace.frames, runMovingMixedContactTrace(spec).frames);
  });
}

test('walking reversal changes contact order and kill credit at the melee boundary', () => {
  for (const reverse of [false, true]) {
    const trace = runMovingMixedContactTrace({ movement: 'reverse-walk', attack: 'slash', mainRole: 'target', observer: true, reverse });
    assert.deepEqual(trace.expected, { contact: reverse ? 7 : 8, meleeHit: true,
      deathTick: reverse ? 7 : 8, killer: reverse ? 'melee' : 'lunger' });
  }
});

test('moving oracle rejects matching corrupted timing, motion and credit in both engines', () => {
  const spec = { movement: 'enter', attack: 'slam', mainRole: 'target', observer: true, reverse: false } as const;
  const original = runMovingMixedContactTrace(spec);
  const changes = [
    (t: typeof original) => { t.frames.length = 0; },
    (t: typeof original) => { t.frames[0].live.length = t.frames[0].headless.length = 0; },
    (t: typeof original) => { t.frames[6].tick = 8; },
    (t: typeof original) => { t.frames[6].live[1].hp = t.frames[6].headless[1].hp = 1; },
    (t: typeof original) => { t.frames[6].live[2].kills = t.frames[6].headless[2].kills = 0; },
    (t: typeof original) => { t.frames[6].live[1].deaths = t.frames[6].headless[1].deaths = 0; },
    (t: typeof original) => { t.frames[6].live[0].lunging = t.frames[6].headless[0].lunging = true; },
    (t: typeof original) => { t.frames[6].live[2].pos[2] = t.frames[6].headless[2].pos.z = -1; },
    (t: typeof original) => { t.frames[6].live[2].vel[2] = t.frames[6].headless[2].vel.z = 0; },
    (t: typeof original) => { t.frames[6].live[2].dashRemaining = t.frames[6].headless[2].dashRemaining = 0; },
    (t: typeof original) => { t.frames[6].live[2].dashCooldown = t.frames[6].headless[2].dashCooldown = 0; },
    (t: typeof original) => { t.frames[6].live[0].outcome = t.frames[6].headless[0].outcome = 'miss_timeout'; },
  ];
  for (const change of changes) {
    const trace = structuredClone(original); change(trace);
    assert.ok(validateMovingMixedContact(trace, spec).differenceCount > 0);
  }
});

test('moving mixed evidence preserves all cases, movement inputs and full-trace fingerprints', () => {
  const traces = compactExecutionTraces(runMovingMixedContactParity());
  assert.equal(traces.length, 252);
  assert.equal(new Set(traces.map(t => t.name)).size, 252);
  assert.ok(traces.every(t => t.differenceCount === 0 && t.frameCount === 120 && t.movement
    && t.frameEvidence.fullTraceSHA256.length === 64));
});
