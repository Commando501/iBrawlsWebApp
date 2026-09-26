import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GrifballLabRuntime, LAB_TICK, cloneLabState } from './grifballLabRuntime';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { defaultGrifballTactics } from '../../game/grifballTacticsConfig';
import { grifballLab } from '../../game/grifballLabStore';
import { simulationRandom } from '../../game/simulationRandom';
import { updateGrifballTeamPlanForState } from './grifballTeamPlanRuntime';
import type { Combatant } from '../../types';

function setup() {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  for (const team of ['blue', 'red']) for (let i = 0; i < 3; i++) {
    const id = `${team}${i}`;
    state.otherPlayers.set(id, { id, playerName: id, team, controller: 'ai', difficulty: 'normal', pos: new THREE.Vector3(i, 0, 0), vel: new THREE.Vector3(), yaw: 0, hp: 100, maxHp: 100, respawnTimer: 0, isCrouching: false, activeWeapon: 'hammer', hue: 0, score: 0, kills: 0, deaths: 0 } as Combatant);
  }
  grifballLab.connect(true); grifballLab.open(); grifballLab.setConfig(defaultGrifballTactics());
  const runtime = new GrifballLabRuntime();
  const tick = (dt: number) => {
    state.gameTime += dt;
    for (const bot of state.otherPlayers.values()) bot.pos.x += simulationRandom() * dt;
    updateGrifballTeamPlanForState(state, dt, team => ({ x: team === 'blue' ? 40 : -40, z: 0 }));
  };
  return { state, runtime, tick };
}
test('pause freezes simulation, Step advances one tick and restart restores vectors, timers and memory', () => {
  const { state, runtime, tick } = setup();
  grifballLab.command({ type: 'scenario', scenario: 'pickup', seed: 42 }); runtime.frame(state, 0.1, tick);
  const initial = cloneLabState(state);
  runtime.frame(state, 0.5, tick); assert.equal(state.gameTime, 0);
  grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick); assert.equal(state.gameTime, LAB_TICK);
  const first = [...state.otherPlayers.values()].map(bot => bot.pos.toArray());
  grifballLab.command({ type: 'restart' }); runtime.frame(state, 0.1, tick);
  assert.equal(state.gameTime, 0); assert.ok(state.playerPos instanceof THREE.Vector3);
  assert.deepEqual(state.aiMatchContext, initial.aiMatchContext);
  grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
  assert.deepEqual([...state.otherPlayers.values()].map(bot => bot.pos.toArray()), first);
  runtime.dispose(); grifballLab.close();
});
test('sequential A/B restores the same state, seed and duration while preserving both configurations', () => {
  const { state, runtime, tick } = setup();
  const baseline = defaultGrifballTactics(); const candidate = defaultGrifballTactics(); candidate.teams.red = { leadForward: 10 };
  grifballLab.command({ type: 'compare', seconds: 1, seed: 5, scenario: 'escort', baseline, candidate });
  for (let i = 0; i < 25; i++) runtime.frame(state, 0.1, tick);
  const results = grifballLab.getSnapshot().results;
  assert.equal(results.length, 2); assert.equal(results[0].metrics.seconds, 1); assert.equal(results[1].metrics.seconds, 1);
  assert.deepEqual(results[0].config, baseline); assert.deepEqual(results[1].config, candidate);
  assert.equal(grifballLab.getSnapshot().running, false);
  assert.ok(grifballLab.getSnapshot().diagnostics!.history.length <= 100);
  runtime.dispose(); grifballLab.close();
});
test('preset selection and import validation are atomic and do not mutate a pinned baseline', () => {
  setup(); grifballLab.pinBaseline(); grifballLab.savePreset('Test formation');
  const config = defaultGrifballTactics(); config.teams.red = { leadForward: 12 }; grifballLab.setConfig(config);
  assert.equal(grifballLab.getSnapshot().baseline!.teams.red, undefined);
  assert.throws(() => grifballLab.setConfig({ invalid: true })); assert.deepEqual(grifballLab.getSnapshot().config, config);
  grifballLab.selectPreset('Test formation'); assert.deepEqual(grifballLab.getSnapshot().config, defaultGrifballTactics());
  grifballLab.deletePreset('Test formation'); grifballLab.close();
});

test('runner scenarios expose repeatable routes and restart clears route memory', () => {
  for (const scenario of ['lane', 'pursuit', 'rendezvous'] as const) {
    const { state, runtime, tick } = setup();
    grifballLab.command({ type: 'scenario', scenario, seed: 7 }); runtime.frame(state, 0.1, tick);
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    const first = cloneLabState(state.aiMatchContext.grifballTeamPlan.runnerPlans);
    assert.equal(grifballLab.getSnapshot().diagnostics!.runnerPlans.length, 1);
    grifballLab.command({ type: 'restart' }); runtime.frame(state, 0.1, tick);
    assert.deepEqual(state.aiMatchContext.grifballTeamPlan.runnerMemory, {});
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    assert.deepEqual(state.aiMatchContext.grifballTeamPlan.runnerPlans, first);
    runtime.dispose(); grifballLab.close();
  }
});


test('tanking scenarios restart with identical orders, metrics and coordinator ownership', () => {
  for (const scenario of ['tanking', 'double', 'breakthrough', 'delay'] as const) {
    const { state, runtime, tick } = setup();
    grifballLab.command({ type: 'scenario', scenario, seed: 12 }); runtime.frame(state, 0.1, tick);
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    const first = cloneLabState(state.aiMatchContext);
    const metrics = { ...grifballLab.getSnapshot().diagnostics!.metrics };
    assert.ok([...first.grifballTeamPlan.assignments.values()].some(a => a.tanking));
    grifballLab.command({ type: 'restart' }); runtime.frame(state, 0.1, tick);
    assert.deepEqual(state.aiMatchContext.grifballTeamPlan.tankingMemory, {});
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    assert.deepEqual(state.aiMatchContext, first);
    assert.deepEqual(grifballLab.getSnapshot().diagnostics!.metrics, metrics);
    runtime.dispose(); grifballLab.close();
  }
});
