import { runGrifballAIOrchestratorForState } from './aiOrchestratorBridge';
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
    const config = defaultGrifballTactics(); config.defaults.defenseEnabled = false; config.defaults.passingEnabled = false; grifballLab.setConfig(config);
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

test('defense and pass scenarios restart with identical plans and cleared charge/transition memory', () => {
  for (const scenario of ['cut', 'lastdefender', 'reinforcements', 'pass', 'passdenied'] as const) {
    const { state, runtime, tick } = setup();
    grifballLab.command({ type: 'scenario', scenario, seed: 15 }); runtime.frame(state, 0.1, tick);
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    const first = cloneLabState(state.aiMatchContext), metrics = { ...grifballLab.getSnapshot().diagnostics!.metrics };
    assert.ok([...first.grifballTeamPlan.assignments.values()].some(a => a.defense || a.pass));
    state.aiMatchContext.grifballTeamPlan.passCharge = { carrierId: 'test', receiverId: 'test', speed: 9, elapsed: 1 };
    grifballLab.command({ type: 'restart' }); runtime.frame(state, 0.1, tick);
    assert.equal(state.aiMatchContext.grifballTeamPlan.passCharge, null);
    assert.deepEqual(state.aiMatchContext.grifballTeamPlan.transition, {});
    grifballLab.command({ type: 'step' }); runtime.frame(state, 0.1, tick);
    assert.deepEqual(state.aiMatchContext, first); assert.deepEqual(grifballLab.getSnapshot().diagnostics!.metrics, metrics);
    runtime.dispose(); grifballLab.close();
  }
});


test('style scenarios use the requested seed, expose preferences and restart clears learned evidence', () => {
  for (const scenario of ['stylematch', 'adaptation'] as const) {
    const { state, runtime, tick } = setup();
    grifballLab.command({ type: 'scenario', scenario, seed: 87 }); runtime.frame(state, 0.1, tick);
    assert.equal(state.aiMatchContext.grifballTeamPlan.styleSeed, 87);
    grifballLab.setRunning(true);
    for (let i = 0; i < 60; i++) runtime.frame(state, 0.1, tick);
    grifballLab.setRunning(false);
    const diagnostics = grifballLab.getSnapshot().diagnostics!;
    assert.equal(diagnostics.stylePlans.length, 2);
    assert.ok(diagnostics.stylePlans.some(p => p.observations >= 8));
    assert.ok(diagnostics.metrics.adaptedSeconds > 0);
    grifballLab.command({ type: 'restart' }); runtime.frame(state, 0.1, tick);
    assert.equal(state.aiMatchContext.grifballTeamPlan.styleSeed, 87);
    assert.deepEqual(state.aiMatchContext.grifballTeamPlan.styleMemory, {});
    assert.equal(grifballLab.getSnapshot().diagnostics!.metrics.adaptedSeconds, 0);
    runtime.dispose(); grifballLab.close();
  }
});

test('identical style A/B runs reproduce adaptation metrics and preserve the captured mechanics', () => {
  const { state, runtime, tick } = setup(), config = defaultGrifballTactics();
  config.teams.blue = { styleAggression: 0.85, styleVariation: 1 }; const settings = cloneLabState(state.settings);
  grifballLab.command({ type: 'compare', seconds: 6, seed: 43, scenario: 'adaptation', baseline: config, candidate: config });
  for (let i = 0; i < 125; i++) runtime.frame(state, 0.1, tick);
  const results = grifballLab.getSnapshot().results;
  assert.equal(results.length, 2); assert.deepEqual(results[0].metrics, results[1].metrics);
  assert.ok(results[0].metrics.adaptedSeconds > 0);
  assert.deepEqual(state.settings, settings);
  assert.deepEqual(results[0].setup, results[1].setup);
  runtime.dispose(); grifballLab.close();
});


test('batch A/B pairs replay identical inputs, mirror the same roster and restore the original session', () => {
  const { state, runtime, tick } = setup();
  const origin = cloneLabState(state);
  const baseline = defaultGrifballTactics(), candidate = defaultGrifballTactics();
  grifballLab.command({ type: 'batch', request: { scenario: 'escort', seed: 23, seeds: 2, seconds: 1,
    opponents: ['balanced'], mirrored: true, baseline, candidate } });
  runtime.frame(state, 0.1, tick);
  candidate.defaults.leadForward = 11; grifballLab.setConfig(candidate);
  for (let i = 0; i < 100 && grifballLab.getSnapshot().comparing; i++) runtime.frame(state, 0.1, tick);
  const report = grifballLab.getSnapshot().evaluationReports[0];
  assert.equal(report.status, 'complete'); assert.equal(report.runs.length, 8);
  for (let i = 0; i < report.runs.length; i += 2) {
    assert.deepEqual(report.runs[i].metrics, report.runs[i + 1].metrics);
    assert.deepEqual(report.runs[i].setup, report.runs[i + 1].setup);
    assert.equal(report.runs[i].simulationCost.samples, 60);
  }
  const initial = report.runs[0].setup.roster, mirrored = report.runs[2].setup.roster;
  for (const bot of initial) {
    const other = mirrored.find(p => p.id === bot.id)!;
    assert.notEqual(other.team, bot.team); assert.ok(Math.abs(other.position.x + bot.position.x) < 1e-10); assert.ok(Math.abs(other.position.z + bot.position.z) < 1e-10);
  }
  assert.deepEqual([...state.otherPlayers.values()].map(p => p.team), [...origin.otherPlayers.values()].map(p => p.team));
  assert.equal(state.gameTime, origin.gameTime);
  assert.notEqual(report.request.candidate.defaults.leadForward, 11);
  runtime.dispose(); grifballLab.close();
});

test('batch pause preserves progress; cancelling or closing restores the roster and retains a partial report', () => {
  const { state, runtime, tick } = setup(); const origin = cloneLabState(state);
  const command = { type: 'batch' as const, request: { scenario: 'pickup' as const, seed: 1, seeds: 2, seconds: 1,
    opponents: ['balanced' as const], mirrored: true, baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() } };
  grifballLab.command(command); runtime.frame(state, 0.1, tick);
  grifballLab.setRunning(false); const time = state.gameTime; runtime.frame(state, 0.1, tick); assert.equal(state.gameTime, time);
  grifballLab.setRunning(true);
  for (let i = 0; i < 10; i++) runtime.frame(state, 0.1, tick);
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].runs.length, 1);
  grifballLab.command({ type: 'cancelBatch' }); runtime.frame(state, 0.1, tick);
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].status, 'cancelled'); assert.equal(state.gameTime, origin.gameTime);
  grifballLab.command(command); runtime.frame(state, 0.1, tick);
  grifballLab.close(); runtime.suspend();
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].status, 'cancelled'); assert.equal(state.gameTime, origin.gameTime);
  assert.equal(grifballLab.getSnapshot().evaluationReports.length, 3);
  runtime.dispose();
});

test('batch rejects neural rosters without leaving modified gameplay state', () => {
  const { state, runtime, tick } = setup();
  state.settings.aiDifficulty = 'neural-net';
  const time = state.gameTime;
  grifballLab.command({ type: 'batch', request: { scenario: 'pickup', seed: 1, seeds: 1, seconds: 1, opponents: ['balanced'], mirrored: false,
    baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() } });
  runtime.frame(state, 0.1, tick);
  assert.equal(grifballLab.getSnapshot().comparing, false); assert.equal(state.gameTime, time);
  assert.match(grifballLab.getSnapshot().message, /scripted/);
  runtime.dispose(); grifballLab.close();
});


test('real roster orchestration preserves frozen mirrored teams and unlocks after cancellation', () => {
  const { state, runtime, tick } = setup();
  const orchestratedTick = (dt: number) => {
    const before = [...state.otherPlayers.values()].map(p => [p.id, p.team, p.difficulty, p.modelType]);
    runGrifballAIOrchestratorForState({ state, dt, isPlaying: true, legacy: {}, offlineBotCount: 7,
      spawnCallbacks: { getOptimalSpawnPoint: () => new THREE.Vector3(), getInwardSpawnYaw: () => 0 }, events: {} });
    assert.deepEqual([...state.otherPlayers.values()].map(p => [p.id, p.team, p.difficulty, p.modelType]), before);
    tick(dt);
  };
  grifballLab.command({ type: 'batch', request: { scenario: 'goal', seed: 1, seeds: 1, seconds: 1, opponents: ['balanced'], mirrored: true,
    baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() } });
  for (let i = 0; i < 24; i++) runtime.frame(state, 0.1, orchestratedTick);
  assert.equal(state.grifballLabRosterLocked, true);
  assert.equal(state.otherPlayers.get('blue0')!.team, 'red');
  grifballLab.command({ type: 'cancelBatch' }); runtime.frame(state, 0.1, orchestratedTick);
  assert.equal(state.grifballLabRosterLocked, false); assert.equal(state.otherPlayers.get('blue0')!.team, 'blue');
  runtime.dispose(); grifballLab.close();
});

test('unexpected roster drift cancels a batch instead of publishing a mislabeled run', () => {
  const { state, runtime, tick } = setup();
  grifballLab.command({ type: 'batch', request: { scenario: 'pickup', seed: 1, seeds: 1, seconds: 1, opponents: ['balanced'], mirrored: true,
    baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() } });
  runtime.frame(state, 0.1, dt => { tick(dt); state.otherPlayers.get('blue0')!.team = 'red'; });
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].status, 'cancelled');
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].runs.length, 0);
  assert.match(grifballLab.getSnapshot().message, /roster changed/);
  assert.equal(state.grifballLabRosterLocked, false);
  runtime.dispose(); grifballLab.close();
});


test('batch records custom combat inputs and rejects mechanics drift', () => {
  const { state, runtime: unused, tick } = setup(); unused.dispose();
  const profiles = { legacy: { botDifficulties: { blue0: 'custom' } }, presets: [] };
  const runtime = new GrifballLabRuntime('Test', undefined, undefined, () => profiles);
  const command = { type: 'batch' as const, request: { scenario: 'pickup' as const, seed: 1, seeds: 1, seconds: 1,
    opponents: ['balanced' as const], mirrored: false, baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() } };
  grifballLab.command(command); runtime.frame(state, 0.1, tick);
  profiles.legacy.botDifficulties.blue0 = 'hard'; runtime.frame(state, 0.1, tick);
  const report = grifballLab.getSnapshot().evaluationReports[0];
  assert.equal(report.rosterConfig!.legacy.botDifficulties!.blue0, 'custom'); assert.equal(report.status, 'cancelled');
  grifballLab.command(command); runtime.frame(state, 0.1, tick); const speed = state.settings.speedForward;
  state.settings.speedForward += 10; runtime.frame(state, 0.1, tick);
  assert.equal(grifballLab.getSnapshot().evaluationReports[0].status, 'cancelled'); assert.equal(state.settings.speedForward, speed);
  runtime.dispose(); grifballLab.close();
});
