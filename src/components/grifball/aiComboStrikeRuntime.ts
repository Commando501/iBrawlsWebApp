import { simulationRandom } from '../../game/simulationRandom';
import { type Combatant, type WeaponState } from '../../types';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTimingRuntime';
import { MELEE_HAMMER_SWIPE_REACH } from './combatGeometry';
import { type CombatantWeapon } from './combatantActions';
import { adjustRangeForTargetModel } from './modelHitbox';
import { type GrifballRuntimeState } from './runtimeState';

export interface AIComboMeleeStrikeResult {
  timer: number;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export function resolveAIComboMeleeStrikeForCombatant<TSelf>({
  state,
  self,
  activeWeapon,
  attackDistanceToTarget,
  targetModelType,
  cooldownMultiplier,
  triggerCombatantAttack,
  random = simulationRandom,
}: {
  state: Pick<GrifballRuntimeState, 'settings'>;
  self: TSelf;
  activeWeapon: CombatantWeapon;
  attackDistanceToTarget: number;
  targetModelType?: Combatant['modelType'];
  cooldownMultiplier: number;
  triggerCombatantAttack: (self: TSelf, weapon: CombatantWeapon, melee?: boolean) => void;
  random?: () => number;
}): AIComboMeleeStrikeResult {
  // Player-parity hammer side-swipe only applies inside the melee swipe band.
  const isHammerMelee =
    activeWeapon === 'hammer' &&
    attackDistanceToTarget <= adjustRangeForTargetModel(MELEE_HAMMER_SWIPE_REACH, targetModelType) &&
    random() < 0.4;

  const timer = resolveScaledAIWeaponReloadTime(
    state.settings,
    activeWeapon,
    cooldownMultiplier,
    isHammerMelee
  );

  triggerCombatantAttack(self, activeWeapon, isHammerMelee);

  return {
    timer,
    weaponState: isHammerMelee ? 'melee_up' : 'swing_up',
  };
}
