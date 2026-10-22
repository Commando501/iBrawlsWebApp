import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { setSimCarrier } from '../../src/sim/grifball';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { stepSimulation } from '../../src/sim/step';

const dt = 1 / 60;
const rounded = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v)));
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function trace(style: GrifballPlayerStyle, main: boolean, mirror: boolean, reverse: boolean, strength = 1) {
  const id = main ? 'main_ai' : 'back',
    team = mirror ? 'red' : 'blue',
    otherTeam = mirror ? 'blue' : 'red',
    sign = mirror ? -1 : 1;
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'escort');
  const { state, sim, bot, target } = f,
    [self, other] = sim.combatants;
  sim.combatExecution = 'live-roster-v2';
  sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match);
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.grifballTactics.defaults, {
    safetyAgencyStrength: strength,
    stylesEnabled: false,
    tankingEnabled: false,
    passingEnabled: false,
  });
  state.grifballTactics.botStyles = { [id]: style };
  state.grifballTactics.teams.red = { safetyAgencyStrength: strength * 0.8 };
  const start = { x: -8 * sign, z: 0 };
  self.id = id;
  other.id = 'escort';
  for (const [c, live, pos, t] of [
    [self, bot, start, team],
    [other, target, { x: 12 * sign, z: -10 * sign }, otherTeam],
  ] as const) {
    c.team = live.team = t;
    c.controller = live.controller = 'ai';
    c.pos = { ...pos, y: 0 };
    live.pos.set(pos.x, 0, pos.z);
    c.vel = { x: 0, y: 0, z: 0 };
    live.vel.set(0, 0, 0);
    c.yaw = 0;
    live.yaw = Math.PI;
    c.hp = c.maxHp = live.hp;
    c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    c.weaponState = 'idle';
  }
  for (const [name, x, z, t] of [
    ['pressure', 6, 0, team],
    ['marker', 6, -10, team],
    ['runner', 10, 0, otherTeam],
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
  state.grifball.ball.state = sim.match.ball.state = 'held';
  state.grifball.ball.holderId = sim.match.ball.holderId = 'runner';
  setSimCarrier(sim.combatants.find((c) => c.id === 'runner')!, true, sim.settings);
  setGrifballCarrierForState({ state, id: 'runner', carrying: true });
  if (reverse) {
    sim.combatants.reverse();
    state.otherPlayers = new Map([...state.otherPlayers].reverse());
  }
  const tactics = structuredClone(state.grifballTactics),
    plan = createGrifballTeamPlanState();
  const scriptedBots = Object.fromEntries(sim.combatants.map((c) => [c.id, 'normal']));
  const goal = (t: string | undefined) => sim.goalPlates.find((p) => p.team !== t)!.position;
  const frames: unknown[] = [];
  let applied = 0,
    moved = 0,
    handoffs = 0;
  // Isolate the last defender's locomotion with static opponents and teammates. Both
  // engines plan independently; ordinary combat handoff must agree when reached.
  for (let tick = 1; tick <= 24; tick++) {
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics }), dt);
    const a = plan.assignments.get(id)!,
      b = state.aiMatchContext.grifballTeamPlan.assignments.get(id)!;
    assert.equal(a.defense?.mode, 'last-defender');
    assert.equal([...plan.assignments.values()].filter((a) => a.team === team && a.defense?.mode === 'last-defender').length, 1);
    assert.deepEqual(rounded(a.defense), rounded(b.defense), `${tick}/defense`);
    assert.deepEqual(rounded(a.destination), rounded(b.destination), `${tick}/destination`);
    if (strength) {
      assert.equal(a.defense!.safetyPosition!.style, style);
      assert.equal(a.defense!.safetyPosition!.strength, strength * (mirror ? 0.8 : 1));
      if (a.defense!.safetyPosition!.applied) applied++;
    } else assert.equal(a.defense!.safetyPosition, undefined);
    const input = resolveSimGrifballSupportInput(sim, plan, id, scriptedBots, dt);
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
    const handled = resolvePrimaryGrifballAIObjectiveMovementForCombatant({
      state,
      botId: id,
      self: bot,
      frame,
      alliesList: [...state.otherPlayers.values()].filter((c) => c.team === team && c.id !== id).map((c) => c.pos),
      enemiesList: [...state.otherPlayers.values()].filter((c) => c.team !== team).map((c) => c.pos),
      dt,
      canStartWeaponAction: true,
      triggerCombatantAttack: () => assert.fail('support controller must not start attacks'),
      getEnemyGoalPos: goal,
      constrainCombatantToArena: (pos, vel) =>
        constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }),
    });
    assert.equal(handled, !!input, `${tick}/movement ownership`);
    if (!input) {
      handoffs++;
      break;
    }
    bot.yaw = frame.yaw;
    bot.aiState = frame.aiState;
    bot.aiTimer = frame.timer;
    stepSimulation(sim, { [id]: input.action }, { settings: sim.settings, scriptedObjective: input.scriptedObjective });
    for (const axis of ['x', 'y', 'z'] as const) {
      near(bot.pos[axis], self.pos[axis], `${tick}/pos/${axis}`);
      near(bot.vel[axis], self.vel[axis], `${tick}/vel/${axis}`);
    }
    if (Math.hypot(self.vel.x, self.vel.z) > 0.01) moved++;
    frames.push({ tick, destination: rounded(a.destination), pos: rounded(self.pos) });
  }
  assert.equal(
    applied > 0,
    strength > 0 && style !== 'balanced',
    `applied=${applied} style=${style} reason=${plan.assignments.get(id)?.defense?.safetyPosition?.reason}`,
  );
  assert.ok(moved > 0, 'the last defender must physically move toward its assigned position');
  return { frames, moved, handoffs };
}
for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[])
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true])
        test(`live/sim last-defender positions and movement ${style}/${main}/${mirror}/${reverse}`, () => {
          trace(style, main, mirror, reverse);
        });
test('zero strength preserves movement across styles with identical starting observations', () => {
  const baseline = trace('balanced', false, false, false, 0);
  for (const style of ['enforcer', 'guardian', 'opportunist'] as const)
    assert.deepEqual(trace(style, false, false, false, 0), baseline);
});

test('personal positions produce different executed paths with identical observations', () => {
  const baseline = trace('balanced', false, false, false);
  for (const style of ['enforcer', 'guardian', 'opportunist'] as const)
    assert.notDeepEqual(trace(style, false, false, false).frames, baseline.frames);
});
