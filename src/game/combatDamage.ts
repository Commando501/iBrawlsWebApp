/** Weapon contact can hurt teammates; an attacker never hits itself. */
export function canCombatantsDamage(attackerId: string, victimId: string): boolean {
  return attackerId !== victimId;
}

/** Sword contact is lethal to the ball carrier, regardless of runner health. */
export function resolveCombatHitDamage(
  weapon: string | undefined,
  isRunner: boolean,
  hp: number,
  damage = 1
): number {
  return weapon === 'sword' && isRunner ? Math.max(hp, damage) : damage;
}
