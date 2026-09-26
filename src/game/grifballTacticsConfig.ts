/** Tactical tuning is deliberately separate from mechanics and combat personalities. */
export const TACTICS_FIELDS = {
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
  enabled: boolean; spacingEnabled: boolean; spaceEnabled: boolean; runnerEnabled: boolean; tankingEnabled: boolean; preserveSlots: boolean; safetyFirst: boolean;
};
export interface GrifballTacticsConfig {
  schemaVersion: 4;
  defaults: TeamTactics;
  teams: { blue?: Partial<TeamTactics>; red?: Partial<TeamTactics> };
}
export function defaultGrifballTactics(): GrifballTacticsConfig {
  return { schemaVersion: 4, defaults: {
    ...Object.fromEntries(Object.entries(TACTICS_FIELDS).map(([key, field]) => [key, field.value])) as Record<TacticalNumber, number>,
    enabled: true, spacingEnabled: true, spaceEnabled: true, runnerEnabled: true, tankingEnabled: true, preserveSlots: true, safetyFirst: false,
  }, teams: {} };
}
const booleanKeys = ['enabled', 'spacingEnabled', 'spaceEnabled', 'runnerEnabled', 'tankingEnabled', 'preserveSlots', 'safetyFirst'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Reject invalid imports atomically; never silently accept misspelled or future controls. */
export function validateGrifballTactics(value: unknown): GrifballTacticsConfig {
  if (!object(value) || ![1, 2, 3, 4].includes(value.schemaVersion as number) || !object(value.defaults) || !object(value.teams)) throw new Error('Expected tactics schemaVersion 1, 2, 3 or 4, defaults and teams.');
  if (Object.keys(value).some(key => !['schemaVersion', 'defaults', 'teams'].includes(key))) throw new Error('Unknown configuration field.');
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
      ...(value.schemaVersion === 1 ? { spaceEnabled: true } : {}),
      ...((value.schemaVersion as number) < 3 ? { runnerEnabled: true } : {}),
      ...((value.schemaVersion as number) < 4 ? { tankingEnabled: true } : {}),
      ...Object.fromEntries(Object.entries(TACTICS_FIELDS).filter(([, field]) =>
        value.schemaVersion === 1 && field.module === 'space' || (value.schemaVersion as number) < 3 && field.module === 'runner' || (value.schemaVersion as number) < 4 && field.module === 'tanking'
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
  return { schemaVersion: 4, defaults, teams };
}
export function resolveTeamTactics(config: GrifballTacticsConfig, team: string): TeamTactics {
  return { ...config.defaults, ...(team === 'blue' || team === 'red' ? config.teams[team] : {}) };
}
