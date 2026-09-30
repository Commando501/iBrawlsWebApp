import { isMapBodyClear } from './grifballMapCollisionOracle';
import { MAP_CONTEST_CASES, type MapContestCase } from './grifballMapContest';
import { runPassMatchTrace } from './grifballPassMatch';

export const MAP_PASS_MATCH_CASES = MAP_CONTEST_CASES;

/** Four autonomous bots, passing enabled, and unchanged supplied geometry/spawns.
 * The clear opening is authored; later contests, passes and scores are not. */
export function runMapPassMatchTrace({ map, ...spec }: MapContestCase) {
  const trace = runPassMatchTrace({ ...spec, opening: 'clear', seed: 17 }, map);
  if (['forerunner_canyon', 'synthwave_grid_arena', 'rainy_industrial_streets'].includes(map.id)) {
    const check = (field: string, actual: boolean) => {
      if (!actual) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected: true }); }
    };
    check('obstacle crossing pass candidates rejected', trace.passGeometry.blockedCandidateSamples > 0);
    check('rejected prediction overlaps an independent obstacle footprint', trace.passGeometry.blockedExamples.some(c => c.path.some(p => !isMapBodyClear(map, { ...p, y: 0 }))));
  }
  return { ...trace, name: `${map.id}/${trace.name}`, mapId: map.id };
}

// Validate every frame before retaining compact evidence, as for other map matches.
export const runMapPassMatch = () => MAP_PASS_MATCH_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runMapPassMatchTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length,
    terminalTick: frames.find(f => f.phase === 'matchEnd')?.tick ?? null, finalFrame: frames.at(-1)! };
});
