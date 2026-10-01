import { resolveSimGrifballComboInput, type SimWeaponFeintMemory } from './grifballComboInput';
import { resolveSimGrifballTacticalWeaponChoice } from './grifballTacticalWeaponChoice';
import type { SimGrifballCombatObservation } from './grifballCombatObservation';

type ComboArguments = Parameters<typeof resolveSimGrifballComboInput>;
type TacticalContext = Parameters<typeof resolveSimGrifballTacticalWeaponChoice>[6];
type TacticalResult = NonNullable<ReturnType<typeof resolveSimGrifballTacticalWeaponChoice>>;

/** One ordered policy boundary: tick/revert the feint, choose using the resulting
 * weapon locals, then arbitrate the combo. Range remains the pre-swap observation.
 * Adopt the returned combo/feint/AI memory and execute its commands in order.
 * The simulation is not mutated and all policy draws use the supplied stream. */
export function resolveSimGrifballTacticalComboInput(state: ComboArguments[0], plan: ComboArguments[1],
  botId: string, scriptedBots: ComboArguments[3], tuning: ComboArguments[4] & { pressureAggression: number },
  memories: ComboArguments[5], context: Omit<ComboArguments[6], 'tacticalWeapon' | 'swapFeintActive' | 'weaponFeintMemory'> &
    Pick<TacticalContext, 'scoreContext' | 'recentLungeMemory'> & {
      observation: SimGrifballCombatObservation; weaponFeintMemory: SimWeaponFeintMemory;
    }, dt = 1 / 60, clockPhase: ComboArguments[8] = 'after-swap-tick') {
  let tactical: TacticalResult | undefined;
  const combo = resolveSimGrifballComboInput(state, plan, botId, scriptedBots, tuning, memories, {
    ...context, swapFeintActive: (context.weaponFeintMemory.swapRemaining ?? 0) > 0,
    tacticalWeapon: weaponFrame => {
      tactical = resolveSimGrifballTacticalWeaponChoice(state, plan, botId, scriptedBots, tuning, memories,
        { ...context, weaponFrame }, dt, clockPhase) ?? undefined;
      if (!tactical) throw new Error('Tactical ownership changed within the combo decision');
      return tactical.decision.weapon;
    },
  }, dt, clockPhase);
  return combo ? { ...combo, tactical: tactical! } : null;
}
