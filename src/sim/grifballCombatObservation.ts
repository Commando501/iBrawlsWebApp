import * as THREE from 'three';
import { resolveAICombatRangeFrame } from '../components/grifball/aiCombatRangeRuntime';
import { resolveAITargetPredictionFrame } from '../components/grifball/aiTargetPredictionRuntime';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { SimState } from './simState';

export interface AssignedCombatTuning {
  effectiveReactionLatency: number;
  tunedAnticipationFactor: number;
  movementComplexity: number;
  playstyleFactor: number;
}

/** A detached observation sampled once, after engagement gravity and before
 * tactical/combo swaps. Retain it only within this actor's current turn. */
export interface SimGrifballCombatObservation {
  version: 'grifball-combat-observation-v1';
  tick: number;
  actorId: string;
  targetId: string;
  observedWeapon: 'hammer' | 'sword';
  targetProtected: boolean;
  resolvedAiReach: number;
  range: ReturnType<typeof resolveAICombatRangeFrame>;
  prediction: {
    predictedTargetPos: { x: number; y: number; z: number };
    movementTargetPos: { x: number; y: number; z: number };
    toTarget: { x: number; y: number; z: number };
    distanceToTarget: number;
    targetAirborne: boolean;
    aim: number;
  };
}

/** Observation authority is broader than ground movement: active airborne,
 * sliding and dashing AI still observe targets before those movement owners run.
 * Committed flight, carriers, player/RL actors and inactive AI have other owners. */
function actorsForObservation(state: SimState, botId: string, targetId: string,
  scriptedBots: Readonly<Record<string, string>>, dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Combat observation requires a positive finite timestep');
  if (state.mode !== 'grifball' || !['live-roster-v2', 'live-mixed-v1'].includes(state.combatExecution ?? ''))
    throw new Error('Combat observation requires explicit live Grifball execution');
  const actors = state.combatants.filter(c => c.id === botId), actor = actors[0];
  const targets = state.combatants.filter(c => c.id === targetId), target = targets[0];
  if (actors.length !== 1 || actor.controller !== 'ai' || actor.id === state.localPlayerId ||
    !Object.hasOwn(scriptedBots, botId) || typeof scriptedBots[botId] !== 'string' ||
    isNeuralNetDifficulty(scriptedBots[botId]) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    state.match.phase !== 'playing' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 ||
    actor.isLunging || actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === botId ||
    targets.length !== 1 || !target.alive || target.hp <= 0 || target.respawnTimer > 0 ||
    target.id === actor.id || target.team === actor.team) return null;
  return { actor, target };
}

export function resolveSimGrifballCombatObservation(state: SimState, botId: string, targetId: string,
  scriptedBots: Readonly<Record<string, string>>, tuning: AssignedCombatTuning, dt = 1 / 60): SimGrifballCombatObservation | null {
  const actors = actorsForObservation(state, botId, targetId, scriptedBots, dt);
  if (!actors) return null;
  for (const key of ['effectiveReactionLatency', 'tunedAnticipationFactor', 'movementComplexity', 'playstyleFactor'] as const)
    if (!Number.isFinite(tuning[key])) throw new Error(`Invalid combat observation tuning: ${key}`);
  const { actor, target } = actors;
  const pos = new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z);
  const resolvedAiReach = (state.settings.attackRange + state.settings.attackRadius * .75) * (.8 + .4 * tuning.playstyleFactor);
  const behavior = resolveBehaviorTuning(state.settings);
  const prediction = resolveAITargetPredictionFrame({ ...tuning, botPos: pos,
    target: { pos: new THREE.Vector3(target.pos.x, target.pos.y, target.pos.z),
      vel: new THREE.Vector3(target.vel.x, target.vel.y, target.vel.z) },
    predictionAnticipationBonus: behavior.predictionAnticipationBonus,
    predictionLandingWeight: behavior.predictionLandingWeight,
    aimAtCurrentTarget: actor.weaponState === 'windup' || actor.weaponState === 'active',
    activeCustomMap: state.map, arenaRadius: state.map.arenaRadius });
  const range = resolveAICombatRangeFrame({ botPos: pos,
    botVel: new THREE.Vector3(actor.vel.x, actor.vel.y, actor.vel.z),
    botIsCrouching: actor.isCrouching, botIsJumping: actor.isJumping,
    targetIsCrouching: target.isCrouching, targetHp: target.hp,
    targetProtected: target.invulnerabilityTimer > 0,
    predictedTargetPos: prediction.predictedTargetPos, distanceToTarget: prediction.distanceToTarget,
    activeWeapon: actor.weapon as 'hammer' | 'sword', attackRange: state.settings.attackRange, attackRadius: state.settings.attackRadius,
    resolvedAiReach });
  const point = (v: THREE.Vector3) => ({ x: v.x === 0 ? 0 : v.x, y: v.y === 0 ? 0 : v.y, z: v.z === 0 ? 0 : v.z });
  return { version: 'grifball-combat-observation-v1', tick: state.tick, actorId: botId, targetId,
    observedWeapon: actor.weapon as 'hammer' | 'sword', targetProtected: target.invulnerabilityTimer > 0, resolvedAiReach, range,
    prediction: { predictedTargetPos: point(prediction.predictedTargetPos), movementTargetPos: point(prediction.movementTargetPos),
      toTarget: point(prediction.toTarget), distanceToTarget: prediction.distanceToTarget,
      targetAirborne: prediction.targetAirborne, aim: prediction.yaw - Math.PI } };
}

/** Validate provenance/shape and recheck actor/target lifecycle without redoing
 * prediction, target selection or range with a weapon chosen later this turn. */
export function retainSimGrifballCombatObservation(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, observation: SimGrifballCombatObservation, dt = 1 / 60) {
  if (!observation || observation.version !== 'grifball-combat-observation-v1' || observation.tick !== state.tick ||
    observation.actorId !== botId || !['hammer', 'sword'].includes(observation.observedWeapon))
    throw new Error('Retained combat observation must belong to this actor and tick');
  const p = observation.prediction, r = observation.range;
  if (!p || !r || ![observation.resolvedAiReach, p.distanceToTarget, p.aim, r.combatDistanceToTarget,
    r.verticalDeltaToTarget, r.attackDistanceToTarget, r.guaranteedKillRange, r.stationarySwingReach].every(Number.isFinite) ||
    ![observation.targetProtected, p.targetAirborne, r.enemyInKillRange, r.selfGrounded].every(v => typeof v === 'boolean'))
    throw new Error('Invalid retained combat observation');
  for (const v of [p.predictedTargetPos, p.movementTargetPos, p.toTarget])
    if (!v || ![v.x, v.y, v.z].every(Number.isFinite)) throw new Error('Invalid retained combat observation vector');
  return actorsForObservation(state, botId, observation.targetId, scriptedBots, dt) ? observation : null;
}
