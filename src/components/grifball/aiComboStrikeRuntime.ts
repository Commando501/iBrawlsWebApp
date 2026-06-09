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

export function resolveAIComboMeleeStrikeForCombatant({
  state,
  self,
  activeWeapon,
  attackDistanceToTarget,
  targetModelType,
  cooldownMultiplier,
  triggerCombatantAttack,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  activeWeapon: CombatantWeapon;
  attackDistanceToTarget: number;
  targetModelType?: Combatant['modelType'];
  cooldownMultiplier: number;
  triggerCombatantAttack: (self: Combatant, weapon: CombatantWeapon, melee?: boolean) => void;
}): AIComboMeleeStrikeResult {
  // Player-parity hammer side-swipe only applies inside the melee swipe band.
  const isHammerMelee =
    activeWeapon === 'hammer' &&
    attackDistanceToTarget <= adjustRangeForTargetModel(MELEE_HAMMER_SWIPE_REACH, targetModelType) &&
    Math.random() < 0.4;

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
