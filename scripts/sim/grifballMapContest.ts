import { PREMADE_MAPS } from '../../src/game/premadeMaps';
import { toGrifballArena } from '../../src/game/grifballMaps';
import { getGoalPlates } from '../../src/game/grifballGoals';
import { runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';
import type { CustomMapData } from '../../src/types';
export interface MapContestCase extends OpposedDecisionCase { map: CustomMapData }
export const MAP_CONTEST_CASES: MapContestCase[] = PREMADE_MAPS.map(toGrifballArena).filter(map => getGoalPlates(map).length === 2)
  .flatMap(map => (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse => [false, true].map(main =>
    ({ map, mode: 'contested' as const, team, reverse, main })))));

/** Authored wounded opening; every subsequent action, carrier recovery and revival
 * uses the production frame/decision/combat/objective owners on intact supplied maps. */
export function runMapContestTrace({ map, ...spec }: MapContestCase) {
  const trace = runOpposedDecisionTrace(spec, 'map-contest', map);
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected }); }
  };
  const end = trace.frames.at(-1)!;
  check('both teams commit autonomous attacks', new Set(trace.attacks.map(a => end.actors.find(c => c.id === a.id)!.team)).size, 2);
  check('carrier dies in active combat', trace.carrierDeaths.length > 0, true);
  check('another living actor recovers after carrier loss', trace.carrierDeaths.some(d => trace.pickups.some(p => p.tick > d.tick && p.id !== d.id)), true);
  check('production respawn observed', trace.revivals.length > 0, true);
  for (const death of trace.deaths.filter(d => d.tick + 181 <= trace.ticks))
    check('every elapsed death delay revives', trace.revivals.some(r => r.id === death.id && r.tick === death.tick + 181), true);
  check('kill credit conserved', end.actors.reduce((s, c) => s + c.kills, 0), trace.deaths.length);
  check('death credit conserved', end.actors.reduce((s, c) => s + c.deaths, 0), trace.deaths.length);
  check('goal notifications conserved', trace.notifications, trace.goals.length);
  check('team scores conserved', end.scores.blue.goals + end.scores.red.goals, trace.goals.length);
  return { ...trace, name: `${map.id}/${trace.name}`, mapId: map.id };
}
export const runMapContest = () => MAP_CONTEST_CASES.map(runMapContestTrace);
