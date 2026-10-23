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
function reserveTrace(id: string, mirror: boolean, enabled: boolean, individuality?: number) {
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
    tipoffReserveHandoffEnabled: enabled,
    tipoffReserveAgencyStrength: individuality ?? 0,
    stylesEnabled: false,
    passingEnabled: false,
    refreshSeconds: 0.05,
  });
  if (individuality !== undefined) state.grifballTactics.botStyles[id] = 'guardian';

  for (const [c, live, name, t, x, z] of [
    [self, bot, id, team, individuality !== undefined ? -16.8 : -10, individuality !== undefined ? 0 : 6],
    [enemy, target, 'enemy', rival, 4, -6],
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
    ['collector', -8, 0],
    ['reserve', -16, 0],
    ['screen', -8, -6],
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

  const incumbent = sim.combatants.find((c) => c.id === 'reserve')!,
    liveIncumbent = state.otherPlayers.get('reserve')!;
  let pending = 0,
    covered = 0,
    returning = false;
  for (let tick = 0; tick < 150; tick++) {
    if (tick === 1 && individuality === undefined) {
      incumbent.weaponState = 'recovering';
      incumbent.weaponTimer = sim.settings.hammerReloadTime;
    }
    // Mirror the unexecuted reserve's public recovery clock; the replacement's
    // actual steering, ground movement and objective update run independently.
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
    if (tick === 0) {
      assert.equal(a.tipoff!.reserveId, individuality ? id : 'reserve');
      if (individuality) {
        assert.equal(a.tipoff!.reserveSelection!.agency!.changedChoice, true);
        assert.equal(a.tipoff!.reserveSelection!.agency!.baselineId, 'reserve');
      }
    }
    if (individuality === undefined ? enabled && tick > 0 : individuality > 0) {
      assert.equal(a.tipoff!.reserveId, id);
      assert.equal(a.tipoff!.job, 'reserve');
      if (a.tipoff!.reserveSelection!.covered) covered++;
      else {
        pending++;
        assert.ok([...plan.assignments.values()].filter((p) => p.team === team).every((p) => !p.tipoff!.attack));
      }
      if (incumbent.weaponState === 'idle') returning = true;
    } else if (!enabled) assert.ok(!a.tipoff!.reserveSelection);
    const input = resolveSimGrifballSupportInput(sim, plan, id, owners, dt)!;
    assert.ok(input);
    assert.equal(input.action.pickup, false);
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
  }
  assert.equal(sim.match.ball.holderId, null);
  if (individuality === undefined ? enabled : individuality > 0) {
    if (individuality === undefined) assert.ok(pending > 0, 'replacement spends real frames returning');
    assert.ok(covered > 0, 'replacement actually reaches rear coverage');
    assert.equal(returning, true, 'recovered reserve does not take the role back');
  }
  return frames;
}
for (const id of ['main_ai', 'bot_2'])
  for (const mirror of [false, true])
    test('live/sim reserve handoff executes return to coverage ' + id + '/' + mirror, () => {
      assert.notDeepEqual(reserveTrace(id, mirror, true), reserveTrace(id, mirror, false));
    });

for (const id of ['main_ai', 'bot_2'])
  for (const mirror of [false, true])
    test('live/sim reserve individuality changes role and executed movement ' + id + '/' + mirror, () => {
      assert.notDeepEqual(reserveTrace(id, mirror, true, 1), reserveTrace(id, mirror, true, 0));
    });
