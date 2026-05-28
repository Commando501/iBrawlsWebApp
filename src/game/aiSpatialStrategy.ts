import type { PlayerModelSnapshot } from './aiPlayerModel';
import { DEFAULT_REACTION_TIME } from './aiPlayerModel';

/** Base sword-lunge evasion detection radius (meters). */
export const BASE_EVASION_DETECT_RANGE = 15;
/** Distance band for optional bait dodges (meters). */
export const BAIT_DODGE_DISTANCE = 12;
export const BAIT_DODGE_BAND = 1.5;
/** ±20% trigger distance jitter from spatial IQ and sway phase. */
export const EVASION_TRIGGER_JITTER = 0.2;

export interface EvasionRangeInput {
  distanceToTarget: number;
  combatDistanceToTarget: number;
  spatialIQ: number;
  /** Sway phase or other stable oscillator for per-bot jitter. */
  swayPhase?: number;
}

export function getEvasionRangeJitter(swayPhase = 0): number {
  return 1 + Math.sin(swayPhase * 4.1) * EVASION_TRIGGER_JITTER;
}

export function getEvasionDetectRange(input: EvasionRangeInput): number {
  const iqScale = 0.88 + (input.spatialIQ / 100) * 0.24;
  const jitter = getEvasionRangeJitter(input.swayPhase ?? 0);
  return BASE_EVASION_DETECT_RANGE * iqScale * jitter;
}

export function isWithinEvasionRange(input: EvasionRangeInput): boolean {
  const dist = Math.min(input.distanceToTarget, input.combatDistanceToTarget);
  return dist < getEvasionDetectRange(input);
}

export interface TargetLungeDirectionInput {
  targetId: string;
  toTargetX: number;
  toTargetZ: number;
  targetVelX?: number;
  targetVelZ?: number;
  playerIsLunging?: boolean;
  playerLungeDirX?: number;
  playerLungeDirZ?: number;
  mainAiIsLunging?: boolean;
  mainAiLungeDirX?: number;
  mainAiLungeDirZ?: number;
  botIsLunging?: boolean;
  botLungeDirX?: number;
  botLungeDirZ?: number;
}

/** Resolves incoming lunge travel direction; falls back to approach vector or velocity. */
export function resolveTargetLungeDirection(input: TargetLungeDirectionInput): { x: number; z: number } {
  let dirX = 0;
  let dirZ = 0;

  if (input.targetId === 'player' && input.playerIsLunging) {
    dirX = input.playerLungeDirX ?? 0;
    dirZ = input.playerLungeDirZ ?? 0;
  } else if (input.targetId === 'main_ai' && input.mainAiIsLunging) {
    dirX = input.mainAiLungeDirX ?? 0;
    dirZ = input.mainAiLungeDirZ ?? 0;
  } else if (input.botIsLunging) {
    dirX = input.botLungeDirX ?? 0;
    dirZ = input.botLungeDirZ ?? 0;
  }

  if (Math.hypot(dirX, dirZ) <= 0.0001) {
    const velLen = Math.hypot(input.targetVelX ?? 0, input.targetVelZ ?? 0);
    if (velLen > 0.5) {
      dirX = input.targetVelX ?? 0;
      dirZ = input.targetVelZ ?? 0;
    } else {
      dirX = input.toTargetX;
      dirZ = input.toTargetZ;
    }
  }

  const len = Math.hypot(dirX, dirZ);
  if (len <= 0.0001) {
    return { x: 0, z: 1 };
  }
  return { x: dirX / len, z: dirZ / len };
}

export function perpendicularXZ(dirX: number, dirZ: number, side: 1 | -1): { x: number; z: number } {
  return { x: -dirZ * side, z: dirX * side };
}

export interface PickDodgeDirectionInput {
  botPosX: number;
  botPosZ: number;
  lungeDirX: number;
  lungeDirZ: number;
  arenaRadius: number;
  playerModel?: PlayerModelSnapshot | null;
  rng?: number;
}

function centerDistanceAfterStep(
  botX: number,
  botZ: number,
  dirX: number,
  dirZ: number,
  step: number,
): number {
  return Math.hypot(botX + dirX * step, botZ + dirZ * step);
}

/** Picks left/right perpendicular to the lunge vector, biased away from the arena edge. */
export function pickPerpendicularDodgeDirection(input: PickDodgeDirectionInput): { x: number; z: number } {
  const lungeLen = Math.hypot(input.lungeDirX, input.lungeDirZ);
  const lx = lungeLen > 0.0001 ? input.lungeDirX / lungeLen : 0;
  const lz = lungeLen > 0.0001 ? input.lungeDirZ / lungeLen : 1;

  const sideA = perpendicularXZ(lx, lz, 1);
  const sideB = perpendicularXZ(lx, lz, -1);
  const step = 3.2;
  const botCenterDist = Math.hypot(input.botPosX, input.botPosZ);
  const edgePressure = Math.min(1, botCenterDist / Math.max(1, input.arenaRadius - 0.6));

  const distA = centerDistanceAfterStep(input.botPosX, input.botPosZ, sideA.x, sideA.z, step);
  const distB = centerDistanceAfterStep(input.botPosX, input.botPosZ, sideB.x, sideB.z, step);

  let scoreA = distB - distA;
  let scoreB = distA - distB;

  if (edgePressure > 0.55) {
    scoreA += (distB - distA) * (edgePressure * 2.2);
    scoreB += (distA - distB) * (edgePressure * 2.2);
  }

  const pm = input.playerModel;
  if (pm && pm.sampleCount >= 5) {
    const biasLen = Math.hypot(pm.dodgeBiasX, pm.dodgeBiasZ);
    if (biasLen > 0.12) {
      const biasA = pm.dodgeBiasX * sideA.x + pm.dodgeBiasZ * sideA.z;
      const biasB = pm.dodgeBiasX * sideB.x + pm.dodgeBiasZ * sideB.z;
      scoreA += biasA * 1.6;
      scoreB += biasB * 1.6;
    }
  }

  const rng = input.rng ?? Math.random();
  if (Math.abs(scoreA - scoreB) < 0.08) {
    return rng > 0.5 ? sideA : sideB;
  }
  return scoreA >= scoreB ? sideA : sideB;
}

/** Scales evasion trigger distance from learned opponent reaction time. */
export function getEvasionTimingScale(model: PlayerModelSnapshot | null | undefined): number {
  if (!model || model.sampleCount < 5) {
    return 1;
  }
  const ratio = model.reactionTime / DEFAULT_REACTION_TIME;
  return Math.max(0.82, Math.min(1.18, 0.92 + (ratio - 1) * 0.35));
}

export interface EvasionRollInput {
  difficulty: string;
  defensiveEvasionMult: number;
  spatialIQ: number;
  rng?: number;
}

export function getEvasionDashRollChance(input: EvasionRollInput): number {
  if (input.difficulty === 'easy') {
    return 0;
  }
  const base = input.difficulty === 'nightmare' ? 0.95 : input.difficulty === 'hard' ? 0.72 : 0.58;
  const iqBoost = (input.spatialIQ / 100) * 0.12;
  return Math.min(0.98, base * input.defensiveEvasionMult + iqBoost);
}

export function getHammerJumpEvasionChance(input: EvasionRollInput): number {
  if (input.difficulty === 'easy') {
    return 0;
  }
  const base = 0.7 * input.defensiveEvasionMult;
  return Math.min(0.92, base + (input.spatialIQ / 100) * 0.08);
}

export interface BaitDodgeInput {
  distanceToTarget: number;
  combatDistanceToTarget: number;
  spatialIQ: number;
  targetIsLunging: boolean;
  targetActiveWeapon: 'hammer' | 'sword';
  dashCooldownRemaining: number;
  difficulty: string;
  rng?: number;
}

export function shouldAttemptBaitDodge(input: BaitDodgeInput): boolean {
  if (input.difficulty === 'easy' || input.spatialIQ < 45) {
    return false;
  }
  if (input.targetIsLunging || input.dashCooldownRemaining > 0) {
    return false;
  }
  if (input.targetActiveWeapon !== 'sword') {
    return false;
  }
  const dist = Math.min(input.distanceToTarget, input.combatDistanceToTarget);
  const minDist = BAIT_DODGE_DISTANCE - BAIT_DODGE_BAND;
  const maxDist = BAIT_DODGE_DISTANCE + BAIT_DODGE_BAND;
  if (dist < minDist || dist > maxDist) {
    return false;
  }
  const rng = input.rng ?? Math.random();
  const chance = (input.spatialIQ / 100) * 0.14;
  return rng < chance;
}

export interface PostEvasionCommitInput {
  targetWeaponState: string;
  attackDistanceToTarget: number;
  resolvedAiReach: number;
  targetProtected: boolean;
  spatialIQ: number;
  weaponReady: boolean;
}

export function shouldCommitChargeAfterEvasion(input: PostEvasionCommitInput): boolean {
  if (input.targetProtected || !input.weaponReady) {
    return false;
  }
  if (input.targetWeaponState !== 'recovering') {
    return false;
  }
  if (input.attackDistanceToTarget > input.resolvedAiReach + 2.5) {
    return false;
  }
  return input.spatialIQ >= 35;
}

export interface BulltrueTriggerInput {
  distanceToTarget: number;
  lungeSpeed: number;
  hammerWindup?: number;
  attackRadius: number;
  timingScale?: number;
}

export function getBulltrueHammerTriggerBand(input: BulltrueTriggerInput): {
  triggerDist: number;
  minDist: number;
} {
  const windup = input.hammerWindup ?? 0.32;
  const scale = input.timingScale ?? 1;
  const triggerDist = (input.lungeSpeed * windup + input.attackRadius * 0.85) * scale;
  return { triggerDist, minDist: triggerDist - 3.5 };
}

export function isInBulltrueHammerWindow(
  distanceToTarget: number,
  band: { triggerDist: number; minDist: number },
): boolean {
  return distanceToTarget <= band.triggerDist && distanceToTarget >= band.minDist;
}

/** Arena boundary inset used for edge-pressure calculations (meters). */
export const ARENA_EDGE_INSET = 0.6;

export interface ScorePositionInput {
  botX: number;
  botZ: number;
  targetX: number;
  targetZ: number;
  arenaRadius: number;
}

export interface PositionScore {
  /** Net positional advantage for the bot, roughly -1 (bad) to +1 (good). */
  advantage: number;
  /** How pinned the target is against the arena edge, 0–1. */
  targetEdgePressure: number;
  /** How exposed the bot is near the edge, 0–1. */
  botEdgeExposure: number;
  /** How strongly the bot should step toward center before engaging, 0–1. */
  centerRepositionStrength: number;
}

function safeArenaRadius(arenaRadius: number): number {
  return Math.max(1, arenaRadius - ARENA_EDGE_INSET);
}

/** Returns 0 at center, 1 at/near the arena boundary. */
export function getEdgePressure(distFromCenter: number, arenaRadius: number): number {
  const safeRadius = safeArenaRadius(arenaRadius);
  const innerBand = safeRadius * 0.4;
  const outerBand = safeRadius * 0.95;
  if (distFromCenter <= innerBand) {
    return 0;
  }
  return Math.min(1, (distFromCenter - innerBand) / Math.max(0.001, outerBand - innerBand));
}

export function scorePosition(input: ScorePositionInput): PositionScore {
  const botDist = Math.hypot(input.botX, input.botZ);
  const targetDist = Math.hypot(input.targetX, input.targetZ);

  const botEdgeExposure = getEdgePressure(botDist, input.arenaRadius);
  const targetEdgePressure = getEdgePressure(targetDist, input.arenaRadius);

  const rawAdvantage = targetEdgePressure * 0.65 - botEdgeExposure * 0.85;
  const advantage = Math.max(-1, Math.min(1, rawAdvantage));

  const centerRepositionStrength =
    botEdgeExposure > 0.45 ? Math.min(1, (botEdgeExposure - 0.35) * 1.8) : 0;

  return {
    advantage,
    targetEdgePressure,
    botEdgeExposure,
    centerRepositionStrength,
  };
}

export interface CutoffInterceptInput {
  targetX: number;
  targetZ: number;
  targetVelX?: number;
  targetVelZ?: number;
  predictedTargetX?: number;
  predictedTargetZ?: number;
  arenaRadius: number;
  spatialIQ: number;
}

export interface CutoffInterceptResult {
  x: number;
  z: number;
  active: boolean;
}

function clampToArena(x: number, z: number, arenaRadius: number): { x: number; z: number } {
  const safeRadius = safeArenaRadius(arenaRadius);
  const dist = Math.hypot(x, z);
  if (dist <= safeRadius) {
    return { x, z };
  }
  const angle = Math.atan2(z, x);
  return { x: Math.cos(angle) * safeRadius, z: Math.sin(angle) * safeRadius };
}

/** Predicts an intercept point when a target is pinned near the edge and retreating toward center. */
export function getCutoffInterceptPoint(input: CutoffInterceptInput): CutoffInterceptResult {
  const targetDist = Math.hypot(input.targetX, input.targetZ);
  const targetEdgePressure = getEdgePressure(targetDist, input.arenaRadius);

  if (targetEdgePressure < 0.35 || input.spatialIQ < 25) {
    return { x: input.targetX, z: input.targetZ, active: false };
  }

  const toCenterLen = targetDist;
  if (toCenterLen <= 0.001) {
    return { x: input.targetX, z: input.targetZ, active: false };
  }

  const retreatX = -input.targetX / toCenterLen;
  const retreatZ = -input.targetZ / toCenterLen;

  const velX = input.targetVelX ?? 0;
  const velZ = input.targetVelZ ?? 0;
  const velLen = Math.hypot(velX, velZ);
  let retreating = targetEdgePressure >= 0.62;

  if (velLen > 0.8) {
    const retreatDot = (velX / velLen) * retreatX + (velZ / velLen) * retreatZ;
    retreating = retreating || retreatDot > 0.25;
  }

  if (!retreating) {
    return { x: input.targetX, z: input.targetZ, active: false };
  }

  const iqNorm = input.spatialIQ / 100;
  const lead = 0.35 + iqNorm * 0.45;
  let predX = input.predictedTargetX ?? input.targetX;
  let predZ = input.predictedTargetZ ?? input.targetZ;
  if (input.predictedTargetX === undefined && velLen > 0.5) {
    predX = input.targetX + velX * lead;
    predZ = input.targetZ + velZ * lead;
  }

  const flankStrength = iqNorm * targetEdgePressure * 0.55;
  const interceptX = predX + retreatX * flankStrength * 3.2;
  const interceptZ = predZ + retreatZ * flankStrength * 3.2;
  const clamped = clampToArena(interceptX, interceptZ, input.arenaRadius);

  return { ...clamped, active: true };
}

export interface SpatialMovementBiasInput extends ScorePositionInput {
  targetVelX?: number;
  targetVelZ?: number;
  predictedTargetX?: number;
  predictedTargetZ?: number;
  spatialIQ: number;
}

export interface SpatialMovementBias {
  movementDirX: number;
  movementDirZ: number;
  blendWeight: number;
  aggressionMult: number;
  cutoffActive: boolean;
}

export function getSpatialMovementBias(input: SpatialMovementBiasInput): SpatialMovementBias {
  const iqNorm = input.spatialIQ / 100;
  if (iqNorm <= 0) {
    return {
      movementDirX: 0,
      movementDirZ: 0,
      blendWeight: 0,
      aggressionMult: 1,
      cutoffActive: false,
    };
  }

  const posScore = scorePosition(input);
  const cutoff = getCutoffInterceptPoint(input);

  let dirX: number;
  let dirZ: number;

  if (cutoff.active) {
    dirX = cutoff.x - input.botX;
    dirZ = cutoff.z - input.botZ;
  } else if (posScore.centerRepositionStrength > 0.2) {
    dirX = -input.botX;
    dirZ = -input.botZ;
  } else {
    dirX = input.targetX - input.botX;
    dirZ = input.targetZ - input.botZ;
  }

  const len = Math.hypot(dirX, dirZ);
  if (len <= 0.001) {
    return {
      movementDirX: 0,
      movementDirZ: 1,
      blendWeight: 0,
      aggressionMult: 1,
      cutoffActive: cutoff.active,
    };
  }
  dirX /= len;
  dirZ /= len;

  let blendWeight = iqNorm * 0.28;
  if (posScore.centerRepositionStrength > 0.3) {
    blendWeight += posScore.centerRepositionStrength * iqNorm * 0.35;
  }
  if (cutoff.active) {
    blendWeight += iqNorm * 0.22;
  }
  blendWeight = Math.min(0.55, blendWeight);

  const aggressionMult = 1 + posScore.targetEdgePressure * iqNorm * 0.35;

  return {
    movementDirX: dirX,
    movementDirZ: dirZ,
    blendWeight,
    aggressionMult,
    cutoffActive: cutoff.active,
  };
}

export function blendSpatialHeading(
  baseDirX: number,
  baseDirZ: number,
  bias: SpatialMovementBias,
): { x: number; z: number } {
  const baseLen = Math.hypot(baseDirX, baseDirZ);
  if (baseLen <= 0.001 || bias.blendWeight <= 0) {
    const len = baseLen || 1;
    return { x: baseDirX / len, z: baseDirZ / len };
  }

  const nx = baseDirX / baseLen;
  const nz = baseDirZ / baseLen;
  const w = bias.blendWeight;
  const x = nx * (1 - w) + bias.movementDirX * w;
  const z = nz * (1 - w) + bias.movementDirZ * w;
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

export interface SpawnGuardAimInput {
  botX: number;
  botZ: number;
  spawnX: number;
  spawnZ: number;
  spatialIQ: number;
}

/** Aim slightly up the spawn approach corridor (toward center) instead of staring at the spawn point. */
export function getSpawnGuardAimAngle(input: SpawnGuardAimInput): number {
  const toSpawnX = input.spawnX - input.botX;
  const toSpawnZ = input.spawnZ - input.botZ;
  const spawnDist = Math.hypot(toSpawnX, toSpawnZ);

  const centerBearingX = -input.spawnX;
  const centerBearingZ = -input.spawnZ;
  const centerLen = Math.hypot(centerBearingX, centerBearingZ);

  const iqNorm = input.spatialIQ / 100;
  const offsetWeight = 0.15 + iqNorm * 0.25;

  let aimX = toSpawnX;
  let aimZ = toSpawnZ;
  if (centerLen > 0.001 && spawnDist > 0.001) {
    aimX += (centerBearingX / centerLen) * offsetWeight * spawnDist;
    aimZ += (centerBearingZ / centerLen) * offsetWeight * spawnDist;
  }

  return Math.atan2(aimX, aimZ);
}

export interface TargetEdgeSelectionInput extends ScorePositionInput {
  spatialIQ: number;
}

/** Bonus applied in tactical target scoring when an opponent is pinned near the edge. */
export function getTargetEdgeSelectionBonus(input: TargetEdgeSelectionInput): number {
  if (input.spatialIQ < 30) {
    return 0;
  }
  const posScore = scorePosition(input);
  const iqNorm = input.spatialIQ / 100;
  return posScore.targetEdgePressure * iqNorm * 120;
}
