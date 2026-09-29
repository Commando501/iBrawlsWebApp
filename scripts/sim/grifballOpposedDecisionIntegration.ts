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
export function runOpposedDecisionTrace(spec: OpposedDecisionCase) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal',
      hammerMeleeSpeed: spec.mode === 'punch-first' ? .04 : .5,
      hammerSlamWindupTime: spec.mode === 'punch-first' ? .5 : .08,
      hammerSlamAttackTime: spec.mode === 'punch-first' ? .2 : .04 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'opposed-corridor', name: 'Opposed corridor', mapShape: 'rectangular', arenaRadius: 60,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData;
  state.arenaRadius = 60; state.isObserverMode = true; state.grifball.phase = 'playing';
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = false; state.otherPlayers.clear();
  const carrierId = spec.main ? 'main_ai' : 'carrier';
  const otherTeam = spec.team === 'blue' ? 'red' as const : 'blue' as const;
  const seeds = [
    { id: carrierId, x: -1, z: 0, team: spec.team },
    { id: 'defender', x: 1, z: 0, team: otherTeam },
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
  const carrier = state.otherPlayers.get(carrierId)!, defender = state.otherPlayers.get('defender')!;
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
      const started = startAIHammerJumpForCombatant({ self, settings: state.settings, vel, horizontalHeading, jumpType,
        onMainAIHammerSwing: noop, playSwing: noop, playJump: noop });
      if (started) attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee: false, kind: 'hammer-jump' });
      return started;
    },
    triggerCombatantLunge: () => check('unexpected sword lunge', true, false),
    swapCombatantWeapon: () => check('unexpected weapon swap', true, false),
    spawnVoxelShockwaveParticles: noop,
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  const impacts: { tick: number; id: string; victims: string[] }[] = [];
  const pickups: { tick: number; id: string; distance: number }[] = [];
  let deathTick = 0, dropTick = 0;
  for (tick = 1; tick <= 150; tick++) {
    const plan = state.aiMatchContext.grifballTeamPlan;
    const updates: string[] = [];
    const living = [...state.otherPlayers.values()].filter(c => c.hp > 0).map(c => c.id);
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    withSimulationRandom(random, tick * dt, () => advanceGrifballFrameForState({
      state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
      isPlaying: true, isPausedRef: { current: false }, replayData: null,
      keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 }, secretAudioRef: { current: null },
      isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
      replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
      spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
      // Observer fixture: no local input/weapon owner or roster resize. Bot physics
      // execute inside the real updater; this short horizon ends before any respawn.
      updatePhysics: noop, updateHammerAnimations: noop, runAIOrchestrator: noop,
      updateAI: delta => updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt: delta,
        respawnCombatant: () => check('unexpected respawn', true, false),
        beforeUpdate: () => updateGrifballTeamPlanForState(state, delta, goal, map), updateSingleAIEntity: (id, delta) => { updates.push(id); update(id, delta); } }),
      updateGrifball: delta => {
        const wasHeld = ballState() === 'held';
        const requested = new Map([...state.otherPlayers].map(([id, c]) => [id, !!c.pickupRequested && c.hp > 0 && c.respawnTimer <= 0]));
        const ballPos = { ...state.grifball.ball.pos };
        updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: delta,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: noop, pushStatsUpdate: noop });
        if (!wasHeld && ballState() === 'held') {
          const id = state.grifball.ball.holderId!, c = state.otherPlayers.get(id)!;
          pickups.push({ tick, id, distance: Math.hypot(c.pos.x - ballPos.x, c.pos.z - ballPos.z) });
          check('autonomous pickup request', requested.get(id), true);
          check('pickup begins from loose ball', wasHeld, false);
          check('pickup alive', c.hp > 0 && c.respawnTimer <= 0, true);
          check('pickup range', pickups.at(-1)!.distance <= (state.settings.grifballPickupRadius ?? 1.6) + 1e-6, true);
        }
      },
      updateCharacterSkeletalAnimations: delta => updateRosterCombatantVisualsForState({ state, refs, dt: delta,
        renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: botId => {
          const health = new Map([...state.otherPlayers].map(([id, c]) => [id, c.hp]));
          applyBotMeleeImpactForState({ state, botId, renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop,
            playExplosion: noop, playDeath: noop, playSwing: noop, recordBotPsychKill: noop, recordBotCalibrationDeath: noop });
          const victims = [...state.otherPlayers.values()].filter(c => c.hp < health.get(c.id)!).map(c => c.id);
          impacts.push({ tick, id: botId, victims });
          check('only enemy damage', victims.every(id => state.otherPlayers.get(id)!.team !== state.otherPlayers.get(botId)!.team), true);
        } }),
      updateMatchTimers: noop, enforceArenaBounds: noop,
      renderGame: () => {
        if (carrier.hp <= 0 && !deathTick) deathTick = tick;
        if (deathTick === tick) {
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
    const lastPickup = pickups.at(-1);
    if (lastPickup && tick === lastPickup.tick + 1) check('new carrier becomes runner', plan.assignments.get(lastPickup.id)?.role, 'runner');
    if (dropTick && tick === dropTick + 1) {
      check('enemy recovers loose-ball assignment', plan.assignments.get(defender.id)?.role, 'retriever');
      if (spec.mode === 'contested') check('ally contests loose ball', plan.assignments.get('escort')?.role, 'retriever');
    }
    for (const c of state.otherPlayers.values()) {
      check(`${c.id}.finite`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw, c.aiTimer ?? 0].every(Number.isFinite), true);
      check(`${c.id}.open segment`, isSpaceSegmentOpen(plan.snapshot!.geometry!, before.get(c.id)!, c.pos), true);
      check(`${c.id}.pickup intent cleared`, !!c.pickupRequested, false);
    }
    if (ballState() === 'held') {
      const holder = state.otherPlayers.get(state.grifball.ball.holderId!)!;
      check('living carrier at frame end', holder.hp > 0 && holder.respawnTimer <= 0, true);
      check('carrier loadout', holder.activeWeapon, 'ball');
    }
    frames.push({ tick, ball: structuredClone(state.grifball.ball),
      assignments: [...plan.assignments.values()].map(a => ({ id: a.botId, role: a.role, target: state.aiMatchContext.coordinator.tacticalEngagements.get(a.botId)?.targetId ?? null })),
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, team: c.team, pos: c.pos.toArray(), vel: c.vel.toArray(),
        hp: c.hp, maxHp: c.maxHp, kills: c.kills, deaths: c.deaths, respawnTimer: c.respawnTimer, yaw: c.yaw, weapon: c.activeWeapon, weaponState: c.weaponState, weaponTimer: c.weaponTimer, isJumping: !!c.isJumping, aiState: c.aiState, timer: c.aiTimer ?? 0 })) });
  }
  tick = 150;
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
  check('main identity kill bookkeeping', state.enemyKills, spec.main && punchWins ? 1 : 0);
  check('main identity death bookkeeping', state.enemyDeaths, spec.main && !punchWins ? 1 : 0);
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
  return { name: `${spec.mode}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.main ? 'main' : 'ordinary'}`,
    boundary: 'live-opposed-decision-integration' as const, scenario: spec, ticks: 150,
    failureCount, failures, deathTick, dropTick, attacks, impacts, pickups, targetLookups, frames };
}
export const runOpposedDecisionIntegration = () => OPPOSED_DECISION_CASES.map(runOpposedDecisionTrace);
