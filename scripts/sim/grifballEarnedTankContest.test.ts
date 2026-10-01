import test from 'node:test';
import assert from 'node:assert/strict';
import { EARNED_TANK_CASES, runEarnedTankTrace, validateEarnedTankResolution, earnedTankResolutionCoverage } from './grifballEarnedTankContest';

const witnesses: Parameters<typeof earnedTankResolutionCoverage>[0][number][] = [];

for (const spec of EARNED_TANK_CASES) test(`earned tank opening ${spec.opening}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runEarnedTankTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 300);
  assert.equal(trace.boundary, 'live-earned-tank-contest');
  if (spec.opening === 'opening') assert.equal(trace.resolution?.outcome, 'runner-interruption');
  if (spec.opening === 'durable-opponent') assert.equal(trace.resolution?.outcome, 'paired-kill');
  const {scenario,ticks,failureCount,resolution}=trace;
  witnesses.push({scenario,ticks,failureCount,resolution});
});
test('earned tank matrix covers both teams, orders and tank identities with three refusal controls', () => {
  assert.equal(EARNED_TANK_CASES.length, 40);
  assert.equal(new Set(EARNED_TANK_CASES.map(s => `${s.opening}/${s.team}/${s.reverse}/${s.main}`)).size, 40);
  assert.deepEqual(earnedTankResolutionCoverage(witnesses), {required:40,completed:40,errors:[]});
  for (const defect of ['missing','duplicate','failed','short','wrong-outcome','missing-outcome','failed-outcome','bad-tick','wrong-team']) {
    const bad=structuredClone(witnesses), t=bad.find(t=>t.scenario.opening==='durable-opponent')!;
    if(defect==='missing') bad.splice(bad.indexOf(t),1);
    if(defect==='duplicate') bad.push(t);
    if(defect==='failed') t.failureCount=1;
    if(defect==='short') t.ticks=299;
    if(defect==='wrong-outcome') t.resolution!.outcome='runner-interruption';
    if(defect==='missing-outcome') t.resolution=null;
    if(defect==='failed-outcome') t.resolution!.failures.push('missing credit');
    if(defect==='bad-tick') t.resolution!.tick=301;
    if(defect==='wrong-team') t.scenario.team='red';
    assert.ok(earnedTankResolutionCoverage(bad).errors.length,defect);
  }
});
for (const opening of ['opening', 'durable-opponent', 'default-roles', 'late-arrival', 'shared-blast'] as const) test(`earned tank exact repeat: ${opening}`, () => {
  const spec = EARNED_TANK_CASES.find(s => s.opening === opening && s.main)!;
  assert.deepEqual(runEarnedTankTrace(spec), runEarnedTankTrace(spec));
});

for (const opening of ['opening', 'durable-opponent'] as const) test(`earned tank resolution rejects missing or stolen credit: ${opening}`, () => {
  const source = runEarnedTankTrace({opening, team:'blue', reverse:false, main:true});
  assert.equal(source.failureCount, 0, JSON.stringify(source.failures));
  const ids = ['main_ai','support_1'], start = source.impacts.find(i=>i.id==='defender')!.tick, end = start+36;
  const tick = source.resolution!.tick, paired = opening === 'durable-opponent';
  const validate = (trace: typeof source) => validateEarnedTankResolution(trace, ids, start, end, paired);
  for (const defect of ['missing-impact','wrong-victim','missing-death','duplicate-death','wrong-time','no-health-loss',
    'no-kill-credit','friendly-killer','dead-killer','missing-frame', ...(paired?[]:['not-carrier','wrong-weapon','late-pair',
    'uncommitted-pair','missing-completion','corpse-hit','stolen-credit'])]) {
    const t = structuredClone(source), impact = t.impacts.find(i=>i.tick===tick&&i.victims.includes('defender'))!;
    const before = t.frames[tick-2], after = t.frames[tick-1];
    if (defect==='missing-impact') t.impacts=t.impacts.filter(i=>i!==impact);
    if (defect==='wrong-victim') impact.victims=[];
    if (defect==='missing-death') t.deaths=t.deaths.filter(d=>d.id!=='defender');
    if (defect==='duplicate-death') t.deaths.push({id:'defender',tick});
    if (defect==='wrong-time') t.deaths.find(d=>d.id==='defender')!.tick++;
    if (defect==='no-health-loss') after.actors.find(a=>a.id==='defender')!.hp=1;
    if (defect==='no-kill-credit') after.actors.find(a=>a.id===impact.id)!.kills--;
    if (defect==='friendly-killer') before.actors.find(a=>a.id===impact.id)!.team='red';
    if (defect==='dead-killer') before.actors.find(a=>a.id===impact.id)!.hp=0;
    if (defect==='missing-frame') t.frames.splice(tick-2,1);
    if (defect==='not-carrier') before.ball.holderId=null;
    if (defect==='wrong-weapon') before.actors.find(a=>a.id==='carrier')!.weapon='hammer';
    if (defect==='late-pair') t.tankActions.find(a=>a.id==='main_ai')!.tick=tick+1;
    if (defect==='uncommitted-pair') before.actors.find(a=>a.id==='main_ai')!.weaponState='ready';
    const completion = t.impacts.find(i=>i.id==='main_ai'&&i.tick>tick);
    if (defect==='missing-completion') t.impacts=t.impacts.filter(i=>i!==completion);
    if (defect==='corpse-hit') completion!.victims=['defender'];
    if (defect==='stolen-credit') t.frames[completion!.tick-1].actors.find(a=>a.id==='main_ai')!.kills++;
    assert.ok(validate(t).failures.length, defect);
  }
  if (!paired) assert.ok(validateEarnedTankResolution(source, ids, start, end, true).failures.length,
    'runner success must never replace the separately required paired kill');
});
