import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

/** Tactical tuning is deliberately separate from mechanics and combat personalities. */
export const TACTICS_FIELDS = {
  hammerDefenseAgencyStrength: { label: 'Hammer defense individuality', min: 0, max: 1, step: .1, value: 0, unit: '', module: 'agency', description: 'Apply each hammer defender’s Grifball style: earlier, tighter Enforcer attempts; later, cleaner Opportunist windows; and early Guardian recognition with more contact margin. Zero keeps team behavior. Requires Hammer pass defense, coordination, space awareness, coordinated defense and hammer ball deflection in match rules.' },
  hammerDefenseReaction: { label: 'Hammer pass reaction delay', min: 0, max: .3, step: .01, value: .08, unit: 's', module: 'defense', description: 'Minimum observed enemy throw age before a stationary hammer interception. Requires Hammer pass defense and hammer ball deflection in match rules.' },
  swordGuardAgencyStrength: { label: 'Sword defense individuality', min: 0, max: 1, step: .1, value: 0, unit: '', module: 'agency', description: 'Apply each sword defender’s Grifball style: Enforcers keep pressure longer, Opportunists leave less extra room for recovery, and Guardians respond sooner with more clearance. Zero keeps team behavior. Requires Sword punch awareness, coordination, space awareness and coordinated defense.' },
  swordGuardReaction: { label: 'Sword guard reaction delay', min: 0, max: .3, step: .01, value: .06, unit: 's', module: 'defense', description: 'Minimum visible runner punch age before a ready sword defender gives it room. Requires Sword punch awareness, coordination, space awareness and coordinated defense.' },
  runnerClashAgencyStrength: { label: 'Counter individuality', min: 0, max: 1, step: .1, value: 0, unit: '', module: 'agency', description: 'Apply each runner’s Grifball style to counter timing: earlier Enforcer commitment, later Opportunist counters, and quicker Guardian recognition. Zero keeps team timing. Requires Runner punch-clash timing, coordination, space awareness and runner planning.' },
  runnerClashReaction: { label: 'Clash reaction delay', min: 0, max: .3, step: .01, value: .06, unit: 's', module: 'runner', description: 'Minimum visible sword attack age before a timed counter. A slower reaction can miss short slashes; cooldowns still apply.' },
  runnerClashLead: { label: 'Clash counter window', min: .02, max: .3, step: .01, value: .08, unit: 's', module: 'runner', description: 'Punch when estimated sword contact is this close. Clamped to the actual punch active duration. Requires Runner punch-clash timing.' },
  passAgencyStrength: { label: 'Passing individuality', min: 0, max: 1, step: 0.1, value: 0, unit: '', module: 'agency', description: 'Apply each carrier’s Grifball style to eligible passes. Zero preserves team pass scoring. Requires coordination, space awareness and passing; safety margins and hammer-deflection checks remain authoritative.' },
  defenseAgencyStrength: { label: 'Defensive individuality', min: 0, max: 1, step: 0.1, value: 0, unit: '', module: 'agency', description: 'Use player styles to choose between timely interceptors and nearby escort markers. Last-defender coverage, containment and emergencies retain priority. Requires coordination, space awareness and coordinated defense.' },
  runnerAgencyStrength: { label: 'Runner individuality', min: 0, max: 1, step: 0.1, value: 0, unit: '', module: 'agency', description: 'Apply each carrier’s Grifball style to eligible route scores. Zero preserves team route scoring. Requires coordination, space awareness and runner planning; independent of support initiative.' },
  agencyStrength: { label: 'Individual initiative', min: 0, max: 1, step: 0.1, value: 0, unit: '', module: 'agency', description: 'Allow support bots to choose separate useful engagements using their Grifball player styles. Zero preserves the established team orders. Requires coordination, space awareness and tanking.' },
  styleAggression: { label: 'Aggression', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Initiate useful engagements sooner at high values; keep more coverage at low values.' },
  stylePatience: { label: 'Patience', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Allow longer coverage rendezvous and tank commitments. Progress timeouts still apply.' },
  styleWidth: { label: 'Formation width', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Widen support lanes and runner cuts. The center value preserves module tuning.' },
  styleSupportDistance: { label: 'Support distance', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Low values keep escorts close; high values spread support farther along the route.' },
  styleRunnerRisk: { label: 'Runner risk', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Higher values tolerate more estimated route risk and smaller pass margins. Pass viability is still required.' },
  styleVariation: { label: 'Bounded variation', min: 0, max: 1, step: 0.05, value: 0.25, unit: '', module: 'styles', description: 'Seeded preference among similarly useful routes and engagements, held throughout each possession.' },
  adaptationStrength: { label: 'Adaptation strength', min: 0, max: 1, step: 0.05, value: 0.5, unit: '', module: 'styles', description: 'Maximum response to observed opponent approach and lane width; does not alter mechanics.' },
  adaptationConfidence: { label: 'Required confidence', min: 0.5, max: 1, step: 0.05, value: 0.7, unit: '', module: 'styles', description: 'Require consistent recent observations before adjusting preferences. Confidence is a heuristic, not a probability.' },
  adaptationMinSamples: { label: 'Minimum observations', min: 4, max: 24, step: 1, value: 8, unit: '', module: 'styles', description: 'Moving opponents are sampled at most twice per second. More observations delay adaptation.' },

  defensePressure: { label: 'Pressure preference', min: 0, max: 1, step: 0.1, value: 0.6, unit: '', module: 'defense', description: 'Higher values contest earlier; lower values contain until support arrives.' },
  defenseLookahead: { label: 'Interception lookahead', min: 0.25, max: 3, step: 0.25, value: 1.5, unit: 's', module: 'defense', description: 'Predict visible carrier movement over this horizon; replan on each tactical update.' },
  defenseSafetyDepth: { label: 'Last-defender depth', min: 2, max: 15, step: 0.5, value: 7, unit: 'm', module: 'defense', description: 'Keep the last defender this far goal-side of the projected carrier, capped before the goal.' },
  defenseContainMargin: { label: 'Containment margin', min: 0.5, max: 6, step: 0.5, value: 2, unit: 'm', module: 'defense', description: 'Hold outside visible attack reach while outnumbered or regrouping.' },
  defenseEmergencyDistance: { label: 'Goal emergency range', min: 3, max: 20, step: 1, value: 8, unit: 'm', module: 'defense', description: 'Contest immediately when the opposing carrier reaches this goal distance.' },
  defenseRespawnWait: { label: 'Reinforcement wait', min: 0, max: 6, step: 0.5, value: 2.5, unit: 's', module: 'defense', description: 'Consider a nearby returning teammate within this estimated arrival time when containing.' },
  defenseTransitionSeconds: { label: 'Turnover recovery time', min: 0, max: 4, step: 0.25, value: 1.5, unit: 's', module: 'defense', description: 'Briefly restore the defensive shape after losing possession.' },
  passSafetyMargin: { label: 'Pass safety margin', min: 0, max: 3, step: 0.1, value: 0.6, unit: 's', module: 'defense', description: 'Required opponent arrival margin beyond receiver pickup time. Larger values accept less risk.' },
  passMinProgress: { label: 'Minimum pass progress', min: 0, max: 20, step: 1, value: 5, unit: 'm', module: 'defense', description: 'Minimum goal progress from a pass before giving up possession.' },
  passMaxReceiveSeconds: { label: 'Receiver arrival limit', min: 0.5, max: 6, step: 0.25, value: 3, unit: 's', module: 'defense', description: 'Reject passes that require a longer receiver run.' },
  passThreatMargin: { label: 'Receiver attack margin', min: 0, max: 2, step: 0.1, value: 0.4, unit: 's', module: 'defense', description: 'Require time to collect the settled ball before an opponent can attack the receiver.' },

  tankCommitSeconds: { label: 'Engagement commitment', min: 0, max: 3, step: 0.1, value: 0.8, unit: 's', module: 'tanking', description: 'Keep a useful target through small score changes. Lost purpose or a recovery opening can override it.' },
  tankDoubleThreshold: { label: 'Double-team threshold', min: 0, max: 15, step: 0.5, value: 4.5, unit: 'score', module: 'tanking', description: 'Minimum value for a second attacker; also requires an opening, safe separation and recovery coverage.' },
  tankReleaseDistance: { label: 'Disengagement distance', min: 4, max: 25, step: 1, value: 10, unit: 'm', module: 'tanking', description: 'Release duels this far behind a friendly runner when the opponent cannot threaten the push soon.' },
  tankReleaseSeconds: { label: 'Return-to-coverage time', min: 0, max: 3, step: 0.1, value: 0.6, unit: 's', module: 'tanking', description: 'After leaving a duel, briefly restore coverage before recommitting. Immediate defense remains available.' },
  tankDelayMargin: { label: 'Delay spacing margin', min: 0.5, max: 5, step: 0.25, value: 1.5, unit: 'm', module: 'tanking', description: 'Outnumbered defenders stay this far outside the visible threat reach while holding the goal side.' },
  tankEmergencyDistance: { label: 'Emergency goal distance', min: 3, max: 20, step: 1, value: 9, unit: 'm', module: 'tanking', description: 'Stop delaying and contest an enemy carrier within this distance of the defended goal.' },
  tankMinimumScore: { label: 'Minimum engagement value', min: 0, max: 10, step: 0.25, value: 1.5, unit: 'score', module: 'tanking', description: 'Below this tactical value, preserve coverage instead of initiating a duel.' },
  tankProtectionWeight: { label: 'Possession protection value', min: 0, max: 10, step: 0.5, value: 5, unit: '', module: 'tanking', description: 'Value of stopping a threat to the friendly carrier or challenging the opposing carrier.' },
  tankOpeningWeight: { label: 'Route opening value', min: 0, max: 10, step: 0.5, value: 4, unit: '', module: 'tanking', description: 'Value of clearing the intended runner or ball-recovery route.' },
  tankDelayWeight: { label: 'Defensive delay value', min: 0, max: 10, step: 0.5, value: 3, unit: '', module: 'tanking', description: 'Value of slowing an opponent on the goal side of the ball.' },
  tankTradeWeight: { label: 'Trade value', min: 0, max: 6, step: 0.25, value: 1, unit: '', module: 'tanking', description: 'Weight of visible attack timing and the tactical value exchanged in an engagement; does not change damage.' },
  tankCoverageWeight: { label: 'Lost coverage cost', min: 0, max: 10, step: 0.5, value: 3, unit: '', module: 'tanking', description: 'Penalty for leaving the assigned area or exposing recovery coverage.' },

  runnerLookahead: { label: 'Route lookahead', min: 2, max: 12, step: 0.5, value: 6, unit: 'm', module: 'runner', description: 'Distance of each short runner route.' },
  runnerCutWidth: { label: 'Cut width', min: 1, max: 10, step: 0.5, value: 4, unit: 'm', module: 'runner', description: 'Sideways distance explored when cutting around pressure.' },
  runnerMaxWait: { label: 'Coverage wait limit', min: 0, max: 4, step: 0.25, value: 1.5, unit: 's', module: 'runner', description: 'Maximum waiting or retreat time until the runner makes real goal progress.' },
  runnerProgressTimeout: { label: 'Progress timeout', min: 1, max: 8, step: 0.5, value: 4, unit: 's', module: 'runner', description: 'Without net progress, force a reachable forward route.' },
  runnerFinishDistance: { label: 'Finish range', min: 2, max: 12, step: 0.5, value: 7, unit: 'm', module: 'runner', description: 'Compare a direct scoring route when this close to goal.' },
  runnerRetreatRisk: { label: 'Retreat risk threshold', min: 0.25, max: 1, step: 0.05, value: 0.8, unit: '', module: 'runner', description: 'Consider retreat only when forward routes exceed this estimated risk.' },
  runnerCommitSeconds: { label: 'Route commitment', min: 0, max: 2, step: 0.1, value: 0.6, unit: 's', module: 'runner', description: 'Keep a reachable route briefly unless a safer urgent route or finish appears.' },
  runnerSwitchAdvantage: { label: 'Route switch advantage', min: 0, max: 6, step: 0.25, value: 1, unit: '', module: 'runner', description: 'Required score improvement before switching a committed route.' },
  runnerProgressWeight: { label: 'Progress preference', min: 0.25, max: 3, step: 0.25, value: 1, unit: '', module: 'runner', description: 'Reward goal progress when comparing routes.' },
  runnerRiskWeight: { label: 'Runner risk penalty', min: 0, max: 20, step: 0.5, value: 10, unit: '', module: 'runner', description: 'Penalty for routes enemies can attack before the carrier arrives.' },
  runnerDangerMargin: { label: 'Attack timing margin', min: 0.1, max: 2, step: 0.1, value: 0.6, unit: 's', module: 'runner', description: 'Extra time allowed when estimating enemy interception risk.' },
  escortLeadDistance: { label: 'Route screen distance', min: 1, max: 10, step: 0.5, value: 4, unit: 'm', module: 'runner', description: 'How far along the chosen route escorts establish a screen.' },
  escortLaneWidth: { label: 'Clear lane width', min: 1, max: 6, step: 0.25, value: 2.5, unit: 'm', module: 'runner', description: 'Keep screens to the sides of the carrier corridor.' },
  escortRearDistance: { label: 'Rear pursuit coverage', min: 1, max: 8, step: 0.5, value: 3, unit: 'm', module: 'runner', description: 'Distance behind the carrier for the safety escort.' },
  threatHorizon: { label: 'Threat horizon', min: 0.25, max: 4, step: 0.25, value: 1.5, unit: 's', module: 'space', description: 'Enemy attacks inside this estimated time window influence position choice.' },
  threatWeight: { label: 'Threat avoidance', min: 0, max: 20, step: 0.5, value: 6, unit: '', module: 'space', description: 'Penalty for positions an enemy can attack soon.' },
  sharedExposureWeight: { label: 'Shared hammer exposure', min: 0, max: 20, step: 0.5, value: 8, unit: '', module: 'space', description: 'Penalty for sharing a plausible hammer blast with a teammate.' },
  supportSeconds: { label: 'Useful support time', min: 0.25, max: 5, step: 0.25, value: 1.5, unit: 's', module: 'space', description: 'Desired time for a teammate to reach attack range of the position.' },
  supportWeight: { label: 'Stay within support', min: 0, max: 20, step: 0.5, value: 4, unit: '', module: 'space', description: 'Penalty per second beyond useful support time.' },
  positionHysteresis: { label: 'Position change threshold', min: 0, max: 5, step: 0.25, value: 0.75, unit: '', module: 'space', description: 'Keep a reachable previous position unless the new score improves by this amount.' },
  refreshSeconds: { label: 'Assignment refresh', min: 0.05, max: 1, step: 0.05, value: 0.2, unit: 's', module: 'roles', description: 'Time between position-based assignment updates. Possession changes update immediately.' },
  reassignmentAdvantage: { label: 'Retriever handoff advantage', min: 0, max: 10, step: 0.5, value: 2, unit: 'm', module: 'roles', description: 'A challenger must be this much closer to take over ball recovery.' },
  leadForward: { label: 'Lead offset', min: 0, max: 15, step: 0.5, value: 6.5, unit: 'm', module: 'spacing', description: 'Distance ahead of the carrier for the lead screen.' },
  coverForward: { label: 'Cover offset', min: -10, max: 15, step: 0.5, value: 2.5, unit: 'm', module: 'spacing', description: 'Distance ahead of the carrier for lateral support; negative values trail.' },
  lateralSpacing: { label: 'Lateral spacing', min: 1.5, max: 15, step: 0.5, value: 4, unit: 'm', module: 'spacing', description: 'Sideways distance between support positions.' },
  safetyDistance: { label: 'Safety depth', min: 0, max: 25, step: 0.5, value: 10, unit: 'm', module: 'spacing', description: 'Maximum distance toward your own goal for recovery coverage.' },
  separation: { label: 'Teammate separation', min: 0, max: 10, step: 0.5, value: 4, unit: 'm', module: 'spacing', description: 'Repulsion radius for support bots. Retrievers may enter the pickup.' },
  arrivalRadius: { label: 'Arrival slowing', min: 0.25, max: 8, step: 0.25, value: 1.5, unit: 'm', module: 'spacing', description: 'Distance from the destination where supports begin slowing down.' },
  engagementDistance: { label: 'Threat engagement distance', min: 2.5, max: 15, step: 0.5, value: 6, unit: 'm', module: 'spacing', description: 'Maximum distance to a relevant enemy before engaging. Immediate self defense remains available.' },
  coverageBoundary: { label: 'Return to coverage boundary', min: 2.5, max: 25, step: 0.5, value: 9, unit: 'm', module: 'spacing', description: 'Beyond this distance from its assignment, a support bot returns to coverage.' },
} as const;
export type TacticalNumber = keyof typeof TACTICS_FIELDS;
export type TeamTactics = Record<TacticalNumber, number> & {
  hammerDefenseEnabled: boolean; swordGuardEnabled: boolean; runnerClashEnabled: boolean; stylesEnabled: boolean; adaptationEnabled: boolean; enabled: boolean; spacingEnabled: boolean; spaceEnabled: boolean; runnerEnabled: boolean; tankingEnabled: boolean; defenseEnabled: boolean; passingEnabled: boolean; preserveSlots: boolean; safetyFirst: boolean;
};
export interface GrifballTacticsConfig {
  schemaVersion: 16;
  defaults: TeamTactics;
  teams: { blue?: Partial<TeamTactics>; red?: Partial<TeamTactics> };
  /** Stable roster IDs: styles follow bots when teams are mirrored. */
  botStyles: Record<string, GrifballPlayerStyle>;
}
export function defaultGrifballTactics(): GrifballTacticsConfig {
  return { schemaVersion: 16, defaults: {
    ...Object.fromEntries(Object.entries(TACTICS_FIELDS).map(([key, field]) => [key, field.value])) as Record<TacticalNumber, number>,
    hammerDefenseEnabled: false, swordGuardEnabled: false, runnerClashEnabled: false, stylesEnabled: true, adaptationEnabled: true, enabled: true, spacingEnabled: true, spaceEnabled: true, runnerEnabled: true, tankingEnabled: true, defenseEnabled: true, passingEnabled: true, preserveSlots: true, safetyFirst: false,
  }, teams: {}, botStyles: {} };
}
const booleanKeys = ['hammerDefenseEnabled', 'swordGuardEnabled', 'runnerClashEnabled', 'stylesEnabled', 'adaptationEnabled', 'enabled', 'spacingEnabled', 'spaceEnabled', 'runnerEnabled', 'tankingEnabled', 'defenseEnabled', 'passingEnabled', 'preserveSlots', 'safetyFirst'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Reject invalid imports atomically; never silently accept misspelled or future controls. */
export function validateGrifballTactics(value: unknown): GrifballTacticsConfig {
  if (!object(value) || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(value.schemaVersion as number) || !object(value.defaults) || !object(value.teams)) throw new Error('Expected tactics schemaVersion 1–16, defaults and teams.');
  if (Object.keys(value).some(key => !['schemaVersion', 'defaults', 'teams', 'botStyles'].includes(key))) throw new Error('Unknown configuration field.');
  const styles = value.botStyles === undefined && (value.schemaVersion as number) < 7 ? {} : value.botStyles;
  if (!object(styles) || Object.keys(styles).length > 128 || Object.entries(styles).some(([id, style]) =>
    !id.trim() || id.length > 128 || typeof style !== 'string' || !Object.hasOwn(GRIFBALL_PLAYER_STYLES, style)))
    throw new Error('Expected at most 128 bot IDs with supported Grifball player styles.');
  const validateTeam = (team: unknown, partial: boolean): Partial<TeamTactics> => {
    if (!object(team)) throw new Error('Team settings must be an object.');
    for (const [key, setting] of Object.entries(team)) {
      if (booleanKeys.includes(key)) { if (typeof setting !== 'boolean') throw new Error(`${key} must be a boolean.`); }
      else {
        const field = TACTICS_FIELDS[key as TacticalNumber];
        if (!field || typeof setting !== 'number' || !Number.isFinite(setting) || setting < field.min || setting > field.max) throw new Error(`Invalid ${key}: use its displayed range.`);
      }
    }
    const migrated = !partial ? {
      ...((value.schemaVersion as number) < 16 ? { hammerDefenseAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 15 ? { hammerDefenseEnabled: false, hammerDefenseReaction: .08 } : {}),
      ...((value.schemaVersion as number) < 14 ? { swordGuardAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 13 ? { swordGuardEnabled: false, swordGuardReaction: .06 } : {}),
      ...((value.schemaVersion as number) < 12 ? { runnerClashAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 11 ? { runnerClashEnabled: false, runnerClashReaction: .06, runnerClashLead: .08 } : {}),
      ...((value.schemaVersion as number) < 10 ? { passAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 9 ? { defenseAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 8 ? { runnerAgencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 7 ? { agencyStrength: 0 } : {}),
      ...((value.schemaVersion as number) < 6 ? { stylesEnabled: true, adaptationEnabled: true } : {}),
      ...((value.schemaVersion as number) < 5 ? { defenseEnabled: true, passingEnabled: true } : {}),
      ...(value.schemaVersion === 1 ? { spaceEnabled: true } : {}),
      ...((value.schemaVersion as number) < 3 ? { runnerEnabled: true } : {}),
      ...((value.schemaVersion as number) < 4 ? { tankingEnabled: true } : {}),
      ...Object.fromEntries(Object.entries(TACTICS_FIELDS).filter(([, field]) =>
        (value.schemaVersion as number) < 6 && field.module === 'styles' || (value.schemaVersion as number) < 5 && field.module === 'defense' || value.schemaVersion === 1 && field.module === 'space' || (value.schemaVersion as number) < 3 && field.module === 'runner' || (value.schemaVersion as number) < 4 && field.module === 'tanking'
      ).map(([key, field]) => [key, field.value])),
      ...team,
    } : team;
    if (!partial && [...Object.keys(TACTICS_FIELDS), ...booleanKeys].some(key => !(key in migrated))) throw new Error('Default settings are incomplete.');
    return { ...migrated } as Partial<TeamTactics>;
  };
  const defaults = validateTeam(value.defaults, false) as TeamTactics;
  const teams: GrifballTacticsConfig['teams'] = {};
  for (const [key, team] of Object.entries(value.teams)) {
    if (key !== 'blue' && key !== 'red') throw new Error(`Unknown team: ${key}`);
    teams[key] = validateTeam(team, true);
  }
  return { schemaVersion: 16, defaults, teams, botStyles: Object.fromEntries(Object.entries(styles)) as Record<string, GrifballPlayerStyle> };
}
export function resolveTeamTactics(config: GrifballTacticsConfig, team: string): TeamTactics {
  return { ...config.defaults, ...(team === 'blue' || team === 'red' ? config.teams[team] : {}) };
}
