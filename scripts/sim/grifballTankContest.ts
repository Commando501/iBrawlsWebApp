import { runOpposedDecisionTrace, type TankContestOpening } from './grifballOpposedDecisionIntegration';

export const TANK_CONTEST_OPENINGS: TankContestOpening[] = ['opening', 'ready', 'late-cover', 'shared-blast', 'disabled', 'short-window', 'threshold', 'no-reserve'];
export interface TankContestCase { opening: TankContestOpening; team: 'blue' | 'red'; reverse: boolean; main: boolean }
export const TANK_CONTEST_CASES: TankContestCase[] = TANK_CONTEST_OPENINGS.flatMap(opening =>
  (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ opening, team, reverse, main })))));

/** Authored visible recovery and constrained hammer settings; subsequent frames are autonomous. */
export function runTankContestTrace(spec: TankContestCase) {
  const trace = runOpposedDecisionTrace({ mode: 'contested', ...spec, seed: 17 }, 'tank-contest', undefined,
    { defender: { x: 5, z: 0 }, cover: { x: 40, z: 18 }, passingEnabled: false },
    { teamSize: spec.opening === 'no-reserve' ? 3 : 4, tankOpening: spec.opening, tactics: {
      tankDoubleThreshold: spec.opening === 'threshold' ? 15 : 1.5, defenseEnabled: false,
      safetyFirst: true, tankingEnabled: spec.opening !== 'disabled',
    } });
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected }); }
  };
  const first = trace.tankSamples[0];
  const friendly = first.assignments.filter(a => a.team === spec.team);
  const pair = friendly.filter(a => a.tanking?.doubleCommit);
  check(1, 'initial double commitment follows opening', pair.length, spec.opening === 'opening' ? 2 : 0);
  check(1, 'one initial primary tank', friendly.filter(a => a.tanking?.mode === 'engage').length, spec.opening === 'disabled' ? 0 : 1);
  const reasons: Partial<Record<TankContestOpening, string>> = {
    ready: 'wait for a recovery opening', 'short-window': 'wait for a recovery opening',
    'late-cover': 'coverage to arrive', 'shared-blast': 'shared hammer exposure', threshold: 'value threshold',
  };
  if (reasons[spec.opening]) check(1, 'negative control reaches intended guard', friendly.some(a => a.tanking?.reason.includes(reasons[spec.opening]!)), true);
  if (spec.opening === 'disabled') check(trace.ticks, 'disabled module stays absent', trace.tankSamples.every(s => s.assignments.every(a => !a.tanking)), true);
  if (spec.opening === 'no-reserve') check(1, 'two supports cannot double with a reserved cover', friendly.filter(a => a.tanking).length, 2);

  // Independently check physical separation and reserve ownership for the authored
  // opening. Later combat may legitimately create different formations/openings.
  const validateCommit = (s: typeof first, ids: string[]) => {
    const orders = ids.map(id => s.assignments.find(a => a.id === id)!);
    const actors = ids.map(id => s.players.find(p => p.id === id)!);
    const reserveId = orders[0].tanking!.recoveryId;
    const reserve = s.players.find(p => p.id === reserveId);
    const reserveOrder = s.assignments.find(a => a.id === reserveId);
    const holder = s.players.find(p => p.id === s.holderId);
    check(s.tick, 'paired tanks target the same living opponent', orders.every(a => a.tanking?.targetId === 'defender') && s.players.some(p => p.id === 'defender' && p.hp > 0 && p.team !== spec.team), true);
    check(s.tick, 'paired references are reciprocal', orders.every((a, i) => a.tanking?.partnerId === ids[1 - i]), true);
    check(s.tick, 'reserve is alive, allied and outside the attacking pair', !!reserve && reserve.hp > 0 && reserve.team === spec.team && !ids.includes(reserve.id), true);
    check(s.tick, 'both tanks retain the same nonattacking reserve', orders.every(a => a.tanking?.recoveryId === reserveId) && reserveOrder?.tanking?.attack === false, true);
    check(s.tick, 'reserve can reach current carrier within coverage budget', !!reserve && !!holder && Math.hypot(reserve.pos[0] - holder.pos[0], reserve.pos[2] - holder.pos[2]) / 5.2 <= 3, true);
    check(s.tick, 'actual tanks are outside a shared authored hammer blast', Math.hypot(actors[0].pos[0] - actors[1].pos[0], actors[0].pos[2] - actors[1].pos[2]) > 3.5, true);
    check(s.tick, 'planned tank positions are outside a shared authored hammer blast', Math.hypot(orders[0].destination.x - orders[1].destination.x, orders[0].destination.z - orders[1].destination.z) > 3.5, true);
  };
  if (spec.opening === 'opening' && pair.length === 2) {
    const ids = pair.map(a => a.id);
    validateCommit(first, ids);
    for (const id of ids) {
      const action = trace.tankActions.find(a => a.id === id && a.assignments.find(o => o.id === id)?.tanking?.doubleCommit);
      check(1, 'each committed tank starts an autonomous attack: ' + id, !!action, true);
      if (!action) continue;
      validateCommit(action, ids);
      const actor = action.players.find(p => p.id === id)!;
      const target = action.players.find(p => p.id === 'defender')!;
      check(action.tick, 'tank respects own ready phase', actor.phase, 'ready');
      check(action.tick, 'target remains in visible recovery at attack', target.phase, 'recovering');
      check(action.tick, 'impact fits remaining recovery window', 1.2 - target.elapsed > .12, true);
      check(action.tick, 'tactical target lookup consumed before attack', trace.targetLookups.some(t => t.id === id && t.target === 'defender' && t.tick <= action.tick), true);
      const impact = trace.impacts.find(i => i.id === id && i.tick >= action.tick && i.tick <= action.tick + 8 && i.victims.includes('defender'));
      check(action.tick, 'committed attack damages intended opponent through live impact', !!impact, true);
      if (impact) check(impact.tick, 'damage lands before authored target recovery ends', impact.tick < 72, true);
    }
    check(trace.ticks, 'double commitment expires after the opening', trace.tankSamples.some(s => s.tick > 14 && s.assignments.filter(a => ids.includes(a.id)).every(a => !a.tanking?.doubleCommit)), true);
  }
  const end = trace.frames.at(-1)!;
  check(trace.ticks, 'kill credit conserved', end.actors.reduce((n, a) => n + a.kills, 0), trace.deaths.length);
  check(trace.ticks, 'death credit conserved', end.actors.reduce((n, a) => n + a.deaths, 0), trace.deaths.length);
  return { ...trace, name: `${spec.opening}/${trace.name}`, scenario: spec };
}

export const runTankContest = () => TANK_CONTEST_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runTankContestTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length, finalFrame: frames.at(-1)! };
});
