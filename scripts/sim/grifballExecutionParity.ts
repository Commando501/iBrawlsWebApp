import { runTankContest } from './grifballTankContest';
import { runRosterContest } from './grifballRosterContest';
import { runMapPassMatch } from './grifballMapPassMatch';
import { runPassMatch } from './grifballPassMatch';
import { runPassContest } from './grifballPassContest';
import { runMapMatch } from './grifballMapMatch';
import { runMapContest } from './grifballMapContest';
import { runMapRouting } from './grifballMapRouting';
import { runMapMobility } from './grifballMapMobility';
import { runMobilityDecisionIntegration } from './grifballMobilityDecisionIntegration';
import { runMatchDecisionIntegration } from './grifballMatchDecisionIntegration';
import { runRoundDecisionIntegration } from './grifballRoundDecisionIntegration';
import { runRevivalDecisionIntegration } from './grifballRevivalDecisionIntegration';
import { runOpposedDecisionIntegration } from './grifballOpposedDecisionIntegration';
import { runPressureDecisionIntegration } from './grifballPressureDecisionIntegration';
import { runPassDecisionIntegration } from './grifballPassDecisionIntegration';
import { runDecisionIntegration } from './grifballDecisionIntegration';
import { runRoundPlayerFlightParity } from './grifballRoundPlayerFlightParity';
import { runRoundFlightParity } from './grifballRoundFlightParity';
import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from '../../src/sim/factory';
import { idleAction, type ActionInput } from '../../src/sim/actions';
import { stepSimulation, SIM_DT } from '../../src/sim/step';
import type { SimCombatExecution } from '../../src/sim/simState';
import { setSimCarrier } from '../../src/sim/grifball';
import { type UniversalSettings, DEFAULT_KEYBINDINGS } from '../../src/types';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { triggerPlayerSwordSlashForState, triggerPlayerHammerSwingForState, triggerPlayerHammerMeleeForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerSwordAnimationForState } from '../../src/components/grifball/playerSwordAnimationRuntime';
import { updatePlayerHammerAnimationForState } from '../../src/components/grifball/playerHammerAnimationRuntime';
import { applyPlayerSwordSlashImpactForState } from '../../src/components/grifball/playerSwordSlashRuntime';
import { applyHammerStrikeImpactForState } from '../../src/components/grifball/hammerStrikeImpactRuntime';
import { applyPlayerHammerMeleeImpactForState } from '../../src/components/grifball/playerHammerMeleeRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState, throwPlayerGrifballPassForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { gate } from '../../src/game/grifballValidation/gates';
import { runBotExecutionParity } from './grifballBotExecutionParity';
import { LUNGE_PARITY_CASES, runLungeParity, runLungeParityTrace } from './grifballLungeParity';
import { runGeometryParity } from './grifballGeometryParity';
import { runMotionParity } from './grifballMotionParity';
import { runMovingContactParity } from './grifballMovingContactParity';
import { runMultiActorParity } from './grifballMultiActorParity';
import { runSpawnParity } from './grifballSpawnParity';
import { runMixedContactParity } from './grifballMixedContactParity';
import { runRoundCombatParity } from './grifballRoundCombatParity';
import { runRoundFrameParity } from './grifballRoundFrameParity';
import { runRunnerCombatParity } from './grifballRunnerCombatParity';
import { runCarrierRecoveryParity } from './grifballCarrierRecoveryParity';
import { runCarrierCrowdParity } from './grifballCarrierCrowdParity';
import { runChargeCombatParity } from './grifballChargeCombatParity';
import { runPassInputParity } from './grifballPassInputParity';
import { runFrameObjectiveParity } from './grifballFrameObjectiveParity';
import { runObjectiveParity } from './grifballObjectiveParity';
import { runOpposedFlightParity } from './grifballOpposedFlightParity';
import { runMixedLifecycleParity } from './grifballMixedLifecycleParity';
import { PLAYER_LUNGE_PARITY_CASES, runPlayerLungeParity, runPlayerLungeParityTrace } from './grifballPlayerLungeParity';

const noop = () => {};
export const PARITY_TOLERANCES = { position: 1e-6, velocity: 1e-6, health: 1e-9, timer: 1e-6, discrete: 0 };
export const PARITY_GAPS = ['Broader mixed-player revival/maps and shielded/airborne/moving/carrier opposing player/roster flights, autonomous dash/steering decisions and airborne/moving/carrier mixed flight-melee groups; bounded roster flight includes airborne, ballistic and assigned-walking/committed-dashing targets, trades and single-spawn revival',
  'Swept collision between samples, moving-carrier punches and player pitch/crouch/model geometry; grounded roster geometry and authored moving sword/hammer impacts are covered',
  'Full movement/combat/objective execution across all authored maps; roster respawns and mixed objective reset placement are covered, but full-frame combat/objective ordering remains open',
  'Full AI decision-to-action integration and complete mixed player/roster execution; authored movement/attack intents do not certify autonomous choices'];
export interface ParityDifference { tick: number; field: string; live: unknown; headless: unknown; tolerance: number }
export interface ParityTraceOptions {
  combatExecution?: SimCombatExecution;
  settings?: Partial<UniversalSettings>;
  targetPosition?: { x: number; y: number; z: number };
  targetHp?: number;
  aim?: number;
  repeatEvery?: number;
}
export function runExecutionParityTrace(name: string, options: ParityTraceOptions = {}) {
  const sim = createMatch({ seed: 17, combatExecution: options.combatExecution ?? 'live-player-v1', teamSizes: { blue: 1, red: 1 }, settings: options.settings, map: structuredClone(defaultGrifballMap()) });
  const self = sim.combatants[0], rival = sim.combatants[1]; self.id = 'player'; rival.id = 'target';
  self.pos = { x: 0, y: 0, z: 0 }; rival.pos = options.targetPosition ?? { x: 0, y: 0, z: 2 };
  rival.hp = rival.maxHp = options.targetHp ?? rival.hp;
  self.weaponReadyTimer = rival.weaponReadyTimer = self.invulnerabilityTimer = rival.invulnerabilityTimer = 0;
  sim.match.phase = 'playing';
  if (name === 'obstacle-movement') sim.map.objects.push({ type: 'box', position: { x: 0, y: 1, z: 3 }, scale: { x: 4, y: 2, z: 1 }, isCollidable: true } as typeof sim.map.objects[number]);
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...sim.settings }, isMultiplayer: false, multiplayerRole: null });
  live.otherPlayers.clear(); live.localPlayerTeam = self.team; live.arenaRadius = sim.map.arenaRadius;
  live.playerPos.set(0, 0, 0); live.playerVel.set(0, 0, 0); live.playerHP = self.hp; live.playerMaxHP = self.maxHp;
  live.playerRespawnTimer = 0; live.playerInvulnerabilityTimer = 0; live.swapCooldownTimer = live.swapLockoutTimer = 0;
  live.grifball = structuredClone(sim.match); live.pWeaponState = 'ready'; live.pSwordState = 'ready'; live.yaw = Math.PI;
  const target = createOfflineBotCombatant({ id: 'target', playerName: 'Target', team: rival.team, spawnPos: new THREE.Vector3(rival.pos.x, rival.pos.y, rival.pos.z),
    yaw: 0, hue: 0, difficulty: 'normal', settings: live.settings, modelType: 'medium' });
  target.hp = rival.hp; target.maxHp = rival.maxHp; target.invulnerabilityTimer = 0; target.weaponState = 'ready'; live.otherPlayers.set(target.id, target);
  const refs = createInitialGrifballThreeRefs(), sword = new THREE.Group(), hammer = new THREE.Group();
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const { placeCombatantsAtGrifballSpawns } = createArenaOrchestratorCallbacksForState({ getState: () => live, getRefs: () => refs,
    spawnPoints: [], getActiveCustomMap: () => sim.map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => 1,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const carrier = () => {
    sim.match.ball.state = live.grifball.ball.state = 'held'; sim.match.ball.holderId = live.grifball.ball.holderId = 'player';
    setSimCarrier(self, true, sim.settings); setGrifballCarrierForState({ state: live, id: 'player', carrying: true });
  };
  if (name === 'sword-hit-recovery') { self.weapon = 'sword'; live.activeWeapon = 'sword'; }
  if (['punch-hit-recovery', 'charged-pass', 'goal-reset'].includes(name)) carrier();
  if (name === 'goal-reset') {
    const goal = sim.goalPlates.find(p => p.team !== self.team)!;
    self.pos = { ...goal.position }; live.playerPos.copy(new THREE.Vector3(self.pos.x, self.pos.y, self.pos.z));
  }
  if (name === 'respawn') { self.hp = live.playerHP = 0; self.alive = false; self.respawnTimer = live.playerRespawnTimer = .25; }
  if (name === 'countdown') { sim.match.phase = live.grifball.phase = 'countdown'; sim.match.phaseTimer = live.grifball.phaseTimer = .2; }
  if (!name.includes('hit')) { rival.pos.x = target.pos.x = 30; }
  const effects = { state: live, mainAI: undefined, isMultiplayer: false, areCombatantsHostile: () => true,
    sendSync: () => false, playSwing: noop, playDeath: noop, spawnVoxelShockwaveParticles: noop,
    evaluatePlayerKillMedals: () => [], recordBotCalibrationDeath: noop };
  const swordImpact = () => applyPlayerSwordSlashImpactForState({ ...effects, executeTrade: noop, applyOutgoingMultiplayerHitLocally: noop });
  const meleeImpact = () => applyPlayerHammerMeleeImpactForState(effects);
  const strikeImpact = () => applyHammerStrikeImpactForState({ ...effects, isPlayerStriking: true,
    getEnemyAITarget: () => null, applyOutgoingMultiplayerHitLocally: noop, renderHammerSplashVfx: noop,
    recordPlayerDamageTaken: noop, tryRecordCalibrationCounterSuccess: noop, recordBotPsychKill: noop,
    recordBotDamageTag: noop, tryEnterPressureState: () => false, tryStartComboOnHit: noop,
    playExplosion: noop, playJump: noop, pushStatsUpdate: noop });
  const differences: ParityDifference[] = [], frames = []; let differenceCount = 0;
  const compare = (tick: number, field: string, a: unknown, b: unknown, tolerance = 0) => {
    const equal = typeof a === 'number' && typeof b === 'number' ? Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance : a === b;
    if (!equal) { differenceCount++; if (differences.length < 64) differences.push({ tick, field, live: a, headless: b, tolerance }); }
  };
  const random = seededRandom(17);
  const sprint = { current: false }, previousSprint = { current: false };
  for (let tick = 1; tick <= 240; tick++) {
    const action: ActionInput = { ...idleAction(), aim: options.aim ?? 0, pickup: name === 'pickup',
      moveZ: name.includes('movement') && tick <= 120 ? 1 : 0,
      moveX: name === 'movement' && tick > 120 && tick < 160 ? 1 : 0,
      attackPrimary: name.includes('hit') && name !== 'swipe-hit-recovery' && (tick === 1 || !!options.repeatEvery && (tick - 1) % options.repeatEvery === 0),
      attackSecondary: name === 'charged-pass' && tick <= 30 || name === 'swipe-hit-recovery' && tick === 1 };
    withSimulationRandom(random, tick * SIM_DT, () => {
      // Same world-facing input. Live camera yaw is policy yaw + PI; its right axis is reversed.
      live.yaw = action.aim + Math.PI;
      if (!updatePlayerRespawnForState({ state: live, dt: SIM_DT, isMultiplayer: false, getMainAi: () => undefined,
        activeCustomMap: sim.map, spawnPoints: [], playRespawn: noop })) {
        updatePlayerHorizontalMovementForState({ state: live, refs, dt: SIM_DT,
          keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS, actionKeybindings: DEFAULT_KEYBINDINGS,
          gamepad: null, mobileJoystick: { x: -action.moveX, y: action.moveZ }, mobileControlsActive: true,
          sprintToggleActiveRef: sprint, prevSprintInputRef: previousSprint });
        updatePlayerVerticalIntegrationForState({ state: live, dt: SIM_DT, gravityAcceleration: 18,
          constrainCombatantToArena: (pos, vel) => { constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: sim.map, arenaRadius: live.arenaRadius }); } });
      }
      if (action.attackPrimary) {
        if (live.activeWeapon === 'sword' && live.pSwordState === 'ready') triggerPlayerSwordSlashForState({ state: live, playSwing: noop, sendSync: noop });
        else if (live.activeWeapon !== 'sword' && live.pWeaponState === 'ready') triggerPlayerHammerSwingForState({ state: live, recordHammerAttack: noop, playSwing: noop, sendSync: noop });
      }
      if (name === 'swipe-hit-recovery' && action.attackSecondary && live.pWeaponState === 'ready') triggerPlayerHammerMeleeForState({ state: live, playSwing: noop, sendSync: noop });
      const animation = { state: live, dt: SIM_DT, idleXBob: 0, idleYBob: 0, idleZRotBob: 0, playerHammer: hammer };
      updatePlayerSwordAnimationForState({ ...animation, playerSword: sword, applyPlayerSwordSlashImpact: swordImpact });
      updatePlayerHammerAnimationForState({ ...animation, applyHammerStrikeImpact: strikeImpact, applyPlayerHammerMeleeImpact: meleeImpact });
      if (!action.attackSecondary && ballChargingRef.current) throwPlayerGrifballPassForState({ state: live, refs, ballChargingRef, ballChargeTimerRef, playSwing: noop });
      ballChargingRef.current = live.activeWeapon === 'ball' && action.attackSecondary;
      live.playerPickupRequested = action.pickup;
      updateGrifballObjectiveForState({ state: live, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: SIM_DT,
        isMultiplayer: false, activeCustomMap: sim.map, placeCombatantsAtGrifballSpawns, pushStatsUpdate: noop });
    });
    stepSimulation(sim, { player: action }, { settings: sim.settings });
    // Keep both engines running independently; never copy state between ticks.
    for (const axis of ['x', 'y', 'z'] as const) {
      compare(tick, `position.${axis}`, live.playerPos[axis], self.pos[axis], PARITY_TOLERANCES.position);
      compare(tick, `velocity.${axis}`, live.playerVel[axis], self.vel[axis], PARITY_TOLERANCES.velocity);
      compare(tick, `ball.position.${axis}`, live.grifball.ball.pos[axis], sim.match.ball.pos[axis], PARITY_TOLERANCES.position);
      compare(tick, `ball.velocity.${axis}`, live.grifball.ball.vel[axis], sim.match.ball.vel[axis], PARITY_TOLERANCES.velocity);
    }
    compare(tick, 'health', live.playerHP, self.hp, PARITY_TOLERANCES.health);
    // Damage and death are compared before respawn; target respawn is a separate coverage gap.
    if (tick <= 120 || (options.targetHp ?? 1) > 1) compare(tick, 'target.health', target.hp, rival.hp, PARITY_TOLERANCES.health);
    compare(tick, 'alive', live.playerHP > 0, self.alive);
    compare(tick, 'phase', live.grifball.phase, sim.match.phase);
    compare(tick, 'round', live.grifball.roundNumber, sim.match.roundNumber);
    compare(tick, 'respawnTimer', Math.max(0, live.playerRespawnTimer), self.respawnTimer, PARITY_TOLERANCES.timer);
    compare(tick, 'passCharge', Math.min(live.settings.grifballChargeMax ?? 1.2, ballChargeTimerRef.current), self.passChargeTimer, PARITY_TOLERANCES.timer);
    compare(tick, 'ball.state', live.grifball.ball.state, sim.match.ball.state);
    compare(tick, 'ball.holder', live.grifball.ball.holderId, sim.match.ball.holderId);
    for (const team of ['blue', 'red'] as const) compare(tick, `goals.${team}`, live.teamScores[team].goals, sim.scores[team].goals);
    if (name.includes('hit')) {
      const phase = live.activeWeapon === 'sword' ? live.pSwordState : live.pWeaponState;
      const canonical = phase === 'ready' ? 'idle' : ['recovering', 'melee_recover'].includes(phase) ? 'recovering' : 'attack';
      compare(tick, 'weaponPhase', canonical, ['windup', 'active'].includes(self.weaponState) ? 'attack' : self.weaponState);
    }
    frames.push({ tick, input: action, live: { phase: live.grifball.phase, pos: live.playerPos.toArray(), hp: live.playerHP, targetHp: target.hp,
      weapon: live.activeWeapon === 'sword' ? live.pSwordState : live.pWeaponState, ball: structuredClone(live.grifball.ball) },
      headless: { phase: sim.match.phase, pos: { ...self.pos }, hp: self.hp, targetHp: rival.hp, weapon: self.weaponState, ball: structuredClone(sim.match.ball) } });
  }
  return { name, combatExecution: sim.combatExecution, ticks: 240, differenceCount, differences, frames };
}

export const PARITY_TRACE_CASES: { name: string; actionTrace: string; options?: ParityTraceOptions; hits?: number }[] = [
  ...['movement', 'obstacle-movement', 'countdown', 'pickup', 'charged-pass', 'goal-reset', 'respawn',
    'sword-hit-recovery', 'punch-hit-recovery', 'hammer-hit-recovery', 'swipe-hit-recovery'].map(name => ({ name, actionTrace: name })),
  { name: 'sword-short-timing', actionTrace: 'sword-hit-recovery', options: { targetHp: 20, settings: { swordSlashSpeed: .1, swordSlashReload: .2 } }, hits: 1 },
  { name: 'sword-long-timing', actionTrace: 'sword-hit-recovery', options: { targetHp: 20, settings: { swordSlashSpeed: .35, swordSlashReload: .75 } }, hits: 1 },
  { name: 'sword-held-input', actionTrace: 'sword-hit-recovery', options: { targetHp: 20, repeatEvery: 1 }, hits: 5 },
  { name: 'punch-held-input', actionTrace: 'punch-hit-recovery', options: { targetHp: 20, repeatEvery: 1 }, hits: 5 },
  { name: 'punch-short-timing', actionTrace: 'punch-hit-recovery', options: { targetHp: 20, settings: { hammerMeleeSpeed: .04, grifballPunchCooldown: .1 } }, hits: 1 },
  { name: 'punch-tuned-reach', actionTrace: 'punch-hit-recovery', options: { targetHp: 20, targetPosition: { x: 0, y: 0, z: 3.7 }, settings: { hammerMeleeSpeed: .37, grifballPunchCooldown: .75, grifballPunchLungeDistance: 3 } }, hits: 1 },
  { name: 'hammer-short-timing', actionTrace: 'hammer-hit-recovery', options: { targetHp: 20, settings: { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04 } }, hits: 1 },
  { name: 'hammer-held-input', actionTrace: 'hammer-hit-recovery', options: { targetHp: 20, repeatEvery: 1 }, hits: 4 },
  ...[
    { name: 'front', x: 0, z: 2, hits: 1 }, { name: 'behind', x: 0, z: -2, hits: 0 },
    { name: 'oblique-hit', x: 1, z: 1.8, hits: 1 }, { name: 'oblique-miss', x: 2, z: .5, hits: 0 },
    { name: 'reach-hit', x: 0, z: 2.6, hits: 1 }, { name: 'reach-miss', x: 0, z: 3.2, hits: 0 },
  ].flatMap(p => ['sword', 'punch'].map(weapon => ({ name: `${weapon}-${p.name}`, actionTrace: `${weapon}-hit-recovery`,
    options: { targetHp: 20, targetPosition: { x: p.x, y: 0, z: p.z } }, hits: p.hits }))),
  { name: 'sword-rotated-aim', actionTrace: 'sword-hit-recovery', options: { targetHp: 20, aim: Math.PI / 2, targetPosition: { x: 2, y: 0, z: 0 } }, hits: 1 },
  { name: 'punch-rotated-aim', actionTrace: 'punch-hit-recovery', options: { targetHp: 20, aim: Math.PI / 2, targetPosition: { x: 2, y: 0, z: 0 } }, hits: 1 },
];

export function runExecutionParity() {
  const traces = PARITY_TRACE_CASES.map(c => ({ ...runExecutionParityTrace(c.actionTrace, c.options), name: c.name }));
  const botTraces = runBotExecutionParity();
  const lungeTraces = runLungeParity();
  const geometryTraces = runGeometryParity();
  const motionTraces = runMotionParity();
  const movingContactTraces = runMovingContactParity();
  const multiActorTraces = runMultiActorParity();
  const spawnTraces = runSpawnParity();
  const mixedContactTraces = runMixedContactParity();
  const playerLungeTraces = runPlayerLungeParity();
  const mixedLifecycleTraces = runMixedLifecycleParity();
  const opposedFlightTraces = runOpposedFlightParity();
  const objectiveTraces = runObjectiveParity();
  const frameObjectiveTraces = runFrameObjectiveParity();
  const passInputTraces = runPassInputParity();
  const chargeCombatTraces = runChargeCombatParity();
  const carrierCrowdTraces = runCarrierCrowdParity();
  const carrierRecoveryTraces = runCarrierRecoveryParity();
  const runnerCombatTraces = runRunnerCombatParity();
  const roundFrameTraces = runRoundFrameParity();
  const roundCombatTraces = runRoundCombatParity();
  const roundFlightTraces = runRoundFlightParity();
  const roundPlayerFlightTraces = runRoundPlayerFlightParity();
  const failures = [...traces, ...botTraces, ...lungeTraces, ...geometryTraces, ...motionTraces, ...movingContactTraces, ...multiActorTraces, ...spawnTraces, ...mixedContactTraces, ...playerLungeTraces, ...mixedLifecycleTraces, ...opposedFlightTraces, ...objectiveTraces, ...frameObjectiveTraces, ...passInputTraces, ...chargeCombatTraces, ...carrierCrowdTraces, ...carrierRecoveryTraces, ...runnerCombatTraces, ...roundFrameTraces, ...roundCombatTraces, ...roundFlightTraces, ...roundPlayerFlightTraces].filter(t => t.differenceCount);
  const decisionIntegrationTraces = runDecisionIntegration();
  const passDecisionTraces = runPassDecisionIntegration();
  const mobilityDecisionTraces = runMobilityDecisionIntegration();
  const mapMobilityTraces = runMapMobility();
  const mapRoutingTraces = runMapRouting();
  const mapContestTraces = runMapContest();
  const mapMatchTraces = runMapMatch();
  const passContestTraces = runPassContest();
  const passMatchTraces = runPassMatch();
  const mapPassMatchTraces = runMapPassMatch();
  const rosterContestTraces = runRosterContest();
  const tankContestTraces = runTankContest();
  const mapMobilityFailures = mapMobilityTraces.filter(t => t.failureCount);
  const matchDecisionTraces = runMatchDecisionIntegration();
  const roundDecisionTraces = runRoundDecisionIntegration();
  const revivalDecisionTraces = runRevivalDecisionIntegration();
  const opposedDecisionTraces = runOpposedDecisionIntegration();
  const pressureDecisionTraces = runPressureDecisionIntegration();
  const decisionFailures = [...decisionIntegrationTraces, ...passDecisionTraces, ...pressureDecisionTraces, ...opposedDecisionTraces, ...revivalDecisionTraces, ...roundDecisionTraces, ...matchDecisionTraces, ...mobilityDecisionTraces, ...mapRoutingTraces, ...mapContestTraces, ...mapMatchTraces, ...passContestTraces, ...passMatchTraces, ...mapPassMatchTraces, ...rosterContestTraces, ...tankContestTraces].filter(t => t.failureCount);
  const legacyCompatibility = ['sword-hit-recovery', 'punch-hit-recovery'].map(name => runExecutionParityTrace(name, { combatExecution: 'legacy-v1' }));
  const priorRosterCompatibility = runLungeParityTrace(LUNGE_PARITY_CASES[0], 'bot_2', true, 'live-roster-v1');
  const priorPlayerCompatibility = runPlayerLungeParityTrace(PLAYER_LUNGE_PARITY_CASES[0], 'live-player-v1');
  return gate('execution-parity', failures.length || decisionFailures.length || mapMobilityFailures.length ? 'fail' : 'inconclusive',
    `${failures.length}/${traces.length + botTraces.length + lungeTraces.length + geometryTraces.length + motionTraces.length + movingContactTraces.length + multiActorTraces.length + spawnTraces.length + mixedContactTraces.length + playerLungeTraces.length + mixedLifecycleTraces.length + opposedFlightTraces.length + objectiveTraces.length + frameObjectiveTraces.length + passInputTraces.length + chargeCombatTraces.length + carrierCrowdTraces.length + carrierRecoveryTraces.length + runnerCombatTraces.length + roundFrameTraces.length + roundCombatTraces.length + roundFlightTraces.length + roundPlayerFlightTraces.length} action/objective boundary traces differ. ${decisionFailures.length}/${decisionIntegrationTraces.length + passDecisionTraces.length + pressureDecisionTraces.length + opposedDecisionTraces.length + revivalDecisionTraces.length + roundDecisionTraces.length + matchDecisionTraces.length + mobilityDecisionTraces.length + mapRoutingTraces.length + mapContestTraces.length + mapMatchTraces.length + passContestTraces.length + passMatchTraces.length + mapPassMatchTraces.length + rosterContestTraces.length + tankContestTraces.length} live decision integration traces fail. ${mapMobilityFailures.length}/${mapMobilityTraces.length} live map mobility traces fail. ${PARITY_GAPS.length} coverage gaps remain; legacy training dynamics are not certified.`,
    { protocol: 'live-functions-vs-headless-step-v43', combatExecution: ['live-player-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1'], tolerances: PARITY_TOLERANCES,
      neuralIntegration: 'Optional and not promoted: legacy training dynamics remain unchanged; their compatibility traces are diagnostic, not a required neural integration gate.',
      scope: 'Production player functions, stationary roster attacks and committed roster flights through contact, lethal/surviving primary/recent-window trades, paired opposing lunges, main-AI victims and single-authored-spawn revival versus versioned stepSimulation. Grounded geometry covers medium/large targets and standing/crouched actors. Motion traces include the scripted gravity prelude, airborne commitments, ballistic targets, crossing/retreating flights and fall completion in both actor orders. Targets and headings are supplied; AI decisions/pressure/combos, post-flight horizontal steering and presentation effects are suppressed. Remaining gaps are not certified.',
      movingContactScope: 'Production assigned-area walking and committed grounded dash movement with authored intent boundaries; targets enter/leave impact range or change direction, sword/hammer attackers move during windup, and lunges resolve in both actor update orders. Dash initiation decisions, moving-carrier punches and swept collision remain outside this slice.',
      multiActorScope: 'Six-actor authored slash/slam/swipe impacts: splash, focus fire, opposing simultaneous attacks, kill/death credit, friendly/shield/range exclusions, both roster orders, views, teams and main-AI roles. Mixed flight/melee is evaluated separately; autonomous decisions remain outside this slice.',
      spawnScope: 'Production roster respawn callback versus headless tickRespawns before movement: eight supplied maps after normal Grifball conversion, five custom spawn edge cases, team/order variants, simultaneous/staggered deaths and alive/dead/observer player occupancy. This does not certify elevated-spawn landing, initial placement, round resets or entire matches on those maps.',
      mixedContactScope: 'Four grounded actors with committed flights and authored slash/slam/swipe commands: contact before/after/same-frame melee, kill cancellation, surviving trade consumption and two allied flights sharing a target. Both roster orders, main-AI roles and views. Independent damage, credit, contact and finish-tick expectations; no autonomous choices, moving/airborne crowds, carrier or player interactions.',
      playerLungeScope: 'Three grounded actors: committed local player lunges plus roster sword/hammer attacks, hit/miss/shield/team/timeout/boundary cases, lethal/surviving counters, same-frame ordering and lethal/nonlethal mid-flight damage. Both roster orders, mirrored teams and main-AI target roles. Explicit localPlayerId and independent health, finish-frame and kill-credit expectations. Frames stop before revival; objectives, player primary attacks, incoming roster flights, moving/airborne/carrier crowds and autonomous intent selection remain uncertified.',
      mixedLifecycleScope: 'Two grounded actors: incoming main/regular roster lunges against an idle or countering player, lethal/surviving sword/hammer trades and exact/recent/expired/future/zero/disabled history, friendly/dead/shield exclusions and shield expiry. Both team mirrors and actor orders, player/roster revival, greedy occupancy at two shared authored spawns, exact revival ticks and asymmetric shield timing. Does not certify opposing player/roster flights, broader maps, airborne/carrier execution or full objective/decision integration.',
      opposedFlightScope: 'Two grounded opposing player/roster lunges, player-first and roster-first contact, all one/two-HP combinations, trades enabled/disabled, main/regular identities, mirrored teams and both actor orders. Independent health, credit, flight-end and recovery-ready boundaries, tuned reload and snapshot continuation through recovery/revival. Does not certify shielded, airborne, moving-heading or carrier duels, crowd contact, telemetry callbacks or full objective/decision integration.',
      objectiveScope: 'Mixed objective functions compared directly with tickGrifballObjective, not full stepSimulation: pickup order/eligibility/recovery, authored player and roster releases, settled-ball reception and return, carrier loss, healing, goal suppression after death/release, score/winner transitions, and round-reset placement across supplied maps. Independent expected outcomes and snapshot continuations; no movement/combat tick, AI pass selection, charge scheduling, observer-player model or complete frame ordering certification.',
      frameObjectiveScope: 'Actual live frame coordinator with production local movement/respawn/weapon functions, roster respawn and committed lunge or newly requested slash, objective update, skeletal impact and final carrier repair versus stepSimulation. Grounded stationary player/bot runners, lethal/surviving hits on/off enemy plates, mirrored teams and actor order, same/next-frame recovery and snapshot continuation. AI targets/attacks are authored; pass-input ordering, moving carrier crowds, broader map lifecycle, observer state and full autonomous decisions remain open.',
      passInputScope: 'Actual pointer press/release handlers sampled before the live frame, with player movement/weapon animation and objective charging versus mixed stepSimulation. Forward/sideways movement, mirrored facing, changed release aim, two charge maxima, overcharge, throwing disabled/re-enabled, hold through pickup and repress, and goal charge cleanup. Snapshot continuation and input-state hashes. Authored input timing, no remote/input-device, combat-during-charge, autonomous passing or full-match certification.',
      chargeCombatScope: 'Live frame coordinator plus charged-player pointer release, stationary/strafe movement, roster slash/lunge impacts, shield exclusions, objective/charge repair and revival versus mixed stepSimulation. Release before contact, after surviving damage or hold through death; one/two HP, mirrored teams and actor order. Recovery after revival requires a fresh press; snapshots cross death, revival and renewed charge. Targets/attacks are authored; multi-attacker crowds, autonomous passing, device-specific input and full matches remain open.',
      carrierCrowdScope: 'Actual frame coordinator versus mixed stepSimulation for five/six grounded actors: paired slashes, paired committed lunges and mixed flight/slash focus fire on a player or roster runner with one to four HP, shield exclusions, mirrored teams and reversed actor order. Protected opposing collectors verify distance priority and insertion-order ties, same/next-frame pickup and retained possession. Independent health, single kill/death credit, no-goal and collector-health checks plus snapshot continuation. Authored stationary targets and commitments; moving/airborne crowds, unprotected contested recovery combat, carrier counterattacks, autonomous decisions and full matches remain open.',
      carrierRecoveryScope: 'Five/six actors in the actual live frame versus mixed stepSimulation: exposed one/three-HP escorts and opposing pickup candidates, paired slashes or committed lunge/slash against one-to-three-HP stationary player/roster runners or crossing/retreating players. Immediate/delayed attacks, mirrored teams and both actor orders. Independent movement, hit/miss/contact timing, kill attribution, death eligibility, same-frame recovered-carrier death, next-frame pickup and out-of-reach ball checks; 48 snapshots cross commitment/contact/recovery. Authored grounded commands, no moving roster carriers, carrier counterattacks, steering decisions, airborne crowds or complete matches.',
      runnerCombatScope: 'Production ordinary-roster carrier movement and its close-enemy counter branch inside the actual frame versus mixed stepSimulation. Two roster actors plus an idle local player: supplied straight route, empty avoidance list, attack availability at tick four, incoming slash/lunge or no attack, one/two HP on either actor, two runner speeds and punch durations, shields, mirrored teams and both actor orders. Independent movement, damage/contact timing, counter counts, possession and credit expectations; 48 snapshots. Scripted runners hold position and facing through punch windup/strike, then resume routing during recovery. Does not certify route/attack availability decisions, repeated counters, moving crowds, main-AI-specific execution, airborne combat or full matches.',
      roundFrameScope: 'Five supplied rectangular maps with real Grifball goals: authored player/ordinary-roster approach movement, scoring, scored hold, next-round placement/countdown/resumed movement or match end, and an independently scheduled roster revival. Both teams and actor orders; injured actors remain injured, dead actors remain dead through reset, spawn occupancy/heading and revival shield are checked, with 50 snapshots. Mixed spawn headings use simulation aim convention and absent inputs preserve current facing. Three circular maps without goal plates are outside scoring coverage. No autonomous routes/attacks, combat across resets, elevated spawns, observer lifecycle or complete multi-round match certification.',
      roundCombatScope: 'Five goal-capable supplied maps, ordinary-roster scorer and separate stationary melee duel: slash, slam and swipe committed before scoring land during the scored hold, on reset/match-end or the following frame. One/three-HP victims, mirrored teams and actor order. Reset teleports precede late melee while weapon phases/recovery persist; match-end retains positions, so pending attacks can still hit when the frame continues. Independent hit/miss, damage, actor credit, phase/ready ticks, preserved death timers and objective lifecycle checks plus 120 snapshots. Live roster credit is compared to simulation kill events, with objective goals compared separately from legacy team combat tallies. Authored commitments only; flights across reset, local/main-AI attacks, observer lifecycle, autonomous decisions and full matches remain open.',
      roundFlightScope: 'Five goal-capable maps with an ordinary-roster scorer and separate committed grounded lunge duel: contact before scoring, at reset, or after reset; one/three-HP victims, team/order variants and winner/nonwinner outcomes. Both continuous committed-flight execution and explicit ordinary-AI inactive-phase pausing are exercised. Production phase guard and flight/finish functions run in the live frame; mixed simulation persists the per-actor pause setting across 80 snapshots. Independent contact/finish ticks, outcome, health, credit, reload at finish, frozen flight clock/velocity, and preserved origin/direction checks. This validates authored locked-target execution, not neural readiness, target reselection, autonomous decisions, local/main-AI flights, airborne resets, cooldown decision resumption or outer match-end UI teardown.',
      roundPlayerFlightScope: 'Five goal-capable maps: local-player lunge alongside a separate roster scorer, ordinary/main-AI victims with one/three HP, mirrored teams and actor orders. Contact before scoring, at reset or after teleport; continued match-end contact, same-frame roster death timer advancement, hidden sword recovery while reset equips hammer, and authored swap back on tick 45. Independent contact/end count, health/credit, preserved origin/direction and exact recovery-ready ticks; 80 snapshots cross reset and swap. Mixed simulation retains a separate serialized sword-lunge recovery clock and clears it on death/revival or fresh sword attacks. No autonomous target selection, opposing/trading/airborne transition combat, general multi-weapon animation banking, observer lifecycle or outer match-end teardown certification.',
      decisionIntegrationScope: 'Live-only production roster tick, planner, bot updater and objective loop on open, detour and sealed synthetic corridors. Three allied bots, a stationary remote opponent, both teams/orders and main/regular retrievers; passing disabled and combat callbacks fail if reached. Verifies ownership, detached shared snapshots, pickup intent, geometry/speed bounds, retrieval, next-frame runner role and support separation. No authored assignments or movement commands. Not headless decision parity, full active-frame, combat, autonomous passing, respawn, quality or complete-match certification.',
      passDecisionScope: 'Live-only autonomous selection, charge, release-time revalidation, ball settling and receiver pickup through production roster/planner/updater/objective owners. Two allied bots and a stationary remote opponent in an open synthetic corridor, mirrored teams/orders and main/regular carriers. Normal/short charge, passing disabled, module/receiver-ownership revocation on the intended release frame, and reenable with fresh charge. Independent charge timing, release velocity/displacement, loadout/health restoration, settled pickup and next-frame runner-role checks, with deterministic replay. Initial possession and external changes are authored; no assigned pass or movement input. Does not certify combat/pressure decisions, interception, obstacle/respawn cases, the outer active frame, headless decision parity, quality or full matches.',
      pressureDecisionScope: 'Live-only pass safety revalidation after a stationary threat arrives on the intended release frame, followed by production runner counter or receiver tactical target/combat handoff, weapon animation and damage. Stationary AI opponent decisions are suppressed; both teams/orders and main/ordinary defenders cover runner pressure, receiver pressure and withdrawal before impact. Independent response/contact timing, single attack, health/credit, pass cancellation and resumed charging; three deterministic replays. Initial possession and opponent placement/withdrawal are authored. No opposing decision/attack, trades, respawn, full active-frame, headless autonomous decisions or complete-match certification.',
      opposedDecisionScope: 'Live-only production frame coordinator with autonomous roster/planner/bot updates, tactical targeting, normal and evasive hammer-jump commitments, objective, skeletal impacts and late carrier reconciliation. Three short synthetic-corridor cases: punch wins, hammer wins and teammates contest the dropped ball; mirrored teams, actor orders and main/ordinary wounded carriers. Initial possession, health/heal delay and weapon timing are authored; subsequent movement/actions/damage/pickups are not. Checks living-actor update counts, hostile targets/damage, cancelled dead attacks, exact first contact/drop, kill/death/respawn clocks, recovery intent/range/timing, next-frame runner assignment and renewed defense. Six repeatability checks. Passing disabled, hammer-only preference, low movement complexity, neutral personality, no player-model observations or pressure/combo extensions; observer local input/render and roster orchestration callbacks are omitted. Not general trade/dash/jump geometry, respawn/reset, full UI or headless autonomous execution, complete-match or quality certification.',
      revivalDecisionScope: 'Live-only 600-frame continuations of opposing decisions through production team respawn callbacks and renewed tactical play. Three opening contests, mirrored teams/orders and main/ordinary carriers; team spawn points are authored, subsequent deaths/revivals/actions are not. Checks every death delay, team placement, full health, grounded/weapon/jump reset, preserved credit, visible mesh, same-frame assignment/update, full shield countdown and protected damage, movement and renewed attacks in contested/forward hammer cases. Six repeatability checks and direct ordinary/main airborne-reset regressions. Original first-150-frame assertions remain. No full round/goal lifecycle, multiple spawn arbitration, obstacles, headless autonomous parity, general main hammer jumps, complete-match or quality certification; same constrained combat/observer omissions as opposing traces.',
      roundDecisionScope: 'Live-only autonomous uncontested goal/round flow through production frame, planner, bot updater, objective and round placement owners. Two allied bots, physical goal plates and two team spawn points; one-goal win, two-goal reset and zero reset/countdown durations, mirrored teams/orders and main/ordinary opening carriers. Initial possession/settings/positions are authored; movement, goals, reset placement, fresh retrieval and second score are not. Independent phase/contact/pickup timing, scoring eligibility, score/notification counts, cleared carrier loadout, inactive movement/orders, distinct team spawns, new retriever/runner assignment and terminal quiescence, with six deterministic repeats. Passing disabled and no enemies; combat/respawn integration, supplied obstacle maps, full contested matches, UI teardown and headless autonomous parity remain uncertified.',
      matchDecisionScope: 'Live-only bounded complete matches with ordinary and main-AI carriers: three authored opening contests, mirrored teams/orders, 3840 frames for ordinary two-bot contests, 10800 for ordinary four-bot contests and 9000 for main identities. Real opposing decisions, melee, carrier cleanup, team respawns, physical goals, round placement/countdown, fresh contested retrieval and a two-goal win. Preserves opening/revival checks plus score/credit conservation, phase timing, reset preservation, new-round combat/retrieval and terminal stability. Twelve deterministic repeats. Main jump requests use the real weapon gate; rejected requests cannot retain plans. Ten direct regressions prove accepted roster jumps launch once at hammer impact, obey limits/radius, aim downward and cancel safely. Successful autonomous flight is checked separately in the mobility family. One spawn per team, flat corridor, passing disabled, constrained tuning and observer callbacks; broader mobility, maps, headless autonomous parity and quality certification remain open.',
      mobilityDecisionScope: 'Eight live-only autonomous main-AI mobility traces: mirrored teams/orders and seeds 1/5, wounded four-bot opening with authored three-HP respawns, 1800 frames each. Production decisions request hammer jumps after revival; real weapon gates, impacts and movement execute takeoff, ascent, descent, landing and renewed tactical movement or a fresh jump. Independent fixed-step gravity/height oracle checks every airborne update; landing must restore the air-jump budget. Four deterministic repeats and six direct landing/evasion regressions. Shared original opening/respawn/hostility/ownership checks remain. Flat corridor without physical goal plates, passing disabled, low mobility knobs; no broad geometry, headless autonomous flight or quality certification.',
      mapMobilityScope: '92 live-only terrain continuations / 16560 frames on all eight supplied maps after production Grifball conversion: floor and outer boundary on every map, seven explicit box/cylinder platform surfaces, recovery/engagement gravity owners and main/ordinary identities. Authored airborne starting states, independent ballistic/contact oracle, real collision callbacks, stable grounding, jump eligibility and actor-local budget reset. Includes spherical-map outer bounds and rectangular boards; does not certify sphere-platform landing, autonomous jump selection/routing, stepping off platforms, ceiling/runaway recovery or headless terrain parity.',
      mapRoutingScope: '40 live-only autonomous retrieval-to-goal traces / 57600 frames on all five goal-capable supplied maps with untouched geometry and team spawns. Three allies, mirrored teams/orders and main/ordinary designated retrievers; route-aware outer-spawn selection on three obstructed maps. Real planner, roster tick, AI updater, collision callback and objective loop; single retriever, pickup intent/range, next-frame runner, bounded safe movement, independent obstacle/goal footprints, enemy-barrier detour, scoring and stable one-goal terminal state. Three deterministic repeats. Authored roster/start/seed/settings, passing disabled, no opponents, outer frame/presentation/respawn omitted; no contested supplied-map matches or headless decision parity.',
      mapContestScope: '40 live-only opposing decision continuations / 72000 frames on all five goal-capable supplied maps. Four bots, wounded held-ball opening, mirrored teams/orders and main/ordinary initial carriers. Production frame coordinator, tactical decisions, weapon commitments/impacts, late carrier cleanup, objective loop and team respawns with intact map/spawn layouts. Retains opening contest, shield, delay, movement and renewed attack checks; requires carrier loss, another actor recovery, all elapsed revivals and credit conservation. Three deterministic repeats. Bounded 30-second continuations do not require a goal or complete match; passing disabled, constrained combat tuning, observer callbacks and optional pressure/player-model paths omitted. Complete supplied-map matches are checked separately; headless autonomous parity remains open.',
      mapMatchScope: '40 live-only complete opposing matches on five goal-capable supplied maps, both teams/orders and main/ordinary initial carriers. Same wounded opening and constrained tuning as short contests; autonomous combat, carrier recovery, production respawns, physical goals, preserved round resets, fresh contested retrieval and two-goal wins. Thirty-minute cap; three terminal seconds include pending revivals. All frames validated before compact event/final-frame gate retention; individual full traces available from runMapMatchTrace. Independent 3D final body clearance permits platform travel and rounded corner sliding; no swept-collision claim. Three deterministic repeats. Passing, broader tuning, headless autonomous parity, UI teardown and quality remain uncertified.',
      passContestScope: '40 live-only passing contests / 48000 frames, four fully autonomous bots in a flat synthetic corridor. Clear reception, close pressure before charging, pressure arriving during charge, blocked opening lane and a passing-disabled control; mirrored teams/orders and main/ordinary carriers. Shared production frame coordinator, planner, updater, weapon/impact, objective, late carrier cleanup and respawn callbacks. Checks charge ownership/timing/cancellation/display cleanup, ready release, ballistic release speed/displacement, settled pickup, receiver role/flight cleanup, opponent motion/attacks, carrier turnover, shields and credit conservation. Five deterministic repeats. Initial positions, seed and constrained hammer tuning are authored; no subsequent input or placement injection. No observed interception of a released pass, obstacle passing, complete passing-enabled matches, headless autonomous parity or quality certification.',
      passMatchScope: '48 live-only complete passing matches on a flat synthetic court: clear, closing-pressure and disabled openings; seeds 17 and 43, both teams/orders and main/ordinary initial carriers. Four autonomous bots run through physical goals, respawns, round reset/countdown and two-goal termination, followed by 181 terminal updates, within a five-minute cap. Inherits charge/release/reception and complete-match lifecycle checks, checks inactive pass cleanup, and explicitly exercises post-reset passes. Three exact repeats. All frames checked before compact gate retention; individual full traces available from runPassMatchTrace. Authored starting possession/positions and constrained hammer tuning; no supplied-map passing, broader roster/tuning coverage, released-pass interception or headless decision parity certification. Seeds are regression examples, not held-out quality evidence.',
      mapPassMatchScope: '40 live-only complete passing-enabled matches on all five goal-capable supplied maps, mirrored teams/orders and main/ordinary initial carriers. Four autonomous bots, intact map geometry and team spawns, authored clear opening and constrained hammer tuning at seed 17. Checks initial release/reception, sampled predicted and actual flight clearance against independent ground footprints, map body clearance, blocked-space candidate samples with independently confirmed obstacle examples on barrier maps, combat/respawn accounting, physical goals, round reset/countdown and two-goal termination with 181 terminal updates within a thirty-minute cap. Three exact repeats. All frames validated before compact event/final-frame retention; individual full traces from runMapPassMatchTrace. Not swept collision, general aerial throwing, released-pass interception, larger rosters/tuning, headless autonomous parity or held-out quality evidence.',
      rosterContestScope: '64 live-only thirty-second 3v3/4v4 contests / 115200 frames on a synthetic flat court, with balanced, wide defensive, compact attacking and tanking-disabled escort profiles. Mirrored teams/orders and main/ordinary initial carriers; authored starts, seed 17 and constrained hammer combat. Every living bot assigned once, single runner and one retriever per available team, unique support slots, finite destinations, living hostile tank targets/allied partners and recovery references, profile preservation, autonomous motion/combat, pass and carrier lifecycle, elapsed revivals and credit accounting. Planner-refresh role/destination/tanking samples retained. Four exact repeats and an explicit wide-versus-compact destination/movement contrast. Full frames validated before compact retention. Observer fixtures do not certify UI roster lifecycle, larger-roster complete matches/maps, arbitrary combat tuning, double-commit timing, performance, headless autonomous parity or held-out quality.',
      rosterContestTraces,
      tankContestScope: '64 live-only five-second tanking contests / 19200 frames. Authored visible recovery, 3 HP, 1.5 hammer range/radius (4.5 radius shared-blast control), 1.2-second recovery, safety-first and low double threshold on an empty court. Eight openings cover actual paired attacks and intended-victim impacts, ready/short recovery, late coverage, shared blast, high threshold, absent spare and disabled module; mirrored teams/orders and main/ordinary initial carriers. Positive cases independently check physical/planned separation, distinct living nonattacking reserve within coverage time, reciprocal target/partner references, ready attackers, recovery timing and live damage. Every frame validates shared combat/objective/respawn invariants. Three exact repeats. Initial recovery is authored, not earned by a prior live swing; main-AI tank attackers, default tuning, general in-motion formation safety, maps, full matches, headless parity and held-out quality remain outside this slice.',
      tankContestTraces,
      mapPassMatchTraces,
      passMatchTraces,
      passContestTraces,
      mapMatchTraces,
      mapContestTraces,
      mapRoutingTraces,
      mapMobilityTraces,
      mobilityDecisionTraces,
      matchDecisionTraces,
      roundDecisionTraces,
      revivalDecisionTraces,
      opposedDecisionTraces,
      pressureDecisionTraces,
      passDecisionTraces,
      decisionIntegrationTraces,
      gaps: PARITY_GAPS, traces, botTraces, lungeTraces, geometryTraces, motionTraces, movingContactTraces, multiActorTraces, spawnTraces, mixedContactTraces, playerLungeTraces, mixedLifecycleTraces, opposedFlightTraces, objectiveTraces, frameObjectiveTraces, passInputTraces, chargeCombatTraces, carrierCrowdTraces, carrierRecoveryTraces, runnerCombatTraces, roundFrameTraces, roundCombatTraces, roundFlightTraces, roundPlayerFlightTraces, legacyCompatibility, priorRosterCompatibility, priorPlayerCompatibility });
}
