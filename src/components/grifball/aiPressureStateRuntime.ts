import { resolveAIPressureState } from '../../game/aiPressureState';
import type { GrifballRuntimeState } from './runtimeState';
export { resolveAIPressureLungeChance } from '../../game/aiPressureState';
export type { AIPressureStateFrame, AIPressureStateResult } from '../../game/aiPressureState';

/** Keep runtime ownership at the boundary; policy receives only settings and observations. */
export function resolveAIPressureStateForCombatant({ state, ...input }:
  Omit<Parameters<typeof resolveAIPressureState>[0], 'settings'> & { state: GrifballRuntimeState }) {
  return resolveAIPressureState({ ...input, settings: state.settings });
}
