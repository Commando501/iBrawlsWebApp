import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState, getGrifballEnemyGoalPosForMap } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import type { CustomMapData } from '../../src/types';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction } from '../../src/components/grifball/combatantActions';
import { updateRosterCombatantVisualsForState } from '../../src/components/grifball/rosterVisualSync';

export interface RoundDecisionCase {
  mode: 'win' | 'reset' | 'instant-reset';
  team: 'blue' | 'red'; reverse: boolean; main: boolean;
}
export const ROUND_DECISION_CASES: RoundDecisionCase[] =
  (['win', 'reset', 'instant-reset'] as const).flatMap(mode =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      [false, true].map(main => ({ mode, team, reverse, main })))));

/** Uncontested live round flow with two allied bots. Only the opening possession,
 * positions, map and settings are authored; all movement, scoring and subsequent
 * pickup/roles come from production decisions, objectives and reset placement. */
export function runRoundDecisionTrace(spec: RoundDecisionCase) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal',
      grifballGoalTarget: spec.mode === 'win' ? 1 : 2,
      grifballRoundResetDelay: spec.mode === 'instant-reset' ? 0 : .19,
      grifballCountdownDuration: spec.mode === 'instant-reset' ? 0 : .09 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'round-decision-court', name: 'Round decision court', mapShape: 'rectangular', arenaRadius: 30,
    arenaHalfExtents: { x: 20, z: 12 }, teamSpawns: {
      blue: [{ x: -6, y: 0, z: 0 }, { x: -6, y: 0, z: 4 }],
      red: [{ x: 6, y: 0, z: 0 }, { x: 6, y: 0, z: -4 }],
    }, objects: (['blue', 'red'] as const).map(team => ({ id: team, type: 'box', goalPlateTeam: team,
      position: { x: team === 'blue' ? -12 : 12, y: 0, z: 0 }, scale: { x: 2, y: .12, z: 2 }, rotation: { x: 0, y: 0, z: 0 } })) } as unknown as CustomMapData;
  state.arenaRadius = 30; state.isObserverMode = true; state.grifball.phase = 'playing';
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = false;
  state.otherPlayers.clear();
  const carrierId = spec.main ? 'main_ai' : 'carrier';
  const seeds = [ { id: carrierId, x: 8, z: 0, team: spec.team, controller: 'ai' as const },
    { id: 'support', x: 0, z: 5, team: spec.team, controller: 'ai' as const } ];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: s.controller, weaponState: 'ready', weaponTimer: 0,
      hp: 1, maxHp: 1, invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c);
    const group = new THREE.Group(); group.userData.modelSystem = 'v2';
    refs.otherPlayerMeshes.set(c.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  }
  const carrier = state.otherPlayers.get(carrierId)!;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrierId;
  state.grifball.ball.pos = { x: carrier.pos.x, y: 1.1, z: carrier.pos.z };
  setGrifballCarrierForState({ state, refs, id: carrierId, carrying: true });
  let tick = 0, failureCount = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {}, goal = (team: string | undefined) => getGrifballEnemyGoalPosForMap(team, map);
  const knobs: AIResolvedKnobs = { difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
    weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0, aiPlaystyle: 50 };
  const derived = deriveAIParams(state.settings, knobs);
  const getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as never),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  const attacks: { tick: number; id: string; weapon: string; melee: boolean }[] = [];
  const targetLookups: { tick: number; id: string; target: string }[] = [];
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, grifballEnemyGoalPos: goal,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    ...targets,
    getBestTacticalTarget: () => { check('no generic target override', true, false); return null; },
    getTacticalTargetById: (id: string, target: string) => {
      targetLookups.push({ tick, id, target });
      return targets.getTacticalTargetById(id, target);
    },
    triggerCombatantAttack: (self, weapon, melee = false) => {
      attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee });
      triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop });
    },
    getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: noop, clearPressureTarget: noop,
    startAIHammerJump: () => { check('unexpected hammer jump', true, false); return false; },
    triggerCombatantLunge: () => check('unexpected sword lunge', true, false),
    swapCombatantWeapon: () => check('unexpected weapon swap', true, false),
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const placement = createArenaOrchestratorCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
    getActiveCustomMap: () => map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => state.otherPlayers.size,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [], transitions: { tick: number; from: string; to: string; round: number }[] = [];
  const goals: { tick: number; id: string; round: number; pos: number[] }[] = [];
  const pickups: { tick: number; id: string; round: number }[] = [];
  const resets: { tick: number; actors: { id: string; pos: number[] }[] }[] = [];
  let notifications = 0;
  for (tick = 1; tick <= 360; tick++) {
    const phase = state.grifball.phase, plan = state.aiMatchContext.grifballTeamPlan;
    const updates: string[] = [];
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    withSimulationRandom(random, tick * dt, () => advanceGrifballFrameForState({
      state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt, isPlaying: true,
      isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} },
      grifbHoldTimerRef: { current: 0 }, secretAudioRef: { current: null },
      isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
      replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
      spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
      updatePhysics: noop, updateHammerAnimations: noop, runAIOrchestrator: noop,
      updateAI: delta => updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt: delta,
        respawnCombatant: () => check('unexpected combat respawn', true, false),
        beforeUpdate: () => updateGrifballTeamPlanForState(state, delta, goal, map), updateSingleAIEntity: (id, delta) => { updates.push(id); update(id, delta); } }),
      updateGrifball: delta => {
        const oldHolder = state.grifball.ball.holderId, total = state.teamScores[spec.team].goals;
        const scorer = oldHolder ? state.otherPlayers.get(oldHolder) : undefined;
        const scoringPosition = scorer?.pos.toArray();
        const loosePosition = { ...state.grifball.ball.pos };
        const requests = new Map([...state.otherPlayers].map(([id, c]) => [id, !!c.pickupRequested]));
        updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: delta,
          isMultiplayer: false, activeCustomMap: map, pushStatsUpdate: () => notifications++,
          placeCombatantsAtGrifballSpawns: () => {
            placement.placeCombatantsAtGrifballSpawns();
            resets.push({ tick, actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, pos: c.pos.toArray() })) });
            for (const c of state.otherPlayers.values()) {
              check('reset to own team spawn', c.pos.x, -6 * sign);
              check('reset clears velocity', c.vel.length(), 0);
              check('reset clears attack history', c.lastHammerAttackTime, 0);
            }
            check('distinct spawns', new Set(resets.at(-1)!.actors.map(c => JSON.stringify(c.pos))).size, 2);
          } });
        if (state.teamScores[spec.team].goals !== total) {
          goals.push({ tick, id: oldHolder!, round: state.grifball.roundNumber, pos: scoringPosition! });
          check('goal increments once', state.teamScores[spec.team].goals, total + 1);
          check('goal from live phase', phase, 'playing');
          check('living scorer on opposing plate', !!scorer && scorer.hp > 0 &&
            Math.abs(scoringPosition![0] - 12 * sign) <= 1 && Math.abs(scoringPosition![2]) <= 1, true);
          check('scorer hammer restored', scorer?.activeWeapon, 'hammer');
          check('scorer base health restored', scorer?.maxHp, state.settings.maxHP ?? 1);
          check('scored phase', state.grifball.phase, 'scored');
          check('goal releases ball', state.grifball.ball.holderId, null);
          check('goal returns ball home', state.grifball.ball.pos.x, 0);
          check('goal clears charge', plan.passCharge, null);
        }
        if (state.grifball.ball.holderId && state.grifball.ball.holderId !== oldHolder) {
          const id = state.grifball.ball.holderId;
          pickups.push({ tick, id, round: state.grifball.roundNumber });
          check('autonomous fresh pickup request', requests.get(id), true);
          const c = state.otherPlayers.get(id)!;
          check('pickup within range', Math.hypot(c.pos.x - loosePosition.x, c.pos.z - loosePosition.z) <= 1.6, true);
          check('pickup only while playing', state.grifball.phase, 'playing');
        }
      },
      updateCharacterSkeletalAnimations: delta => updateRosterCombatantVisualsForState({ state, refs, dt: delta,
        renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: () => check('unexpected impact', true, false) }),
      updateMatchTimers: noop, enforceArenaBounds: noop, renderGame: noop, updateFloatingNameplate: noop,
      pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop,
    }));
    if (state.grifball.phase !== phase) transitions.push({ tick, from: phase, to: state.grifball.phase, round: state.grifball.roundNumber });
    check('one update per bot', JSON.stringify(updates), JSON.stringify([...state.otherPlayers.keys()]));
    if (phase !== 'playing') check('inactive orders cleared', plan.assignments.size, 0);
    const resetNow = resets.at(-1)?.tick === tick;
    for (const c of state.otherPlayers.values()) {
      check(`${c.id}.finite`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw].every(Number.isFinite), true);
      check(`${c.id}.pickup consumed`, !!c.pickupRequested, false);
      check(`${c.id}.no damage`, c.hp > 0, true);
      if (!resetNow) check(`${c.id}.movement bounded`, c.pos.distanceTo(before.get(c.id)!) <= 7.54 * dt + 1e-9, true);
      if (phase !== 'playing' && !resetNow) check(`${c.id}.inactive movement paused`, c.pos.distanceTo(before.get(c.id)!), 0);
    }
    if (resetNow) {
      check('reset countdown', state.grifball.phase, 'countdown');
      check('reset clears ownership', state.grifball.ball.holderId, null);
      check('reset centers ball', state.grifball.ball.pos.x, 0);
    }
    const pickup = pickups.at(-1);
    if (pickup && tick === pickup.tick + 1) check('retriever becomes runner', plan.assignments.get(pickup.id)?.role, 'runner');
    frames.push({ tick, phase: state.grifball.phase, round: state.grifball.roundNumber, timer: state.grifball.phaseTimer,
      winner: state.grifball.winningTeam, scores: structuredClone(state.teamScores), ball: structuredClone(state.grifball.ball),
      assignments: [...plan.assignments.values()].map(a => ({ id: a.botId, role: a.role })),
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, pos: c.pos.toArray(), vel: c.vel.toArray(), hp: c.hp,
        maxHp: c.maxHp, weapon: c.activeWeapon, aiState: c.aiState, weaponState: c.weaponState })) });
  }
  tick = 360;
  const target = spec.mode === 'win' ? 1 : 2;
  check('autonomous goal total', goals.length, target);
  check('score notifications', notifications, target);
  check('own goal tally', state.teamScores[spec.team].goals, target);
  check('opponent tally unchanged', state.teamScores[spec.team === 'blue' ? 'red' : 'blue'].goals, 0);
  check('round reset count', resets.length, target - 1);
  check('fresh round pickup count', pickups.length, target - 1);
  check('match ends', state.grifball.phase, 'matchEnd');
  check('winning team', state.grifball.winningTeam, spec.team);
  check('final round', state.grifball.roundNumber, target);
  check('no combat', attacks.length, 0);
  const instant = spec.mode === 'instant-reset', holdTicks = instant ? 1 : 12;
  check('first score timing', goals[0]?.tick, 24);
  check('first scorer', goals[0]?.id, carrierId);
  const expectedTransitions = target === 1 ? [
    { tick: 24, from: 'playing', to: 'scored', round: 1 },
    { tick: 36, from: 'scored', to: 'matchEnd', round: 1 },
  ] : [
    { tick: 24, from: 'playing', to: 'scored', round: 1 },
    { tick: 24 + holdTicks, from: 'scored', to: 'countdown', round: 2 },
    { tick: instant ? 26 : 42, from: 'countdown', to: 'playing', round: 2 },
    { tick: instant ? 178 : 194, from: 'playing', to: 'scored', round: 2 },
    { tick: instant ? 179 : 206, from: 'scored', to: 'matchEnd', round: 2 },
  ];
  check('phase sequence and timing', JSON.stringify(transitions), JSON.stringify(expectedTransitions));
  if (target === 2) {
    const receiverId = spec.reverse ? 'support' : carrierId;
    check('fresh round retriever selected by spawn', pickups[0]?.id, receiverId);
    check('fresh pickup timing', pickups[0]?.tick, instant ? 77 : 93);
    check('new round scorer follows recovered possession', goals[1]?.id, receiverId);
    const firstLiveFrame = frames[(instant ? 27 : 43) - 1];
    check('fresh round retrieval assignment', firstLiveFrame.assignments.find(a => a.id === receiverId)?.role, 'retriever');
    check('fresh round removes old runner assignment', firstLiveFrame.assignments.some(a => a.role === 'runner'), false);
  }
  check('no terminal possession', state.grifball.ball.holderId, null);
  check('no terminal assignments', state.aiMatchContext.grifballTeamPlan.assignments.size, 0);
  check('no combat credits', [...state.otherPlayers.values()].some(c => c.kills || c.deaths), false);
  check('no hostile target lookup', targetLookups.length, 0);
  return { name: `${spec.mode}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.main ? 'main' : 'ordinary'}`,
    boundary: 'live-round-decision-integration' as const, scenario: spec, ticks: 360,
    failureCount, failures, transitions, goals, pickups, resets, notifications, frames };
}
export const runRoundDecisionIntegration = () => ROUND_DECISION_CASES.map(runRoundDecisionTrace);
