import type { Combatant } from '../../src/types';
import { validateDashDecisionTrace, dashDecisionCoverage } from './grifballDashDecisionValidation';
import { isDeepStrictEqual } from 'node:util';
import type { TrialResult } from '../../src/game/grifballValidation/runner';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { createAutonomousValidationRuntime, type AutonomousJumpObservation,
  type AutonomousTradeObservation, type AutonomousDashObservation } from './grifballAutonomousRuntime';

export interface IncomingLungeMobilityCase {
  seed: number; mirrored: boolean; reverse: boolean; dashReady: boolean;
}
export const INCOMING_LUNGE_MOBILITY_CASES: readonly IncomingLungeMobilityCase[] =
  Array.from({ length: 8 }, (_, i) => i + 1).flatMap(seed => [false, true].flatMap(mirrored =>
    [false, true].flatMap(reverse => [true, false].map(dashReady => ({ seed, mirrored, reverse, dashReady })))));
const caseName = (s: IncomingLungeMobilityCase) => `${s.seed}/${s.mirrored}/${s.reverse}/${s.dashReady}`;
type JumpRequest = AutonomousJumpObservation & { tick: number };
type Trade = AutonomousTradeObservation & { tick: number };
interface ActorFrame {
  id: string; hp: number; deaths: number; pos: number[]; vel: number[];
  team: Combatant['team']; kills: number; respawnTimer: number; shield: number;
  weapon: Combatant['activeWeapon']; phase: NonNullable<Combatant['weaponState']>; weaponTimer: number; jump: boolean; planned: boolean;
  budget: number; dash: number; lunge: boolean; role: string | null;
}
interface Frame {
  tick: number; phase: string; holder: string | null; actors: ActorFrame[];
  round: number; scores: { blue: number; red: number };
}
export interface IncomingLungeRecording {
  spec: IncomingLungeMobilityCase; error: string | null;
  completion: Pick<TrialResult, 'jobId' | 'termination' | 'check' | 'end'> | null;
  frames: Frame[]; requests: JumpRequest[]; trades: Trade[];
  dashSamples: (AutonomousDashObservation & { tick: number })[];
  dashSettings: { distance: number; duration: number; cooldown: number };
}

/** Authored opportunity, then complete production frame execution. Initial
 * ready/spent dash states are separate declared cases, not retries. The rest of
 * the roster starts dead; normal round resets may restore it. No later action,
 * movement, damage or tactical assignment is injected. */
export async function recordIncomingLungeMobility(spec: IncomingLungeMobilityCase): Promise<IncomingLungeRecording> {
  if (!INCOMING_LUNGE_MOBILITY_CASES.some(s => caseName(s) === caseName(spec))) throw new Error('Undeclared incoming-lunge case');
  const manifest = createSuiteManifest('quick');
  manifest.candidate.defaults.passingEnabled = false;
  manifest.cases = [{ id: 'incoming-sword-mobility', mode: 'match', scenario: null,
    mapId: 'championship_stadium', roster: 'scripted-4v4', difficulty: 'normal',
    seeds: [1, 2, 3, 4, 5, 6, 7, 8], opponents: ['balanced'], mirrored: true,
    fixedHz: 60, simulationSeconds: 60, watchdogSeconds: 120 }];
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  const fixture = structuredClone(plan.cases[0]);
  const job = plan.jobs.find(j => j.variant === 'candidate' && j.seed === spec.seed && j.mirrored === spec.mirrored)!;
  fixture.mechanics.maxHP = 3;
  fixture.roster.find(a => a.slot.team === 'blue')!.id = 'main_ai';
  for (const actor of fixture.roster) {
    const priority = actor.slot.team === 'red' ? 100 : 0;
    actor.slot.weaponPrioritization = actor.effectiveKnobs.weaponPrioritization = priority;
  }
  if (spec.reverse) fixture.roster.reverse();
  let tick = 0;
  const requests: JumpRequest[] = [], trades: Trade[] = [], frames: Frame[] = [];
  const dashSamples: IncomingLungeRecording['dashSamples'] = [];
  const host = createAutonomousValidationRuntime(fixture, job, undefined, {
    hammerJump: sample => requests.push({ tick, ...sample }),
    trade: sample => trades.push({ tick, ...sample }),
    dashUpdate: sample => dashSamples.push({ tick, ...sample }),
  });
  const state = host.state, main = state.otherPlayers.get('main_ai')!;
  const phase = () => state.grifball.phase;
  const carrier = state.otherPlayers.get('validation-blue-1')!, opponent = state.otherPlayers.get('validation-red-0')!;
  const sign = spec.mirrored ? -1 : 1;
  let error: string | null = null;
  let completion: IncomingLungeRecording['completion'] = null;
  try {
    for (const actor of state.otherPlayers.values()) {
      actor.invulnerabilityTimer = actor.aiTimer = actor.swapCooldownTimer = actor.swapLockoutTimer = 0;
      actor.weaponState = 'ready'; actor.weaponTimer = 0; actor.vel.set(0, 0, 0);
      if (![main, carrier, opponent].includes(actor)) { actor.hp = 0; actor.respawnTimer = 1000; }
    }
    main.pos.set(41 * sign, 0, -6.5 * sign);
    opponent.pos.set(45 * sign, 0, -1.5 * sign);
    carrier.pos.set(40 * sign, 0, -3 * sign);
    main.aiDashCooldownTimer = spec.dashReady ? 0 : state.settings.dashCooldown;
    main.activeWeapon = 'hammer'; opponent.activeWeapon = 'sword';
    state.grifball.phase = 'playing'; state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrier.id;
    setGrifballCarrierForState({ state, id: carrier.id, carrying: true });
    Object.assign(state.grifball.ball.pos, carrier.pos);
    for (tick = 1; tick <= 3600; tick++) {
      host.runtime.step();
      frames.push({ tick, phase: phase(), holder: state.grifball.ball.holderId,
        round: state.grifball.roundNumber, scores: { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals },
        actors: [main, carrier, opponent].map(a => ({ id: a.id, hp: a.hp, deaths: a.deaths ?? 0,
          team: a.team, kills: a.kills, respawnTimer: a.respawnTimer, shield: a.invulnerabilityTimer,
          pos: a.pos.toArray(), vel: a.vel.toArray(), weapon: a.activeWeapon, phase: a.weaponState ?? 'ready',
          weaponTimer: a.weaponTimer ?? 0, jump: !!a.isJumping, planned: !!a.hammerJumpPlanned,
          budget: a.aiHammerJumpsInAir ?? 0, dash: a.aiDashRemaining ?? 0, lunge: !!a.isLunging,
          role: state.aiMatchContext.grifballTeamPlan.assignments.get(a.id)?.role ?? null })) });
      if (phase() === 'matchEnd') break;
    }
    const result = await host.runtime.done;
    completion = { jobId: result.jobId, termination: result.termination, check: result.check, end: result.end };
  } catch (caught) { error = String(caught); }
  finally { host.runtime.dispose(); }
  return { spec: { ...spec }, error, completion, frames, requests, trades, dashSamples,
    dashSettings: { distance: state.settings.dashDistance, duration: state.settings.dashDuration, cooldown: state.settings.dashCooldown } };
}

/** Independent fixed-step ballistic oracle. Interrupted commitments remain
 * evidence but can never stand in for completed flights. */

/** Validate threat-free airborne dash updates for the two authored allies.
 * Incoming-threat steering and lunges use different movement branches and do
 * not supply witnesses for this independent ballistic/drift oracle. */
export function validateIncomingLungeDash(trace: IncomingLungeRecording) {
  const samples = trace.dashSamples.filter(sample =>
    ['main_ai', 'validation-blue-1'].includes(sample.id) && !sample.requested && sample.target !== null &&
    !sample.incomingThreat && sample.before.remaining > 0 &&
    (sample.before.pos[1] > 0 || sample.before.vel[1] !== 0) &&
    !sample.before.lunging && !sample.after.lunging && sample.before.hp > 0 && sample.after.hp > 0);
  if (samples.length) return validateDashDecisionTrace({ dashSamples: samples, dashSettings: trace.dashSettings });
  return { failureCount: 0, failures: [], starts: [], completions: [], cancellations: [],
    groundedSteps: 0, airborneDeferred: 0, airborneSteps: 0, airborneLandings: [] } as ReturnType<typeof validateDashDecisionTrace>;
}

export function validateIncomingLungeMobility(trace: IncomingLungeRecording) {
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  let failureCount = 0;
  const check = (valid: boolean, field: string, tick = 0) => {
    if (!valid) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual: false, expected: true }); }
  };
  check(Array.isArray(trace.dashSamples) && trace.dashSamples.length > 0, 'dash update observations are present');
  const seenDash = new Set<string>();
  let previousDashTick = 0;
  for (const sample of trace.dashSamples ?? []) {
    const key = sample.tick + '/' + sample.id;
    check(Number.isInteger(sample.tick) && sample.tick >= previousDashTick && sample.tick >= 1 &&
      sample.tick <= trace.frames.length && !seenDash.has(key), 'dash updates are ordered and unique', sample.tick);
    seenDash.add(key); previousDashTick = sample.tick;
  }
  const dash = trace.dashSamples?.length ? validateIncomingLungeDash(trace) : {
    failureCount: 0, failures: [], starts: [], completions: [], cancellations: [], groundedSteps: 0,
    airborneDeferred: 0, airborneSteps: 0, airborneLandings: [] } as ReturnType<typeof validateDashDecisionTrace>;
  for (const failure of dash.failures) check(false, failure.field, failure.tick);
  // Preserve uncapped failure totals if a recording exceeds retained diagnostics.
  failureCount += dash.failureCount - dash.failures.length;
  const actor = (tick: number) => trace.frames[tick - 1]?.actors.find(a => a.id === 'main_ai');
  const flights: { launch: number; landing: number; apex: number }[] = [];
  const rejections: { tick: number }[] = [], interruptions: { request: number; tick: number; kind: string }[] = [];
  check(trace.error === null, 'no runtime error');
  check(trace.frames.length > 0 && trace.frames.length <= 3600 &&
    (trace.frames.length === 3600 || trace.frames.at(-1)?.phase === 'matchEnd'), 'complete bounded recording');
  check(trace.frames.every((f, i) => f.tick === i + 1 && new Set(f.actors.map(a => a.id)).size === 3 &&
    f.actors.some(a => a.id === 'main_ai') && f.actors.every(a =>
      a.pos.length === 3 && a.vel.length === 3 && [...a.pos, ...a.vel, a.hp, a.budget, a.dash].every(Number.isFinite))),
  'contiguous finite actor recording');
  // Completion comes from the runtime, while scores and rounds are copied
  // independently from every frame. A cap remains a valid bounded recording,
  // but cannot supply a completed-match witness.
  const last = trace.frames.at(-1), completion = trace.completion;
  const ended = last?.phase === 'matchEnd';
  const validScores = (scores: Frame['scores'] | undefined) => !!scores &&
    [scores.blue, scores.red].every(n => Number.isInteger(n) && n >= 0 && n <= 2);
  let previousScores = { blue: 0, red: 0 }, previousRound = 1, previousPhase = 'playing';
  for (const frame of trace.frames) {
    const coherent = validScores(frame.scores) && Number.isInteger(frame.round) && frame.round >= 1;
    check(coherent, 'finite legal match scores and round', frame.tick);
    if (!coherent) continue;
    const blue = frame.scores.blue - previousScores.blue, red = frame.scores.red - previousScores.red;
    check((blue === 0 || blue === 1) && (red === 0 || red === 1) && blue + red <= 1,
      'at most one legal goal per frame', frame.tick);
    if (blue + red) check(previousPhase === 'playing' && frame.phase === 'scored' && frame.holder === null,
      'score increment is an observed goal transition', frame.tick);
    check(frame.round === previousRound + Number(previousPhase === 'scored' && frame.phase === 'countdown'),
      'round advances only on an observed reset', frame.tick);
    previousScores = frame.scores; previousRound = frame.round; previousPhase = frame.phase;
  }
  const suffix = '/' + trace.spec.seed + '/balanced/' + (trace.spec.mirrored ? 'mirrored' : 'original') + '/candidate';
  check(!!completion && completion.jobId.split('/')[0] === 'incoming-sword-mobility' &&
    /^[a-f0-9]{64}$/.test(completion.jobId.split('/')[1]) && completion.jobId.endsWith(suffix) &&
    completion.check.id === completion.jobId && completion.check.state === 'completed' &&
    isDeepStrictEqual(completion.check.evidence, ['trial:' + completion.jobId]), 'runtime completion belongs to this declared job');
  check(completion?.termination === (ended ? 'match-end' : 'simulation-cap') &&
    completion?.check.verdict === (ended ? 'pass' : 'inconclusive'), 'runtime termination and verdict match the recording');
  check(!!last && !!completion?.end && completion.end.tick === last.tick && completion.end.phase === last.phase &&
    completion.end.round === last.round && completion.end.holder === last.holder &&
    isDeepStrictEqual(completion.end.scores, last.scores), 'runtime end agrees with independently recorded match state');
  if (ended) check(!!last && validScores(last.scores) && Math.max(last.scores.blue, last.scores.red) === 2 &&
    Math.min(last.scores.blue, last.scores.red) < 2 && last.holder === null &&
    last.round === last.scores.blue + last.scores.red, 'completed match has a two-goal winner and released possession');
  let previousRequest = 0;
  const mainJumpRequests = trace.requests.filter(r => r.id === 'main_ai');
  for (const request of mainJumpRequests) {
    const startErrors = failureCount, at = actor(request.tick);
    check(Number.isInteger(request.tick) && request.tick > previousRequest && request.tick <= trace.frames.length,
      'ordered request within recording', request.tick);
    previousRequest = request.tick;
    check(!!at, 'request frame exists', request.tick);
    if (!at) continue;
    if (!request.accepted) {
      if (request.dash > 0) {
        check(!request.plannedBefore && !request.plannedAfter && !at.planned, 'dash rejection leaves no pending jump', request.tick);
        if (failureCount === startErrors) rejections.push({ tick: request.tick });
      }
      continue;
    }
    check(request.dash === 0 && request.swap === 0, 'accepted jump respects action lockouts', request.tick);
    check(!request.plannedBefore && request.plannedAfter, 'request creates fresh commitment', request.tick);
    // Default .28s windup plus .12s strike takes 25 updates including request.
    const launch = request.tick + 24;
    let interrupted = false;
    for (let tick = request.tick; tick <= launch; tick++) {
      const a = actor(tick), frame = trace.frames[tick - 1];
      check(!!a, 'commitment observed through resolution', tick);
      if (!a) { interrupted = true; break; }
      if (a.hp <= 0 || frame.phase !== 'playing') {
        interruptions.push({ request: request.tick, tick, kind: a.hp <= 0 ? 'death-before-launch' : 'round-before-launch' });
        interrupted = true; break;
      }
      const trade = trace.trades.find(t => t.tick === tick && t.targetId === 'main_ai' && t.before?.planned);
      if (trade) {
        const { before, after } = trade;
        check(!!after, 'trade includes completed target observation', tick);
        if (before && after) {
          check(!after.planned && after.jumpType === undefined, 'consumed trade clears queued jump and type', tick);
          check(after.hp === before.hp - 1, 'trade consumes one health point', tick);
          check(after.vy === before.vy && after.budget === before.budget, 'trade cannot launch cancelled jump', tick);
          if (after.hp > 0) check(after.phase === 'recovering', 'surviving traded hammer enters recovery', tick);
        }
        interruptions.push({ request: request.tick, tick, kind: 'trade-before-launch' });
        interrupted = true; break;
      }
      if (tick < launch) check(a.planned, 'commitment retained until impact or observed cancellation', tick);
    }
    if (interrupted) continue;
    const start = actor(launch)!;
    check(!start.planned && start.budget === 1 && start.jump && Math.abs(start.vel[1] - 13.7) < 1e-9,
      'full commitment produces configured launch', launch);
    let y = start.pos[1], vy = 13.7, landing = 0, apex = y;
    for (let tick = launch + 1; tick <= Math.min(trace.frames.length, launch + 120); tick++) {
      const a = actor(tick), frame = trace.frames[tick - 1];
      check(!!a, 'flight actor remains observed', tick);
      if (!a) { interrupted = true; break; }
      if (a.hp <= 0 || frame.phase !== 'playing' || a.deaths !== start.deaths) {
        interruptions.push({ request: request.tick, tick, kind: a.hp <= 0 || a.deaths !== start.deaths ? 'death-in-flight' : 'round-in-flight' });
        interrupted = true; break;
      }
      vy -= 18 / 60; y += vy / 60; apex = Math.max(apex, y);
      check(Math.abs(a.pos[1] - Math.max(0, y)) < 1e-8, 'single vertical integration', tick);
      check(Math.abs(a.vel[1] - (y <= 0 ? 0 : vy)) < 1e-8, 'vertical velocity follows gravity', tick);
      check(!a.planned, 'jump plan remains consumed', tick);
      if (y <= 0) { landing = tick; check(!a.jump && a.budget === 0, 'landing resets airborne state and budget', tick); break; }
      check(a.jump && a.budget === 1, 'airborne state and budget', tick);
    }
    if (interrupted) continue;
    check(landing > 0, 'complete landing within two seconds', launch);
    if (landing) {
      const landed = actor(landing)!;
      check(!!landed.role, 'landing retains tactical assignment', landing);
      check(trace.frames.slice(landing, landing + 30).some(f => {
        const a = f.actors.find(a => a.id === 'main_ai');
        return !!a && a.hp > 0 && f.phase === 'playing' && Math.hypot(a.pos[0] - landed.pos[0], a.pos[2] - landed.pos[2]) > .5;
      }), 'resumed movement after landing', landing);
      if (failureCount === startErrors) flights.push({ launch, landing, apex });
    }
  }
  return { ...trace, name: `incoming-lunge/${caseName(trace.spec)}`, ticks: trace.frames.length,
    boundary: 'live-incoming-lunge-mobility' as const,
    scenario: { ...trace.spec, team: trace.spec.mirrored ? 'red' as const : 'blue' as const, main: true },
    failureCount, failures, completedMatch: failureCount === 0 && ended, mainJumpRequests, flights, rejections, interruptions, dash };
}

export type IncomingLungeMobilityTrace = ReturnType<typeof validateIncomingLungeMobility>;
export async function runIncomingLungeMobilityTrace(spec: IncomingLungeMobilityCase) {
  return validateIncomingLungeMobility(await recordIncomingLungeMobility(spec));
}
export function incomingLungeMobilityCoverage(traces: readonly IncomingLungeMobilityTrace[]) {
  const errors: string[] = [], expected = new Set(INCOMING_LUNGE_MOBILITY_CASES.map(caseName));
  const verified = new Set<IncomingLungeMobilityTrace>();
  for (const trace of traces) {
    const declared = INCOMING_LUNGE_MOBILITY_CASES.find(s => caseName(s) === caseName(trace.spec));
    const recomputed = validateIncomingLungeMobility(trace);
    if (!declared || !isDeepStrictEqual(declared, trace.spec) || recomputed.failureCount || trace.failureCount ||
      trace.error !== null || trace.name !== recomputed.name || trace.ticks !== recomputed.ticks ||
      trace.boundary !== recomputed.boundary || !isDeepStrictEqual(trace.scenario, recomputed.scenario) ||
      !isDeepStrictEqual(trace.flights, recomputed.flights) || !isDeepStrictEqual(trace.rejections, recomputed.rejections) ||
      !isDeepStrictEqual(trace.mainJumpRequests, recomputed.mainJumpRequests) ||
      !isDeepStrictEqual(trace.interruptions, recomputed.interruptions) || trace.completedMatch !== recomputed.completedMatch ||
      !isDeepStrictEqual(trace.dash, recomputed.dash)) errors.push(`${trace.name}: invalid retained evidence`);
    else verified.add(trace);
  }
  for (const name of expected) {
    const matching = traces.filter(t => caseName(t.spec) === name);
    if (matching.length !== 1) errors.push(`${name}: required exactly once`);
    else if (!verified.has(matching[0])) errors.push(`${name}: failed recording`);
  }
  for (const trace of traces) if (!expected.has(caseName(trace.spec))) errors.push(`${trace.name}: undeclared case`);
  for (const mirrored of [false, true]) for (const reverse of [false, true]) {
    const eligible = traces.filter(t => verified.has(t) && t.spec.mirrored === mirrored && t.spec.reverse === reverse);
    if (!eligible.some(t => t.flights.length)) errors.push(`${mirrored}/${reverse}: missing complete flight`);
    if (!eligible.some(t => t.rejections.length)) errors.push(`${mirrored}/${reverse}: missing dash rejection`);
  }
  const dashCoverage = dashDecisionCoverage(traces.filter(t => verified.has(t)));
  for (const group of dashCoverage.missing.filter(group => group.endsWith('/airborne-landing')))
    errors.push(group + ': missing incoming-sword dash landing');
  return { required: expected.size, completed: verified.size, errors };
}

/** Recheck full raw observations before accepting complete-match opportunities.
 * Physical failures, runtime failures and capped recordings cannot contribute. */
export function incomingLungeCompletedMatchWitnesses(traces: readonly IncomingLungeMobilityTrace[]) {
  return traces.flatMap(trace => {
    const verified = validateIncomingLungeMobility(trace);
    return !trace.failureCount && verified.completedMatch ? [verified] : [];
  });
}
