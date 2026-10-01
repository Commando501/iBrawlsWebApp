import { resolveGrifballSupportSteering } from '../game/aiGrifballObjectiveSteering';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { idleAction } from './actions';
import type { SimState } from './simState';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, validateScriptedObjectiveInput, type ScriptedObjectiveInput } from './scriptedObjectiveInput';

/** Translate this engine's current assignment into one grounded support command.
 * Refresh the caller-owned plan once per frame using its own tactical snapshot.
 * This neither advances the plan nor integrates physics. Null requires another
 * controller; it must not be interpreted as certified autonomous idle behavior. */
export function resolveSimGrifballSupportInput(state: SimState, plan: GrifballTeamPlanState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, dt = 1 / 60) {
  const scriptedObjective: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots, movement: {} };
  validateScriptedObjectiveInput(state, scriptedObjective, {}, state.settings);
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Support steering requires a positive finite timestep');
  const actors = state.combatants.filter(c => c.id === botId), actor = actors[0];
  if (actors.length !== 1 || actor.controller !== 'ai' || actor.id === state.localPlayerId ||
    !Object.prototype.hasOwnProperty.call(scriptedBots, botId) || isNeuralNetDifficulty(scriptedBots[botId]) ||
    isNeuralNetDifficulty(state.settings.aiDifficulty) || state.match.phase !== 'playing' ||
    !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 || actor.hasBall ||
    state.match.ball.state === 'held' && state.match.ball.holderId === botId ||
    actor.isLunging || actor.isJumping || actor.pos.y > .01 || actor.vel.y !== 0 || actor.dashRemaining > 0 || actor.slideActive) return null;
  const movement = resolveGrifballSupportSteering({ assignment: plan.assignments.get(botId), pos: actor.pos,
    allies: state.combatants.filter(c => c.id !== botId && c.team === actor.team && c.alive && c.hp > 0 && c.respawnTimer <= 0).map(c => c.pos),
    players: plan.snapshot?.players ?? [], ball: state.match.ball.pos,
    heldByAnyone: state.match.ball.state === 'held' && !!state.match.ball.holderId,
    separation: state.settings.grifballEscortSpacing ?? 4, speed: 5.2 * state.settings.speedForward / 100, dt });
  if (!movement) return null;
  const speed = 5.2 * state.settings.speedForward / 100;
  scriptedObjective.movement = { [botId]: speed > 0
    ? { x: movement.velocity.x / speed, z: movement.velocity.z / speed } : { x: 0, z: 0 } };
  const action = { ...idleAction(), pickup: movement.pickupRequested,
    aim: movement.heading && actor.weaponState === 'idle' ? Math.atan2(movement.heading.x, movement.heading.z) : actor.yaw };
  validateScriptedObjectiveInput(state, scriptedObjective, { [botId]: action }, state.settings);
  return { action, scriptedObjective };
}
