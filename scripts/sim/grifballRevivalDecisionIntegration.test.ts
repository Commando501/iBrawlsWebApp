import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIVAL_DECISION_CASES, runRevivalDecisionTrace, revivalAttackCoverage, runRevivalDecisionIntegration, summarizeRevivalDecisionTraces } from './grifballRevivalDecisionIntegration';
import { validateRevivalActivity, verifiedRevivalAttacks } from './grifballRevivalActivity';
import { MOBILITY_DECISION_CASES } from './grifballMobilityDecisionIntegration';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { PARITY_FRAME_SAMPLE_LIMIT } from './grifballParityEvidence';

test('revival report verifies full history before sampling and preserves actual failures', () => {
  const full = runRevivalDecisionIntegration();
  const {revivalDecisionTraces: sampled, revivalAttackWitnesses: coverage} = summarizeRevivalDecisionTraces(full);
  assert.equal(full.length, 24);
  assert.deepEqual(coverage.missing, []);
  assert.equal(new Set(coverage.witnesses.map(w => w.group)).size, 8);
  assert.deepEqual(coverage, revivalAttackCoverage(full));
  assert.deepEqual(sampled.map(t=>({name:t.name, count:t.failureCount, failures:t.failures})),
    full.map(t=>({name:t.name, count:t.failureCount, failures:t.failures})));
  for (const trace of sampled) {
    assert.equal(trace.frameCount, 600);
    assert.ok(trace.frames.length <= PARITY_FRAME_SAMPLE_LIMIT);
    assert.equal(trace.frameEvidence.fullTraceSHA256.length, 64);
    assert.ok(trace.dashEvidence.frameCount > trace.dashEvidence.frames.length);
    assert.ok(!Object.hasOwn(trace, 'dashSamples'));
  }
  // The old report order loses all eight real groups: required adjacent frames
  // are absent from the bounded sample. Never fall back to trusting requests.
  assert.equal(revivalAttackCoverage(sampled).missing.length, 8);
  const withoutProof = full.map(t => ({...t, attacks:[]}));
  assert.equal(summarizeRevivalDecisionTraces(withoutProof).revivalAttackWitnesses.missing.length, 8);
});

let dashWitness: ReturnType<typeof runOpposedDecisionTrace> | undefined;
function defensiveRevivalWitness() {
  if (dashWitness) return dashWitness;
  let selected: typeof dashWitness;
  // Retain every original mobility case. The longer recordings supply test
  // evidence; they do not replace the separate 600-frame revival requirement.
  for (const spec of MOBILITY_DECISION_CASES) {
    const trace = runOpposedDecisionTrace(spec, 'mobility');
    assert.equal(trace.failureCount, 0, JSON.stringify({spec, failures:trace.failures}));
    const activity = validateRevivalActivity(trace);
    assert.equal(activity.failureCount, 0, JSON.stringify({spec, failures:activity.failures}));
    const witness = activity.defensiveDashes[0];
    if (!selected && witness) selected = {...trace, attacks:[],
      dashSamples: trace.dashSamples!.filter(s => s.id === witness.id && s.tick === witness.tick)};
  }
  assert.ok(selected, 'the complete fixed mobility matrix must supply a defensive revival witness');
  assert.equal(validateRevivalActivity(selected).failureCount, 0);
  return dashWitness = selected;
}

for (const spec of REVIVAL_DECISION_CASES.filter(s => s.mode === 'hammer-first')) {
  test(`revived attack proof verifies living commitments ${JSON.stringify(spec)}`, () => {
    const trace = runRevivalDecisionTrace(spec);
    assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
    const id = spec.main ? 'main_ai' : 'carrier';
    const witnesses = verifiedRevivalAttacks(trace);
    assert.ok(witnesses.some(a => a.id === id));
    assert.deepEqual(trace.activity.attacks, witnesses);
    assert.ok(!revivalAttackCoverage([trace]).missing.includes(`${spec.team}/${spec.reverse}/${spec.main}`));
  });
}

test('revived attack proof rejects requests without living revival and commitment evidence', () => {
  const trace = runRevivalDecisionTrace({mode:'hammer-first', team:'blue', reverse:false, main:true});
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  const witness = verifiedRevivalAttacks(trace).find(a => a.id === 'main_ai')!;
  assert.ok(witness);
  trace.attacks = trace.attacks.filter(a => a.id === witness.id && a.tick === witness.tick);
  assert.equal(validateRevivalActivity(trace).failureCount, 0);
  type T = typeof trace;
  const actor = (t: T, tick: number) => t.frames.find(f => f.tick === tick)!.actors.find(a => a.id === witness.id)!;
  const revival = trace.revivals.find(r => r.id === witness.id)!;
  const mutations: [string, (t: T) => void][] = [
    ['missing attack', t => { t.attacks = []; }],
    ['duplicate request', t => { t.attacks.push({...t.attacks[0]}); }],
    ['fractional tick', t => { t.attacks[0].tick += .5; }],
    ['unobserved actor', t => { t.attacks[0].id = 'missing'; }],
    ['wrong weapon', t => { t.attacks[0].weapon = 'sword'; }],
    ['wrong melee kind', t => { t.attacks[0].melee = true; }],
    ['unconsumed jump request', t => { t.attacks[0].kind = 'hammer-jump'; }],
    ['missing revival', t => { t.revivals = []; }],
    ['invented revival boundary', t => { t.revivals[0].tick++; }],
    ['future revival', t => { t.revivals[0].tick = witness.tick + 1; }],
    ['missing death', t => { t.deaths = []; }],
    ['death after revival', t => { t.deaths.push({id:witness.id, tick:witness.tick - 1}); }],
    ['dead on attack frame', t => { actor(t, witness.tick).hp = 0; }],
    ['dead before attack', t => { actor(t, witness.tick - 1).hp = 0; }],
    ['respawning before attack', t => { actor(t, witness.tick - 1).respawnTimer = 1; }],
    ['respawning after attack', t => { actor(t, witness.tick).respawnTimer = 1; }],
    ['living before revival', t => { actor(t, revival.tick - 1).hp = 1; }],
    ['not waiting to respawn', t => { actor(t, revival.tick - 1).respawnTimer = 0; }],
    ['dead after revival', t => { actor(t, revival.tick).hp = 0; }],
    ['revival credit changed', t => { t.revivals[0].kills++; }],
    ['revival death count changed', t => { t.revivals[0].deaths++; }],
    ['later life substituted', t => { actor(t, witness.tick - 1).deaths++; actor(t, witness.tick).deaths++; }],
    ['no committed phase', t => { actor(t, witness.tick).weaponState = 'ready'; }],
    ['old windup', t => { actor(t, witness.tick).weaponTimer = .07; }],
    ['already attacking', t => { actor(t, witness.tick - 1).weaponState = 'swing_up'; }],
    ['inactive phase', t => { t.frames.find(f => f.tick === witness.tick)!.phase = 'matchEnd'; }],
    ['missing attack frame', t => { t.frames = t.frames.filter(f => f.tick !== witness.tick); }],
    ['missing pre-attack frame', t => { t.frames = t.frames.filter(f => f.tick !== witness.tick - 1); }],
    ['missing revival frame', t => { t.frames = t.frames.filter(f => f.tick !== revival.tick); }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(trace); mutate(changed);
    assert.deepEqual(verifiedRevivalAttacks(changed), [], label);
    assert.ok(validateRevivalActivity(changed).failureCount > 0, label);
    assert.ok(revivalAttackCoverage([changed]).missing.includes('blue/false/true'), label);
  }
});

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
      attacks: structuredClone(t.attacks), revivals: structuredClone(t.revivals), deaths: t.deaths, frames: t.frames }));
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
  const source = defensiveRevivalWitness();
  assert.equal(validateRevivalActivity(source).defensiveDashes.length, 1);
  assert.equal(revivalAttackCoverage([source]).missing.length, 8);
  const missing = revivalAttackCoverage(coverage.map(t => ({ ...t, attacks: [] }))).missing;
  assert.equal(missing.length, 8);
});

test('revival activity requires a verified consumed defensive step by a living revived actor', (t) => {
  const source = defensiveRevivalWitness(), activity = validateRevivalActivity(source);
  const witness = activity.defensiveDashes[0];
  t.diagnostic(JSON.stringify({scenario:source.scenario, witness}));
  assert.deepEqual(activity.attacks, []);
  assert.equal(activity.defensiveDashes.length, 1);
  assert.ok(Math.abs(witness.displacement - .4) < 1e-8);
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
    ['unrevived actor', t => { t.revivals = t.revivals.filter(r => r.id !== witness.id); }],
    ['before revival', t => { t.revivals.forEach(r => r.tick = t.ticks + 1); }],
    ['dead actor', (_t, s) => { s.before.hp = 0; }],
    ['dead afterward', (_t, s) => { s.after.hp = 0; }],
    ['no displacement', (_t, s) => { s.after.pos = [...s.before.pos]; }],
    ['wrong cooldown', (_t, s) => { s.after.cooldown = 0; }],
    ['wrong duration', (_t, s) => { s.after.remaining = .25; }],
    ['wrong direction', (_t, s) => { s.after.direction.x! += .1; }],
    ['airborne', (_t, s) => { s.before.jumping = true; }],
    ['missing frame', t => { t.frames = t.frames.filter(f => f.tick !== witness.tick); }],
    ['false position', t => { t.frames.find(f => f.tick === witness.tick)!.actors.find(a => a.id === witness.id)!.pos[0] += .1; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(source), sample = changed.dashSamples!.find(s => s.id === witness.id && s.tick === witness.tick);
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
