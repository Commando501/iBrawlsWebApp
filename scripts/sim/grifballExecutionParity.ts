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

const noop = () => {};
export const PARITY_TOLERANCES = { position: 1e-6, velocity: 1e-6, health: 1e-9, timer: 1e-6, discrete: 0 };
export const PARITY_GAPS = ['Paired sword lunge/trade and damaged-target respawn traces (live lifecycle regressions alone do not certify parity)',
  'Moving/swept attacks, attacker pitch/crouch, target crouch and model sizes',
  'All authored maps and multi-slot spawn arbitration',
  'AI decision-to-action integration, moving attacks and mixed player/roster execution; stationary bot attacks alone are covered'];
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
  const failures = [...traces, ...botTraces].filter(t => t.differenceCount);
  const legacyCompatibility = ['sword-hit-recovery', 'punch-hit-recovery'].map(name => runExecutionParityTrace(name, { combatExecution: 'legacy-v1' }));
  return gate('execution-parity', failures.length ? 'fail' : 'inconclusive',
    `${failures.length}/${traces.length + botTraces.length} player/roster action traces differ. ${PARITY_GAPS.length} coverage gaps remain; legacy training dynamics are not certified.`,
    { protocol: 'live-functions-vs-headless-step-v3', combatExecution: ['live-player-v1', 'live-roster-v1'], tolerances: PARITY_TOLERANCES,
      neuralIntegration: 'Optional and not promoted: legacy training dynamics remain unchanged; their compatibility traces are diagnostic, not a required neural integration gate.',
      scope: 'Production player movement, weapon impact/animation, objective and respawn functions plus stationary roster attacks in both viewing modes versus explicitly versioned stepSimulation; presentation effects suppressed. AI decisions, lunges/trades and damaged-target respawns are not certified.',
      gaps: PARITY_GAPS, traces, botTraces, legacyCompatibility });
}
