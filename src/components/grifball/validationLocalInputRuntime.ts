import { DEFAULT_KEYBINDINGS } from '../../types';
import type { ValidationLocalInput } from '../../game/grifballValidation/localPlayerInput';
import { requestPlayerPickupForState, triggerPointerPrimaryPlayerActionForState } from './playerInputRuntime';
import type { GrifballRuntimeState } from './runtimeState';

/** Feed the local player's input owners; never apply movement, hits, possession or scores here. */
export function applyValidationLocalInput(state: GrifballRuntimeState, keys: Record<string, boolean>, input: ValidationLocalInput,
  callbacks: Parameters<typeof triggerPointerPrimaryPlayerActionForState>[0]['callbacks']): void {
  if (state.isObserverMode || state.playerHP <= 0 || state.playerRespawnTimer > 0 || state.grifball.phase !== 'playing') return;
  keys[DEFAULT_KEYBINDINGS.moveForward] = input.forward;
  if (input.forward || input.attack) { state.yaw = input.yaw; state.pitch = 0; }
  if (input.pickup) requestPlayerPickupForState(state, false, true);
  if (input.attack) triggerPointerPrimaryPlayerActionForState({ state, callbacks });
}
