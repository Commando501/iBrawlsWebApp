import { MAP_CONTEST_CASES } from './grifballMapContest';
import { runRosterContestTrace } from './grifballRosterContest';
import { validateCompleteMatchTrace } from './grifballMatchDecisionIntegration';
import { isMapBodyClear } from './grifballMapCollisionOracle';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';

// Open stadium and obstacle grid. Cover every team/order/carrier identity for
// each roster size; these seed-17 fixtures are integration, not quality trials.
export const ROSTER_MATCH_CASES = MAP_CONTEST_CASES
  .filter(s => ['championship_stadium', 'synthwave_grid_arena'].includes(s.map.id))
  .flatMap(s => ([3, 4] as const).map(teamSize => ({ ...s, teamSize, profile: 'balanced' as const })));

export function runRosterMatchTrace(spec: typeof ROSTER_MATCH_CASES[number]) {
  const trace = validateCompleteMatchTrace(runRosterContestTrace(spec, spec.map));
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected });
    }
  };
  const first = trace.frames[0], end = trace.frames.at(-1)!;
  for (const [key, value] of Object.entries(trace.combatSettings!))
    check(0, `default combat setting: ${key}`, value, DEFAULT_ADMIN_SETTINGS[key as keyof typeof DEFAULT_ADMIN_SETTINGS]);
  const ids = first.actors.map(a => a.id).sort();
  for (const frame of trace.frames) {
    check(frame.tick, 'complete roster identities retained', JSON.stringify(frame.actors.map(a => a.id).sort()), JSON.stringify(ids));
    for (const team of ['blue', 'red']) check(frame.tick, 'team sizes retained', frame.actors.filter(a => a.team === team).length, spec.teamSize);
    if (frame.phase !== 'playing') {
      check(frame.tick, 'inactive phase clears pass charge', frame.pass?.charge, null);
      check(frame.tick, 'inactive phase clears pass flight', frame.pass?.flight, null);
    }
  }
  check(trace.ticks, 'larger roster executes live passes', trace.passes.length > 0, true);
  for (const pass of trace.passes) {
    check(pass.tick, 'release only during active play', trace.frames[pass.tick - 1].phase, 'playing');
    check(pass.tick, 'receiver belongs to carrier team', end.actors.find(a => a.id === pass.receiverId)?.team, end.actors.find(a => a.id === pass.carrierId)?.team);
  }
  const reset = trace.resets[0]?.tick ?? Infinity;
  for (const actor of first.actors) {
    check(trace.ticks, 'each bot receives a role after reset: ' + actor.id,
      trace.tacticalSamples.some(s => s.tick > reset && s.assignments.some(a => a.id === actor.id)), true);
  }
  if (spec.map.id === 'synthwave_grid_arena') {
    check(trace.ticks, 'blocked pass candidates rejected', trace.passGeometry.blockedCandidateSamples > 0, true);
    check(trace.ticks, 'rejected path intersects independent obstacle footprint',
      trace.passGeometry.blockedExamples.some(c => c.path.some(p => !isMapBodyClear(spec.map, { ...p, y: 0 }))), true);
  }
  const terminalTick = trace.frames.find(f => f.phase === 'matchEnd')?.tick ?? null;
  check(trace.ticks, 'terminal observation includes complete respawn delay', terminalTick !== null &&
    trace.ticks === Math.max(terminalTick, trace.deaths.at(-1)?.tick ?? 0) + 181, true);
  return { ...trace, boundary: 'live-map-roster-match' as const, name: `${spec.map.id}/${trace.name}`, mapId: spec.map.id,
    scenario: { teamSize: spec.teamSize, profile: spec.profile, team: spec.team, reverse: spec.reverse, main: spec.main, seed: 17 },
    terminalTick, passesAfterReset: trace.passes.filter(p => p.tick > reset).length };
}

export const runRosterMatch = () => ROSTER_MATCH_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runRosterMatchTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length, finalFrame: frames.at(-1)! };
});
