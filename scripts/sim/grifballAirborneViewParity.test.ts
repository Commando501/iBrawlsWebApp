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
  assert.equal(trace.firstLiveHit,trace.expectedHit ? (spec.attack === 'slam' || spec.attack === 'punch' ? 5 : 3) : 0);
});
test('airborne view inventory retains range, pitch, stance and landing controls', () => {
  const full = traces().filter(t=>t.scenario.targetMotion === 'static' && t.scenario.attack !== 'punch'), compact = compactExecutionTraces(traces());
  assert.deepEqual(airborneViewCoverage(compact),{required:3840,completed:3840,errors:[]});
  assert.equal(full.filter(t=>t.expectedHit).length,248);
  assert.deepEqual(['slash','slam','swipe'].map(attack => full.filter(t=>t.scenario.attack === attack && t.expectedHit).length),[72,88,88]);
  for (const trace of full.filter(t=>t.scenario.flight === 'landing')) {
    assert.ok(trace.frames[trace.impactTick - 2].live.height > 0);
    assert.equal(trace.frames[trace.impactTick - 1].live.height,0);
  }
  for (const attack of ['slam','swipe']) {
    const edge = full.filter(t=>t.scenario.attack === attack && t.scenario.flight === 'rising' && !t.scenario.crouching && t.scenario.pitch === -.5);
    assert.equal(edge.length,16);
    for (const trace of edge) assert.equal(trace.expectedHit,trace.scenario.model === 'large');
  }
  const select = (flight:string, crouching:boolean, model:string, pitch:number) =>
    full.filter(t=>t.scenario.attack === 'slash' && t.scenario.flight === flight && t.scenario.crouching === crouching && t.scenario.model === model && t.scenario.pitch === pitch);
  for (const t of select('rising',false,'medium',-.5)) assert.equal(t.expectedHit,false);
  for (const t of select('rising',true,'medium',-.5)) assert.equal(t.expectedHit,true);
  for (const t of select('falling',false,'medium',-.5)) assert.equal(t.expectedHit,false);
  for (const t of select('falling',false,'large',-.5)) assert.equal(t.expectedHit,true);
  for (const t of select('landing',true,'medium',-.5)) {assert.equal(t.expectedHit,true); assert.equal(t.frames[2].live.height,0);}
  for (const t of select('landing',true,'medium',.5)) assert.equal(t.expectedHit,false);
  for (const mutation of ['missing','duplicate','failed','truncated','scenario','snapshots','impact','impact-clock','renamed','motion']) {
    const changed = structuredClone(compact);
    if (mutation === 'missing') changed.shift();
    if (mutation === 'duplicate') changed.push(changed[0]);
    if (mutation === 'failed') changed[0].differenceCount = 1;
    if (mutation === 'truncated') changed[0].frameCount--;
    if (mutation === 'scenario') changed[0].scenario.mirror = !changed[0].scenario.mirror;
    if (mutation === 'snapshots') changed[0].snapshotTicks = [2];
    if (mutation === 'impact') changed[0].firstLiveHit = 2;
    if (mutation === 'impact-clock') changed[0].impactTick = 5;
    if (mutation === 'motion') changed[0].scenario.targetMotion = 'retreat';
    if (mutation === 'renamed') changed[0].name = 'substituted';
    assert.ok(airborneViewCoverage(changed).errors.length,mutation);
  }
});
test('airborne view repeats exactly across impact and stance-release snapshots', () => {
  for (const attack of ['slash','slam','swipe','punch']) for (const flight of ['rising','falling','landing']) {
    const original = traces().find(t=>t.scenario.attack === attack && t.scenario.flight === flight && t.expectedHit)!;
    assert.deepEqual(runAirborneViewTrace(original.scenario),original);
  }
});

// The matrix must retain meaningful outcomes, not simply exercise nominal inputs.
test('expanded geometry covers moving targets, aim changes, both supported model sizes and airborne punches', () => {
  const all = traces();
  for (const attack of ['slash','slam','swipe','punch']) for (const targetMotion of ['static','approach','retreat','rise','fall'])
    for (const model of ['medium','large']) {
      const group = all.filter(t=>t.scenario.attack === attack && t.scenario.targetMotion === targetMotion && t.scenario.model === model);
      assert.equal(group.length,96);
      assert.ok(group.some(t=>t.expectedHit), `${attack}/${targetMotion}/${model} hit witness`);
      assert.ok(group.some(t=>!t.expectedHit), `${attack}/${targetMotion}/${model} miss witness`);
    }
  for (const t of all.filter(t=>t.scenario.targetMotion !== 'static')) {
    assert.ok(Math.abs(t.frames[1].live.pitch-t.frames[0].live.pitch-.2)<1e-9,'actual pointer input changes pitch');
    assert.notEqual(t.frames[t.impactTick-1].live.targetHeight+t.frames[t.impactTick-1].live.targetZ,
      t.frames[0].live.targetHeight+t.frames[0].live.targetZ,'target moves before impact');
  }
  // An approaching target crosses reach during the third frame. Real mixed
  // ordering samples the target before that frame's roster movement.
  const edge = all.filter(t=>t.scenario.attack==='slash' && t.scenario.targetMotion==='approach' &&
    t.scenario.flight==='rising' && t.scenario.model==='large' && !t.scenario.crouching && t.scenario.pitch===-.5);
  assert.equal(edge.length,8);
  for (const t of edge) assert.equal(t.expectedHit,t.scenario.execution==='live-player-v1');
});
