import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import {
  setGrifballCarrierForState,
  updateGrifballObjectiveForState,
} from '../../src/components/grifball/grifballObjectiveRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { setSimCarrier } from '../../src/sim/grifball';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballCarrierInput } from '../../src/sim/grifballCarrierInput';
import { stepSimulation } from '../../src/sim/step';

const dt = 1 / 60;
const rounded = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v)));
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function trace(style: GrifballPlayerStyle, mirror: boolean, main: boolean, reverse: boolean, strength = 1) {
  const id = main ? 'main_ai' : 'runner',
    team = mirror ? 'red' : 'blue',
    sign = mirror ? -1 : 1;
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'enemy');
  const { state, sim, bot, target } = f,
    [self, other] = sim.combatants;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    runnerPatienceAgencyStrength: strength,
    runnerMaxWait: 2,
    runnerCutWidth: 1,
    runnerRiskWeight: 20,
    stylesEnabled: false,
    passingEnabled: false,
    tankingEnabled: false,
    defenseEnabled: false,
  });
  state.grifballTactics.botStyles = { [id]: style, escort: 'guardian' };
  self.id = id;
  other.id = 'enemy';
  for (const [c, live, x, t] of [
    [self, bot, 0, team],
    [other, target, 12, mirror ? 'blue' : 'red'],
  ] as const) {
    c.team = live.team = t;
    c.controller = live.controller = 'ai';
    c.pos = { x: x * sign, y: 0, z: 0 };
    live.pos.set(c.pos.x, 0, 0);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.yaw = 0;
    live.yaw = Math.PI;
    c.hp = c.maxHp = live.hp;
    c.invulnerabilityTimer = c.weaponReadyTimer = 0;
    c.weaponState = 'idle';
  }
  const escort = structuredClone(other);
  escort.id = 'escort';
  escort.team = team;
  escort.pos.x = -3 * sign;
  sim.combatants.push(escort);
  const liveEscort = createOfflineBotCombatant({
    id: 'escort',
    playerName: 'Escort',
    team,
    spawnPos: bot.pos.clone().set(escort.pos.x, 0, 0),
    yaw: Math.PI,
    hue: 0,
    difficulty: 'normal',
    settings: state.settings,
  });
  liveEscort.invulnerabilityTimer = 0;
  liveEscort.weaponState = 'ready';
  liveEscort.weaponTimer = 0;
  state.otherPlayers.set('escort', liveEscort);
  state.grifball.ball.state = sim.match.ball.state = 'held';
  state.grifball.ball.holderId = sim.match.ball.holderId = id;
  setSimCarrier(self, true, sim.settings);
  setGrifballCarrierForState({ state, id, carrying: true });
  if (reverse) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const tactics = structuredClone(state.grifballTactics),
    plan = createGrifballTeamPlanState();
  const scriptedBots = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const frames: unknown[] = [];
  let firstMove = 0,
    firstBudget = 0,
    arrival = 0;
  // The escort and defender stay put to isolate the carrier's patience clock.
  // Both physical owners independently execute every carrier input, including wait.
  for (let tick = 1; tick <= 180; tick++) {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
    const livePlan = state.aiMatchContext.grifballTeamPlan.runnerPlans[team],
      simPlan = plan.runnerPlans[team];
    assert.deepEqual(rounded(simPlan), rounded(livePlan), `${tick}/plan`);
    assert.deepEqual(rounded(plan.runnerMemory), rounded(state.aiMatchContext.grifballTeamPlan.runnerMemory), `${tick}/memory`);
    if (tick === 1) {
      assert.equal(simPlan.selected.action, 'wait');
      firstBudget = simPlan.patience?.maxWait ?? 2;
      arrival = 3 / 5.2;
    }
    if (strength) {
      assert.equal(simPlan.patience!.style, style);
      assert.equal(simPlan.patience!.strength, strength);
    } else assert.equal(simPlan.patience, undefined);
    const carrier = resolveSimGrifballCarrierInput(sim, plan, id, scriptedBots, true)!;
    assert.ok(carrier.input, `executable carrier input required: ${carrier.decision.kind}`);
    const frame = {
      pos: bot.pos,
      vel: bot.vel,
      yaw: bot.yaw,
      aiState: bot.aiState,
      timer: bot.aiTimer ?? 0,
      dashRemaining: bot.aiDashRemaining ?? 0,
      slideActive: !!bot.aiSlideActive,
      weaponState: bot.weaponState ?? 'ready',
      pickupRequested: !!bot.pickupRequested,
    };
    assert.ok(
      resolvePrimaryGrifballAIObjectiveMovementForCombatant({
        state,
        botId: id,
        self: bot,
        frame,
        alliesList: [liveEscort.pos],
        enemiesList: [target.pos],
        dt,
        canStartWeaponAction: true,
        triggerCombatantAttack: () => assert.fail('A distant threat must not trigger a punch'),
        getEnemyGoalPos: goal,
        constrainCombatantToArena: (pos, vel) =>
          constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }),
      }),
    );
    bot.yaw = frame.yaw;
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
      placeCombatantsAtGrifballSpawns: () => assert.fail('Unexpected reset'),
      pushStatsUpdate: () => {},
    });
    stepSimulation(
      sim,
      { [id]: carrier.input.action },
      { settings: sim.settings, scriptedObjective: carrier.input.scriptedObjective },
    );
    for (const axis of ['x', 'y', 'z'] as const) {
      near(bot.pos[axis], self.pos[axis], `${tick}/position/${axis}`);
      near(bot.vel[axis], self.vel[axis], `${tick}/velocity/${axis}`);
      near(state.grifball.ball.pos[axis], sim.match.ball.pos[axis], `${tick}/ball/${axis}`);
    }
    frames.push({ tick, action: simPlan.selected.action, pos: { ...self.pos }, waitUsed: plan.runnerMemory[team].waitUsed });
    if (Math.hypot(self.pos.x, self.pos.z) > 0.001) {
      firstMove = tick;
      break;
    }
  }
  assert.ok(firstMove > 0, 'The carrier must leave its wait and actually move');
  assert.ok(
    firstMove * dt >= firstBudget - arrival && firstMove * dt <= firstBudget - arrival + 0.3,
    `Departure ${firstMove * dt} must follow the personal allowance ${firstBudget} and arrival ${arrival}`,
  );
  return { firstMove, frames };
}

for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[])
  for (const mirror of [false, true])
    for (const main of [false, true])
      for (const reverse of [false, true])
        test(`live/sim carrier patience drives actual movement ${style}/${mirror}/${main}/${reverse}`, () => {
          trace(style, mirror, main, reverse);
        });

test('styles produce distinct departure times and zero strength preserves every frame', () => {
  const times = Object.fromEntries(
    (Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[]).map((style) => [
      style,
      trace(style, false, false, false).firstMove,
    ]),
  );
  assert.ok(times.enforcer < times.opportunist && times.opportunist < times.balanced && times.balanced < times.guardian);
  const control = trace('balanced', false, false, false, 0);
  for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
    assert.deepEqual(trace(style, false, false, false, 0), control);
});
