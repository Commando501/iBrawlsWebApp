import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_DECISION_CASES, runPassDecisionTrace } from './grifballPassDecisionIntegration';

for (const spec of PASS_DECISION_CASES) test(`autonomous pass ${JSON.stringify(spec)}`, () => {
  const trace = runPassDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 360);
});

for (const mode of ['pass', 'cancel-receiver', 'resume'] as const) test(`pass decision repeatability: ${mode}`, () => {
  const spec = { mode, team: 'blue' as const, reverse: false, carrierId: 'main_ai' as const };
  assert.deepEqual(runPassDecisionTrace(spec), runPassDecisionTrace(spec));
});

for (const mode of ['pass', 'short-charge'] as const) for (const team of ['blue', 'red'] as const)
  test(`receiver recovers a contact-redirected pass: ${mode}/${team}`, () => {
    const trace = runPassDecisionTrace({ mode, team, reverse: false, carrierId: 'carrier' });
    const sign = team === 'blue' ? 1 : -1;
    const redirected = trace.frames.find(frame => frame.tick > trace.releaseTick && frame.tick < trace.receptionTick &&
      frame.ball.state === 'thrown' && frame.ball.vel.x * sign < -1);
    assert.ok(redirected, 'contact must change the horizontal flight, not merely the pickup timestamp');
    const receiver = redirected.actors.find(actor => actor.id === 'receiver')!;
    assert.ok(Math.abs(redirected.ball.pos.x) < 10, 'redirect occurs away from the arena wall');
    assert.ok(Math.hypot(receiver.pos[0] - redirected.ball.pos.x, receiver.pos[2] - redirected.ball.pos.z) < 1.5);
    assert.equal(redirected.ball.holderId, null, 'contact is not an airborne catch');
    assert.equal(trace.frames[trace.receptionTick - 1].ball.holderId, 'receiver');
    assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  });
