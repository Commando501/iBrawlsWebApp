import { INCOMING_LUNGE_MOBILITY_CASES, runIncomingLungeMobilityTrace, incomingLungeMobilityCoverage, type IncomingLungeMobilityTrace } from './grifballIncomingLungeMobility';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILITY_DECISION_CASES, runMobilityDecisionTrace, LANDING_TURNOVER_CASES, runLandingTurnoverTrace, landingTurnoverRecovery, landingTurnoverCoverage } from './grifballMobilityDecisionIntegration';
import { jumpCoverage, type JumpCoverageTrace } from './grifballJumpCoverage';
import { dashDecisionCoverage } from './grifballDashDecisionValidation';

// Share one fixed supplemental matrix between the two coverage assertions.
// Every original corridor case, cap, dash assertion and repeat remains below.
let incomingMatrix: Promise<IncomingLungeMobilityTrace[]> | undefined;
const incoming = () => incomingMatrix ??= (async () => {
  const traces: IncomingLungeMobilityTrace[] = [];
  for (const spec of INCOMING_LUNGE_MOBILITY_CASES) traces.push(await runIncomingLungeMobilityTrace(spec));
  return traces;
})();
const coverage: JumpCoverageTrace[] = [];
const dashCoverage: Parameters<typeof dashDecisionCoverage>[0][number][] = [];
for (const spec of MOBILITY_DECISION_CASES) test(`autonomous jump flight ${spec.team}/${spec.reverse}/${spec.seed}`, () => {
  const trace = runMobilityDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 3600);
  dashCoverage.push({ failureCount: trace.failureCount, scenario: spec, dash: trace.dash });
  coverage.push({ name: trace.name, scenario: trace.scenario, failureCount: trace.failureCount,
    flights: trace.flights, mainJumpRequests: trace.mainJumpRequests });
});
test('combined mobility matrices witness full flights and real dash rejections for both teams and orders', async () => {
  const supplemental = await incoming();
  assert.deepEqual(incomingLungeMobilityCoverage(supplemental), { required: 64, completed: 64, errors: [] });
  assert.deepEqual(jumpCoverage([...coverage, ...supplemental], 'mobility').missing, []);
});
test('autonomous dash matrices cover ground commitments, airborne landings and target loss', async (t) => {
  const supplemental = await incoming();
  assert.deepEqual(incomingLungeMobilityCoverage(supplemental), { required: 64, completed: 64, errors: [] });
  const allDashCoverage = [...dashCoverage, ...supplemental];
  assert.deepEqual(dashDecisionCoverage(allDashCoverage).missing, []);
  t.diagnostic(JSON.stringify(dashDecisionCoverage(allDashCoverage)));
  assert.ok(dashDecisionCoverage(allDashCoverage.filter(t => t.scenario.team !== 'red')).missing.includes('red/forward/main'));
  assert.ok(dashDecisionCoverage([]).missing.includes('target-loss'));
  assert.ok(dashDecisionCoverage(allDashCoverage.map(t => ({ ...t, dash: { ...t.dash, airborneLandings: [] } })))
    .missing.includes('blue/forward/main/airborne-landing'));
  assert.ok(dashDecisionCoverage(allDashCoverage.map(t => ({ ...t, dash: { ...t.dash, failureCount: 1 } })))
    .missing.includes('blue/forward/main/airborne-landing'), 'failed traces cannot supply landing witnesses');
  assert.ok(dashDecisionCoverage(allDashCoverage.map(t => ({ ...t, failureCount: 1 })))
    .missing.includes('blue/forward/main/airborne-landing'), 'failures outside the dash audit also disqualify witnesses');
});
for (const seed of [1, 5]) for (const reverse of [false, true]) test(`autonomous jump flight repeats: ${reverse}/${seed}`, () => {
  const spec = { mode: 'contested' as const, team: 'blue' as const, main: true, reverse, seed };
  assert.deepEqual(runMobilityDecisionTrace(spec), runMobilityDecisionTrace(spec));
});
const landingWitnesses: ReturnType<typeof runLandingTurnoverTrace>[] = [];
for (const spec of LANDING_TURNOVER_CASES) test('controlled landing across carrier death: ' + JSON.stringify(spec), () => {
  const raw=runLandingTurnoverTrace(spec), id=spec.main?'main_ai':'escort';
  assert.equal(raw.failureCount,0,JSON.stringify(raw.failures));
  assert.equal(raw.frames.length,12);
  assert.deepEqual(raw.landingRecovery,{landing:8,carrierId:'carrier',reassignedAt:9});
  landingWitnesses.push(raw);
  for(const defect of ['next-tick','inactive','no-possession','no-prior-order','dead-carrier-before','living-carrier-after',
    'missing-death','missing-impact','ball-still-held','dead-lander-next','no-next-order','stale-target','not-airborne-before',
    'dead-lander','not-grounded','airborne-after','unreset-budget','retained-order','missing-frame']) {
    const t=structuredClone(raw), before=t.frames[6], landed=t.frames[7], next=t.frames[8];
    if(defect==='next-tick') next.tick++;
    if(defect==='inactive') landed.phase='countdown';
    if(defect==='no-possession') before.ball.state='loose';
    if(defect==='no-prior-order') before.assignments=before.assignments.filter(a=>a.id!==id);
    if(defect==='dead-carrier-before') before.actors.find(a=>a.id==='carrier')!.hp=0;
    if(defect==='living-carrier-after') landed.actors.find(a=>a.id==='carrier')!.hp=1;
    if(defect==='missing-death') t.deaths=[];
    if(defect==='missing-impact') t.impacts=[];
    if(defect==='ball-still-held') landed.ball.holderId='carrier';
    if(defect==='dead-lander-next') next.actors.find(a=>a.id===id)!.hp=0;
    if(defect==='no-next-order') next.assignments=next.assignments.filter(a=>a.id!==id);
    if(defect==='stale-target') next.assignments.find(a=>a.id===id)!.target='carrier';
    if(defect==='not-airborne-before') before.actors.find(a=>a.id===id)!.isJumping=false;
    if(defect==='dead-lander') landed.actors.find(a=>a.id===id)!.hp=0;
    if(defect==='not-grounded') landed.actors.find(a=>a.id===id)!.pos[1]=.1;
    if(defect==='airborne-after') landed.actors.find(a=>a.id===id)!.isJumping=true;
    if(defect==='unreset-budget') landed.actors.find(a=>a.id===id)!.jumpBudget=1;
    if(defect==='retained-order') landed.assignments.push({...before.assignments.find(a=>a.id===id)!});
    if(defect==='missing-frame') t.frames.splice(7,1);
    assert.equal(landingTurnoverRecovery(t,id,8),null,defect);
  }
});
test('landing-turnover coverage requires every declared case and verified next-tick recovery',()=>{
  assert.deepEqual(landingTurnoverCoverage(landingWitnesses),{required:8,completed:8,errors:[]});
  for(const defect of ['missing','duplicate','failed','short','missing-recovery','wrong-carrier','late-reassignment','wrong-team']) {
    const t=structuredClone(landingWitnesses), first=t[0];
    if(defect==='missing')t.shift();
    if(defect==='duplicate')t.push(first);
    if(defect==='failed')first.failureCount=1;
    if(defect==='short')first.ticks=11;
    if(defect==='missing-recovery')first.landingRecovery=null;
    if(defect==='wrong-carrier')first.landingRecovery!.carrierId='defender';
    if(defect==='late-reassignment')first.landingRecovery!.reassignedAt=10;
    if(defect==='wrong-team')first.scenario.team='red';
    assert.ok(landingTurnoverCoverage(t).errors.length,defect);
  }
});
for(const main of [false,true])test('controlled landing repeats: main='+main,()=>{
  const spec={mode:'contested' as const,team:'red' as const,reverse:true,main};
  assert.deepEqual(runLandingTurnoverTrace(spec),runLandingTurnoverTrace(spec));
});
