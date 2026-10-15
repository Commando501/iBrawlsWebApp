import test from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER_CONTEST_CASES, ROSTER_TACTICS, runRosterContestTrace, type RosterContestCase } from './grifballRosterContest';

for (const spec of ROSTER_CONTEST_CASES) test(`roster contest ${spec.teamSize}/${spec.profile}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runRosterContestTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 1800);
  assert.equal(trace.frames.at(-1)!.actors.length, spec.teamSize * 2);
});
test('roster contest matrix covers both sizes, four profiles, teams, orders and carrier identities', () => {
  assert.equal(ROSTER_CONTEST_CASES.length, 64);
  assert.equal(new Set(ROSTER_CONTEST_CASES.map(s => `${s.teamSize}/${s.profile}/${s.team}/${s.reverse}/${s.main}`)).size, 64);
});
for (const profile of Object.keys(ROSTER_TACTICS) as RosterContestCase['profile'][]) test(`roster contest repeats: ${profile}`, () => {
  const spec = ROSTER_CONTEST_CASES.find(s => s.teamSize === 4 && s.profile === profile && s.main)!;
  assert.deepEqual(runRosterContestTrace(spec), runRosterContestTrace(spec));
});
test('wide and compact controls change support destinations and subsequent movement', () => {
  const base = { teamSize: 4 as const, team: 'blue' as const, reverse: false, main: false };
  const wide = runRosterContestTrace({ ...base, profile: 'wide' });
  const compact = runRosterContestTrace({ ...base, profile: 'compact' });
  assert.equal(wide.failureCount + compact.failureCount, 0);
  const destinations = (t: typeof wide) => t.tacticalSamples[0].assignments.filter(a => a.id.startsWith('support_')).map(a => a.destination);
  assert.notDeepEqual(destinations(wide), destinations(compact));
  assert.ok(wide.frames[299].actors.filter(a => a.id.startsWith('support_')).some(a => {
    const b = compact.frames[299].actors.find(b => b.id === a.id)!;
    return Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > .5;
  }));
});
