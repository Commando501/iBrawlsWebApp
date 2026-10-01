import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { runOpposedDecisionTrace, type EarnedTankOpening } from './grifballOpposedDecisionIntegration';

export const EARNED_TANK_OPENINGS: EarnedTankOpening[] = ['opening', 'durable-opponent', 'default-roles', 'late-arrival', 'shared-blast'];
export interface EarnedTankCase { opening: EarnedTankOpening; team: 'blue' | 'red'; reverse: boolean; main: boolean }
export const EARNED_TANK_CASES: EarnedTankCase[] = EARNED_TANK_OPENINGS.flatMap(opening =>
  (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse => [false, true].map(main => ({ opening, team, reverse, main })))));

/** A committed pair cannot hit an opponent already killed by the runner.
 * Retain that interruption as its own outcome, and require a separate paired
 * kill witness when the authored opponent can survive the runner's punch. */
export function validateEarnedTankResolution(trace: Pick<ReturnType<typeof runOpposedDecisionTrace>, 'frames' | 'impacts' | 'deaths' | 'tankActions'>, ids: string[],
  recoveryStart: number, recoveryEnd: number, requirePairedKill: boolean) {
  const failures: string[] = [];
  const pairHits = trace.impacts.filter(i => ids.includes(i.id) && i.tick > recoveryStart && i.tick < recoveryEnd && i.victims.includes('defender'));
  const runnerHits = trace.impacts.filter(i => i.id === 'carrier' && i.tick > recoveryStart && i.tick < recoveryEnd && i.victims.includes('defender'));
  const impact = pairHits.length === 1 ? pairHits[0] : !pairHits.length && !requirePairedKill && runnerHits.length === 1 ? runnerHits[0] : undefined;
  const outcome = impact ? ids.includes(impact.id) ? 'paired-kill' as const : 'runner-interruption' as const : null;
  if (!impact) return { outcome, tick: 0, failures: ['earned recovery requires the declared lethal resolution'] };
  const before = trace.frames.find(f => f.tick === impact.tick - 1), after = trace.frames.find(f => f.tick === impact.tick);
  const targetBefore = before?.actors.find(a => a.id === 'defender'), targetAfter = after?.actors.find(a => a.id === 'defender');
  const killerBefore = before?.actors.find(a => a.id === impact.id), killerAfter = after?.actors.find(a => a.id === impact.id);
  if (trace.deaths.filter(d => d.id === 'defender' && d.tick === impact.tick).length !== 1 ||
    targetBefore?.hp !== 1 || targetAfter?.hp !== 0 || targetAfter.deaths !== targetBefore.deaths + 1 ||
    !killerBefore || !killerAfter || killerBefore.hp <= 0 || killerBefore.team === targetBefore?.team ||
    killerAfter.kills !== killerBefore.kills + 1)
    failures.push('earned recovery resolution has matching lethal damage, death and hostile kill credit');
  if (outcome === 'runner-interruption') {
    if (before?.ball.holderId !== 'carrier' || killerBefore?.weapon !== 'ball') failures.push('interruption is a real carrier punch');
    for (const id of ids) {
      const action = trace.tankActions.find(a => a.id === id && a.tick > recoveryStart && a.tick < impact.tick &&
        a.assignments.find(o => o.id === id)?.tanking?.doubleCommit);
      const completion = trace.impacts.find(i => i.id === id && i.tick > impact.tick && i.tick < recoveryEnd);
      const phase = before?.actors.find(a => a.id === id)?.weaponState;
      if (!action || !['swing_up', 'swing_down'].includes(phase ?? '') || !completion || completion.victims.includes('defender'))
        failures.push('runner interruption preserves each earlier paired commitment without a corpse hit');
      if (completion) {
        const end = trace.frames.find(f => f.tick === completion.tick), startActor = before?.actors.find(a => a.id === id);
        if (end?.actors.find(a => a.id === 'defender')?.hp !== 0 || !startActor ||
          end?.actors.find(a => a.id === id)?.kills !== startActor.kills)
          failures.push('interrupted pair receives no stolen kill credit');
      }
    }
  }
  return { outcome, tick: impact.tick, failures };
}

/** Default combat, authored mid-fight lifecycle state; the target earns its recovery through a live swing. */
export function runEarnedTankTrace(spec: EarnedTankCase) {
  const trace = runOpposedDecisionTrace({ mode: 'contested', ...spec, seed: 17 }, 'earned-tank-contest', undefined,
    { defender: { x: 4, z: 0 }, cover: { x: 40, z: 18 } },
    { teamSize: 4, earnedTankOpening: spec.opening, tactics: { safetyFirst: spec.opening !== 'default-roles' } });
  const check = (tick: number, field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { trace.failureCount++; if (trace.failures.length < 64) trace.failures.push({ tick, field, actual, expected }); }
  };
  for (const [key, value] of Object.entries(trace.combatSettings!))
    check(1, `default combat setting: ${key}`, value, DEFAULT_ADMIN_SETTINGS[key as keyof typeof DEFAULT_ADMIN_SETTINGS]);
  const ids = [spec.main ? 'main_ai' : 'escort', 'support_1'];
  const first = trace.tankSamples[0];
  check(1, 'authored opponent health', first.players.find(p => p.id === 'defender')?.hp, spec.opening === 'durable-opponent' ? 2 : 1);
  check(1, 'opponent starts ready rather than in authored recovery', first.players.find(p => p.id === 'defender')?.phase, 'ready');
  check(1, 'incoming tanks start pending a real respawn', ids.every(id => first.players.find(p => p.id === id)?.hp === 0), true);
  check(1, 'no initial double commitment', first.assignments.some(a => a.tanking?.doubleCommit), false);
  const enemyAction = trace.attacks.find(a => a.id === 'defender');
  const enemyImpact = trace.impacts.find(i => i.id === 'defender');
  check(1, 'opponent autonomously starts a fresh hammer swing', enemyAction?.kind, 'swing');
  check(1, 'opponent live impact damages the carrier', enemyImpact?.victims.includes('carrier'), true);
  check(1, 'opponent impact follows its own attack', !!enemyAction && !!enemyImpact && enemyImpact.tick > enemyAction.tick, true);
  const recoveryEnd = (enemyImpact?.tick ?? 0) + DEFAULT_ADMIN_SETTINGS.hammerReloadTime * 60;
  const samples = trace.tankSamples.filter(s => s.tick < recoveryEnd);
  const commits = samples.filter(s => s.assignments.some(a => ids.includes(a.id) && a.tanking?.doubleCommit));
  const actions = trace.tankActions.filter(a => ids.includes(a.id) && a.tick < recoveryEnd &&
    a.assignments.find(o => o.id === a.id)?.tanking?.doubleCommit);
  let resolution: ReturnType<typeof validateEarnedTankResolution> | null = null;
  for (const id of ids) {
    const revival = trace.revivals.find(r => r.id === id);
    check(1, `production owner revives incoming tank: ${id}`, !!revival, true);
    if (revival) check(revival.tick, 'initial pending spawn does not invent a death or kill', revival.deaths + revival.kills, 0);
  }
  if (spec.opening !== 'opening' && spec.opening !== 'durable-opponent') {
    check(1, 'unsafe first recovery has no paired commitment', commits.length, 0);
    check(1, 'unsafe first recovery has no committed attacks', actions.length, 0);
    if (spec.opening === 'late-arrival') check(1, 'late control arrives after recovery ends',
      ids.every(id => (trace.revivals.find(r => r.id === id)?.tick ?? 0) >= recoveryEnd), true);
  } else {
    check(1, 'live recovery creates a double commitment', commits.length > 0, true);
    check(1, 'both tanks consume the commitment once', actions.length, 2);
    const validatePair = (sample: typeof first) => {
      const orders = ids.map(id => sample.assignments.find(a => a.id === id));
      const actors = ids.map(id => sample.players.find(p => p.id === id)!);
      const reserve = sample.players.find(p => p.id === 'support_2')!;
      const holder = sample.players.find(p => p.id === sample.holderId)!;
      const target = sample.players.find(p => p.id === 'defender')!;
      check(sample.tick, 'commit follows opponent impact', sample.tick > (enemyImpact?.tick ?? Infinity), true);
      check(sample.tick, 'reciprocal attackers share the living opponent and separate reserve', orders.every((a, i) =>
        a?.tanking?.doubleCommit && a.tanking.attack && a.tanking.targetId === 'defender' &&
        a.tanking.partnerId === ids[1 - i] && a.tanking.recoveryId === reserve.id) && target.hp > 0 && target.team !== spec.team, true);
      check(sample.tick, 'reserve is alive, allied and not ordered to attack', reserve.hp > 0 && reserve.team === spec.team &&
        sample.assignments.find(a => a.id === reserve.id)?.tanking?.attack === false, true);
      check(sample.tick, 'reserve remains within the default three-second coverage budget',
        Math.hypot(reserve.pos[0] - holder.pos[0], reserve.pos[2] - holder.pos[2]) / 5.2 <= 3, true);
      check(sample.tick, 'actual pair clears default shared blast diameter',
        Math.hypot(actors[0].pos[0] - actors[1].pos[0], actors[0].pos[2] - actors[1].pos[2]) > 9.5, true);
      if (orders.every(Boolean)) check(sample.tick, 'planned pair clears default shared blast diameter',
        Math.hypot(orders[0]!.destination.x - orders[1]!.destination.x, orders[0]!.destination.z - orders[1]!.destination.z) > 9.5, true);
    };
    for (const sample of commits) validatePair(sample);
    for (const id of ids) {
      const action = actions.find(a => a.id === id);
      check(1, `committed action exists: ${id}`, !!action, true);
      if (!action) continue;
      validatePair(action);
      const target = action.players.find(p => p.id === 'defender')!;
      check(action.tick, 'attacker is ready after its production respawn', action.players.find(p => p.id === id)?.phase, 'ready');
      check(action.tick, 'target is still recovering when attack starts', target.phase, 'recovering');
      check(action.tick, 'remaining recovery accommodates default windup and strike',
        DEFAULT_ADMIN_SETTINGS.hammerReloadTime - target.elapsed > .4, true);
      check(action.tick, 'live target lookup consumes the intended opponent', trace.targetLookups.some(t => t.id === id && t.target === 'defender' && t.tick === action.tick), true);
      check(action.tick, 'committed swing reaches the live impact owner before recovery ends',
        trace.impacts.some(i => i.id === id && i.tick > action.tick && i.tick < recoveryEnd), true);
    }
    resolution = validateEarnedTankResolution(trace, ids, enemyImpact?.tick ?? 0, recoveryEnd, spec.opening === 'durable-opponent');
    for (const failure of resolution.failures) check(resolution.tick, failure, false, true);
    const hitTick = resolution.tick;
    check(hitTick, 'reserve starts no attack before the pair resolves the opening', trace.attacks.some(a => a.id === 'support_2' && a.tick <= hitTick), false);
    check(trace.ticks, 'paired commitment subsequently expires', trace.tankSamples.some(s => s.tick > hitTick &&
      s.assignments.filter(a => ids.includes(a.id)).every(a => !a.tanking?.doubleCommit)), true);
  }
  const end = trace.frames.at(-1)!;
  check(trace.ticks, 'kill credit conserved', end.actors.reduce((n, a) => n + a.kills, 0), trace.deaths.length);
  check(trace.ticks, 'death credit conserved', end.actors.reduce((n, a) => n + a.deaths, 0), trace.deaths.length);
  return { ...trace, resolution, name: `${spec.opening}/${trace.name}`, scenario: spec };
}

export const runEarnedTankContest = () => EARNED_TANK_CASES.map(spec => {
  const { frames, targetLookups, ...trace } = runEarnedTankTrace(spec);
  return { ...trace, frameCount: frames.length, targetLookupCount: targetLookups.length, finalFrame: frames.at(-1)! };
});

type EarnedTankWitness = Pick<ReturnType<typeof runEarnedTankTrace>, 'scenario' | 'ticks' | 'failureCount' | 'resolution'>;
export function earnedTankResolutionCoverage(traces: readonly EarnedTankWitness[]) {
  const key = (s: EarnedTankCase) => `${s.opening}/${s.team}/${s.reverse}/${s.main}`;
  const expected = new Set(EARNED_TANK_CASES.map(key)), errors: string[] = [];
  let completed = 0;
  for (const spec of EARNED_TANK_CASES) {
    const name = key(spec), found = traces.filter(t => key(t.scenario) === name);
    if (found.length !== 1) { errors.push(`${name}: required exactly once`); continue; }
    const t = found[0], wanted = spec.opening === 'opening' ? 'runner-interruption' : spec.opening === 'durable-opponent' ? 'paired-kill' : null;
    if (t.failureCount !== 0 || t.ticks !== 300 || (wanted ? !t.resolution || t.resolution.outcome !== wanted ||
      t.resolution.failures.length !== 0 || !Number.isInteger(t.resolution.tick) || t.resolution.tick <= 0 || t.resolution.tick > t.ticks : t.resolution !== null))
      errors.push(`${name}: missing successful declared resolution`);
    else completed++;
  }
  for (const t of traces) if (!expected.has(key(t.scenario))) errors.push(`${key(t.scenario)}: undeclared case`);
  return { required: expected.size, completed, errors };
}
