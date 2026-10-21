import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { stepSimulation } from '../../src/sim/step';

const rounded = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v));
for (const style of Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[])
for (const enabled of [false, true]) for (const mirror of [false, true]) for (const main of [false, true])
  test(`independent weapon clocks and planner adapters: ${style}/${enabled}/${mirror}/${main}`, () => {
    const id = main ? 'main_ai' : 'b', team = mirror ? 'red' : 'blue', sign = mirror ? -1 : 1;
    const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'enemy');
    const { state, sim, bot, target } = f;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
    state.grifballTactics = defaultGrifballTactics();
    Object.assign(state.grifballTactics.defaults, { doubleTeamAgencyStrength: enabled ? 1 : 0, tankDoubleThreshold: 0,
      stylesEnabled: false, passingEnabled: false, defenseEnabled: false });
    state.grifballTactics.botStyles = { a: style, [id]: style };
    const [actor, opponent] = sim.combatants;
    actor.id = id; opponent.id = 'enemy';
    for (const [c, live, x, z, t] of [[actor, bot, 5, 7, team], [opponent, target, 5, 0, mirror ? 'blue' : 'red']] as const) {
      c.team = live.team = t; c.controller = live.controller = 'ai';
      c.pos = { x: x * sign, y: 0, z: z * sign }; live.pos.set(c.pos.x, 0, c.pos.z);
      c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0); c.yaw = 0; live.yaw = Math.PI;
      c.hp = c.maxHp = live.hp; c.invulnerabilityTimer = c.weaponReadyTimer = 0;
    }
    for (const [extraId, x, z] of [['a', 5, -7], ['reserve', -10, 0], ['runner', 0, 0]] as const) {
      const c = structuredClone(actor); c.id = extraId; c.pos = { x: x * sign, y: 0, z: z * sign }; sim.combatants.push(c);
      const live = createOfflineBotCombatant({ id: extraId, playerName: extraId, team,
        spawnPos: bot.pos.clone().set(c.pos.x, 0, c.pos.z), yaw: Math.PI, hue: 0, difficulty: 'normal', settings: state.settings });
      live.invulnerabilityTimer = 0; live.weaponState = 'ready'; live.weaponTimer = 0; state.otherPlayers.set(extraId, live);
    }
    // Only initial recovery is authored. Each engine independently advances its
    // own physical clock; stationary actors isolate adapter/decision consistency.
    target.weaponState = 'recovering'; target.weaponTimer = 0;
    opponent.weaponState = 'recovering'; opponent.weaponTimer = sim.settings.hammerReloadTime; opponent.attackKind = 'strike';
    state.grifball.ball.state = sim.match.ball.state = 'held'; state.grifball.ball.holderId = sim.match.ball.holderId = 'runner';
    setSimCarrier(sim.combatants.find(c => c.id === 'runner')!, true, sim.settings);
    setGrifballCarrierForState({ state, id: 'runner', carrying: true });
    const tactics = structuredClone(state.grifballTactics), plan = createGrifballTeamPlanState();
    const scriptedBots = Object.fromEntries(sim.combatants.map(c => [c.id, 'normal']));
    const goal = (t: string | undefined) => sim.goalPlates.find(p => p.team !== t)!.position;
    let joined = false, covered = false, decisions = 0;
    for (let tick = 0; tick < 100; tick++) {
      f.weaponFrame(1 / 60); f.respawns(1 / 60); f.visuals(1 / 60); stepSimulation(sim, {});
      updateGrifballTeamPlanForState(state, 1 / 60, goal, f.map);
      const snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics });
      updateGrifballTeamPlan(plan, snapshot, 1 / 60);
      for (const a of plan.assignments.values()) {
        const live = state.aiMatchContext.grifballTeamPlan.assignments.get(a.botId)!;
        assert.deepEqual(rounded(a.tanking), rounded(live.tanking), `${tick}/${a.botId}/order`);
        assert.deepEqual(rounded(a.destination), rounded(live.destination), `${tick}/${a.botId}/destination`);
        const actor = snapshot.players.find(p => p.id === a.botId)!;
        assert.equal(selectGrifballAssignmentThreat(a, actor.pos, snapshot.players),
          selectGrifballAssignmentThreat(live, state.otherPlayers.get(a.botId)!.pos, state.aiMatchContext.grifballTeamPlan.snapshot!.players));
        if (a.tanking?.mode === 'punish' && a.team === team) {
          if (a.tanking.doubleCommit) joined = true; else covered = true;
          if (a.tanking.doubleTeam) { decisions++; assert.equal(a.tanking.doubleTeam.style, style); }
        }
      }
    }
    assert.ok(joined && covered, 'the same observed opening must be used and then closed');
    assert.equal(decisions > 0, enabled);
  });
