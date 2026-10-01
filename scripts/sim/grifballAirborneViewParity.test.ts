import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBORNE_VIEW_CASES, runAirborneViewTrace, runAirborneViewParity, airborneViewCoverage } from './grifballAirborneViewParity';
import { compactExecutionTraces } from './grifballParityEvidence';

let cached: ReturnType<typeof runAirborneViewParity> | undefined;
const traces = () => cached ??= runAirborneViewParity();
for (const [index,spec] of AIRBORNE_VIEW_CASES.entries()) test(`airborne view ${JSON.stringify(spec)}`, () => {
  const trace = traces()[index];
  assert.equal(trace.differenceCount,0,JSON.stringify(trace.differences));
  assert.equal(trace.frames.length,60);
  assert.equal(trace.firstLiveHit,trace.expectedHit ? 3 : 0);
});
test('airborne view inventory retains range, pitch, stance and landing controls', () => {
  const full = traces(), compact = compactExecutionTraces(full);
  assert.deepEqual(airborneViewCoverage(compact),{required:192,completed:192,errors:[]});
  assert.equal(full.filter(t=>t.expectedHit).length,72);
  const select = (flight:string, crouching:boolean, model:string, pitch:number) =>
    full.filter(t=>t.scenario.flight === flight && t.scenario.crouching === crouching && t.scenario.model === model && t.scenario.pitch === pitch);
  for (const t of select('rising',false,'medium',-.5)) assert.equal(t.expectedHit,false);
  for (const t of select('rising',true,'medium',-.5)) assert.equal(t.expectedHit,true);
  for (const t of select('falling',false,'medium',-.5)) assert.equal(t.expectedHit,false);
  for (const t of select('falling',false,'large',-.5)) assert.equal(t.expectedHit,true);
  for (const t of select('landing',true,'medium',-.5)) {assert.equal(t.expectedHit,true); assert.equal(t.frames[2].live.height,0);}
  for (const t of select('landing',true,'medium',.5)) assert.equal(t.expectedHit,false);
  for (const mutation of ['missing','duplicate','failed','truncated','scenario','snapshots','impact','renamed']) {
    const changed = structuredClone(compact);
    if (mutation === 'missing') changed.shift();
    if (mutation === 'duplicate') changed.push(changed[0]);
    if (mutation === 'failed') changed[0].differenceCount = 1;
    if (mutation === 'truncated') changed[0].frameCount--;
    if (mutation === 'scenario') changed[0].scenario.mirror = !changed[0].scenario.mirror;
    if (mutation === 'snapshots') changed[0].snapshotTicks = [2];
    if (mutation === 'impact') changed[0].firstLiveHit = 2;
    if (mutation === 'renamed') changed[0].name = 'substituted';
    assert.ok(airborneViewCoverage(changed).errors.length,mutation);
  }
});
test('airborne view repeats exactly across impact and stance-release snapshots', () => {
  for (const flight of ['rising','falling','landing']) {
    const original = traces().find(t=>t.scenario.flight === flight && t.expectedHit)!;
    assert.deepEqual(runAirborneViewTrace(original.scenario),original);
  }
});
