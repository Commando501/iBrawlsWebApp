import { MAP_CONTEST_CASES, type MapContestCase } from './grifballMapContest';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { validateCompleteMatchTrace } from './grifballMatchDecisionIntegration';

export const MAP_MATCH_CASES = MAP_CONTEST_CASES;

/** Same authored opening as the short contest, followed only by autonomous play.
 * Stop after three terminal seconds; fail if the match exceeds thirty minutes. */
export function runMapMatchTrace({ map, ...spec }: MapContestCase) {
  const trace = validateCompleteMatchTrace(runOpposedDecisionTrace(spec, 'map-match', map));
  return { ...trace, name: map.id + '/' + trace.name, mapId: map.id };
}
// Validate every frame before retaining compact gate evidence. Full traces remain
// available individually, avoiding another full-match matrix resident in the gate.
export const runMapMatch = () => MAP_MATCH_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runMapMatchTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length,
    terminalTick: frames.find(f => f.phase === 'matchEnd')?.tick ?? null, finalFrame: frames.at(-1)! };
});
