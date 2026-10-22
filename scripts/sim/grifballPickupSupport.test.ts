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
  const id = main ? 'main_ai' : 'cover',
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
    pickupSupportAgencyStrength: strength,
    stylesEnabled: false,
    tankingEnabled: false,
    passingEnabled: false,
  });
  state.grifballTactics.teams.red = { pickupSupportAgencyStrength: strength * 0.8 };
  state.grifballTactics.botStyles = { [id]: style };
  self.id = id;
  other.id = 'a';
  for (const [c, live, x, z] of [
    [self, bot, -4, -7],
    [other, target, -5, 0],
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
  for (const [name, x, z, t] of [
    ['back', -12, 0, team],
    ['other', -4, 7, team],
    ['enemy', 25, 0, mirror ? 'blue' : 'red'],
  ] as const) {
    const c = structuredClone(other);
    c.id = name;
    c.team = t;
    c.pos = { x: x * sign, y: 0, z: z * sign };
    sim.combatants.push(c);
    const live = createOfflineBotCombatant({
      id: name,
      playerName: name,
      team: t,
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
  state.grifball.ball.state = sim.match.ball.state = 'loose';
  if (reverse) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const tactics = structuredClone(state.grifballTactics),
    plan = createGrifballTeamPlanState();
  const scriptedBots = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const frames: unknown[] = [];
  let receipt = 0,
    applied = 0,
    moved = 0;
  // Opponents remain stationary. Both engines independently plan and execute
  // every friendly ground order through actual pickup and the next possession.
  for (let tick = 1; tick <= 180; tick++) {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
    const orders = [...plan.assignments.values()].filter((a) => a.team === team);
    assert.deepEqual(
      orders.filter((a) => a.role === 'retriever').map((a) => a.botId),
      ['a'],
    );
    assert.deepEqual(
      orders.filter((a) => a.role === 'safety').map((a) => a.botId),
      ['back'],
    );
    const cover = plan.assignments.get(id)!;
    assert.equal(cover.defense!.mode, 'recover');
    if (strength) {
      const d = cover.defense!.pickupSupport!;
      assert.equal(d.style, style);
      assert.equal(d.strength, strength * (mirror ? 0.8 : 1));
      if (d.applied) applied++;
    } else assert.equal(cover.defense!.pickupSupport, undefined);
    assert.equal(plan.assignments.get('a')!.defense?.pickupSupport, undefined);
    assert.equal(plan.assignments.get('back')!.defense!.pickupSupport, undefined);
    const actions: Record<string, ActionInput> = {},
      objective: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots, movement: {} };
    const friendly = sim.combatants.filter((c) => c.team === team);
    for (const c of friendly) {
      const a = plan.assignments.get(c.id)!,
        b = state.aiMatchContext.grifballTeamPlan.assignments.get(c.id)!;
      assert.deepEqual(rounded(a.defense), rounded(b.defense), `${tick}/${c.id}/defense`);
      assert.deepEqual(rounded(a.destination), rounded(b.destination), `${tick}/${c.id}/destination`);
      const input = resolveSimGrifballSupportInput(sim, plan, c.id, scriptedBots, dt);
      assert.ok(input, `${c.id} must execute ground steering`);
      if (c.id === id) assert.equal(input.action.pickup, false, 'a lateral support must not steal the pickup');
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
          triggerCombatantAttack: () => assert.fail('ground support must not start an attack'),
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
    if (Math.hypot(self.vel.x, self.vel.z) > 0.01) moved++;
    frames.push({ tick, holder: sim.match.ball.holderId, positions: friendly.map((c) => ({ id: c.id, pos: rounded(c.pos) })) });
    if (sim.match.ball.holderId) {
      receipt = tick;
      break;
    }
  }
  assert.ok(receipt > 0, 'the team retriever must actually collect the ball');
  assert.equal(sim.match.ball.holderId, 'a');
  assert.ok(moved > 0, 'the supporting bot must actually move');
  assert.equal(applied > 0, strength > 0 && style !== 'balanced');
  updateGrifballTeamPlanForState(state, dt, goal, f.map);
  updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
  assert.ok([...plan.assignments.values()].every((a) => !a.defense?.pickupSupport));
  assert.ok([...state.aiMatchContext.grifballTeamPlan.assignments.values()].every((a) => !a.defense?.pickupSupport));
  return { receipt, holder: sim.match.ball.holderId, frames };
}
for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[])
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true])
        test(`live/sim pickup support through possession ${style}/${main}/${mirror}/${reverse}`, () => {
          trace(style, main, mirror, reverse);
        });
test('zero strength preserves the complete movement trace across player styles', () => {
  const baseline = trace('balanced', false, false, false, 0);
  for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
    assert.deepEqual(trace(style, false, false, false, 0), baseline);
});
test('each personal position changes actual support movement while preserving pickup ownership and timing', () => {
  const baseline = trace('balanced', false, false, false, 0);
  for (const style of ['enforcer', 'opportunist', 'guardian'] as const) {
    const individual = trace(style, false, false, false);
    assert.notDeepEqual(individual.frames, baseline.frames);
    assert.equal(individual.receipt, baseline.receipt);
    assert.equal(individual.holder, baseline.holder);
  }
});
