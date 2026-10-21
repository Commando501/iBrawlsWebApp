import { resolveCombatHitDamage } from '../../game/combatDamage';
import type { GrifballRuntimeState } from './runtimeState';

export function resolveCombatHitDamageForState(
  state: GrifballRuntimeState,
  victimId: string,
  hp: number,
  weapon: string | undefined,
  damage = 1
): number {
  const isRunner = state.settings.gameMode === 'grifball'
    && state.grifball.ball.state === 'held'
    && state.grifball.ball.holderId === victimId;
  return resolveCombatHitDamage(weapon, isRunner, hp, damage);
}
