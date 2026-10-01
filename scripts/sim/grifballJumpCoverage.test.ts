import test from 'node:test';
import assert from 'node:assert/strict';
import { jumpCoverage, type JumpCoverageTrace } from './grifballJumpCoverage';
import { runMobilityDecisionIntegration, validateMobilityDecisionTrace } from './grifballMobilityDecisionIntegration';

const matrix: JumpCoverageTrace[] = (['blue', 'red'] as const).flatMap(team => [false, true].map(reverse => ({
  name: `${team}/${reverse}`, scenario: { team, reverse, main: true }, failureCount: 0,
  flights: [{ launch: 8, landing: 99, apex: 5 }],
  mainJumpRequests: [{ tick: 1, accepted: false, dash: .1, swap: 0 }],
})));

test('jump coverage requires all team/order opportunities, not duplicates of one trace', () => {
  assert.deepEqual(jumpCoverage(matrix, 'mobility').missing, []);
  assert.deepEqual(jumpCoverage(matrix, 'match').missing, []);
  assert.equal(jumpCoverage([], 'mobility').missing.length, 8);
  assert.equal(jumpCoverage([], 'match').missing.length, 2);
  assert.equal(jumpCoverage([matrix[0], matrix[0]], 'mobility').missing.length, 6);
});

test('failed traces and ordinary actors cannot satisfy main-jump coverage', () => {
  for (const reason of ['failed', 'ordinary']) {
    const changed = structuredClone(matrix);
    if (reason === 'failed') changed[3].failureCount = 1;
    else changed[3].scenario.main = false;
    assert.deepEqual(jumpCoverage(changed, 'mobility').missing, ['red/true/flight', 'red/true/dash-rejection']);
  }
});

test('missing flights, incomplete landings, accepted jumps and non-dash rejections cannot supply witnesses', () => {
  for (const reason of ['no-flight', 'no-landing', 'accepted', 'not-dashing']) {
    const changed = structuredClone(matrix);
    if (reason === 'no-flight') changed[0].flights = [];
    if (reason === 'no-landing') changed[0].flights![0].landing = 0;
    if (reason === 'accepted') changed[0].mainJumpRequests[0].accepted = true;
    if (reason === 'not-dashing') changed[0].mainJumpRequests[0].dash = 0;
    assert.equal(jumpCoverage(changed, 'mobility').missing.length, 1, reason);
  }
  assert.deepEqual(jumpCoverage(matrix.filter(t => t.scenario.team === 'blue'), 'match').missing, ['red/dash-rejection']);
});

test('flight evidence checks impulse, commitment, trajectory, landing budget and resumed movement', () => {
  const traces = runMobilityDecisionIntegration();
  assert.ok(traces.every(t => t.failureCount === 0), JSON.stringify(traces.filter(t => t.failureCount).map(t => ({ name: t.name, failures: t.failures }))));
  assert.deepEqual(jumpCoverage(traces, 'mobility').missing, []);
  // The full matrix is checked before selecting evidence for deliberate mutation.
  // This is a validator control, not a separate passing gameplay run.
  const flight = traces.find(t => t.flights.length)!;
  assert.equal(flight.failureCount, 0, JSON.stringify(flight.failures));
  assert.ok(flight.flights.length);
  const first = flight.flights[0];
  for (const lastTick of [first.launch + 10, first.landing]) {
    const prefix = structuredClone(flight);
    prefix.ticks = lastTick; prefix.frames = prefix.frames.slice(0, lastTick);
    prefix.mainJumpImpacts = prefix.mainJumpImpacts.filter(j => j.tick <= lastTick);
    prefix.mainJumpRequests = prefix.mainJumpRequests.filter(j => j.tick <= lastTick);
    prefix.revivals = prefix.revivals.filter(r => r.tick <= lastTick);
    const observed = validateMobilityDecisionTrace(prefix);
    assert.equal(observed.failureCount, 0, JSON.stringify(observed.failures));
    assert.equal(observed.flights.length, 0, 'an unfinished observation cannot satisfy completed-flight coverage');
    assert.equal(observed.partialFlights.length, 1);
    assert.ok(jumpCoverage([observed], 'mobility').missing.includes(`${observed.scenario.team}/${observed.scenario.reverse}/flight`));
    const invalid = structuredClone(prefix);
    invalid.frames[first.launch].actors.find(a => a.id === 'main_ai')!.pos[1] += 1;
    assert.ok(validateMobilityDecisionTrace(invalid).failureCount > 0, 'a partial flight still checks every observed ballistic step');
  }
  for (const reason of ['impulse', 'commitment', 'trajectory', 'landing-budget', 'movement']) {
    const changed = structuredClone(flight);
    const actor = (tick: number) => changed.frames[tick - 1].actors.find(a => a.id === 'main_ai')!;
    if (reason === 'impulse') actor(first.launch).vel[1] = 0;
    if (reason === 'commitment') changed.mainJumpRequests = [];
    if (reason === 'trajectory') actor(first.launch + 1).pos[1] += 1;
    if (reason === 'landing-budget') actor(first.landing).jumpBudget = 1;
    if (reason === 'movement') {
      changed.mainJumpRequests = changed.mainJumpRequests.filter(r => r.tick < first.landing || r.tick >= first.landing + 30);
      const landed = [...actor(first.landing).pos];
      for (let tick = first.landing + 1; tick <= first.landing + 30; tick++) actor(tick).pos = [...landed];
    }
    assert.ok(validateMobilityDecisionTrace(changed).failureCount > 0, reason);
  }
  // A late airborne death may correctly remain unrevived at the recording cap.
  // Revival corruption controls need a witnessed revival from the validated matrix.
  const interrupted = traces.find(t => t.interruptedFlights.some(f => f.revival !== null))!;
  assert.ok(interrupted, 'matrix retains an observed airborne death followed by revival');
  const death = interrupted.interruptedFlights.find(f => f.revival !== null)!;
  assert.ok(death.revival);
  for (const reason of ['death-event', 'lethal-impact', 'revival-time', 'corpse-motion', 'dead-attack', 'weapon', 'respawn-budget']) {
    const changed = structuredClone(interrupted);
    const actor = (tick: number) => changed.frames[tick - 1].actors.find(a => a.id === 'main_ai')!;
    if (reason === 'death-event') changed.deaths = changed.deaths.filter(d => d.id !== 'main_ai' || d.tick !== death.death);
    if (reason === 'lethal-impact') changed.impacts = changed.impacts.filter(i => i.tick !== death.death);
    if (reason === 'revival-time') changed.revivals.find(r => r.id === 'main_ai' && r.tick === death.revival)!.tick++;
    if (reason === 'corpse-motion') actor(death.death + 1).pos[1] += 1;
    if (reason === 'dead-attack') changed.attacks.push({ tick: death.death + 1, id: 'main_ai', weapon: 'hammer', melee: false, kind: 'swing' });
    if (reason === 'weapon') actor(death.death).weaponState = 'windup';
    if (reason === 'respawn-budget') actor(death.revival!).jumpBudget = 1;
    assert.ok(validateMobilityDecisionTrace(changed).failureCount > 0, reason);
  }
});
