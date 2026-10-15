import { resolveAIGroundMovementPrelude } from '../../game/aiGroundMovementPrelude';
import type { GrifballRuntimeState } from './runtimeState';
import type { GrifballThreeRefs } from './threeRefs';
export type { AIGroundMovementPreludeFrame } from '../../game/aiGroundMovementPrelude';

export function resolveAIGroundMovementPreludeForCombatant({ state, refs, ...input }:
  Omit<Parameters<typeof resolveAIGroundMovementPrelude>[0], 'settings' | 'arenaRadius' | 'navigation'> &
  { state: GrifballRuntimeState; refs: GrifballThreeRefs }) {
  return resolveAIGroundMovementPrelude({ ...input, settings: state.settings, arenaRadius: state.arenaRadius, navigation: refs });
}
