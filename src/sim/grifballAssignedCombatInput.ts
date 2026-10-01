import { type ScriptedDecisionClockPhase } from './scriptedActorDecision';
import { selectGrifballAssignmentThreat, type GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { resolveSimGrifballGroundActor } from './grifballSupportInput';
import { resolveSimGrifballGroundAttackInput } from './grifballGroundAttackInput';
import type { SimState } from './simState';

import { resolveSimGrifballCombatObservation, type AssignedCombatTuning } from './grifballCombatObservation';
export type { AssignedCombatTuning } from './grifballCombatObservation';

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
  const observation = targetId ? resolveSimGrifballCombatObservation(state, botId, targetId, scriptedBots, tuning, dt) : null;
  if (!observation) return null;
  const input = resolveSimGrifballGroundAttackInput(state, botId, scriptedBots,
    { ...memory, enemyInKillRange: observation.range.enemyInKillRange }, dt, clockPhase);
  if (input) input.action.aim = observation.prediction.aim;
  return { targetId: observation.targetId, range: observation.range, input, prediction: observation.prediction };
}
