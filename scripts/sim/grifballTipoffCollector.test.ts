import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { stepSimulation } from '../../src/sim/step';

import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';

const dt = 1 / 60;
const rounded = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e8) / 1e8 : x)));
function collectorTrace(id: string, mirror: boolean, enabled: boolean) {
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', attackRange: 1.8, attackRadius: 2 }, 'enemy');
  const { state, sim, bot, target } = f;
  const [self, enemy] = sim.combatants;
  const team = mirror ? 'red' : 'blue',
    rival = mirror ? 'blue' : 'red',
    sign = mirror ? -1 : 1;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    tipoffEnabled: true,
    tipoffCollectorHandoffEnabled: enabled,
    stylesEnabled: false,
    passingEnabled: false,
    refreshSeconds: 0.05,
  });
  for (const [c, live, name, t, x, z] of [
    [self, bot, id, team, -2, -2],
    [enemy, target, 'enemy', rival, 40, 0],
  ] as const) {
    c.id = name;
    c.team = live.team = t;
    c.controller = live.controller = 'ai';
    c.pos = { x: x * sign, y: 0, z: z * sign };
    live.pos.set(c.pos.x, 0, c.pos.z);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.yaw = 0;
    live.yaw = Math.PI;
    c.weaponState = 'idle';
    live.weaponState = 'ready';
    c.weaponReadyTimer = c.invulnerabilityTimer = live.invulnerabilityTimer = 0;
    c.hp = c.maxHp = live.hp;
  }
  for (const [name, x, z] of [
    ['collector', -1.5, 0],
    ['reserve', -16, 0],
    ['support', -10, 6],
  ] as const) {
    const c = structuredClone(self);
    c.id = name;
    c.pos = { x: x * sign, y: 0, z: z * sign };
    sim.combatants.push(c);
    const live = createOfflineBotCombatant({
      id: name,
      playerName: name,
      team,
      spawnPos: bot.pos.clone().set(c.pos.x, 0, c.pos.z),
      yaw: Math.PI,
      hue: 0,
      difficulty: 'normal',
      settings: state.settings,
    });
    live.invulnerabilityTimer = 0;
    live.weaponState = 'ready';
    live.weaponTimer = 0;
    state.otherPlayers.set(name, live);
  }
  sim.match.ball.state = state.grifball.ball.state = 'idle';
  if (mirror) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const owners = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const plan = createGrifballTeamPlanState(),
    frames: unknown[] = [];
  const incumbent = sim.combatants.find((c) => c.id === 'collector')!,
    liveIncumbent = state.otherPlayers.get('collector')!;
  let tookOver = false;
  for (let tick = 0; tick < 36; tick++) {
    if (tick === 1) {
      incumbent.weaponState = 'recovering';
      incumbent.weaponTimer = sim.settings.hammerReloadTime;
    }
    // Only the candidate's live movement runs in this fixture; mirror the
    // incumbent's publicly observed recovery clock from the simulated actor.
    assert.ok(incumbent.weaponState === 'idle' || incumbent.weaponState === 'recovering');
    liveIncumbent.weaponState = incumbent.weaponState === 'idle' ? 'ready' : 'recovering';
    liveIncumbent.weaponTimer =
      incumbent.weaponState === 'recovering' ? sim.settings.hammerReloadTime - incumbent.weaponTimer : 0;
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(
      plan,
      createSimGrifballTacticalSnapshot(sim, { scriptedBots: owners, tactics: state.grifballTactics }),
      dt,
    );
    const a = plan.assignments.get(id)!,
      b = state.aiMatchContext.grifballTeamPlan.assignments.get(id)!;
    assert.deepEqual(rounded(a.tipoff), rounded(b.tipoff));
    assert.deepEqual(rounded(a.destination), rounded(b.destination));
    assert.equal(plan.assignments.get('reserve')!.tipoff!.job, 'reserve');
    if (tick === 0) assert.equal(a.tipoff!.collectorId, 'collector');
    if (tick > 0 && enabled) {
      assert.equal(a.tipoff!.collectorSelection!.selectedId, id);
      tookOver = true;
    }
    const input = resolveSimGrifballSupportInput(sim, plan, id, owners, dt)!;
    assert.ok(input);
    assert.equal(input.action.pickup, tick > 0 && enabled);
    const frame = {
      pos: bot.pos,
      vel: bot.vel,
      yaw: bot.yaw,
      aiState: bot.aiState,
      timer: bot.aiTimer ?? 0,
      dashRemaining: 0,
      slideActive: false,
      weaponState: bot.weaponState ?? 'ready',
      pickupRequested: false,
    };
    assert.ok(
      resolvePrimaryGrifballAIObjectiveMovementForCombatant({
        state,
        botId: id,
        self: bot,
        frame,
        alliesList: [...state.otherPlayers.values()].filter((p) => p.team === team && p.id !== id).map((p) => p.pos),
        enemiesList: [...state.otherPlayers.values()].filter((p) => p.team !== team).map((p) => p.pos),
        dt,
        canStartWeaponAction: true,
        triggerCombatantAttack: () => assert.fail('ground movement does not start combat'),
        getEnemyGoalPos: goal,
        constrainCombatantToArena: (pos, vel) =>
          constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }),
      }),
    );
    bot.yaw = frame.yaw;
    bot.aiState = frame.aiState;
    bot.aiTimer = frame.timer;
    bot.pickupRequested = frame.pickupRequested;
    updateGrifballObjectiveForState({
      state,
      refs: f.refs,
      ballMeshRef: { current: null },
      ballChargingRef: { current: false },
      ballChargeTimerRef: { current: 0 },
      dt,
      isMultiplayer: false,
      activeCustomMap: f.map,
      placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'),
      pushStatsUpdate: () => {},
    });
    stepSimulation(sim, { [id]: input.action }, { scriptedObjective: input.scriptedObjective });
    assert.deepEqual(rounded(self.pos), rounded(bot.pos));
    assert.deepEqual(rounded(self.vel), rounded(bot.vel));

    assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId);
    frames.push({ ...self.pos });
    if (sim.match.ball.holderId) break;
  }
  assert.equal(tookOver, enabled);
  assert.equal(sim.match.ball.holderId, enabled ? id : null);
  if (enabled) {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(
      plan,
      createSimGrifballTacticalSnapshot(sim, { scriptedBots: owners, tactics: state.grifballTactics }),
      dt,
    );
    assert.ok([...plan.assignments.values()].every((a) => !a.tipoff));
    assert.ok([...state.aiMatchContext.grifballTeamPlan.assignments.values()].every((a) => !a.tipoff));
  }
  return frames;
}
for (const id of ['main_ai', 'bot_2'])
  for (const mirror of [false, true])
    test('live/sim collector handoff moves and collects ' + id + '/' + mirror, () => {
      assert.notDeepEqual(collectorTrace(id, mirror, true), collectorTrace(id, mirror, false));
    });
