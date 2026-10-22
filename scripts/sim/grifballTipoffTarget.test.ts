import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  selectGrifballAssignmentThreat,
} from '../../src/game/aiGrifballTeamPlan';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { stepSimulation } from '../../src/sim/step';
import type { GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';

const dt = 1 / 60;
const rounded = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e8) / 1e8 : x)));
function targetTrace(
  id: string,
  mirror: boolean,
  style: GrifballPlayerStyle,
  strength = 1,
  commitmentSeconds?: number,
) {
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', attackRange: 1.8, attackRadius: 2 }, 'nearest');
  const { state, sim, bot, target } = f;
  const [self, enemy] = sim.combatants;
  const team = mirror ? 'red' : 'blue',
    rivalTeam = mirror ? 'blue' : 'red',
    sign = mirror ? -1 : 1;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    tipoffEnabled: true,
    tipoffTargetAgencyStrength: strength,
    stylesEnabled: false,
    passingEnabled: false,
    ...(commitmentSeconds !== undefined ? { tipoffTargetCommitSeconds: commitmentSeconds, refreshSeconds: 0.05 } : {}),
  });
  state.grifballTactics.botStyles[id] = style;
  for (const [c, live, name, t, x, z] of [
    [self, bot, id, team, -8, -6],
    [enemy, target, 'nearest', rivalTeam, 2.5, -5.5],
  ] as const) {
    c.id = name;
    c.team = live.team = t;
    c.controller = live.controller = 'ai';
    c.pos = { x: x * sign, y: 0, z: z * sign };
    live.pos.set(c.pos.x, 0, c.pos.z);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.weaponState = 'idle';
    live.weaponState = 'ready';
    c.invulnerabilityTimer = c.weaponReadyTimer = live.invulnerabilityTimer = 0;
    c.yaw = 0;
    live.yaw = Math.PI;
    c.hp = c.maxHp = live.hp;
  }
  for (const [name, t, x, z] of [
    ['collector', team, -8, 0],
    ['reserve', team, -16, 0],
    ['support', team, -10, 6],
    ['preferred', rivalTeam, 3, -2.5],
  ] as const) {
    const c = structuredClone(self);
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
  sim.match.ball.state = state.grifball.ball.state = 'idle';
  if (style === 'opportunist') {
    const c = sim.combatants.find((c) => c.id === 'preferred')!;
    c.weaponState = 'recovering';
    c.weaponTimer = sim.settings.hammerReloadTime;
    const live = state.otherPlayers.get('preferred')!;
    live.weaponState = 'recovering';
    live.weaponTimer = 0;
  }
  if (style === 'guardian') state.grifballTactics.defaults.threatHorizon = 1.9;
  if (mirror) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const owners = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const plan = createGrifballTeamPlanState();
  const frames: unknown[] = [];
  let heldFrames = 0,
    changedTargets = 0;
  let previousTarget: string | null = null;
  for (let tick = 0; tick < 12; tick++) {
    if (commitmentSeconds !== undefined && tick > 0) {
      // Both engines observe the same small rival movement. Each independently
      // chooses and executes a screen route; no orders are copied between hosts.
      enemy.pos.x = target.pos.x = (Math.floor((tick - 1) / 4) % 2 ? 2.5 : 4) * sign;
    }
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(
      plan,
      createSimGrifballTacticalSnapshot(sim, { scriptedBots: owners, tactics: state.grifballTactics }),
      dt,
    );
    const a = plan.assignments.get(id)!,
      b = state.aiMatchContext.grifballTeamPlan.assignments.get(id)!;
    assert.equal(a.tipoff!.job, 'screen');
    assert.deepEqual(rounded(a.tipoff), rounded(b.tipoff));
    assert.deepEqual(rounded(a.destination), rounded(b.destination));
    if (a.tipoff!.targetSelection?.commitment?.retained) heldFrames++;
    if (previousTarget && previousTarget !== a.tipoff!.targetId) changedTargets++;
    previousTarget = a.tipoff!.targetId;
    assert.equal(
      selectGrifballAssignmentThreat(a, self.pos, plan.snapshot!.players),
      selectGrifballAssignmentThreat(b, bot.pos, state.aiMatchContext.grifballTeamPlan.snapshot!.players),
    );
    if (tick === 0) {
      assert.equal(a.tipoff!.attack, true, JSON.stringify({ order: a.tipoff, players: plan.snapshot!.players }));
      assert.equal(
        a.tipoff!.targetId,
        strength === 0 || style === 'balanced' ? 'nearest' : 'preferred',
        JSON.stringify(a.tipoff),
      );
      if (strength > 0) assert.equal(a.tipoff!.targetSelection!.changedByStyle, style !== 'balanced');
    }
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
    stepSimulation(sim, { [id]: input.action }, { scriptedObjective: input.scriptedObjective });
    assert.deepEqual(rounded(self.pos), rounded(bot.pos));
    assert.deepEqual(rounded(self.vel), rounded(bot.vel));
    frames.push({ ...self.pos });
  }
  assert.notDeepEqual(frames[0], frames[11]);
  if (commitmentSeconds !== undefined) {
    assert.equal(changedTargets > 0, commitmentSeconds === 0);
    assert.equal(heldFrames > 0, commitmentSeconds > 0);
  }
  return frames;
}

for (const id of ['main_ai', 'bot_2'])
  for (const mirror of [false, true])
    test(`live/sim target individuality changes actual screen movement ${id}/${mirror}`, () => {
      const baseline = targetTrace(id, mirror, 'balanced');
      assert.deepEqual(targetTrace(id, mirror, 'enforcer', 0), baseline);
      for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
        assert.notDeepEqual(targetTrace(id, mirror, style), baseline, style + ' must change executed movement');
    });

for (const id of ['main_ai', 'bot_2'])
  for (const mirror of [false, true])
    test(`live/sim target commitment steadies executed movement through rival jitter ${id}/${mirror}`, () => {
      const reactive = targetTrace(id, mirror, 'balanced', 1, 0);
      const steady = targetTrace(id, mirror, 'balanced', 1, 0.6);
      assert.notDeepEqual(steady, reactive, 'commitment must change actual screen movement');
    });
