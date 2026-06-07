import type { AIMatchContext } from './aiMatchContext';
import type { AICombatDecision, AICombatDecisionInput } from './aiCombatDecision';
import { getRectHalfExtents, type ArenaHalfExtents } from './arenaDimensions';

export const PLAYER_MODEL_EMA_ALPHA = 0.08;
export const LOCAL_PLAYER_ID = 'player';
export const DEFAULT_LUNGE_DISTANCE = 8.0;
export const DEFAULT_REACTION_TIME = 0.35;

export interface PlayerModel {
  avgLungeDistance: number;
  lungeFrequency: number;
  dodgeBiasX: number;
  dodgeBiasZ: number;
  counterRate: number;
  approachSpeed: number;
  edgeProximity: number;
  reactionTime: number;
  sampleCount: number;
  lungeAttempts: number;
  lungeHits: number;
  countersAttempted: number;
  countersLanded: number;
  // Raw per-match action volumes (reset each match with the model). These complement
  // the EMA "rate" features above — rates describe HOW a player fights, volumes
  // describe HOW MUCH. Accumulated for every combatant, so per-combatant telemetry
  // gets them for free. Excluded from PlayerModelSnapshot / persistent memory (per-match only).
  hammerAttacks: number;
  weaponSwaps: number;
  dashes: number;
  damageDealtCount: number;
  damageReceivedCount: number;
  lastPositionSampleTime: number;
  /** EMA smoothing factor (learning rate) for this model. */
  emaAlpha: number;
}

/** Raw per-match action volumes for a combatant (telemetry / analysis). */
export interface MatchBehaviorStats {
  lungeAttempts: number;
  lungeHits: number;
  hammerAttacks: number;
  weaponSwaps: number;
  dashes: number;
  countersAttempted: number;
  countersLanded: number;
  damageDealtCount: number;
  damageReceivedCount: number;
}

export interface PlayerModelSnapshot {
  avgLungeDistance: number;
  lungeFrequency: number;
  dodgeBiasX: number;
  dodgeBiasZ: number;
  counterRate: number;
  approachSpeed: number;
  edgeProximity: number;
  reactionTime: number;
  sampleCount: number;
}

export interface PlayerModelDefaults {
  emaAlpha?: number;
  defaultLungeDistance?: number;
  defaultReactionTime?: number;
}

export function createPlayerModel(defaults?: PlayerModelDefaults): PlayerModel {
  return {
    avgLungeDistance: defaults?.defaultLungeDistance ?? DEFAULT_LUNGE_DISTANCE,
    lungeFrequency: 0.35,
    dodgeBiasX: 0,
    dodgeBiasZ: 0,
    counterRate: 0.2,
    approachSpeed: 0.5,
    edgeProximity: 0.35,
    reactionTime: defaults?.defaultReactionTime ?? DEFAULT_REACTION_TIME,
    sampleCount: 0,
    lungeAttempts: 0,
    lungeHits: 0,
    countersAttempted: 0,
    countersLanded: 0,
    hammerAttacks: 0,
    weaponSwaps: 0,
    dashes: 0,
    damageDealtCount: 0,
    damageReceivedCount: 0,
    lastPositionSampleTime: 0,
    emaAlpha: defaults?.emaAlpha ?? PLAYER_MODEL_EMA_ALPHA,
  };
}

export function toMatchBehaviorStats(model: PlayerModel): MatchBehaviorStats {
  return {
    lungeAttempts: model.lungeAttempts,
    lungeHits: model.lungeHits,
    hammerAttacks: model.hammerAttacks,
    weaponSwaps: model.weaponSwaps,
    dashes: model.dashes,
    countersAttempted: model.countersAttempted,
    countersLanded: model.countersLanded,
    damageDealtCount: model.damageDealtCount,
    damageReceivedCount: model.damageReceivedCount,
  };
}

/** Raw action volumes for a combatant, or null if the model doesn't exist. */
export function getMatchBehaviorStats(
  context: AIMatchContext,
  playerId: string,
): MatchBehaviorStats | null {
  const model = context.playerModels.get(playerId) as PlayerModel | undefined;
  return model ? toMatchBehaviorStats(model) : null;
}

export function toPlayerModelSnapshot(model: PlayerModel): PlayerModelSnapshot {
  return {
    avgLungeDistance: model.avgLungeDistance,
    lungeFrequency: model.lungeFrequency,
    dodgeBiasX: model.dodgeBiasX,
    dodgeBiasZ: model.dodgeBiasZ,
    counterRate: model.counterRate,
    approachSpeed: model.approachSpeed,
    edgeProximity: model.edgeProximity,
    reactionTime: model.reactionTime,
    sampleCount: model.sampleCount,
  };
}

function ema(model: PlayerModel, current: number, sample: number): number {
  return current + model.emaAlpha * (sample - current);
}

export function getOrCreatePlayerModel(
  context: AIMatchContext,
  playerId: string,
  defaults?: PlayerModelDefaults,
): PlayerModel {
  const existing = context.playerModels.get(playerId);
  if (existing) {
    return existing as PlayerModel;
  }
  const model = createPlayerModel(defaults);
  context.playerModels.set(playerId, model);
  return model;
}

export function getPlayerModelSnapshot(
  context: AIMatchContext,
  playerId: string,
  minSamples = 3,
): PlayerModelSnapshot | null {
  const model = context.playerModels.get(playerId) as PlayerModel | undefined;
  if (!model || model.sampleCount < minSamples) {
    return null;
  }
  return toPlayerModelSnapshot(model);
}

/**
 * Seeds an existing model from a persisted snapshot as cross-match memory.
 * Feature values and sample confidence carry forward, while raw per-match
 * action volumes remain clean because they are not part of the snapshot.
 */
export function hydratePlayerModel(
  model: PlayerModel,
  snapshot: PlayerModelSnapshot,
  maxSampleCount = Number.MAX_SAFE_INTEGER,
): void {
  model.avgLungeDistance = snapshot.avgLungeDistance;
  model.lungeFrequency = snapshot.lungeFrequency;
  model.dodgeBiasX = snapshot.dodgeBiasX;
  model.dodgeBiasZ = snapshot.dodgeBiasZ;
  model.counterRate = snapshot.counterRate;
  model.approachSpeed = snapshot.approachSpeed;
  model.edgeProximity = snapshot.edgeProximity;
  model.reactionTime = snapshot.reactionTime;
  model.sampleCount = Math.max(0, Math.min(snapshot.sampleCount, maxSampleCount));
}

export function observePlayerLungeStart(model: PlayerModel, distance: number): void {
  model.lungeAttempts += 1;
  model.avgLungeDistance = ema(model, model.avgLungeDistance, distance);
  model.lungeFrequency = ema(model, model.lungeFrequency, 1);
  model.sampleCount += 1;
}

export function observePlayerHammerAttack(model: PlayerModel): void {
  model.lungeFrequency = ema(model, model.lungeFrequency, 0);
  model.hammerAttacks += 1;
  model.sampleCount += 1;
}

export function observePlayerLungeEnd(model: PlayerModel, distanceTraveled: number, hit: boolean): void {
  model.avgLungeDistance = ema(model, model.avgLungeDistance, distanceTraveled);
  if (hit) {
    model.lungeHits += 1;
  }
  model.sampleCount += 1;
}

export function observePlayerDash(model: PlayerModel, dirX: number, dirZ: number): void {
  const length = Math.hypot(dirX, dirZ);
  if (length > 0.0001) {
    model.dodgeBiasX = ema(model, model.dodgeBiasX, dirX / length);
    model.dodgeBiasZ = ema(model, model.dodgeBiasZ, dirZ / length);
  }
  model.dashes += 1;
  model.sampleCount += 1;
}

export function observePlayerWeaponSwap(model: PlayerModel, weapon: 'hammer' | 'sword'): void {
  if (weapon === 'sword') {
    model.lungeFrequency = ema(model, model.lungeFrequency, 0.65);
  } else {
    model.lungeFrequency = ema(model, model.lungeFrequency, 0.15);
  }
  model.weaponSwaps += 1;
  model.sampleCount += 1;
}

export function observePlayerCounter(model: PlayerModel, success: boolean): void {
  model.countersAttempted += 1;
  if (success) {
    model.countersLanded += 1;
  }
  const rate = model.countersLanded / Math.max(1, model.countersAttempted);
  model.counterRate = ema(model, model.counterRate, rate);
  model.sampleCount += 1;
}

export function observePlayerDamageDealt(model: PlayerModel): void {
  model.damageDealtCount += 1;
  model.sampleCount += 1;
}

export function observePlayerDamageReceived(model: PlayerModel): void {
  model.damageReceivedCount += 1;
  model.sampleCount += 1;
}

export function observePlayerPosition(
  model: PlayerModel,
  posX: number,
  posZ: number,
  arenaRadius: number,
  nowSeconds: number,
  mapShape?: string,
  rectHalf?: ArenaHalfExtents,
): void {
  if (nowSeconds - model.lastPositionSampleTime < 0.25) {
    return;
  }
  model.lastPositionSampleTime = nowSeconds;
  let proximity = 0;
  if (mapShape === 'rectangular') {
    const half = getRectHalfExtents(arenaRadius, rectHalf);
    const boundX = half.x - 0.6;
    const boundZ = half.z - 0.6;
    const normX = Math.abs(posX) / Math.max(1, boundX);
    const normZ = Math.abs(posZ) / Math.max(1, boundZ);
    proximity = Math.min(1, Math.max(normX, normZ));
  } else {
    const distFromCenter = Math.hypot(posX, posZ);
    proximity = Math.min(1, distFromCenter / Math.max(1, arenaRadius - 0.6));
  }
  model.edgeProximity = ema(model, model.edgeProximity, proximity);
  model.sampleCount += 1;
}

export function observePlayerApproachSpeed(model: PlayerModel, speed: number, maxSpeed: number): void {
  const normalized = Math.min(1, speed / Math.max(1, maxSpeed));
  model.approachSpeed = ema(model, model.approachSpeed, normalized);
  model.sampleCount += 1;
}

export function observePlayerReaction(model: PlayerModel, reactionSeconds: number): void {
  model.reactionTime = ema(model, model.reactionTime, Math.max(0, reactionSeconds));
  model.sampleCount += 1;
}

/** Reduces feint pressure when the player reliably counters (used by PR-F). */
export function getFeintPressureMultiplier(model: PlayerModelSnapshot | null | undefined): number {
  if (!model || model.sampleCount < 5) {
    return 1;
  }
  return 1 - Math.min(0.5, model.counterRate * 0.6);
}

/** Perpendicular meters to offset approach heading based on learned dodge bias. */
export function getApproachLateralOffset(model: PlayerModelSnapshot | null | undefined): number {
  if (!model || model.sampleCount < 5) {
    return 0;
  }
  const bias = Math.hypot(model.dodgeBiasX, model.dodgeBiasZ);
  if (bias < 0.12) {
    return 0;
  }
  return Math.max(-1.2, Math.min(1.2, model.dodgeBiasX * 1.8));
}

export function applyLungeAimBias(
  dirX: number,
  dirZ: number,
  model: PlayerModelSnapshot | null | undefined,
): { x: number; z: number } {
  if (!model || model.sampleCount < 5) {
    return { x: dirX, z: dirZ };
  }
  const length = Math.hypot(dirX, dirZ);
  if (length <= 0.0001) {
    return { x: dirX, z: dirZ };
  }
  const nx = dirX / length;
  const nz = dirZ / length;
  const perpX = -nz;
  const perpZ = nx;
  const bias = model.dodgeBiasX * perpX + model.dodgeBiasZ * perpZ;
  const bx = nx + perpX * bias * 0.35;
  const bz = nz + perpZ * bias * 0.35;
  const bl = Math.hypot(bx, bz) || 1;
  return { x: bx / bl, z: bz / bl };
}

export function applyPlayerModelCombatAdjustments(
  decision: AICombatDecision,
  input: AICombatDecisionInput,
  mechanicAware: boolean,
  minDistance: number,
  minLunge: number,
  maxLunge: number,
  pSword: number,
  hammerForbidden: boolean,
  swordForbidden: boolean,
): AICombatDecision {
  const pm = input.playerModel;
  if (!pm || pm.sampleCount < 3 || !mechanicAware || decision.weapon) {
    return decision;
  }

  const nearLearnedLunge = Math.abs(minDistance - pm.avgLungeDistance) <= 1.5;
  const inLungeBand = minDistance >= minLunge && minDistance <= maxLunge;

  if (pm.counterRate > 0.45 && inLungeBand && !hammerForbidden) {
    return { ...decision, weapon: 'hammer' };
  }

  if (
    pm.counterRate <= 0.35 &&
    nearLearnedLunge &&
    pm.lungeFrequency > 0.35 &&
    inLungeBand &&
    !swordForbidden
  ) {
    return { ...decision, weapon: 'sword' };
  }

  if (
    pm.lungeFrequency > 0.55 &&
    nearLearnedLunge &&
    inLungeBand &&
    minDistance >= pm.avgLungeDistance - 1.0 &&
    minDistance <= pm.avgLungeDistance + 0.5 &&
    !hammerForbidden
  ) {
    return { ...decision, weapon: 'hammer' };
  }

  if (
    inLungeBand &&
    nearLearnedLunge &&
    pm.approachSpeed > 0.65 &&
    !swordForbidden &&
    pSword >= 0.35
  ) {
    return { ...decision, weapon: 'sword' };
  }

  return decision;
}
