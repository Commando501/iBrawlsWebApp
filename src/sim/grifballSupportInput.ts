import { resolveGrifballSupportSteering } from '../game/aiGrifballObjectiveSteering';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { resolveDirectionalSpeedMultiplier } from '../game/runnerBallSettings';
import { getYawForHeading } from '../game/yaw';
import { idleAction } from './actions';
import type { SimState } from './simState';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, validateScriptedObjectiveInput, type ScriptedObjectiveInput } from './scriptedObjectiveInput';

/** Shared eligibility for opt-in ground controllers; not control authorization
 * for remote, neural, airborne or inactive participants. */
export function resolveSimGrifballGroundActor(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, dt = 1 / 60) {
  validateScriptedObjectiveInput(state, { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots, movement: {} }, {}, state.settings);
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Objective steering requires a positive finite timestep');
  const actors = state.combatants.filter(c => c.id === botId), actor = actors[0];
  if (actors.length !== 1 || actor.controller !== 'ai' || actor.id === state.localPlayerId ||
    !Object.prototype.hasOwnProperty.call(scriptedBots, botId) || isNeuralNetDifficulty(scriptedBots[botId]) ||
    isNeuralNetDifficulty(state.settings.aiDifficulty) || state.match.phase !== 'playing' ||
    !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 ||
    actor.isLunging || actor.isJumping || actor.pos.y > .01 || actor.vel.y !== 0 || actor.dashRemaining > 0 || actor.slideActive) return null;
  return actor;
}

/** Translate this engine's assignment without advancing planning or physics.
 * Refresh the caller-owned plan once per frame from its own tactical snapshot.
 * Null requires another controller, not an autonomous idle command. */
export function resolveSimGrifballSupportInput(state: SimState, plan: GrifballTeamPlanState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, dt = 1 / 60) {
  const actor = resolveSimGrifballGroundActor(state, botId, scriptedBots, dt);
  if (!actor || actor.hasBall || state.match.ball.state === 'held' && state.match.ball.holderId === botId) return null;
  const scriptedObjective: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots, movement: {} };
  const movement = resolveGrifballSupportSteering({ assignment: plan.assignments.get(botId), pos: actor.pos,
    allies: state.combatants.filter(c => c.id !== botId && c.team === actor.team && c.alive && c.hp > 0 && c.respawnTimer <= 0).map(c => c.pos),
    players: plan.snapshot?.players ?? [], ball: state.match.ball.pos,
    heldByAnyone: state.match.ball.state === 'held' && !!state.match.ball.holderId,
    separation: state.settings.grifballEscortSpacing ?? 4, speed: 5.2 * state.settings.speedForward / 100,
    retrySpeed: 5.2 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', false), dt });
  if (!movement) return null;
  const speed = 5.2 * state.settings.speedForward / 100;
  scriptedObjective.movement = { [botId]: speed > 0
    ? { x: movement.velocity.x / speed, z: movement.velocity.z / speed } : { x: 0, z: 0 } };
  const action = { ...idleAction(), crouch: actor.isCrouching, pickup: movement.pickupRequested,
    aim: movement.heading && actor.weaponState === 'idle' ? getYawForHeading(movement.heading.x, movement.heading.z) - Math.PI : actor.yaw };
  validateScriptedObjectiveInput(state, scriptedObjective, { [botId]: action }, state.settings);
  return { action, scriptedObjective };
}
