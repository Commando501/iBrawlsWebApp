import test from 'node:test';
import assert from 'node:assert/strict';
import { INCOMING_LUNGE_MOBILITY_CASES, runIncomingLungeMobilityTrace,
  validateIncomingLungeMobility, incomingLungeMobilityCoverage,
  type IncomingLungeMobilityTrace } from './grifballIncomingLungeMobility';

const traces: IncomingLungeMobilityTrace[] = [];
for (const spec of INCOMING_LUNGE_MOBILITY_CASES) test('incoming sword mobility ' + JSON.stringify(spec), async () => {
  const trace = await runIncomingLungeMobilityTrace(spec);
  traces.push(trace);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.ok(trace.ticks > 0 && trace.ticks <= 3600);
  assert.equal(trace.boundary, 'live-incoming-lunge-mobility');
});

test('incoming sword matrix requires every case and complete flights and dash rejections in all four groups', () => {
  assert.deepEqual(incomingLungeMobilityCoverage(traces), { required: 64, completed: 64, errors: [] });
  for (const defect of ['missing', 'duplicate', 'failed', 'no-flights', 'no-rejections', 'wrong-team', 'false-count', 'foreign']) {
    // Shallow copies suffice here: each mutation replaces a summary field or
    // the case object, and never alters the retained physical frames.
    const altered = traces.map(t => ({ ...t }));
    if (defect === 'missing') altered.shift();
    if (defect === 'duplicate') altered.push(altered[0]);
    if (defect === 'failed') altered[0].failureCount++;
    if (defect === 'no-flights') for (const t of altered) t.flights = [];
    if (defect === 'no-rejections') for (const t of altered) t.rejections = [];
    if (defect === 'wrong-team') altered[0].scenario = { ...altered[0].scenario, team: 'red' };
    if (defect === 'false-count') altered[0].ticks--;
    if (defect === 'foreign') altered[0].spec = { ...altered[0].spec, seed: 999 };
    assert.ok(incomingLungeMobilityCoverage(altered).errors.length, defect);
  }
});

test('incoming sword evidence rejects corrupted commitments, physics and continued play', () => {
  const good = traces.find(t => t.flights.length && !t.failureCount)!;
  assert.ok(good, 'required complete-flight evidence must exist before testing its validator');
  const flight = good.flights[0];
  for (const defect of ['launch', 'trajectory', 'budget', 'landing', 'dash-lock', 'movement', 'request-order', 'truncated', 'missing-actor']) {
    const altered = structuredClone(good);
    const actor = (tick: number) => altered.frames[tick - 1].actors.find(a => a.id === 'main_ai')!;
    if (defect === 'launch') actor(flight.launch).vel[1] = 0;
    if (defect === 'trajectory') actor(flight.launch + 1).pos[1] += .1;
    if (defect === 'budget') actor(flight.launch + 1).budget = 0;
    if (defect === 'landing') actor(flight.landing).jump = true;
    if (defect === 'dash-lock') altered.requests.find(r => r.id === 'main_ai' && r.accepted)!.dash = .2;
    if (defect === 'movement') for (const frame of altered.frames.slice(flight.landing, flight.landing + 30)) {
      const a = frame.actors.find(a => a.id === 'main_ai')!, landed = actor(flight.landing);
      a.pos[0] = landed.pos[0]; a.pos[2] = landed.pos[2];
    }
    if (defect === 'request-order') altered.requests.push({ ...altered.requests.find(r => r.id === 'main_ai')! });
    if (defect === 'truncated') altered.frames.splice(flight.launch + 3);
    if (defect === 'missing-actor') altered.frames[flight.launch].actors = [];
    assert.ok(validateIncomingLungeMobility(altered).failureCount, defect);
    assert.ok(incomingLungeMobilityCoverage(traces.map(t => t === good ? altered : t)).errors.length,
      defect + ': a cached passing verdict cannot hide corrupted frames');
  }
});

test('trade interruption cancels a planned jump and cannot count as a completed flight', () => {
  const good = traces.find(t => t.interruptions.some(i => i.kind === 'trade-before-launch'))!;
  assert.ok(good, 'the fixed matrix must retain a real trade interruption');
  const interrupted = good.interruptions.find(i => i.kind === 'trade-before-launch')!;
  assert.ok(!good.flights.some(f => f.launch === interrupted.request + 24));
  const altered = structuredClone(good);
  const trade = altered.trades.find(t => t.targetId === 'main_ai' && t.before?.planned)!;
  assert.ok(trade.after);
  trade.after.planned = true;
  assert.ok(validateIncomingLungeMobility(altered).failureCount);
});

for (const index of [0, INCOMING_LUNGE_MOBILITY_CASES.length - 1]) test('incoming sword exact repeat ' + index, async () => {
  const spec = INCOMING_LUNGE_MOBILITY_CASES[index];
  const original = traces.find(t => JSON.stringify(t.spec) === JSON.stringify(spec));
  assert.ok(original);
  assert.deepEqual(await runIncomingLungeMobilityTrace(spec), original);
});

test('incoming sword updater observations validate dash landings for both allied identities and all mirrors/orders', () => {
  for (const team of ['blue', 'red']) for (const reverse of [false, true]) for (const id of ['main_ai', 'validation-blue-1'])
    assert.ok(traces.some(t => t.scenario.team === team && t.scenario.reverse === reverse &&
      t.failureCount === 0 && t.dash.failureCount === 0 && t.dash.airborneLandings.some(a => a.id === id)), team + '/' + reverse + '/' + id);
});
test('incoming sword dash validation rejects corrupted physical transitions and cached evidence', () => {
  const good = traces.find(t => t.dash.airborneLandings.length)!;
  assert.ok(good);
  const landing = good.dash.airborneLandings[0];
  for (const defect of ['height', 'vertical-speed', 'position', 'speed', 'duration', 'cooldown', 'direction', 'airborne-flag', 'missing-observations', 'duplicate', 'outside-recording', 'cached-landings']) {
    const altered = structuredClone(good);
    const sample = altered.dashSamples.find(s => s.tick === landing.tick && s.id === landing.id)!;
    if (defect === 'height') sample.after.pos[1] += 1;
    if (defect === 'vertical-speed') sample.after.vel[1] += 1;
    if (defect === 'position') sample.after.pos[0] += 1;
    if (defect === 'speed') sample.after.vel[0] += 1;
    if (defect === 'duration') sample.after.remaining += .1;
    if (defect === 'cooldown') sample.after.cooldown += .1;
    if (defect === 'direction') sample.after.direction.x += .1;
    if (defect === 'airborne-flag') sample.after.jumping = true;
    if (defect === 'missing-observations') altered.dashSamples = [];
    if (defect === 'duplicate') altered.dashSamples.push({ ...sample });
    if (defect === 'outside-recording') sample.tick = altered.frames.length + 1;
    if (defect === 'cached-landings') altered.dash.airborneLandings = [];
    else assert.ok(validateIncomingLungeMobility(altered).failureCount > 0, defect);
    assert.ok(incomingLungeMobilityCoverage(traces.map(t => t === good ? altered : t)).errors.length > 0, defect);
  }
});
