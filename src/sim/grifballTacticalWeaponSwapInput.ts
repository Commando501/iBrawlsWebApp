import { canApplyAITacticalWeaponSwap, type TacticalWeaponSwapContext } from '../game/aiTacticalWeaponSwap';
import { idleAction } from './actions';
import { resolveSimGrifballGroundActor } from './grifballSupportInput';
import type { SimState } from './simState';

/** Translate an arbitrated tactical choice into the existing swap action. Only
 * ready ground actors are supported: null returns control to the caller's FSM.
 * The caller retains movement/aim and must resolve combo and feint priorities
 * before using this request. Observation never advances the engine's clocks. */
export function resolveSimGrifballTacticalWeaponSwapInput(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, requestedWeapon: 'hammer' | 'sword',
  context: TacticalWeaponSwapContext, dt = 1 / 60) {
  const actor = resolveSimGrifballGroundActor(state, botId, scriptedBots, dt);
  if (!actor || actor.hasBall || actor.weapon === 'ball' || actor.weaponState !== 'idle' ||
    state.match.ball.state === 'held' && state.match.ball.holderId === botId) return null;
  if (!canApplyAITacticalWeaponSwap({ ...context, activeWeapon: actor.weapon, requestedWeapon,
    weaponState: 'ready', swapLockoutTimer: Math.max(0, actor.swapLockoutTimer - dt) })) return null;
  return { ...idleAction(), aim: actor.yaw, crouch: actor.isCrouching, swapWeapon: true };
}
