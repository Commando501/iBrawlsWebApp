import { type ScriptedDecisionClockPhase } from './scriptedActorDecision';
import * as THREE from 'three';
import { resolveAICombatRangeFrame } from '../components/grifball/aiCombatRangeRuntime';
import { resolveAITargetPredictionFrame } from '../components/grifball/aiTargetPredictionRuntime';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { selectGrifballAssignmentThreat, type GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { resolveSimGrifballGroundActor } from './grifballSupportInput';
import { resolveSimGrifballGroundAttackInput } from './grifballGroundAttackInput';
import type { SimState } from './simState';

export interface AssignedCombatTuning {
  /** Resolved by this host's calibration/pressure/personality owner. */
  effectiveReactionLatency: number;
  tunedAnticipationFactor: number;
  movementComplexity: number;
  playstyleFactor: number;
}

/** Assigned, grounded combat observation and stationary attack opportunity.
 * Uses the same threat, prediction and range rules as the live FSM, then reads
 * the selected actor's CURRENT pose/vitals (the team snapshot can be older).
 * The caller must still run earlier FSM priorities before adopting input.
 * A target with input=null still requires combat movement/recovery ownership;
 * null itself means no supported assigned target, never an idle command. */
export function resolveSimGrifballAssignedCombatInput(state: SimState, plan: GrifballTeamPlanState,
  botId: string, scriptedBots: Readonly<Record<string, string>>, tuning: AssignedCombatTuning,
  memory: Omit<Parameters<typeof resolveSimGrifballGroundAttackInput>[3], 'enemyInKillRange'>, dt = 1 / 60, clockPhase: ScriptedDecisionClockPhase = 'before-swap-tick') {
  const actor = resolveSimGrifballGroundActor(state, botId, scriptedBots, dt);
  if (!actor || actor.hasBall || actor.weapon === 'ball' ||
    state.match.ball.state === 'held' && state.match.ball.holderId === botId) return null;
  const assignment = plan.assignments.get(botId);
  if (!assignment) return null;
  const targetId = selectGrifballAssignmentThreat(assignment, actor.pos, plan.snapshot?.players ?? []);
  const targets = state.combatants.filter(c => c.id === targetId);
  const target = targets[0];
  if (targets.length !== 1 || !target.alive || target.hp <= 0 || target.respawnTimer > 0 ||
    target.id === botId || target.team === actor.team) return null;
  const pos = new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z);
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
    activeWeapon: actor.weapon, attackRange: state.settings.attackRange, attackRadius: state.settings.attackRadius,
    resolvedAiReach: (state.settings.attackRange + state.settings.attackRadius * .75) * (.8 + .4 * tuning.playstyleFactor) });
  const input = resolveSimGrifballGroundAttackInput(state, botId, scriptedBots,
    { ...memory, enemyInKillRange: range.enemyInKillRange }, dt, clockPhase);
  if (input) input.action.aim = prediction.yaw - Math.PI;
  const point = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
  return { targetId: target.id, range, input, prediction: {
    predictedTargetPos: point(prediction.predictedTargetPos), movementTargetPos: point(prediction.movementTargetPos),
    toTarget: point(prediction.toTarget), distanceToTarget: prediction.distanceToTarget,
    targetAirborne: prediction.targetAirborne, aim: prediction.yaw - Math.PI,
  } };
}
