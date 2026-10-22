import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, type ScriptedObjectiveInput } from '../../src/sim/scriptedObjectiveInput';
import type { ActionInput } from '../../src/sim/actions';

const dt = 1 / 60;
const rounded = (value: unknown) =>
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v)));
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function trace(style: GrifballPlayerStyle, main: boolean, mirror: boolean, reverse: boolean, strength = 1) {
  const id = main ? 'main_ai' : 'b',
    team = mirror ? 'red' : 'blue',
    sign = mirror ? -1 : 1;
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'a');
  const { state, sim, bot, target } = f,
    [self, other] = sim.combatants;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    pickupAgencyStrength: strength,
    stylesEnabled: false,
    tankingEnabled: false,
    passingEnabled: false,
  });
  state.grifballTactics.teams.red = { pickupAgencyStrength: strength * 0.8 };
  state.grifballTactics.botStyles = { [id]: style };
  self.id = id;
  other.id = 'a';
  for (const [c, live, x, z] of [
    [self, bot, -Math.sqrt(5.5 ** 2 - 16), -4],
    [other, target, -3, 4],
  ] as const) {
    c.team = live.team = team;
    c.controller = live.controller = 'ai';
    c.pos = { x: x * sign, y: 0, z: z * sign };
    live.pos.set(c.pos.x, 0, c.pos.z);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.yaw = 0;
    live.yaw = Math.PI;
    c.hp = c.maxHp = live.hp;
    c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    c.weaponState = 'idle';
  }
  for (const [name, x, t] of [
    ['back', -15, team],
    ['enemy', 25, mirror ? 'blue' : 'red'],
  ] as const) {
    const c = structuredClone(other);
    c.id = name;
    c.team = t;
    c.pos = { x: x * sign, y: 0, z: 0 };
    sim.combatants.push(c);
    const live = createOfflineBotCombatant({
      id: name,
      playerName: name,
      team: t,
      spawnPos: bot.pos.clone().set(c.pos.x, 0, 0),
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
  state.grifball.ball.state = sim.match.ball.state = 'loose';
  if (reverse) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const tactics = structuredClone(state.grifballTactics),
    plan = createGrifballTeamPlanState();
  const scriptedBots = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const expected = strength && (style === 'enforcer' || style === 'opportunist') ? id : 'a';
  const frames: unknown[] = [];
  let receipt = 0;
  // The opponent remains stationary. Both engines independently plan all bots
  // and execute friendly ground steering, pickup requests and actual possession.
  for (let tick = 1; tick <= 180; tick++) {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
    const orders = [...plan.assignments.values()].filter((a) => a.team === team);
    assert.equal(orders.filter((a) => a.role === 'retriever').length, 1);
    assert.equal(orders.find((a) => a.role === 'retriever')!.botId, expected);
    assert.equal(orders.filter((a) => a.role === 'safety').length, 1);
    const actions: Record<string, ActionInput> = {},
      objective: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots, movement: {} };
    const friendly = sim.combatants.filter((c) => c.team === team);
    for (const c of friendly) {
      const a = plan.assignments.get(c.id)!,
        b = state.aiMatchContext.grifballTeamPlan.assignments.get(c.id)!;
      assert.deepEqual(rounded(a.pickupAgency), rounded(b.pickupAgency), `${tick}/${c.id}/bid`);
      assert.deepEqual(rounded(a.destination), rounded(b.destination), `${tick}/${c.id}/destination`);
      if (strength) {
        assert.equal(a.pickupAgency!.strength, strength * (mirror ? 0.8 : 1));
        assert.equal(a.pickupAgency!.candidates.find((p) => p.botId === id)!.style, style);
      } else assert.equal(a.pickupAgency, undefined);
      const input = resolveSimGrifballSupportInput(sim, plan, c.id, scriptedBots, dt);
      assert.ok(input, `${c.id} must execute ground steering`);
      actions[c.id] = input.action;
      Object.assign(objective.movement, input.scriptedObjective.movement);
    }
    for (const c of friendly) {
      const live = state.otherPlayers.get(c.id)!;
      const frame = {
        pos: live.pos,
        vel: live.vel,
        yaw: live.yaw,
        aiState: live.aiState,
        timer: live.aiTimer ?? 0,
        dashRemaining: 0,
        slideActive: false,
        weaponState: live.weaponState ?? 'ready',
        pickupRequested: false,
      };
      assert.ok(
        resolvePrimaryGrifballAIObjectiveMovementForCombatant({
          state,
          botId: c.id,
          self: live,
          frame,
          alliesList: [...state.otherPlayers.values()].filter((p) => p.team === team && p.id !== c.id).map((p) => p.pos),
          enemiesList: [...state.otherPlayers.values()].filter((p) => p.team !== team).map((p) => p.pos),
          dt,
          canStartWeaponAction: true,
          triggerCombatantAttack: () => assert.fail('ground recovery must not start an attack'),
          getEnemyGoalPos: goal,
          constrainCombatantToArena: (pos, vel) =>
            constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }),
        }),
      );
      live.yaw = frame.yaw;
      live.aiState = frame.aiState;
      live.aiTimer = frame.timer;
      live.pickupRequested = frame.pickupRequested;
    }
    updateGrifballObjectiveForState({
      state,
      refs: f.refs,
      ballMeshRef: { current: null },
      ballChargingRef: { current: false },
      ballChargeTimerRef: { current: 0 },
      dt,
      isMultiplayer: false,
      activeCustomMap: f.map,
      placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected round reset'),
      pushStatsUpdate: () => {},
    });
    stepSimulation(sim, actions, { settings: sim.settings, scriptedObjective: objective });
    for (const c of friendly) {
      const live = state.otherPlayers.get(c.id)!;
      for (const axis of ['x', 'y', 'z'] as const) {
        near(c.pos[axis], live.pos[axis], `${tick}/${c.id}/pos/${axis}`);
        near(c.vel[axis], live.vel[axis], `${tick}/${c.id}/vel/${axis}`);
      }
    }
    assert.equal(sim.match.ball.state, state.grifball.ball.state);
    assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId);
    for (const axis of ['x', 'y', 'z'] as const)
      near(sim.match.ball.pos[axis], state.grifball.ball.pos[axis], `${tick}/ball/${axis}`);
    frames.push({ tick, holder: sim.match.ball.holderId, positions: friendly.map((c) => ({ id: c.id, pos: rounded(c.pos) })) });
    if (sim.match.ball.holderId) {
      receipt = tick;
      break;
    }
  }
  assert.ok(receipt > 0, 'the selected bot must actually collect the ball');
  assert.equal(sim.match.ball.holderId, expected);
  updateGrifballTeamPlanForState(state, dt, goal, f.map);
  updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
  assert.ok([...plan.assignments.values()].every((a) => !a.pickupAgency));
  assert.ok([...state.aiMatchContext.grifballTeamPlan.assignments.values()].every((a) => !a.pickupAgency));
  return { receipt, holder: sim.match.ball.holderId, frames };
}
for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[])
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true])
        test(`live/sim pickup individuality and possession ${style}/${main}/${mirror}/${reverse}`, () => {
          trace(style, main, mirror, reverse);
        });
test('zero strength preserves every movement frame and the actual receiver across styles', () => {
  const baseline = trace('balanced', false, false, false, 0);
  for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
    assert.deepEqual(trace(style, false, false, false, 0), baseline);
});
