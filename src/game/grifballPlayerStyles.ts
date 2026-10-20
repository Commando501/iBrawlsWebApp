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

export const GRIFBALL_DEFENSE_PREFERENCES = {
  balanced: 'Use team interception timing and coverage distance.',
  enforcer: 'Step up for carrier pressure when another defender can cover the goal.',
  opportunist: 'Favor pressure and marks with a visible, reachable recovery window.',
  guardian: 'Favor nearby escort marking while a teammate contests the carrier.',
} satisfies Record<GrifballPlayerStyle, string>;

export const GRIFBALL_PASS_PREFERENCES = {
  balanced: 'Use team pass scores.',
  enforcer: 'Favor passes that gain more ground.',
  opportunist: 'Favor a quicker release from the eligible passes.',
  guardian: 'Favor larger pickup and attack margins for the receiver.',
} satisfies Record<GrifballPlayerStyle, string>;

/** Small execution preferences in seconds, independent of combat difficulty.
 * Earlier commitment can be wasted; later commitment leaves less timing margin. */
export const GRIFBALL_CLASH_PREFERENCES = {
  balanced: { reaction: 0, window: 0, reason: 'Use team counter timing.' },
  enforcer: { reaction: 0, window: .03, reason: 'Commit earlier once the sword attack is recognized.' },
  opportunist: { reaction: 0, window: -.03, reason: 'Hold the punch for closer sword contact, accepting a smaller timing margin.' },
  guardian: { reaction: -.02, window: 0, reason: 'Recognize a visible sword attack sooner while retaining the team counter window.' },
} satisfies Record<GrifballPlayerStyle, { reaction: number; window: number; reason: string }>;

/** Reaction offsets in seconds; clearance is extra room beyond the punch reach.
 * Less clearance leaves a quicker recovery opportunity but less movement margin. */
export const GRIFBALL_SWORD_GUARD_PREFERENCES = {
  balanced: { reaction: 0, clearance: 0, reason: 'Use team sword reaction and punch clearance.' },
  enforcer: { reaction: .02, clearance: 0, reason: 'Keep pressure longer before responding, accepting more punch risk.' },
  opportunist: { reaction: 0, clearance: -.15, reason: 'Give less extra room to stay close for recovery, accepting a smaller movement margin.' },
  guardian: { reaction: -.02, clearance: .25, reason: 'Respond sooner and leave more room, giving up some recovery pressure.' },
} satisfies Record<GrifballPlayerStyle, { reaction: number; clearance: number; reason: string }>;

/** Reaction offsets in seconds; margin is extra contact cushion inside the
 * physical blast boundary. A larger cushion can forfeit a brief opportunity. */
export const GRIFBALL_HAMMER_DEFENSE_PREFERENCES = {
  balanced: { reaction: 0, margin: 0, reason: 'Use team pass reaction and blast contact margin.' },
  enforcer: { reaction: -.02, margin: -.1, reason: 'Attempt earlier, tighter deflections, accepting less room for trajectory changes.' },
  opportunist: { reaction: .02, margin: .15, reason: 'Wait for a cleaner contact window, risking a late or missed interception.' },
  guardian: { reaction: -.02, margin: .35, reason: 'Recognize throws sooner but require more contact margin, passing up marginal attempts.' },
} satisfies Record<GrifballPlayerStyle, { reaction: number; margin: number; reason: string }>;

/** Seconds added to the current receiver's handoff margin. This changes only
 * willingness to yield; candidate travel estimates and eligibility stay physical. */
export const GRIFBALL_PASS_RECOVERY_PREFERENCES = {
  balanced: { advantage: 0, reason: 'Use the team recovery handoff margin.' },
  enforcer: { advantage: .25, reason: 'Hold marginal receiving assignments longer, accepting a slower pickup.' },
  opportunist: { advantage: -.15, reason: 'Yield to quicker pickups with a smaller advantage, accepting more handoffs.' },
  guardian: { advantage: -.25, reason: 'Yield marginal recoveries sooner, accepting more assignment changes.' },
} satisfies Record<GrifballPlayerStyle, { advantage: number; reason: string }>;

/** Metres relative to the team's lateral landing-cover slot. Preferences only
 * apply when the proposed ground position preserves timing and separation. */
export const GRIFBALL_PASS_SUPPORT_PREFERENCES = {
  balanced: { depth: 0, width: 0, reason: 'Use the team landing-cover position.' },
  enforcer: { depth: -1, width: 0, reason: 'Cover closer to the receiver, giving up some goal-side depth.' },
  opportunist: { depth: 0, width: 1.5, reason: 'Cover a wider outlet, accepting a longer return to the receiver.' },
  guardian: { depth: 1.5, width: 0, reason: 'Hold deeper recovery cover, giving up some forward support.' },
} satisfies Record<GrifballPlayerStyle, { depth: number; width: number; reason: string }>;

export function grifballPassStyleBonus(style: GrifballPlayerStyle, strength: number,
  candidate: { progress: number; chargeSeconds: number; pickupMargin: number; attackMargin: number }): number {
  const bonus = style === 'enforcer' ? .2 * candidate.progress
    : style === 'opportunist' ? -2.5 * candidate.chargeSeconds
    : style === 'guardian' ? .5 * Math.min(3, candidate.pickupMargin) + .5 * Math.min(3, candidate.attackMargin) : 0;
  return strength * Math.max(-3, Math.min(3, bonus));
}

/** Preferences only rank viable jobs; they never extend an interception deadline. */
export function grifballDefenseStyleBonus(style: GrifballPlayerStyle, strength: number,
  job: 'pressure' | 'mark', recoveryOpening: boolean): number {
  const bonus = job === 'pressure'
    ? style === 'enforcer' ? .2 : style === 'opportunist' && recoveryOpening ? .25 : style === 'guardian' ? -.1 : 0
    : style === 'guardian' ? 2 : style === 'opportunist' && recoveryOpening ? 1.5 : 0;
  return strength * bonus;
}

/** At most three score points of preference; route eligibility remains authoritative. */
export function grifballRunnerStyleBonus(style: GrifballPlayerStyle, strength: number,
  candidate: { action: string; progress: number; risk: number; recoveryOpening: number }): number {
  const { action, progress, risk, recoveryOpening } = candidate;
  const bonus = style === 'enforcer' ? .3 * progress + 1.5 * risk
    : style === 'opportunist' ? 2.5 * recoveryOpening * (1 - risk) - .5 * risk
    : style === 'guardian' ? -3 * risk + (action === 'wait' ? .5 : 0) : 0;
  return strength * Math.max(-3, Math.min(3, bonus));
}
