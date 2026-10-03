import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createSnapshotRouters, planGrifballRunner, tickRunnerMemory } from './aiGrifballRunner';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballAssignment, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';

function fixture(sign: number, reverse: boolean) {
  const team = sign === 1 ? 'blue' : 'red', enemy = team === 'blue' ? 'red' : 'blue';
  const actor = (id: string, owner: string, x: number, z: number) => ({ id, team: owner,
    pos: { x: x * sign, z: z * sign }, vel: { x: 0, z: 0 }, scripted: true,
    space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer', 'ready') });
  const carrier = actor('runner', team, 0, 0), escort = actor('escort', team, 6, 5), threat = actor('threat', enemy, 6, 0);
  const tactics = defaultGrifballTactics(); tactics.defaults.stylesEnabled = false; tactics.defaults.passingEnabled = false;
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: carrier.id, ball: { x: 0, z: 0 }, spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, tactics,
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    players: reverse ? [threat, escort, carrier] : [carrier, escort, threat] };
  return { snapshot, carrier, escort, threat, team, enemy, tuning: tactics.defaults };
}

for (const sign of [1, -1]) for (const reverse of [false, true])
  for (const intent of ['engaged', 'cover', 'other-threat', 'missing', 'human', 'late'] as const)
    test(`runner pressure credit respects published support intent ${sign}/${reverse}/${intent}`, () => {
      const f = fixture(sign, reverse);
      if (intent === 'human') f.escort.scripted = false;
      if (intent === 'late') f.escort.space.attackIn = 3;
      const targets = new Map<string, string | null>();
      if (intent !== 'missing') targets.set(f.escort.id, intent === 'cover' ? null : intent === 'other-threat' ? 'another-enemy' : f.threat.id);
      const plan = planGrifballRunner(f.snapshot, f.carrier, f.tuning,
        tickRunnerMemory(undefined, f.carrier, f.snapshot.goals[f.enemy]!, 0), createSnapshotRouters(f.snapshot), undefined, targets);
      const advance = plan.candidates.find(c => c.action === 'advance')!;
      assert.equal(advance.risk, intent === 'engaged' ? .55 : 1);
    });

for (const sign of [1, -1]) for (const reverse of [false, true])
  for (const intent of ['engage', 'cover', 'release', 'receive', 'old-possession'] as const)
    test(`team runner planning consumes rechecked teammate orders ${sign}/${reverse}/${intent}`, () => {
      const f = fixture(sign, reverse), state = createGrifballTeamPlanState();
      state.snapshot = structuredClone(f.snapshot);
      if (intent === 'old-possession') state.snapshot.holderId = 'previous-runner';
      const assignment: GrifballAssignment = { botId: f.escort.id, team: f.team, role: 'cover', slot: 1,
        destination: { ...f.escort.pos }, anchor: { ...f.carrier.pos }, carrierId: f.carrier.id,
        reason: 'Previously published support order', tuning: f.tuning, geometry: f.snapshot.geometry,
        tanking: { mode: intent === 'engage' || intent === 'old-possession' ? 'engage' : intent === 'release' ? 'release' : 'cover',
          targetId: intent === 'engage' || intent === 'old-possession' ? f.threat.id : null,
          attack: intent === 'engage' || intent === 'old-possession', partnerId: null, recoveryId: null,
          doubleCommit: false, reason: 'Observed engagement intent', candidates: [] } };
      if (intent === 'receive') assignment.receive = { carrierId: f.carrier.id, point: { ...f.escort.pos }, seconds: 1 };
      state.assignments.set(f.escort.id, assignment);
      updateGrifballTeamPlan(state, f.snapshot, .2);
      const advance = state.runnerPlans[f.team].candidates.find(c => c.action === 'advance')!;
      assert.equal(advance.risk, intent === 'engage' ? .55 : 1);
    });
