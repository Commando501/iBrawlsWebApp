import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIVAL_DECISION_CASES, runRevivalDecisionTrace, revivalAttackCoverage } from './grifballRevivalDecisionIntegration';
import { validateRevivalActivity } from './grifballRevivalActivity';

const coverage: ReturnType<typeof runRevivalDecisionTrace>[] = [];
for (const spec of REVIVAL_DECISION_CASES) test(`revival decision ${JSON.stringify(spec)}`, () => {
  const trace = runRevivalDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 600);
  coverage.push(trace);
});
test('revival matrix proves renewed attacks by both carrier identities, teams and update orders', () => {
  assert.deepEqual(revivalAttackCoverage(coverage).missing, []);
  for (const defect of ['no-attacks', 'no-revival', 'before-revival', 'wrong-actor', 'failed']) {
    const changed = coverage.map(t => ({ name: t.name, scenario: t.scenario, failureCount: t.failureCount,
      attacks: structuredClone(t.attacks), revivals: structuredClone(t.revivals) }));
    for (const t of changed.filter(t => t.scenario.team === 'red' && t.scenario.main && t.scenario.reverse)) {
      if (defect === 'no-attacks') t.attacks = [];
      if (defect === 'no-revival') t.revivals = [];
      if (defect === 'before-revival') t.attacks.forEach(a => a.tick = 0);
      if (defect === 'wrong-actor') t.attacks.forEach(a => a.id = 'escort');
      if (defect === 'failed') t.failureCount = 1;
    }
    assert.ok(revivalAttackCoverage(changed).missing.includes('red/true/true'), defect);
  }
});

test('verified defensive activity cannot replace original-carrier attack matrix coverage', () => {
  assert.ok(coverage.some(t => t.activity.defensiveDashes.length));
  const missing = revivalAttackCoverage(coverage.map(t => ({ ...t, attacks: [] }))).missing;
  assert.equal(missing.length, 8);
});

test('revival activity requires a verified consumed defensive step by a living revived actor', () => {
  const source = coverage.find(t => t.name === 'contested/red/forward/main');
  assert.ok(source);
  assert.deepEqual(source.activity.attacks, []);
  assert.deepEqual(source.activity.defensiveDashes.map(({ tick, id, target }) => ({ tick, id, target })),
    [{ tick: 352, id: 'main_ai', target: 'defender' }]);
  assert.ok(Math.abs(source.activity.defensiveDashes[0].displacement - .4) < 1e-8);
  type Trace = typeof source;
  type Sample = NonNullable<Trace['dashSamples']>[number];
  const mutations: [string, (t: Trace, s: Sample) => void][] = [
    ['no samples', t => { t.dashSamples = []; }],
    ['no settings', t => { delete t.dashSettings; }],
    ['no request', (_t, s) => { s.requested = false; }],
    ['no threat', (_t, s) => { s.incomingThreat = false; }],
    ['no target', (_t, s) => { s.target = null; }],
    ['self target', (_t, s) => { s.target = s.id; }],
    ['unknown actor', (_t, s) => { s.id = 'missing'; }],
    ['friendly target', (_t, s) => { s.target = 'escort'; }],
    ['unrevived actor', t => { t.revivals = t.revivals.filter(r => r.id !== 'main_ai'); }],
    ['before revival', t => { t.revivals.forEach(r => r.tick = 600); }],
    ['dead actor', (_t, s) => { s.before.hp = 0; }],
    ['dead afterward', (_t, s) => { s.after.hp = 0; }],
    ['no displacement', (_t, s) => { s.after.pos = [...s.before.pos]; }],
    ['wrong cooldown', (_t, s) => { s.after.cooldown = 0; }],
    ['wrong duration', (_t, s) => { s.after.remaining = .25; }],
    ['wrong direction', (_t, s) => { s.after.direction.x = 0; }],
    ['airborne', (_t, s) => { s.before.jumping = true; }],
    ['missing frame', t => { t.frames = t.frames.filter(f => f.tick !== 352); }],
    ['false position', t => { t.frames.find(f => f.tick === 352)!.actors.find(a => a.id === 'main_ai')!.pos[0] += .1; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(source), sample = changed.dashSamples!.find(s => s.id === 'main_ai' && s.tick === 352);
    assert.ok(sample); mutate(changed, sample);
    assert.ok(validateRevivalActivity(changed).failureCount > 0, label);
  }
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`revival decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runRevivalDecisionTrace(spec), runRevivalDecisionTrace(spec));
  });
}
