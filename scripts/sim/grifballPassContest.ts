import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';

export const PASS_CONTEST_OPENINGS = {
  clear: { defender: { x: -35, z: 12 }, cover: { x: -45, z: -18 } },
  pressure: { defender: { x: -20, z: 8 }, cover: { x: -45, z: -18 } },
  'closing-charge': { defender: { x: -20, z: 12 }, cover: { x: -45, z: -18 } },
  'blocked-lane': { defender: { x: -6, z: 6 }, cover: { x: -45, z: -18 } },
  disabled: { defender: { x: -35, z: 12 }, cover: { x: -45, z: -18 }, passingEnabled: false },
} as const;
export interface PassContestCase {
  opening: keyof typeof PASS_CONTEST_OPENINGS;
  team: 'blue' | 'red'; reverse: boolean; main: boolean;
}
export const PASS_CONTEST_CASES: PassContestCase[] = (Object.keys(PASS_CONTEST_OPENINGS) as PassContestCase['opening'][])
  .flatMap(opening => (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ opening, team, reverse, main })))));

/** Four autonomous bots; initial positions and tuning are authored, later
 * decisions, movement, attacks, possession and respawns are not injected. */
export function runPassContestTrace(spec: PassContestCase) {
  const trace = runOpposedDecisionTrace({ mode: 'contested', team: spec.team, reverse: spec.reverse, main: spec.main },
    'pass-contest', undefined, PASS_CONTEST_OPENINGS[spec.opening]);
  return validatePassContestTrace(trace, spec);
}

/** Recheck retained evidence independently of its original verdict. */
export function validatePassContestTrace(trace: Omit<ReturnType<typeof runOpposedDecisionTrace>, 'scenario'>, spec: PassContestCase) {
  validatePassSelections(trace);
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick: trace.ticks, field, actual, expected }); }
  };
  const end = trace.frames.at(-1)!, carrierId = spec.main ? 'main_ai' : 'carrier';
  const teamOf = (id: string) => end.actors.find(a => a.id === id)!.team;
  check('both teams attack autonomously', new Set(trace.attacks.map(a => teamOf(a.id))).size, 2);
  check('combat occurs', trace.deaths.length > 0, true);
  check('production revival occurs', trace.revivals.length > 0, true);
  for (const death of trace.deaths.filter(d => d.tick + 181 <= trace.ticks)) check('every elapsed death delay revives', trace.revivals.some(r => r.id === death.id && r.tick === death.tick + 181), true);
  check('kills conserved', end.actors.reduce((n, c) => n + c.kills, 0), trace.deaths.length);
  check('deaths conserved', end.actors.reduce((n, c) => n + c.deaths, 0), trace.deaths.length);
  check('only hostile tactical targets', trace.targetLookups.every(t => teamOf(t.id) !== teamOf(t.target)), true);
  for (const id of ['defender', 'cover']) {
    const initial = PASS_CONTEST_OPENINGS[spec.opening][id as 'defender' | 'cover'];
    const sign = spec.team === 'blue' ? 1 : -1;
    check('opponents actually move: ' + id, trace.frames.some(f => f.actors.some(a => a.id === id && a.hp > 0 && Math.hypot(a.pos[0] - initial.x * sign, a.pos[2] - initial.z * sign) > 2)), true);
  }
  if (spec.opening === 'disabled') {
    check('disabled module never releases', trace.passes.length, 0);
    check('disabled module never charges', trace.frames.some(f => f.pass?.charge), false);
  } else if (spec.opening === 'blocked-lane') {
    const opening = trace.frames[0];
    check('unsafe opening rejects its pass selection', opening.pass?.selections.find(p => p.id === carrierId)?.selected, null);
    check('unsafe opening does not charge', opening.pass?.charge, null);
    check('unsafe opening does not release', trace.passes.some(p => p.tick <= opening.tick && p.carrierId === carrierId), false);
    // The defender can move or die. Later safe releases must remain legal;
    // neither a carrier death nor an opposing pickup is required for pass safety.
  } else {
    const first = trace.passes[0];
    check('original carrier releases autonomously', first?.carrierId, carrierId);
    check('allied intended receiver', first?.receiverId, 'escort');
    const reception = trace.pickups.find(p => p.tick > (first?.tick ?? Infinity));
    check('pass received by intended teammate', reception?.id, 'escort');
    if (spec.opening === 'clear') {
      check('unpressured release timing', first?.tick, 36);
      check('unpressured settled reception timing', reception?.tick, 131);
    } else {
      check('nearby threat dies before release', trace.deaths.some(d => d.id === 'defender' && d.tick < (first?.tick ?? 0)), true);
      if (spec.opening === 'closing-charge') {
        check('moving pressure cancels a real charge', trace.cancellations.some(c => c.carrierId === carrierId && c.elapsed > 0 && c.tick < (first?.tick ?? 0)), true);
      } else check('immediate pressure prevents opening charge', trace.frames[0].pass?.charge, null);
    }
  }
  return { ...trace, name: spec.opening + '/' + trace.name, scenario: spec };
}

type PassTrace = Pick<ReturnType<typeof runOpposedDecisionTrace>, 'ticks' | 'frames' | 'passes' | 'failureCount' | 'failures'>;

/** Every charge/release needs the contemporaneous selection, not the opening's decision. */
export function validatePassSelections<T extends PassTrace>(trace: T): T {
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) {
      trace.failureCount++;
      if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected });
    }
  };
  for (const frame of trace.frames) {
    const charge = frame.pass?.charge;
    if (!charge) continue;
    const selected = frame.pass?.selections.find(p => p.id === charge.carrierId)?.selected;
    check(frame.tick, 'charge retains its selected receiver', selected?.receiverId, charge.receiverId);
    check(frame.tick, 'charge retains its selected speed', selected?.speed, charge.speed);
  }
  for (const pass of trace.passes) {
    const frame = trace.frames[pass.tick - 1];
    const selected = frame?.pass?.selections.find(p => p.id === pass.carrierId)?.selected;
    check(pass.tick, 'release has matching frame evidence', frame?.tick, pass.tick);
    check(pass.tick, 'release retains its selected receiver', selected?.receiverId, pass.receiverId);
    check(pass.tick, 'release retains its selected speed', selected?.speed, pass.speed);
  }
  return trace;
}
export const runPassContest = () => PASS_CONTEST_CASES.map(runPassContestTrace);
