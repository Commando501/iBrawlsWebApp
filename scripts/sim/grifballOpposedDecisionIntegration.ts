import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { createCombatantActionCallbacksForState } from '../../src/components/grifball/combatantActionCallbacks';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { getOptimalSpawnPointForArena } from '../../src/components/grifball/arenaRuntime';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { isSpaceSegmentOpen } from '../../src/game/grifballSpaceGeometry';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import type { CustomMapData } from '../../src/types';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction, startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { updateRosterCombatantVisualsForState } from '../../src/components/grifball/rosterVisualSync';
import { applyBotMeleeImpactForState } from '../../src/components/grifball/botMeleeImpactRuntime';

export interface OpposedDecisionCase {
  mode: 'punch-first' | 'hammer-first' | 'contested';
  team: 'blue' | 'red'; reverse: boolean; main: boolean;
}
export const OPPOSED_DECISION_CASES: OpposedDecisionCase[] =
  (['punch-first', 'hammer-first', 'contested'] as const).flatMap(mode =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      [false, true].map(main => ({ mode, team, reverse, main })))));

/** Live decisions by every actor, through the production frame coordinator.
 * Initial positions, wounded possession and timing settings are authored; no
 * actions, assignments, movement, subsequent damage or ownership are injected.
 */
export function runOpposedDecisionTrace(spec: OpposedDecisionCase, continuation: 'opening' | 'revival' | 'match' = 'opening') {
  const match = continuation === 'match', revival = continuation !== 'opening';
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal',
      ...(match ? { grifballGoalTarget: 2, grifballRoundResetDelay: .19, grifballCountdownDuration: .09 } : {}),
      hammerMeleeSpeed: spec.mode === 'punch-first' ? .04 : .5,
      hammerSlamWindupTime: spec.mode === 'punch-first' ? .5 : .08,
      hammerSlamAttackTime: spec.mode === 'punch-first' ? .2 : .04 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'opposed-corridor', name: 'Opposed corridor', mapShape: 'rectangular', arenaRadius: 60,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData;
  if (match) map.objects = (['blue', 'red'] as const).map(team => ({ id: team, type: 'box', goalPlateTeam: team,
    position: { x: team === 'blue' ? -47 : 47, y: 0, z: 0 }, scale: { x: 2, y: .12, z: 2 }, rotation: { x: 0, y: 0, z: 0 } })) as CustomMapData['objects'];
  state.arenaRadius = 60; state.isObserverMode = true; state.grifball.phase = 'playing';
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = false; state.otherPlayers.clear();
  const carrierId = spec.main ? 'main_ai' : 'carrier';
  const defenderId = 'defender';
  if (revival) map.teamSpawns = { blue: [{ x: -12, y: 0, z: 3 }], red: [{ x: 12, y: 0, z: -3 }] };
  const otherTeam = spec.team === 'blue' ? 'red' as const : 'blue' as const;
  const seeds = [
    { id: carrierId, x: -1, z: 0, team: spec.team },
    { id: defenderId, x: 1, z: 0, team: otherTeam },
    ...(spec.mode === 'contested' ? [
      { id: 'escort', x: -8, z: 3, team: spec.team },
      { id: 'cover', x: 8, z: -3, team: otherTeam },
    ] : []),
  ];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: 'ai', weaponState: 'ready', weaponTimer: 0,
      hp: 1, maxHp: 1, invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c);
    const group = new THREE.Group(); group.userData.modelSystem = 'v2';
    refs.otherPlayerMeshes.set(c.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  }
  const carrier = state.otherPlayers.get(carrierId)!, defender = state.otherPlayers.get(defenderId)!;
  const ballState = () => state.grifball.ball.state;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrierId;
  state.grifball.ball.pos = { x: carrier.pos.x, y: 1.1, z: carrier.pos.z };
  setGrifballCarrierForState({ state, refs, id: carrierId, carrying: true });
  carrier.hp = 1; carrier.runnerLastHp = 1; carrier.runnerHealDelayTimer = 3; // Wounded carrier: one lethal hit, normal carrier mechanics.
  let tick = 0, failureCount = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {}, goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const knobs: AIResolvedKnobs = { difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
    weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0, aiPlaystyle: 50 };
  const derived = deriveAIParams(state.settings, knobs);
  const getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as never),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  const attacks: { tick: number; id: string; weapon: string; melee: boolean; kind: 'swing' | 'hammer-jump' }[] = [];
  const mainJumpRequests: { tick: number; accepted: boolean; dash: number; swap: number }[] = [];
  const targetLookups: { tick: number; id: string; target: string }[] = [];
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, grifballEnemyGoalPos: goal,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    ...targets,
    getBestTacticalTarget: (id: string, pos: THREE.Vector3, difficulty: string) => {
      const target = targets.getBestTacticalTarget(id, pos, difficulty);
      if (target) targetLookups.push({ tick, id, target: target.id });
      return target;
    },
    getTacticalTargetById: (id: string, target: string) => {
      targetLookups.push({ tick, id, target });
      return targets.getTacticalTargetById(id, target);
    },
    triggerCombatantAttack: (self, weapon, melee = false) => {
      attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee, kind: 'swing' });
      triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop });
    },
    getOptimalSpawnPoint: excludePositions => getOptimalSpawnPointForArena({ activeCustomMap: map, spawnPoints: [], excludePositions }),
    getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: noop, clearPressureTarget: noop,
    startAIHammerJump: (self, _pos, vel, horizontalHeading, jumpType) => {
      const plannedBefore = !!self.hammerJumpPlanned;
      const started = startAIHammerJumpForCombatant({ self, settings: state.settings, vel, horizontalHeading, jumpType,
        onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(state.otherPlayers.get('main_ai')), playSwing: noop, playJump: noop });
      if (self.id === 'main_ai') {
        mainJumpRequests.push({ tick, accepted: started, dash: self.aiDashRemaining ?? 0, swap: self.swapCooldownTimer ?? 0 });
        if (!started && !plannedBefore) check('rejected main jump leaves no latent plan', !!self.hammerJumpPlanned, false);
      }
      if (started) attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee: false, kind: 'hammer-jump' });
      return started;
    },
    triggerCombatantLunge: () => check('unexpected sword lunge', true, false),
    swapCombatantWeapon: () => check('unexpected weapon swap', true, false),
    spawnVoxelShockwaveParticles: noop,
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const actions = createCombatantActionCallbacksForState({ getState: () => state, getRefs: () => refs,
    spawnPoints: [], getRosterAI: () => [...state.otherPlayers.values()], getActiveCustomMap: () => map,
    getOptimalSpawnPoint: excludePositions => getOptimalSpawnPointForArena({ activeCustomMap: map, spawnPoints: [], excludePositions }),
    recordCombatantObservation: noop, onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(state.otherPlayers.get('main_ai')), playSwing: noop, playJump: noop, playDash: noop, playRespawn: noop });
  const placement = createArenaOrchestratorCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
    getActiveCustomMap: () => map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => state.otherPlayers.size,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const transitions: { tick: number; from: string; to: string; round: number }[] = [];
  const goals: { tick: number; id: string; team: string; round: number }[] = [];
  const resets: { tick: number; round: number }[] = [];
  let notifications = 0;
  const deaths: { tick: number; id: string }[] = [];
  const revivals: { tick: number; id: string; pos: number[]; shield: number; deaths: number; kills: number }[] = [];
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  const mainJumpImpacts: { tick: number; launched: boolean; budget: number }[] = [];
  const carrierDeaths: { tick: number; id: string; pos: number[] }[] = [];
  const impacts: { tick: number; id: string; victims: string[] }[] = [];
  const pickups: { tick: number; id: string; distance: number }[] = [];
  let deathTick = 0, dropTick = 0;
  const ticks = match ? (spec.main ? 9000 : 3840) : revival ? 480 : 150;
  for (tick = 1; tick <= ticks; tick++) {
    const plan = state.aiMatchContext.grifballTeamPlan, phase = state.grifball.phase;
    const updates: string[] = [];
    const attackCount = attacks.length;
    let living = [...state.otherPlayers.values()].filter(c => c.hp > 0).map(c => c.id);
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    withSimulationRandom(random, tick * dt, () => advanceGrifballFrameForState({
      state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
      isPlaying: true, isPausedRef: { current: false }, replayData: null,
      keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 }, secretAudioRef: { current: null },
      isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
      replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
      spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
      // Observer fixture: no local input/weapon owner or roster resize. Bot physics
      // execute inside the real updater; optional continuation includes real respawns.
      updatePhysics: noop, updateHammerAnimations: noop, runAIOrchestrator: noop,
      updateAI: delta => updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt: delta,
        respawnCombatant: (c, mesh) => {
          check('respawn continuation enabled', revival, true);
          const death = deaths.filter(d => d.id === c.id).at(-1);
          check('revival follows one full death delay', tick, (death?.tick ?? -181) + 181);
          const deathCount = c.deaths, kills = c.kills;
          actions.respawnCombatant(c, mesh);
          revivals.push({ tick, id: c.id, pos: c.pos.toArray(), shield: c.invulnerabilityTimer, deaths: deathCount, kills });
          const spawn = map.teamSpawns?.[c.team!]?.[0];
          check('team spawn', JSON.stringify(c.pos.toArray()), JSON.stringify(spawn ? [spawn.x, spawn.y, spawn.z] : []));
          check('respawn full base health', c.hp, state.settings.maxHP ?? 1);
          check('respawn weapon ready', c.weaponState, 'ready');
          check('respawn grounded', !!c.isJumping, false);
          check('respawn jump plan cleared', !!c.hammerJumpPlanned, false);
          check('respawn jump type cleared', c.hammerJumpType, undefined);
          check('respawn jump budget reset', c.aiHammerJumpsInAir, 0);
          check('respawn jump window cleared', c.hammerJumpWindowTimer, 0);
          check('respawn flight cleared', !!c.isLunging, false);
          check('respawn velocity reset', c.vel.length(), 0);
          check('respawn dash reset', c.aiDashRemaining, 0);
          check('respawn pressure reset', c.aiPressureTargetId, undefined);
          check('respawn shield initialized', c.invulnerabilityTimer, state.settings.respawnInvulnerabilityDuration);
          check('respawn visible', mesh.visible, true);
          check('respawn timestamp uses simulation clock', c.spawnTime, 1_000_000 + tick * dt * 1000);
          check('respawn preserves deaths', c.deaths, deathCount);
          check('respawn preserves kills', c.kills, kills);
        },
        beforeUpdate: () => {
          living = [...state.otherPlayers.values()].filter(c => c.hp > 0).map(c => c.id);
          updateGrifballTeamPlanForState(state, delta, goal, map);
        }, updateSingleAIEntity: (id, delta) => { updates.push(id); update(id, delta); } }),
      updateGrifball: delta => {
        const previousBallState = ballState();
        const oldHolder = state.grifball.ball.holderId;
        const scorer = oldHolder ? state.otherPlayers.get(oldHolder) : undefined;
        const scoringPosition = scorer?.pos.clone();
        const priorGoals = { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals };
        const wasHeld = previousBallState === 'held';
        const requested = new Map([...state.otherPlayers].map(([id, c]) => [id, !!c.pickupRequested && c.hp > 0 && c.respawnTimer <= 0]));
        const ballPos = { ...state.grifball.ball.pos };
        updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: delta,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => {
            check('round continuation enabled', match, true);
            const health = [...state.otherPlayers.values()].map(c => [c.id, c.hp, c.respawnTimer, c.kills, c.deaths]);
            placement.placeCombatantsAtGrifballSpawns();
            resets.push({ tick, round: state.grifball.roundNumber });
            check('round reset preserves combat lifecycle', JSON.stringify([...state.otherPlayers.values()].map(c => [c.id, c.hp, c.respawnTimer, c.kills, c.deaths])), JSON.stringify(health));
            for (const c of state.otherPlayers.values()) {
              const spawn = map.teamSpawns![c.team!]![0];
              check('round team spawn', JSON.stringify(c.pos.toArray()), JSON.stringify([spawn.x, spawn.y, spawn.z]));
              check('round velocity reset', c.vel.length(), 0);
            }
          }, pushStatsUpdate: () => notifications++ });
        for (const team of ['blue', 'red'] as const) if (state.teamScores[team].goals !== priorGoals[team]) {
          goals.push({ tick, id: oldHolder!, team, round: state.grifball.roundNumber });
          check('goal only during play', phase, 'playing');
          check('single goal increment', state.teamScores[team].goals, priorGoals[team] + 1);
          check('living scorer on enemy plate', !!scorer && scorer.team === team && scorer.hp > 0 &&
            Math.abs(scoringPosition!.x - (team === 'blue' ? 47 : -47)) <= 1 && Math.abs(scoringPosition!.z) <= 1, true);
          check('goal clears possession', state.grifball.ball.holderId, null);
          check('goal restores weapon', scorer?.activeWeapon, 'hammer');
          check('goal restores base health', scorer?.maxHp, state.settings.maxHP ?? 1);
          check('goal clears charge', plan.passCharge, null);
          check('goal starts scored hold', state.grifball.phase, 'scored');
        }
        if (!wasHeld && ballState() === 'held') {
          const id = state.grifball.ball.holderId!, c = state.otherPlayers.get(id)!;
          pickups.push({ tick, id, distance: Math.hypot(c.pos.x - ballPos.x, c.pos.z - ballPos.z) });
          check('autonomous pickup request', requested.get(id), true);
          check('pickup begins from available ball', previousBallState === 'loose' || match && previousBallState === 'idle', true);
          check('pickup alive', c.hp > 0 && c.respawnTimer <= 0, true);
          check('pickup range', pickups.at(-1)!.distance <= (state.settings.grifballPickupRadius ?? 1.6) + 1e-6, true);
        }
      },
      updateCharacterSkeletalAnimations: delta => updateRosterCombatantVisualsForState({ state, refs, dt: delta,
        renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: botId => {
          const holderId = state.grifball.ball.holderId;
          const attacker = state.otherPlayers.get(botId)!;
          const plannedJump = botId === 'main_ai' && !!attacker.hammerJumpPlanned;
          const jumpBudget = attacker.aiHammerJumpsInAir ?? 0;
          const health = new Map([...state.otherPlayers].map(([id, c]) => [id, c.hp]));
          applyBotMeleeImpactForState({ state, botId, renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop,
            playExplosion: noop, playDeath: noop, playSwing: noop, recordBotPsychKill: noop, recordBotCalibrationDeath: noop });
          if (plannedJump) {
            check('main jump plan consumed at impact', attacker.hammerJumpPlanned, false);
            check('main jump type consumed at impact', attacker.hammerJumpType, undefined);
            check('main jump applies upward impulse', attacker.vel.y, 7.2 + (state.settings.hammerJumpPower ?? 6.5));
            check('main jump increments budget once', attacker.aiHammerJumpsInAir, jumpBudget + 1);
            mainJumpImpacts.push({ tick, launched: !!attacker.isJumping, budget: attacker.aiHammerJumpsInAir ?? 0 });
          }
          const victims = [...state.otherPlayers.values()].filter(c => c.hp < health.get(c.id)!).map(c => c.id);
          impacts.push({ tick, id: botId, victims });
          for (const id of victims) if (state.otherPlayers.get(id)!.hp <= 0) {
            deaths.push({ tick, id });
            if (holderId === id) carrierDeaths.push({ tick, id, pos: state.otherPlayers.get(id)!.pos.toArray() });
          }
          check('no damage through spawn shield', victims.every(id => state.otherPlayers.get(id)!.invulnerabilityTimer <= 0), true);
          check('only enemy damage', victims.every(id => state.otherPlayers.get(id)!.team !== state.otherPlayers.get(botId)!.team), true);
        } }),
      updateMatchTimers: noop, enforceArenaBounds: noop,
      renderGame: () => {
        const lost = carrierDeaths.at(-1);
        if (lost?.tick === tick) {
          check('every carrier death releases ownership before render', state.grifball.ball.holderId, null);
          check('every carrier death drops loose ball', ballState(), 'loose');
          check('every drop uses death position', Math.hypot(state.grifball.ball.pos.x - lost.pos[0], state.grifball.ball.pos.z - lost.pos[2]) < 1e-9, true);
          check('every dead carrier restores hammer', state.otherPlayers.get(lost.id)!.activeWeapon, 'hammer');
          check('every dead carrier clears assignment', plan.assignments.has(lost.id), false);
          check('every dead carrier clears charge', plan.passCharge, null);
        }
        if (carrier.hp <= 0 && !deathTick) deathTick = tick;
        if (deathTick === tick && (!match || dropTick === 0 && tick < 150)) {
          check('dead carrier released before render', state.grifball.ball.holderId !== carrierId, true);
          if (ballState() !== 'held') dropTick = tick;
          check('dead carrier weapon restored', carrier.activeWeapon, 'hammer');
          check('stale carrier charge cleared', plan.passCharge, null);
          check('dead carrier pickup intent cleared', !!carrier.pickupRequested, false);
          check('dropped ball at death position', Math.hypot(state.grifball.ball.pos.x - carrier.pos.x,
            state.grifball.ball.pos.z - carrier.pos.z) < 1e-9, true);
          check('drop starts fresh loose clock', state.grifball.ball.looseTimer, 0);
          check('stale carrier assignment cleared', plan.assignments.has(carrierId), false);
        }
      },
      updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop,
      recordReplayFrame: noop, playRespawn: noop,
    }));
    check('one decision per living actor', JSON.stringify(updates), JSON.stringify(living));
    for (const r of revivals.filter(r => r.tick === tick)) {
      const c = state.otherPlayers.get(r.id)!;
      check('revived bot assignment matches phase', plan.assignments.has(r.id), phase === 'playing' && c.hp > 0);
      check('revived shield advances once', Math.abs(c.invulnerabilityTimer - (r.shield - dt)) < 1e-9, true);
    }
    const lastPickup = pickups.at(-1);
    if (lastPickup && tick === lastPickup.tick + 1 && phase === 'playing' && state.grifball.ball.holderId === lastPickup.id) check('new carrier becomes runner', plan.assignments.get(lastPickup.id)?.role, 'runner');
    if (dropTick && tick === dropTick + 1) {
      check('enemy recovers loose-ball assignment', plan.assignments.get(defender.id)?.role, 'retriever');
      if (spec.mode === 'contested') check('ally contests loose ball', plan.assignments.get('escort')?.role, 'retriever');
    }
    for (const c of state.otherPlayers.values()) {
      const latestRevival = revivals.filter(r => r.id === c.id).at(-1);
      if (latestRevival && c.hp > 0) {
        const expectedShield = Math.max(0, latestRevival.shield - (tick - latestRevival.tick + 1) * dt);
        check(`${c.id}.shield countdown`, Math.abs(c.invulnerabilityTimer - expectedShield) < 1e-9, true);
      }
      check(`${c.id}.finite`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw, c.aiTimer ?? 0].every(Number.isFinite), true);
      if (plan.snapshot?.geometry && resets.at(-1)?.tick !== tick) check(`${c.id}.open segment`, isSpaceSegmentOpen(plan.snapshot.geometry, before.get(c.id)!, c.pos), true);
      check(`${c.id}.pickup intent cleared`, !!c.pickupRequested, false);
    }
    if (ballState() === 'held') {
      const holder = state.otherPlayers.get(state.grifball.ball.holderId!)!;
      check('living carrier at frame end', holder.hp > 0 && holder.respawnTimer <= 0, true);
      check('carrier loadout', holder.activeWeapon, 'ball');
    }
    if (state.grifball.phase !== phase) transitions.push({ tick, from: phase, to: state.grifball.phase, round: state.grifball.roundNumber });
    if (phase !== 'playing') {
      check('inactive assignments cleared', plan.assignments.size, 0);
      check('inactive bots do not start attacks', attacks.length, attackCount);
    }
    frames.push({ tick, phase: state.grifball.phase, round: state.grifball.roundNumber, scores: structuredClone(state.teamScores), winner: state.grifball.winningTeam, ball: structuredClone(state.grifball.ball),
      assignments: [...plan.assignments.values()].map(a => ({ id: a.botId, role: a.role, target: state.aiMatchContext.coordinator.tacticalEngagements.get(a.botId)?.targetId ?? null })),
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, team: c.team, pos: c.pos.toArray(), vel: c.vel.toArray(),
        hp: c.hp, maxHp: c.maxHp, kills: c.kills, deaths: c.deaths, respawnTimer: c.respawnTimer, shield: c.invulnerabilityTimer, yaw: c.yaw, weapon: c.activeWeapon, weaponState: c.weaponState, weaponTimer: c.weaponTimer, isJumping: !!c.isJumping, aiState: c.aiState, timer: c.aiTimer ?? 0 })) });
    if (tick === 150) validateOpeningContest();
  }
  tick = ticks;
  if (revival) {
    const loser = spec.mode === 'punch-first' ? defender : carrier;
    const first = revivals.find(r => r.id === loser.id);
    check('first loser revives', !!first, true);
    check('full respawn delay', first?.tick, (impacts[0]?.tick ?? 0) + 181);
    check('revived actor resumes useful movement', frames.some(f => f.tick > (first?.tick ?? ticks) &&
      f.actors.some(c => c.id === loser.id && c.hp > 0 && Math.hypot(c.pos[0] - first!.pos[0], c.pos[2] - first!.pos[2]) > 2)), true);
    if (spec.mode === 'contested' || spec.mode === 'hammer-first' && !spec.reverse) {
      check('revived actor autonomously attacks again', attacks.some(a => a.id === loser.id && a.tick > (first?.tick ?? ticks)), true);
    }
    check('revived actor resumes tactical role', frames.some(f => f.tick > (first?.tick ?? ticks) &&
      f.assignments.some(a => a.id === loser.id && ['chaser', 'safety', 'lead', 'left', 'right', 'runner', 'retriever'].includes(a.role))), true);
  }
  if (match) {
    const main = state.otherPlayers.get('main_ai');
    check('main identity final kill accounting', state.enemyKills, main?.kills ?? 0);
    check('main identity final death accounting', state.enemyDeaths, main?.deaths ?? 0);
    const jumpTicks = Math.ceil(state.settings.hammerSlamWindupTime / dt) + Math.ceil(state.settings.hammerSlamAttackTime / dt);
    for (const request of mainJumpRequests.filter(r => r.accepted)) {
      check('accepted main jump reaches impact or is interrupted by death',
        mainJumpImpacts.some(j => j.tick >= request.tick && j.tick <= request.tick + jumpTicks) ||
        deaths.some(d => d.id === 'main_ai' && d.tick >= request.tick && d.tick <= request.tick + jumpTicks), true);
    }
  }
  function validateOpeningContest() {
    check('runner attacks autonomously', attacks.some(a => a.id === carrierId), true);
    check('opponent attacks autonomously', attacks.some(a => a.id === defender.id), true);
    check('hostile target lookups', targetLookups.every(t => state.otherPlayers.get(t.id)!.team !== state.otherPlayers.get(t.target)!.team), true);
    const punchWins = spec.mode === 'punch-first';
    const winner = punchWins ? carrier : defender, loser = punchWins ? defender : carrier;
    check('loser health', loser.hp, 0);
    check('one credited kill', winner.kills, 1);
    check('one recorded death', loser.deaths, 1);
    check('loser never kills', loser.kills, 0);
    check('winner survives', winner.deaths, 0);
    check('first impact owner', impacts[0]?.id, winner.id);
    check('first impact victim', JSON.stringify(impacts[0]?.victims), JSON.stringify([loser.id]));
    check('first impact timing', impacts[0]?.tick, punchWins ? 5 : spec.reverse ? 8 : 9);
    check('loser commitment cancelled on death', impacts.some(i => i.id === loser.id), false);
    check('no post-death attack', attacks.some(a => a.id === loser.id && a.tick > impacts[0]?.tick), false);
    check('dead actor respawn clock advances once', Math.abs(loser.respawnTimer - (3 - (150 - (impacts[0]?.tick ?? 0)) / 60)) < 1e-9, true);
    check('dead actor weapon ready', loser.weaponState, 'ready');
    check('main identity kill bookkeeping', state.enemyKills, winner.id === 'main_ai' ? 1 : 0);
    check('main identity death bookkeeping', state.enemyDeaths, loser.id === 'main_ai' ? 1 : 0);
    check('expected pickup count', pickups.length, punchWins ? 0 : 1);
    check('same-frame death/drop', dropTick, punchWins ? 0 : impacts[0]?.tick);
    if (punchWins) {
      check('runner retains possession', state.grifball.ball.holderId, carrierId);
      check('runner resumes route', carrier.pos.x * sign > 5, true);
    } else {
      const recoveryId = spec.mode === 'contested' ? 'escort' : defender.id;
      check('expected recovery owner', pickups[0]?.id, recoveryId);
      check('expected recovery timing', pickups[0]?.tick, spec.mode === 'contested' ? 70 : spec.reverse ? 57 : 113);
      check('recovered possession retained', state.grifball.ball.holderId, recoveryId);
      if (spec.mode === 'contested') {
        check('opponent contests new runner', impacts.filter(i => i.victims.includes('escort')).length, 1);
        check('escort survives follow-up', state.otherPlayers.get('escort')!.hp, 1);
        check('coverage teammate unharmed', state.otherPlayers.get('cover')!.hp, 1);
        check('new carrier targeted autonomously', targetLookups.some(t => t.id === defender.id && t.target === 'escort' && t.tick > (pickups[0]?.tick ?? 150)), true);
      }
    }
  }
  return { name: `${spec.mode}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.main ? 'main' : 'ordinary'}`,
    boundary: match ? 'live-match-decision-integration' as const : revival ? 'live-revival-decision-integration' as const : 'live-opposed-decision-integration' as const, scenario: spec, ticks,
    failureCount, failures, mainJumpRequests, mainJumpImpacts, carrierDeaths, goals, resets, transitions, notifications, deaths, revivals, deathTick, dropTick, attacks, impacts, pickups, targetLookups, frames };
}
export const runOpposedDecisionIntegration = () => OPPOSED_DECISION_CASES.map(spec => runOpposedDecisionTrace(spec));
