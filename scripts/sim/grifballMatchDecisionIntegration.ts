import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, type OpposedDecisionCase } from './grifballOpposedDecisionIntegration';

// Main-AI jump execution has a separate weapon owner and is not supplied by this
// observer fixture. Keep those configurations outside this acceptance boundary.
export const MATCH_DECISION_CASES = OPPOSED_DECISION_CASES.filter(spec => !spec.main);

/** Complete bounded matches with opposing ordinary bots. Shared instrumentation
 * retains the opening contest and revival assertions; these checks join those
 * owners to scoring, round reset, fresh retrieval and terminal state. */
export function runMatchDecisionTrace(spec: OpposedDecisionCase) {
  const trace = runOpposedDecisionTrace(spec, 'match');
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected });
    }
  };
  check('ordinary roster boundary', spec.main, false);
  const end = trace.frames.at(-1)!;
  check('bounded autonomous match completes', end.phase, 'matchEnd');
  check('match has a winning team', end.winner === 'blue' || end.winner === 'red', true);
  check('winner reaches two goals', end.winner ? end.scores[end.winner].goals : 0, 2);
  check('loser remains below target', end.winner ? end.scores[end.winner === 'blue' ? 'red' : 'blue'].goals < 2 : false, true);
  check('every goal notified once', trace.notifications, trace.goals.length);
  check('goal accounting', end.scores.blue.goals + end.scores.red.goals, trace.goals.length);
  check('every nonwinning goal resets', trace.resets.length, trace.goals.length - 1);
  check('rounds account for goals', end.round, trace.goals.length);
  check('combat causes deaths', trace.deaths.length > 0, true);
  check('all deaths eventually respawn', trace.revivals.length, trace.deaths.length);
  check('both teams attack', new Set(trace.attacks.map(a => end.actors.find(c => c.id === a.id)!.team)).size, 2);
  check('all kills credited', end.actors.reduce((sum, c) => sum + c.kills, 0), trace.deaths.length);
  check('all deaths recorded', end.actors.reduce((sum, c) => sum + c.deaths, 0), trace.deaths.length);
  for (const reset of trace.resets) {
    const before = trace.frames[reset.tick - 2], frame = trace.frames[reset.tick - 1];
    check('reset increments round', frame.round, before.round + 1);
    check('reset starts countdown', frame.phase, 'countdown');
    check('reset releases possession', frame.ball.holderId, null);
    check('reset centers ball', Math.hypot(frame.ball.pos.x, frame.ball.pos.z), 0);
    const playing = trace.transitions.find(t => t.tick > reset.tick && t.to === 'playing');
    check('countdown lasts six updates', playing?.tick, reset.tick + 6);
    const next = trace.frames[reset.tick + 6];
    check('new round has no stale runner', next.assignments.some(a => a.role === 'runner'), false);
    check('new round assigns retrieval', next.assignments.some(a => a.role === 'retriever'), true);
    const goal = trace.goals.find(g => g.round === reset.round);
    check('new round scores autonomously', !!goal, true);
    check('fresh pickup between reset and goal', trace.pickups.some(p => p.tick > reset.tick && p.tick < (goal?.tick ?? 0)), true);
    check('new round includes combat', trace.attacks.some(a => a.tick > reset.tick && a.tick < (goal?.tick ?? 0)), true);
  }
  for (const goal of trace.goals) {
    const transition = trace.transitions.find(t => t.tick > goal.tick);
    check('scored hold lasts twelve updates', transition?.tick, goal.tick + 12);
    check('scored hold chooses reset or end', transition?.to, goal === trace.goals.at(-1) ? 'matchEnd' : 'countdown');
  }
  const terminal = trace.frames.find(f => f.phase === 'matchEnd');
  check('terminal observation lasts at least one second', !!terminal && trace.ticks - terminal.tick >= 60, true);
  if (terminal) for (const frame of trace.frames.filter(f => f.tick > terminal.tick)) {
    check('terminal score stable', JSON.stringify(frame.scores), JSON.stringify(terminal.scores));
    check('terminal phase stable', frame.phase, 'matchEnd');
    check('terminal possession clear', frame.ball.holderId, null);
    check('terminal assignments clear', frame.assignments.length, 0);
  }
  return trace;
}
export const runMatchDecisionIntegration = () => MATCH_DECISION_CASES.map(runMatchDecisionTrace);
