import type { AIBehaviorState } from '../types';
import { resolveAIGroundAttackCommitment } from '../game/aiGroundAttackCommitment';
import { canStartAIWeaponAction } from '../game/aiWeaponTiming';
import { idleAction } from './actions';
import { resolveSimGrifballGroundActor } from './grifballSupportInput';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, validateScriptedObjectiveInput } from './scriptedObjectiveInput';
import type { SimState } from './simState';

/** Translate a caller-owned tactical opportunity using this engine's current
 * readiness. This is NOT a combat planner: null hands control back to the FSM.
 * On success the caller adopts the returned AI memory and executes the command.
 * No engine, memory or clock is mutated while selecting a command. */
export function resolveSimGrifballGroundAttackInput(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, opportunity: {
    enemyInKillRange: boolean;
    aiState: AIBehaviorState | undefined;
    timer: number | undefined;
    cooldownMultiplier: number;
  }, dt = 1 / 60) {
  const actor = resolveSimGrifballGroundActor(state, botId, scriptedBots, dt);
  if (!actor || actor.hasBall || actor.weapon === 'ball' ||
    state.match.ball.state === 'held' && state.match.ball.holderId === botId) return null;
  const commitment = resolveAIGroundAttackCommitment({
    ...opportunity, selfGrounded: true, slideActive: actor.slideActive,
    weaponReady: actor.weaponState === 'idle', activeWeapon: actor.weapon, settings: state.settings,
    // Live swap readiness ticks before the decision; AI cooldown does not.
    canStartWeaponAction: canStartAIWeaponAction({ ...opportunity,
      swapCooldownTimer: Math.max(0, actor.weaponReadyTimer - dt) }),
  });
  if (!commitment) return null;
  const action = { ...idleAction(), aim: actor.yaw, crouch: actor.isCrouching, attackPrimary: true };
  const scriptedObjective = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots,
    movement: { [botId]: commitment.movement } };
  validateScriptedObjectiveInput(state, scriptedObjective, { [botId]: action });
  return { action, scriptedObjective, aiState: commitment.aiState, timer: commitment.timer };
}
