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

export const GRIFBALL_RUNNER_PREFERENCES = {
  balanced: 'Balance progress and coverage using the team route scores.',
  enforcer: 'Favor forward progress and accept more exposure to keep the push moving.',
  opportunist: 'Under forward pressure, favor routes through visible recovery openings before they close.',
  guardian: 'Favor lower exposure and a useful coverage rendezvous.',
} satisfies Record<GrifballPlayerStyle, string>;

/** At most three score points of preference; route eligibility remains authoritative. */
export function grifballRunnerStyleBonus(style: GrifballPlayerStyle, strength: number,
  candidate: { action: string; progress: number; risk: number; recoveryOpening: number }): number {
  const { action, progress, risk, recoveryOpening } = candidate;
  const bonus = style === 'enforcer' ? .3 * progress + 1.5 * risk
    : style === 'opportunist' ? 2.5 * recoveryOpening * (1 - risk) - .5 * risk
    : style === 'guardian' ? -3 * risk + (action === 'wait' ? .5 : 0) : 0;
  return strength * Math.max(-3, Math.min(3, bonus));
}
