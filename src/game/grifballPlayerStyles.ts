/** Grifball preferences are independent of combat archetypes and difficulty. */
export const GRIFBALL_PLAYER_STYLES = {
  balanced: { label: 'Balanced', description: 'Balances useful pressure with recovery coverage.', protection: 0, opening: 0, trade: 0, coverage: 0, threshold: 1 },
  enforcer: { label: 'Enforcer', description: 'Prefers opening lanes and engaging a second defender.', protection: 0.5, opening: 1, trade: 0, coverage: -0.2, threshold: 0.25 },
  opportunist: { label: 'Opportunist', description: 'Leaves coverage for a punishable recovery window.', protection: 0, opening: 0.25, trade: 1.5, coverage: 0.25, threshold: 0.5 },
  guardian: { label: 'Guardian', description: 'Prioritizes threats to the runner and preserves coverage.', protection: 1.5, opening: -0.25, trade: 0, coverage: 0.75, threshold: 1.5 },
} as const;
export type GrifballPlayerStyle = keyof typeof GRIFBALL_PLAYER_STYLES;

export function resolveGrifballPlayerStyle(styles: Readonly<Record<string, GrifballPlayerStyle>> | undefined, id: string): GrifballPlayerStyle {
  return styles && Object.hasOwn(styles, id) ? styles[id] : 'balanced';
}

export function grifballPlayerStyleBonus(style: GrifballPlayerStyle, strength: number,
  score: { protection: number; opening: number; trade: number; coverageLost: number }): number {
  const weights = GRIFBALL_PLAYER_STYLES[style];
  return strength * (score.protection * weights.protection + score.opening * weights.opening +
    score.trade * weights.trade - score.coverageLost * weights.coverage);
}
