import type { CustomMapData } from '../../src/types';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { validateCompleteMatchTrace } from './grifballMatchDecisionIntegration';
import { PASS_CONTEST_OPENINGS, validatePassSelections, validatePassCancellation, type PassContestCase } from './grifballPassContest';

export interface PassMatchCase extends Omit<PassContestCase, 'opening'> {
  opening: 'clear' | 'closing-charge' | 'disabled';
  seed: number;
}
export const PASS_MATCH_CASES: PassMatchCase[] = (['clear', 'closing-charge', 'disabled'] as const)
  .flatMap(opening => [17, 43].flatMap(seed => (['blue', 'red'] as const)
    .flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ opening, seed, team, reverse, main }))))));

/** Continue passing contests through physical goals, resets and a two-goal win.
 * Initial positions and tuning are authored; all subsequent play is autonomous. */
export function runPassMatchTrace(spec: PassMatchCase, map?: CustomMapData) {
  const trace = validateCompleteMatchTrace(runOpposedDecisionTrace(
    { mode: 'contested', team: spec.team, reverse: spec.reverse, main: spec.main, seed: spec.seed },
    map ? 'map-pass-match' : 'pass-match', map, PASS_CONTEST_OPENINGS[spec.opening]));
  return validatePassMatchTrace(trace, spec);
}

export function validatePassMatchTrace(trace: Omit<ReturnType<typeof runOpposedDecisionTrace>, 'scenario'>, spec: PassMatchCase) {
  validatePassSelections(trace);
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected });
    }
  };
  const first = trace.passes[0], carrierId = spec.main ? 'main_ai' : 'carrier';
  if (spec.opening === 'disabled') {
    check('disabled passing never releases across rounds', trace.passes.length, 0);
    check('disabled passing never charges across rounds', trace.frames.some(f => f.pass?.charge), false);
  } else if (spec.opening === 'clear') {
    check('initial carrier passes autonomously', first?.carrierId, carrierId);
    check('initial intended teammate', first?.receiverId, 'escort');
    check('initial pass reaches teammate', trace.pickups.find(p => p.tick > (first?.tick ?? Infinity))?.id, 'escort');
    check('clear opening release timing', first?.tick, 36);
  } else {
    validatePassCancellation(trace, carrierId);
  }
  const end = trace.frames.at(-1)!;
  check('hostile targeting throughout match', trace.targetLookups.every(t => end.actors.find(a => a.id === t.id)!.team !== end.actors.find(a => a.id === t.target)!.team), true);
  for (const pass of trace.passes) check('pass releases only during active play', trace.frames[pass.tick - 1].phase, 'playing');
  for (const frame of trace.frames) if (frame.phase !== 'playing') {
    check('inactive phase clears pass charge', frame.pass?.charge, null);
    check('inactive phase clears pass flight', frame.pass?.flight, null);
  }
  const reset = trace.resets[0]?.tick ?? Infinity;
  return { ...trace, name: `${spec.opening}/seed-${spec.seed}/${trace.name}`, scenario: spec,
    passesAfterReset: trace.passes.filter(p => p.tick > reset).length };
}

// Keep full traces available for diagnosis; validate every frame before compacting
// the matrix retained by the execution gate.
export const runPassMatch = () => PASS_MATCH_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runPassMatchTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length,
    terminalTick: frames.find(f => f.phase === 'matchEnd')?.tick ?? null, finalFrame: frames.at(-1)! };
});

export interface PostResetPassTrace {
  name: string;
  scenario: { team: 'blue' | 'red'; main: boolean };
  passesAfterReset: number;
  failureCount: number;
}

/** Coverage belongs to the complete fixed matrix, not a prescribed tactical outcome per seed. */
export function postResetPassCoverage(traces: readonly PostResetPassTrace[]) {
  const required = ['blue/false', 'blue/true', 'red/false', 'red/true'];
  const witnesses = traces.filter(t => t.failureCount === 0 && t.passesAfterReset > 0)
    .map(t => ({ group: `${t.scenario.team}/${t.scenario.main}`, trace: t.name, passes: t.passesAfterReset }));
  return { witnesses, missing: required.filter(group => !witnesses.some(w => w.group === group)) };
}
