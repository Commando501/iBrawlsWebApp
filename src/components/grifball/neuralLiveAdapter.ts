import * as THREE from 'three';
import { type ActionInput, idleAction } from '../../sim/actions';
import { decodeAction } from '../../sim/env/action';
import {
  encodeObservationForVersion,
  obsDimForVersion,
} from '../../sim/env/observation';
import { type SimCombatant, type SimState, type SimWeaponState } from '../../sim/simState';
import { createInitialGrifballMatchState } from '../../game/grifballMatch';
import { createInitialBall } from '../../game/grifballBall';
import { createEmptyTeamScores, type TeamId, type TeamScoresState } from '../../game/teamScoring';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { type CustomMapData, type UniversalSettings, type WeaponState } from '../../types';
import {
  getNeuralAgentRuntime,
  type LoadedNeuralBrain,
} from '../../game/neuralBrainLoader';
import { runGreedyPolicy } from '../../game/neuralPolicy';
import { type GrifballRuntimeState } from './runtimeState';

const BASE_SPEED = 5.8;
const RUNNER_MULT = 1.3;
const CROUCH_SPEED = 2.5;

const FALLBACK_COMBAT_MAP: CustomMapData = {
  id: 'neural-combat-live',
  name: 'Neural Combat Live',
  description: 'Runtime combat observation map.',
  author: 'iBrawls',
  theme: 'hangar',
  arenaRadius: 20,
  spawnPoints: [
    { x: 0, y: 0, z: 12 },
    { x: 0, y: 0, z: -12 },
  ],
  objects: [],
  lighting: {
    ambientColor: '#ffffff',
    ambientIntensity: 0.8,
    directColor: '#ffffff',
    directIntensity: 1,
    directPosition: { x: 10, y: 16, z: 10 },
    pointLights: [],
  },
};

export interface NeuralCombatantDecision {
  action: ActionInput;
  factors: Int32Array;
  logits: Float32Array;
  reused: boolean;
}

export function simYawToLiveYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
}

export function liveYawToSimYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
}

export function buildLiveCombatSimState(
  state: GrifballRuntimeState,
  botId: string,
  activeCustomMap: CustomMapData | null
): SimState | null {
  const self = state.otherPlayers.get(botId);
  if (!self) return null;

  const combatants: SimCombatant[] = [
    livePlayerToSimCombatant(state),
  ];
  let teamIndex = 1;
  for (const combatant of state.otherPlayers.values()) {
    combatants.push(liveAIToSimCombatant(combatant, `t${teamIndex++}` as TeamId));
  }

  const teamIds = combatants.map((c) => c.team);
  const scores = createEmptyTeamScores(teamIds);
  fillLiveCombatScores(scores, state, combatants);

  const settings = state.settings;
  const match = createInitialGrifballMatchState(settings);
  match.phase = 'playing';
  match.goalTarget = settings.iBrawlsKillTarget ?? 25;
  match.ball = createInitialBall({ x: 0, y: 0, z: 0 });

  const map = activeCustomMap ?? FALLBACK_COMBAT_MAP;
  const spawns: Record<TeamId, { x: number; y: number; z: number }[]> = {} as Record<TeamId, { x: number; y: number; z: number }[]>;
  for (const c of combatants) {
    spawns[c.team] = [{ x: c.pos.x, y: 0, z: c.pos.z }];
  }

  return {
    mode: 'combat',
    combatants,
    match,
    scores,
    settings,
    map,
    goalPlates: [],
    spawns,
    tick: Math.max(0, Math.round(state.gameTime * 60)),
    seed: 0,
    rngState: 0,
  };
}

export function nextNeuralCombatantDecision({
  brain,
  state,
  botId,
  activeCustomMap,
}: {
  brain: LoadedNeuralBrain;
  state: GrifballRuntimeState;
  botId: string;
  activeCustomMap: CustomMapData | null;
}): NeuralCombatantDecision | null {
  const sim = buildLiveCombatSimState(state, botId, activeCustomMap);
  if (!sim) return null;
  const agent = getNeuralAgentRuntime(brain, botId);
  if (agent.ticksUntilDecision > 0 && agent.lastFactors) {
    agent.ticksUntilDecision -= 1;
    brain.telemetry.reusedActions += 1;
    return {
      action: decodeAction(agent.lastFactors, sim, botId),
      factors: agent.lastFactors,
      logits: agent.lastActionLogits ?? new Float32Array(0),
      reused: true,
    };
  }

  const obsDim = obsDimForVersion(brain.manifest.observationVersion);
  const observation = new Float32Array(obsDim);
  encodeObservationForVersion(sim, botId, observation, 0, brain.manifest.observationVersion);
  const stacked = agent.frameStack.push(observation);
  const result = runGreedyPolicy(brain.policy, stacked);
  agent.lastFactors = result.factors;
  agent.lastActionLogits = result.logits;
  agent.ticksUntilDecision = Math.max(0, brain.manifest.decisionInterval - 1);
  brain.telemetry.decisions += 1;
  brain.telemetry.lastDecisionAt = performance.now();
  brain.telemetry.lastFactors = Array.from(result.factors);

  return {
    action: decodeAction(result.factors, sim, botId),
    factors: result.factors,
    logits: result.logits,
    reused: false,
  };
}

export function liveWeaponStateToSim(state: WeaponState | 'slashing' | 'recovering' | undefined): SimWeaponState {
  if (!state || state === 'ready') return 'idle';
  if (state === 'swing_up' || state === 'melee_up') return 'windup';
  if (state === 'swing_down' || state === 'melee_down' || state === 'slashing') return 'active';
  if (state === 'recovering' || state === 'melee_recover') return 'recovering';
  return 'idle';
}

export function resolveNeuralPlanarVelocity(
  action: ActionInput,
  policyYaw: number,
  settings: UniversalSettings,
  activeWeapon: 'hammer' | 'sword' | 'ball',
  isCrouching: boolean
): THREE.Vector3 {
  const forward = new THREE.Vector3(Math.sin(policyYaw), 0, Math.cos(policyYaw));
  const right = new THREE.Vector3(Math.cos(policyYaw), 0, -Math.sin(policyYaw));
  const inputLength = Math.hypot(action.moveZ, action.moveX);
  if (inputLength <= 0) return new THREE.Vector3(0, 0, 0);

  let baseSpeed = BASE_SPEED;
  if (activeWeapon === 'ball') baseSpeed *= RUNNER_MULT;
  else if (isCrouching) baseSpeed = CROUCH_SPEED;

  const normForward = action.moveZ / inputLength;
  const normRight = action.moveX / inputLength;
  const fMultiplier =
    normForward > 0
      ? settings.speedForward / 100
      : normForward < 0
        ? settings.speedBackward / 100
        : 1.0;
  const sMultiplier = settings.speedSide / 100;
  const analogScale = Math.min(1, inputLength);

  return new THREE.Vector3()
    .addScaledVector(forward, normForward * fMultiplier * baseSpeed * analogScale)
    .addScaledVector(right, normRight * sMultiplier * baseSpeed * analogScale);
}

function livePlayerToSimCombatant(state: GrifballRuntimeState): SimCombatant {
  const maxHp = state.playerMaxHP || state.settings.maxHP || 1;
  return {
    id: 'player',
    team: 't0',
    controller: 'remote',
    pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
    vel: { x: state.playerVel.x, y: state.playerVel.y, z: state.playerVel.z },
    yaw: liveYawToSimYaw(state.yaw),
    isCrouching: state.isCrouching,
    isJumping: state.isJumping,
    grounded: !state.isJumping && state.playerPos.y <= 0.01,
    hp: state.playerHP,
    maxHp,
    alive: state.playerHP > 0 && state.playerRespawnTimer <= 0,
    respawnTimer: state.playerRespawnTimer,
    invulnerabilityTimer: state.playerInvulnerabilityTimer,
    weapon: state.activeWeapon === 'sword' || state.activeWeapon === 'ball' ? state.activeWeapon : 'hammer',
    weaponState: liveWeaponStateToSim(state.pWeaponState),
    weaponTimer: state.pWeaponTimer,
    swapLockoutTimer: state.swapLockoutTimer,
    attackCooldown: state.pWeaponReady ? 0 : Math.max(0, state.pWeaponCooldown ?? state.pWeaponTimer),
    dashCooldownTimer: state.playerDashCooldownTimer,
    dashRemaining: state.playerDashRemaining,
    dashDir: {
      x: state.playerDashDir.x,
      y: state.playerDashDir.y,
      z: state.playerDashDir.z,
    },
    slideActive: state.playerSlideActive,
    slideCooldownTimer: state.playerSlideCooldownTimer,
    isSprinting: false,
    attackKind: 'none',
    lastAttackTick: 0,
    weaponReadyTimer: state.swapCooldownTimer,
    hammerJumpWindowTimer: state.pHammerJumpWindowTimer,
    hammerJumpsInAir: state.pHammerJumpsInAir,
    passChargeTimer: state.grifballPassCharge,
    isLunging: state.isLunging,
    lungeTimer: state.lungeTimer,
    lungeDir: {
      x: state.lungeTargetDir.x,
      y: state.lungeTargetDir.y,
      z: state.lungeTargetDir.z,
    },
    hasBall: state.activeWeapon === 'ball',
  };
}

function liveAIToSimCombatant(combatant: GrifballRuntimeState['otherPlayers'] extends Map<string, infer C> ? C : never, team: TeamId): SimCombatant {
  const maxHp = combatant.maxHp || 1;
  const lungeTarget = combatant.lungeTargetDir;
  return {
    id: combatant.id,
    team,
    controller: combatant.controller,
    pos: { x: combatant.pos.x, y: combatant.pos.y, z: combatant.pos.z },
    vel: { x: combatant.vel.x, y: combatant.vel.y, z: combatant.vel.z },
    yaw: liveYawToSimYaw(combatant.yaw),
    isCrouching: combatant.isCrouching,
    isJumping: combatant.isJumping ?? false,
    grounded: !(combatant.isJumping ?? false) && combatant.pos.y <= 0.01,
    hp: combatant.hp,
    maxHp,
    alive: combatant.hp > 0 && combatant.respawnTimer <= 0,
    respawnTimer: combatant.respawnTimer,
    invulnerabilityTimer: combatant.invulnerabilityTimer ?? 0,
    weapon: combatant.activeWeapon === 'ball' ? 'ball' : combatant.activeWeapon,
    weaponState: liveWeaponStateToSim(combatant.weaponState),
    weaponTimer: combatant.weaponTimer ?? 0,
    swapLockoutTimer: combatant.swapLockoutTimer ?? 0,
    attackCooldown: combatant.weaponState === 'ready' || !combatant.weaponState ? 0 : combatant.weaponTimer ?? 0,
    dashCooldownTimer: combatant.aiDashCooldownTimer ?? 0,
    dashRemaining: combatant.aiDashRemaining ?? 0,
    dashDir: combatant.aiDashDir ?? { x: 0, y: 0, z: 0 },
    slideActive: combatant.aiSlideActive ?? false,
    slideCooldownTimer: combatant.aiSlideCooldownTimer ?? 0,
    isSprinting: combatant.aiIsSprinting ?? false,
    attackKind: 'none',
    lastAttackTick: 0,
    weaponReadyTimer: combatant.swapCooldownTimer ?? 0,
    hammerJumpWindowTimer: combatant.hammerJumpWindowTimer ?? 0,
    hammerJumpsInAir: combatant.aiHammerJumpsInAir ?? 0,
    passChargeTimer: 0,
    isLunging: combatant.isLunging ?? false,
    lungeTimer: combatant.lungeTimer ?? 0,
    lungeDir: lungeTarget
      ? { x: lungeTarget.x, y: lungeTarget.y, z: lungeTarget.z }
      : { x: 0, y: 0, z: 0 },
    hasBall: combatant.activeWeapon === 'ball',
  };
}

function fillLiveCombatScores(
  scores: TeamScoresState,
  state: GrifballRuntimeState,
  combatants: SimCombatant[]
): void {
  const playerTeam = combatants[0]?.team;
  if (playerTeam) {
    scores[playerTeam].kills = state.playerKills;
    scores[playerTeam].score = state.scorePlayer;
    scores[playerTeam].deaths = state.playerDeaths;
    scores[playerTeam].respawnTimer = state.playerRespawnTimer;
  }
  for (const combatant of combatants.slice(1)) {
    const live = state.otherPlayers.get(combatant.id);
    if (!live) continue;
    scores[combatant.team].kills = live.kills;
    scores[combatant.team].score = live.score;
    scores[combatant.team].deaths = live.deaths;
    scores[combatant.team].respawnTimer = live.respawnTimer;
  }
}

export function safeIdleNeuralAction(): ActionInput {
  return idleAction();
}

export function liveForwardVectorForYaw(yaw: number): THREE.Vector3 {
  const forward = getForwardHeadingForYaw(yaw);
  return new THREE.Vector3(forward.x, 0, forward.z);
}

function normalizeYaw(yaw: number): number {
  let a = yaw % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
