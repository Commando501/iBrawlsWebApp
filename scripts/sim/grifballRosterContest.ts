import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { PASS_CONTEST_OPENINGS } from './grifballPassContest';
import type { TeamTactics } from '../../src/game/grifballTacticsConfig';
import type { CustomMapData } from '../../src/types';

export const ROSTER_TACTICS = {
  balanced: {},
  escorting: { tankingEnabled: false },
  wide: { styleWidth: .9, stylePatience: .85, styleAggression: .2, styleSupportDistance: .75, styleRunnerRisk: .2,
    safetyFirst: true, lateralSpacing: 6, escortLaneWidth: 3.5, tankDoubleThreshold: 7, passSafetyMargin: 1 },
  compact: { styleWidth: .2, stylePatience: .25, styleAggression: .8, styleSupportDistance: .25, styleRunnerRisk: .8,
    lateralSpacing: 2.5, escortLaneWidth: 1.5, tankDoubleThreshold: 2, passSafetyMargin: .3 },
} satisfies Record<string, Partial<TeamTactics>>;
export interface RosterContestCase {
  teamSize: 3 | 4; profile: keyof typeof ROSTER_TACTICS; team: 'blue' | 'red'; reverse: boolean; main: boolean;
}
export const ROSTER_CONTEST_CASES: RosterContestCase[] = ([3, 4] as const).flatMap(teamSize =>
  (Object.keys(ROSTER_TACTICS) as RosterContestCase['profile'][]).flatMap(profile => (['blue', 'red'] as const)
    .flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ teamSize, profile, team, reverse, main }))))));

/** Bounded autonomous 3v3/4v4 contests with authored starts and tactical profiles. */
export function runRosterContestTrace(spec: RosterContestCase, map?: CustomMapData) {
  const trace = runOpposedDecisionTrace({ mode: 'contested', team: spec.team, reverse: spec.reverse, main: spec.main, seed: 17 },
    map ? 'map-roster-match' : 'roster-contest', map, PASS_CONTEST_OPENINGS.clear, { teamSize: spec.teamSize, tactics: ROSTER_TACTICS[spec.profile] });
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected }); }
  };
  const first = trace.frames[0], end = trace.frames.at(-1)!;
  check('full authored roster retained', end.actors.length, spec.teamSize * 2);
  for (const actor of first.actors) {
    check('every bot moves while alive: ' + actor.id, trace.frames.some(f => f.actors.some(a => a.id === actor.id && a.hp > 0 && Math.hypot(a.pos[0] - actor.pos[0], a.pos[2] - actor.pos[2]) > 2)), true);
    check('every bot receives a tactical role: ' + actor.id, trace.tacticalSamples.some(s => s.assignments.some(a => a.id === actor.id)), true);
  }
  check('both teams attack autonomously', new Set(trace.attacks.map(a => end.actors.find(c => c.id === a.id)!.team)).size, 2);
  check('combat causes deaths', trace.deaths.length > 0, true);
  check('production respawn observed', trace.revivals.length > 0, true);
  for (const death of trace.deaths.filter(d => d.tick + 181 <= trace.ticks)) check('every elapsed death delay revives', trace.revivals.some(r => r.id === death.id && r.tick === death.tick + 181), true);
  check('kill credit conserved', end.actors.reduce((n, c) => n + c.kills, 0), trace.deaths.length);
  check('death credit conserved', end.actors.reduce((n, c) => n + c.deaths, 0), trace.deaths.length);
  check('hostile tactical targets only', trace.targetLookups.every(t => end.actors.find(a => a.id === t.id)!.team !== end.actors.find(a => a.id === t.target)!.team), true);
  check('carrier support roles exercised', trace.tacticalSamples.some(s => s.holderId && s.assignments.some(a => a.team === end.actors.find(c => c.id === s.holderId)!.team && ['lead', 'cover', 'safety'].includes(a.role))), true);
  check('tanking module follows profile', trace.tacticalSamples.some(s => s.assignments.some(a => a.tanking)), spec.profile !== 'escorting');
  if (spec.profile === 'escorting') check('escort orders exercised when tanking is disabled', trace.tacticalSamples.some(s => s.assignments.some(a => a.escort)), true);
  return { ...trace, name: `${spec.teamSize}v${spec.teamSize}/${spec.profile}/${trace.name}`, scenario: spec, tactics: ROSTER_TACTICS[spec.profile] };
}
// Validate full frame histories before retaining compact aggregate evidence.
export const runRosterContest = () => ROSTER_CONTEST_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runRosterContestTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length, finalFrame: frames.at(-1)! };
});
