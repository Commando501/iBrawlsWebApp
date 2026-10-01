import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSuiteManifest } from '../../game/grifballValidation/profiles';
import { createSuitePlan } from '../../game/grifballValidation/plan';
import { simulationRandom } from '../../game/simulationRandom';
import { tickGrifballMatch, resolveMatchConfig, registerGoal } from '../../game/grifballMatch';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { GrifballValidationRuntime } from './grifballValidationRuntime';
import { createInitialGrifballRuntimeState, type GrifballRuntimeState } from './runtimeState';
import { cloneLabState } from './grifballTrialSetup';
import { updateAIRosterTick } from './aiRosterTick';
import { createAIRosterCallbacksForState } from './aiRosterCallbacks';
import { runGrifballAIOrchestratorForState } from './aiOrchestratorBridge';
import { updateGrifballTeamPlanForState } from './grifballTeamPlanRuntime';
import type { GrifballThreeRefs } from './threeRefs';
import { liveTimings } from '../../game/grifballValidation/telemetry';
import { assertDecisionTrace } from '../../game/grifballValidation/decisionTrace';
import type { ValidationLocalInput } from '../../game/grifballValidation/localPlayerInput';

async function setup(roster: 'scripted-1v1' | 'scripted-3v4' | 'scripted-4v4' | 'local-4v4' | 'scenario' = 'scripted-1v1', mirrored = false,
  tick?: (s: GrifballRuntimeState, dt: number) => void, seconds = 1, localAdapter = true) {
  const manifest = createSuiteManifest(roster === 'scenario' ? 'quick' : 'standard');
  manifest.cases = [manifest.cases.find(c => roster === 'scenario' ? c.scenario === 'pickup' : c.roster === (roster === 'local-4v4' ? 'scripted-3v4' : roster))!];
  if (roster === 'local-4v4') manifest.cases[0].roster = roster;
  Object.assign(manifest.cases[0], { seeds: [101], mirrored, simulationSeconds: seconds });
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  const job = plan.jobs.find(j => j.mirrored === mirrored)!;
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, isMultiplayer: false, multiplayerRole: null });
  state.gameTime = 99; const origin = cloneLabState(state), meshes = new Map<string, { group: THREE.Group }>(); let calls = 0;
  const inputs: ValidationLocalInput[] = [];
  const runtime = new GrifballValidationRuntime({ state, resetControls: () => {}, removeActor: id => { meshes.delete(id); },
    provisionActor: p => { meshes.set(p.id, { group: new THREE.Group() }); }, hasActorMesh: id => meshes.has(id),
    ...(localAdapter ? { applyLocalInput: (input: ValidationLocalInput) => { inputs.push(input); } } : {}),
    tick: dt => { calls++; tick?.(state, dt); } }, plan.cases[0], job);
  return { runtime, state, origin, meshes, calls: () => calls, fixture: plan.cases[0], inputs };
}

for (const mirrored of [false, true]) test(`local fixture freezes seven bot owners and a separate local input owner: ${mirrored}`, async () => {
  const { runtime, state, fixture, inputs, origin } = await setup('local-4v4', mirrored);
  assert.equal(fixture.observer, 'local-input'); assert.equal(fixture.localInput, 'objective-walk-and-melee-v1');
  assert.equal(state.otherPlayers.size, 7); assert.equal(state.isObserverMode, false); assert.equal(state.hideLocalObserverAvatar, false);
  assert.equal(state.localPlayerTeam, mirrored ? 'red' : 'blue');
  assert.equal([...state.otherPlayers.values()].filter(p => p.team === state.localPlayerTeam).length, 3);
  assert.ok(state.playerPos.y < 1); assert.ok(state.playerHP > 0);
  assert.ok(![...state.otherPlayers.values()].some(p => p.pos.distanceTo(state.playerPos) < .1));
  runtime.step(); assert.deepEqual(inputs[0], { forward: false, yaw: 0, attack: null, pickup: false });
  state.grifball.phase = 'playing'; runtime.step(); assert.equal(inputs[1].forward, true);
  const result = runtime.stop('cancelled');
  assert.equal(result.start!.alive.length, 8); assert.ok(result.start!.alive.includes('player'));
  assert.equal(result.localPlayer!.inputTicks, 2); assert.equal(result.localPlayer!.movementRequests, 1);
  runtime.dispose(); assert.equal(state.isObserverMode, origin.isObserverMode); assert.deepEqual(state.playerPos, origin.playerPos);
});

test('local fixture fails closed without its production input adapter', async () => {
  const { runtime } = await setup('local-4v4', false, undefined, 1, false);
  const result = await runtime.done; assert.equal(result.termination, 'setup-error'); assert.match(result.check.summary, /input adapter/); runtime.dispose();
});

for (const mutation of ['team', 'observer', 'non-finite', 'assignment', 'dead-holder'] as const)
  test(`local ownership invariants reject ${mutation}`, async () => {
    const { runtime, state } = await setup('local-4v4');
    if (mutation === 'team') state.localPlayerTeam = 'red';
    if (mutation === 'observer') state.isObserverMode = true;
    if (mutation === 'non-finite') state.playerPos.x = NaN;
    if (mutation === 'assignment') state.aiMatchContext.grifballTeamPlan.assignments.set('player', {} as never);
    if (mutation === 'dead-holder') { state.playerHP = 0; state.playerRespawnTimer = 3; state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player'; }
    runtime.step(); const result = await runtime.done;
    assert.equal(result.termination, 'invalid-state'); assert.ok(result.failureState!.actors.some(p => p.id === 'player'));
    if (mutation === 'dead-holder') assert.equal(result.failureState!.holder!.hp, 0);
    runtime.dispose();
  });

test('living local possession is valid, and local state contributes to the deterministic hash', async () => {
  const hashes = [];
  for (const offset of [0, 0, 1]) {
    const { runtime, state } = await setup('local-4v4');
    state.grifball.phase = 'playing'; state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player';
    state.activeWeapon = 'ball'; state.playerPos.z += offset;
    runtime.step(); runtime.stop('cancelled'); const result = await runtime.done;
    assert.equal(result.termination, 'cancelled'); assert.equal(result.localPlayer!.possessions, 1);
    assert.equal(result.localPlayer!.carrierTicks, 1); hashes.push(result.deterministic!.hash); runtime.dispose();
  }
  assert.equal(hashes[0], hashes[1]); assert.notEqual(hashes[0], hashes[2]);
});

for (const roster of ['scripted-1v1', 'scripted-3v4', 'scripted-4v4'] as const) for (const mirrored of [false, true]) {
  test(`${roster} ${mirrored ? 'mirrored' : 'original'} starts a fresh authored match with an outside observer`, async () => {
    const { runtime, state, meshes, fixture } = await setup(roster, mirrored);
    assert.equal(state.otherPlayers.size, fixture.roster.length); assert.equal(meshes.size, fixture.roster.length);
    assert.equal(state.grifball.phase, 'countdown'); assert.equal(state.grifball.roundNumber, 1);
    assert.equal(state.grifball.ball.holderId, null); assert.equal(state.grifball.ball.state, 'idle');
    assert.deepEqual(state.grifball.ball.pos, { ...state.grifball.ball.home, y: state.grifball.ball.home.y + 0.35 });
    assert.equal(state.teamScores.blue.goals + state.teamScores.red.goals, 0);
    assert.equal(state.gameTime, fixture.mechanics.matchTimerSeconds ?? 522);
    assert.ok(state.isObserverMode && state.hideLocalObserverAvatar && state.grifballLabRosterLocked);
    assert.ok(!state.otherPlayers.has('main_ai')); assert.equal(state.aiMatchContext.grifballTeamPlan.assignments.size, 0);
    for (const bot of state.otherPlayers.values()) {
      assert.equal(bot.hp, bot.maxHp); assert.equal(bot.respawnTimer, 0); assert.equal(bot.weaponState ?? 'idle', 'idle');
      assert.equal(bot.team, state.grifballValidationSlots![bot.id].team);
      assert.ok(fixture.map.spawnPoints.some(p => Math.abs(p.x - (mirrored ? -bot.pos.x : bot.pos.x)) < 0.01 &&
        Math.abs(p.z - (mirrored ? -bot.pos.z : bot.pos.z)) < 0.01));
    }
    runGrifballAIOrchestratorForState({ state, dt: 1, isPlaying: true, legacy: {}, offlineBotCount: 6,
      spawnCallbacks: { getOptimalSpawnPoint: () => new THREE.Vector3(), getInwardSpawnYaw: () => 0 }, events: {} });
    assert.equal(state.otherPlayers.size, fixture.roster.length);
    const updated: string[] = [];
    updateAIRosterTick({ refs: { otherPlayerMeshes: meshes } as GrifballThreeRefs, rosterAI: [...state.otherPlayers.values()], dt: 1 / 60,
      respawnCombatant: () => {}, updateSingleAIEntity: id => { updated.push(id); } });
    assert.equal(updated.length, fixture.roster.length); runtime.dispose();
  });
}

test('scenario replay uses the same seeded stream and resets tactical memory', async () => {
  const tick = (state: GrifballRuntimeState, dt: number) => {
    for (const bot of state.otherPlayers.values()) bot.pos.x += simulationRandom() * dt;
    updateGrifballTeamPlanForState(state, dt, team => ({ x: team === 'blue' ? 40 : -40, z: 0 }));
  };
  const run = async () => {
    const { runtime, state } = await setup('scenario', false, tick);
    for (let i = 0; i < 60; i++) runtime.step();
    const result = await runtime.done, memory = cloneLabState(state.aiMatchContext);
    const captured = JSON.stringify(result.decisions);
    state.aiMatchContext.grifballTeamPlan.stylePlans.blue.confidence = .987;
    [...state.aiMatchContext.grifballTeamPlan.assignments.values()].find(v => v.team === 'blue')!.tuning!.defenseSafetyDepth = 15;
    assert.equal(JSON.stringify(result.decisions), captured, 'diagnostics must not retain mutable planner references');
    assert.equal(result.termination, 'scenario-complete'); runtime.dispose(); return { result, memory };
  };
  const a = await run(), b = await run();
  assert.deepEqual(a.result.trace, b.result.trace); assert.deepEqual(a.result.metrics, b.result.metrics); assert.deepEqual(a.memory, b.memory);
  assert.deepEqual(a.result.decisions, b.result.decisions);
  assert.ok(a.result.decisions!.frames.at(-1)!.actors.some(actor => actor.role === 'retriever' && actor.reason && actor.destination));
  const teams = a.result.decisions!.frames.at(-1)!.teams!;
  assert.deepEqual(teams.map(t => t.team), ['blue', 'red']);
  for (const team of teams) {
    const style = a.memory.grifballTeamPlan.stylePlans[team.team];
    const tuning = [...a.memory.grifballTeamPlan.assignments.values()].find(v => v.team === team.team)!.tuning!;
    assert.equal(team.style!.pressure, style.pressure);
    assert.equal(team.style!.confidence, style.confidence);
    assert.equal(team.style!.adapting, style.adapting);
    assert.deepEqual(team.defense, { pressure: tuning.defensePressure, lookahead: tuning.defenseLookahead, safetyDepth: tuning.defenseSafetyDepth });
  }
});

test('decision diagnostics retain opening and recent event context without live references', async () => {
  const { runtime, state } = await setup('scripted-1v1', false, s => {
    const [bot, rival] = [...s.otherPlayers.values()];
    bot.hp = bot.hp > 0 ? 0 : bot.maxHp;
    bot.pos.x += .01;
    bot.aiPressureTargetId = rival.id;
    bot.aiState = 'PRESSURING';
  }, 4);
  for (let i = 0; i < 240; i++) runtime.step();
  const result = await runtime.done, trace = result.decisions!;
  assertDecisionTrace(trace, result.end!.tick);
  assert.equal(trace.frames.length, 64);
  assert.equal(trace.droppedFrames, 177);
  assert.deepEqual(trace.frames.slice(0, 8).map(s => s.frame.tick), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(trace.frames.at(-1)!.frame.tick, 240);
  assert.equal(trace.frames[8].frame.tick, 185);
  assert.equal(trace.frames.at(-1)!.actors[0].aiState, 'PRESSURING');
  assert.equal(trace.frames.at(-1)!.actors[0].pressureTargetId, [...state.otherPlayers.keys()][1]);
  const captured = JSON.stringify(trace);
  [...state.otherPlayers.values()][0].pos.x = 999;
  runtime.dispose();
  assert.equal(JSON.stringify(trace), captured);
});

test('simulation cap remains unfinished and no ticks occur after stopping', async () => {
  const { runtime, calls } = await setup();
  for (let i = 0; i < 100; i++) runtime.step();
  const result = await runtime.done;
  assert.equal(result.termination, 'simulation-cap'); assert.equal(result.check.verdict, 'inconclusive');
  assert.equal(calls(), 60); assert.equal(result.end!.tick, 60); runtime.dispose();
});

test('performance warmup counts actual play across countdown and round reset', async () => {
  const { runtime, state } = await setup('scripted-4v4', false, (s, dt) => {
    tickGrifballMatch(s.grifball, dt, resolveMatchConfig(s.settings));
    updateGrifballTeamPlanForState(s, dt, team => ({ x: team === 'blue' ? 40 : -40, z: 0 }));
  }, 10);
  try {
    const timing = liveTimings.get(state)!;
    for (let i = 0; i < 180; i++) runtime.step();
    assert.equal(timing.finish().warm.tick.samples, 0, 'countdown must not warm the planner');
    for (let i = 0; i < 60 && state.grifball.phase === 'countdown'; i++) runtime.step();
    assert.equal(state.grifball.phase, 'playing');
    assert.equal(timing.playingTicks, 1);
    assert.equal(timing.finish().cold.plannerRefresh.samples, 1, 'first live refresh is cold');
    while (timing.playingTicks < 120) runtime.step();
    assert.equal(timing.finish().warm.plannerRefresh.samples, 0);
    assert.equal(timing.finish().warm.tick.samples, 0);
    for (let i = 0; i < 20; i++) runtime.step();
    assert.ok(timing.finish().warm.plannerRefresh.samples > 0);
    assert.equal(timing.finish().warm.tick.samples, 20);
    const active = timing.playingTicks;
    state.grifball.phase = 'scored'; state.grifball.phaseTimer = 0;
    for (let i = 0; i < 60; i++) runtime.step();
    assert.equal(timing.playingTicks, active, 'round reset must not advance active warmup');
    const report = timing.finish();
    assert.equal(report.version, 2);
    assert.equal(report.version === 2 && report.warmupBasis, 'playing-ticks');
  } finally { runtime.dispose(); }
});

test('real phase machine reaches terminal state and prevents post-match ticks (controlled lifecycle fixture)', async () => {
  const { runtime, state, calls } = await setup('scripted-1v1', false, (s, dt) => {
    tickGrifballMatch(s.grifball, dt, { ...resolveMatchConfig(s.settings), countdownDuration: 0, roundResetDelay: 0 });
    if (s.grifball.phase === 'playing') {
      s.teamScores.blue.goals++;
      registerGoal(s.grifball, 'blue', s.teamScores.blue.goals, resolveMatchConfig(s.settings));
    }
  });
  for (let i = 0; i < 60; i++) runtime.step();
  const result = await runtime.done;
  assert.equal(result.termination, 'match-end'); assert.equal(state.grifball.roundNumber, 2); assert.equal(state.teamScores.blue.goals, 2);
  assert.ok(calls() < 60); assert.equal(result.end!.tick, calls()); runtime.dispose();
});

for (const [label, mutate] of [
  ['non-finite position', (s: GrifballRuntimeState) => { s.otherPlayers.values().next().value!.pos.x = NaN; }],
  ['foreign holder', (s: GrifballRuntimeState) => { s.grifball.ball.holderId = 'observer'; s.grifball.ball.state = 'held'; }],
  ['frozen settings', (s: GrifballRuntimeState) => { s.settings.grifballGoalTarget = 999; }],
  ['score outside phase', (s: GrifballRuntimeState) => { s.teamScores.blue.goals++; }],
  ['changed goal target', (s: GrifballRuntimeState) => { s.grifball.goalTarget = 0; }],
  ['missing health', (s: GrifballRuntimeState) => { delete (s.otherPlayers.values().next().value! as Partial<import('../../types').Combatant>).hp; }],
  ['false terminal', (s: GrifballRuntimeState) => { s.grifball.phase = 'matchEnd'; }],
  ['score jump', (s: GrifballRuntimeState) => { s.teamScores.blue.goals += 2; }],
  ['early pickup', (s: GrifballRuntimeState) => { s.grifball.ball.holderId = s.otherPlayers.keys().next().value!; s.grifball.ball.state = 'held'; }],
] as const) test(`runtime fails on ${label} and restores prior state and ownership`, async () => {
  const { runtime, state, origin } = await setup('scripted-1v1', false, mutate);
  runtime.step(); const result = await runtime.done; assert.equal(result.termination, 'invalid-state');
  runtime.dispose(); runtime.dispose(); assert.equal(state.gameTime, 99); assert.deepEqual(state.settings, origin.settings);
  assert.deepEqual(state.aiMatchContext, origin.aiMatchContext); assert.equal(state.otherPlayers.size, 0);
  assert.equal(state.grifballValidationSlots, undefined); assert.equal(state.grifballLabRosterLocked, false);
  assert.ok(state.playerPos instanceof THREE.Vector3);
});

test('missing mesh fails setup instead of quietly skipping a bot', async () => {
  const { runtime, meshes } = await setup('scripted-4v4'); meshes.delete('validation-blue-0'); runtime.step();
  const result = await runtime.done; assert.equal(result.termination, 'invalid-state'); assert.match(result.check.summary, /mesh missing/); runtime.dispose();
});


test('live roster callbacks use frozen combat tuning for every validation actor', async () => {
  const { runtime, state, fixture } = await setup('scripted-4v4');
  const callbacks = createAIRosterCallbacksForState({ getState: () => state, opponentClientId: '', opponentPlayerName: '',
    botDifficultiesRef: { current: {} }, botBehaviorsRef: { current: {} }, botWeaponBehaviorsRef: { current: {} },
    botArchetypesRef: { current: {} }, botModelTypesRef: { current: {} }, botColorsRef: { current: {} }, aiPresets: [] });
  for (const actor of fixture.roster) {
    assert.deepEqual(callbacks.resolveRosterSlot(actor.id), actor.slot);
    assert.deepEqual(callbacks.resolveBotKnobs(actor.id), actor.effectiveKnobs);
  }
  assert.equal(callbacks.getRosterAI().length, 8); assert.equal(callbacks.mai(), undefined); runtime.dispose();
});


test('lifecycle trace stays bounded during repeated death/respawn transitions', async () => {
  const { runtime } = await setup('scenario', false, s => {
    const bot = s.otherPlayers.values().next().value!;
    bot.hp = bot.hp > 0 ? 0 : bot.maxHp; bot.respawnTimer = bot.hp > 0 ? 0 : 1;
  }, 10);
  for (let i = 0; i < 600; i++) runtime.step();
  const result = await runtime.done;
  assert.equal(result.termination, 'scenario-complete'); assert.equal(result.trace.length, 512);
  assert.equal(result.trace[0].tick, 0); assert.equal(result.trace.at(-1)!.tick, 600);
  assert.equal(result.droppedTraceEntries, 89); runtime.dispose();
});

test('cancellation restores an existing roster and preserves a prior roster lock', async () => {
  const first = await setup(); const original = cloneLabState(first.state.otherPlayers.values().next().value!);
  first.runtime.dispose(); original.id = 'original-human'; original.controller = 'remote';
  first.state.otherPlayers.set(original.id, original); first.state.grifballLabRosterLocked = true;
  const origin = cloneLabState(first.state), meshes = new Set([original.id]);
  const runtime = new GrifballValidationRuntime({ state: first.state, tick: () => {}, resetControls: () => {},
    removeActor: id => { meshes.delete(id); }, provisionActor: p => { meshes.add(p.id); }, hasActorMesh: id => meshes.has(id) },
    first.fixture, first.runtime.job);
  runtime.stop('cancelled'); runtime.dispose(); runtime.dispose();
  assert.deepEqual(first.state.otherPlayers, origin.otherPlayers); assert.deepEqual([...meshes], [original.id]);
  assert.equal(first.state.grifballLabRosterLocked, true); assert.equal(first.state.isObserverMode, origin.isObserverMode);
});


test('invalid carrier evidence preserves the failed tick separately from the valid trace', async () => {
  const { runtime, state } = await setup('scenario', false, s => {
    const carrier = s.otherPlayers.values().next().value!;
    s.grifball.ball.state = 'held'; s.grifball.ball.holderId = carrier.id;
    carrier.hp = 0; carrier.respawnTimer = 3; carrier.activeWeapon = 'ball';
  });
  runtime.step(); const result = await runtime.done;
  assert.equal(result.termination, 'invalid-state'); assert.equal(result.end!.tick, 0);
  assert.equal(result.failureState!.tick, 1); assert.equal(result.failureState!.lastValidTick, 0);
  assert.equal(result.failureState!.stage, 'after-tick'); assert.equal(result.failureState!.holder!.hp, 0);
  assert.equal(result.failureState!.holder!.weapon, 'ball'); assert.equal(result.trace.length, 1);
  const snapshot = JSON.stringify(result.failureState); state.otherPlayers.clear();
  assert.equal(JSON.stringify(result.failureState), snapshot); runtime.dispose();
});

for (const kind of ['missing-holder', 'non-finite', 'tick-exception'] as const) test(`failure evidence survives ${kind}`, async () => {
  const { runtime } = await setup('scenario', false, s => {
    if (kind === 'missing-holder') { s.grifball.ball.state = 'held'; s.grifball.ball.holderId = 'missing'; }
    if (kind === 'non-finite') s.otherPlayers.values().next().value!.pos.x = NaN;
    if (kind === 'tick-exception') throw new Error('impact exploded');
  });
  runtime.step(); const result = await runtime.done;
  assert.equal(result.termination, 'invalid-state'); assert.equal(result.failureState!.tick, 1);
  const saved = JSON.parse(JSON.stringify(result.failureState));
  if (kind === 'missing-holder') { assert.equal(saved.holder, null); assert.equal(saved.ball.holderId, 'missing'); }
  if (kind === 'non-finite') assert.equal(saved.actors[0].position[0], 'NaN');
  if (kind === 'tick-exception') { assert.equal(saved.stage, 'tick'); assert.match(result.check.summary, /impact exploded/); }
  runtime.dispose();
});
