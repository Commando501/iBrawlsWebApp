import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, SCRIPTED_PASS_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { buildGrifballTeamAwarenessForCombatant } from '../../src/components/grifball/grifballAITeamAwareness';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { tickCombatantInvulnerability, pauseInactiveGrifballAI } from '../../src/components/grifball/aiTickState';
import { tickAIEngagementCooldowns } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { canStartAIWeaponAction } from '../../src/components/grifball/aiWeaponTimingRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { DEFAULT_KEYBINDINGS } from '../../src/types';

const dt = 1 / 60, noop = () => {};
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const passing of [false, true])
  test(`own-state mixed unopposed match through restart and winner mirror=${mirror}/reverse=${reverse}/passing=${passing}`, t => {
    const f = createBotParityFixture('main_ai', false, { aiDifficulty: 'normal', grifballGoalTarget: 2 }, 'support');
    const { sim, state, refs, map, bot } = f, team = mirror ? 'red' : 'blue', sign = mirror ? -1 : 1;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
    const player = { ...structuredClone(sim.combatants[0]), id: 'player', controller: 'remote' as const };
    sim.combatants.push(player);
    for (const [i, c] of sim.combatants.entries()) {
      c.id = ['main_ai', 'support', 'player'][i]; c.controller = c === player ? 'remote' : 'ai'; c.team = team;
      c.pos = { x: [-12, -20, -30][i] * sign, y: 0, z: i === 2 ? 10 : 0 };
      c.vel = { x: 0, y: 0, z: 0 }; c.yaw = 0;
      c.hp = c.maxHp = sim.settings.maxHP; c.invulnerabilityTimer = c.weaponReadyTimer = 0;
      const live = state.otherPlayers.get(c.id);
      if (live) { live.team = team; live.pos.set(c.pos.x, 0, c.pos.z); live.vel.set(0, 0, 0); live.yaw = Math.PI;
        live.hp = live.maxHp = c.hp; live.aiState = 'APPROACHING'; live.aiTimer = 0; }
    }
    state.localPlayerTeam = team; state.playerPos.set(player.pos.x, 0, player.pos.z); state.playerVel.set(0, 0, 0);
    state.yaw = Math.PI; state.playerHP = state.playerMaxHP = player.hp;
    state.playerRespawnTimer = state.playerInvulnerabilityTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
    state.pWeaponState = state.pSwordState = 'ready'; state.pWeaponTimer = state.pSwordTimer = 0; state.activeWeapon = 'hammer';
    state.grifball = structuredClone(sim.match); state.arenaRadius = map.arenaRadius;
    state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = passing;
    if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
    const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION, scriptedBots: { main_ai: 'normal', support: 'normal' },
      plan: createGrifballTeamPlanState(), tactics: structuredClone(state.grifballTactics),
      punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { main_ai: 0, support: 0 } }, passControl: SCRIPTED_PASS_VERSION };
    const placement = createArenaOrchestratorCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
      getActiveCustomMap: () => map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => state.otherPlayers.size,
      isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
    const constrain = (pos: typeof bot.pos, vel: typeof bot.vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius });
    const goal = (side: string | undefined) => sim.goalPlates.find(p => p.team !== side)!.position;
    const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
    let liveResets = 0, simResets = 0, countdowns = 0, postResetPickups = 0, finalTick = 0;
    const goals: number[] = []; let passes = 0;
    let continuation: { state: typeof sim; planner: ScriptedObjectivePlanner } | undefined;
    const compare = (a: any, b: any, path: string) => {
      if (a && typeof a === 'object') for (const key of Object.keys(a)) compare(a[key], b?.[key], `${path}.${key}`);
      else if (typeof a === 'number') near(a, b, path);
      else assert.equal(b, a, path);
    };
    for (let tick = 1; tick <= 6000; tick++) {
      advanceGrifballFrameForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
        isPlaying: true, isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 },
        secretAudioRef: { current: null }, isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
        replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
        spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
        updatePhysics: delta => {
          if (!updatePlayerRespawnForState({ state, dt: delta, isMultiplayer: false, getMainAi: () => bot, activeCustomMap: map, spawnPoints: [], playRespawn: noop })) {
            updatePlayerHorizontalMovementForState({ state, refs, dt: delta, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
              actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: { x: 0, y: 0 }, mobileControlsActive: true,
              sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
            updatePlayerVerticalIntegrationForState({ state, dt: delta, gravityAcceleration: 18, constrainCombatantToArena: constrain });
          }
        }, updateHammerAnimations: f.weaponFrame, runAIOrchestrator: f.respawns,
        updateAI: delta => {
          updateGrifballTeamPlanForState(state, delta, goal, map);
          for (const live of state.otherPlayers.values()) {
            if (live.hp <= 0) continue;
            tickCombatantInvulnerability(live, delta);
            if (pauseInactiveGrifballAI(state, live)) continue;
            const frame = { pos: live.pos, vel: live.vel, yaw: live.yaw, aiState: live.aiState, timer: live.aiTimer ?? 0,
              dashRemaining: 0, slideActive: false, weaponState: live.weaponState ?? 'ready', pickupRequested: !!live.pickupRequested,
              dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 };
            tickAIEngagementCooldowns({ frame, self: live, botId: live.id, mainAIId: 'main_ai', dt: delta });
            assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: live.id, self: live, frame,
              ...buildGrifballTeamAwarenessForCombatant(state, live.id, live.team), dt: delta,
              canStartWeaponAction: canStartAIWeaponAction({ aiState: frame.aiState, timer: frame.timer, swapCooldownTimer: live.swapCooldownTimer }),
              triggerCombatantAttack: () => assert.fail('unopposed match must not attack'), getEnemyGoalPos: goal, constrainCombatantToArena: constrain }), `${tick}/${live.id}/live handoff`);
            live.yaw = frame.yaw; live.aiState = frame.aiState; live.aiTimer = frame.timer; live.pickupRequested = frame.pickupRequested;
          }
        },
        updateGrifball: delta => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: delta,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => { liveResets++; placement.placeCombatantsAtGrifballSpawns(); }, pushStatsUpdate: noop }),
        updateCharacterSkeletalAnimations: f.visuals, updateMatchTimers: noop, enforceArenaBounds: noop, renderGame: noop,
        updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop });
      const events = stepSimulation(sim, {}, { settings: sim.settings, scriptedPlanner: planner });
      assert.ok(events.plannerFrame!.decisions.every(d => d.kind !== 'handoff'), `${tick}/${JSON.stringify(events.plannerFrame)}`);
      if (continuation) {
        const replay = stepSimulation(continuation.state, {}, { settings: continuation.state.settings, scriptedPlanner: continuation.planner });
        assert.deepEqual(replay, events); assert.deepEqual(continuation.state, sim); assert.deepEqual(continuation.planner, planner);
      }
      if (events.roundReset) { simResets++; continuation = { state: JSON.parse(JSON.stringify(sim)), planner: structuredClone(planner) }; }
      if (events.startedPlaying) countdowns++;
      if (simResets && events.pickup) postResetPickups++;
      if (events.goal) goals.push(tick);
      if (events.scriptedPass?.kind === 'release') passes++;
      assert.equal(simResets, liveResets, `${tick}/resets`);
      compare(state.grifball, sim.match, `${tick}/match`); compare(state.teamScores, sim.scores, `${tick}/scores`);
      for (const c of sim.combatants) {
        const live = state.otherPlayers.get(c.id), pos = live?.pos ?? state.playerPos, vel = live?.vel ?? state.playerVel, yaw = live?.yaw ?? state.yaw;
        for (const axis of ['x', 'y', 'z'] as const) { near(c.pos[axis], pos[axis], `${tick}/${c.id}/position.${axis}`); near(c.vel[axis], vel[axis], `${tick}/${c.id}/velocity.${axis}`); }
        near(Math.sin(c.yaw), -Math.sin(yaw), `${tick}/${c.id}/heading.x`); near(Math.cos(c.yaw), -Math.cos(yaw), `${tick}/${c.id}/heading.z`);
        assert.equal(c.hp, live?.hp ?? state.playerHP); assert.equal(c.maxHp, live?.maxHp ?? state.playerMaxHP);
        assert.equal(c.weapon, live?.activeWeapon ?? state.activeWeapon);
        near(c.respawnTimer, Math.max(0, live?.respawnTimer ?? state.playerRespawnTimer), `${tick}/${c.id}/respawn`);
        near(c.invulnerabilityTimer, live?.invulnerabilityTimer ?? state.playerInvulnerabilityTimer, `${tick}/${c.id}/shield`);
        assert.equal(c.alive, (live?.hp ?? state.playerHP) > 0);
      }
      if (events.matchEnded) finalTick = tick;
      if (finalTick && tick >= finalTick + 5) break;
    }
    assert.ok(finalTick > 0, 'both own-state engines must reach matchEnd within 100 seconds');
    assert.equal(simResets, 1); assert.equal(countdowns, 2); assert.ok(postResetPickups > 0);
    assert.equal(sim.match.winningTeam, team); assert.equal(sim.scores[team].goals, 2);
    assert.equal(sim.scores[team === 'blue' ? 'red' : 'blue'].goals, 0);
    assert.equal(sim.match.phase, 'matchEnd'); assert.equal(goals.length, 2);
    t.diagnostic(JSON.stringify({ goals, finalTick, resets: simResets, countdowns, postResetPickups, passes }));
  });
