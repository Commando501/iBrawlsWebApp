/**
 * The Grifball ball is, mechanically, a melee weapon (Punch). Many subsystems —
 * model rendering, AI targeting, trade resolution, the remote-sync DTO — only
 * understand hammer/sword/pistol. This helper maps `'ball'` to its closest base
 * combat analog (hammer) while passing every other weapon through unchanged, so a
 * ball carrier is treated as a melee fighter by those systems. Ball-specific
 * behavior (Punch lunge, Pass throw) lives in the dedicated action paths.
 */
export function ballAsHammer<T extends string>(weapon: T): Exclude<T, 'ball'> | 'hammer' {
  return (weapon === 'ball' ? 'hammer' : weapon) as Exclude<T, 'ball'> | 'hammer';
}
