import { isDeepStrictEqual } from 'node:util';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import type { FrozenCase, ValidationCase, ValidationJob } from '../../src/game/grifballValidation/types';
import { createComposedValidationMatch, createComposedMatchStepper, type ComposedMatchCheckpoint } from './grifballComposedMatch';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { createParityFrameRecorder } from './grifballParityEvidence';
import { observeSimTacticalWeaponTarget } from '../../src/sim/grifballTacticalWeaponChoice';

type Variant = Pick<ValidationCase, 'mapId' | 'roster' | 'difficulty'> & { mirrored: boolean };
const variants = [
  { mapId: 'championship_stadium', roster: 'scripted-4v4', difficulty: 'normal' },
  { mapId: 'forerunner_canyon', roster: 'scripted-4v4', difficulty: 'normal' },
  { mapId: 'forerunner_canyon', roster: 'scripted-4v4', difficulty: 'hard' },
  { mapId: 'forerunner_canyon', roster: 'local-4v4', difficulty: 'normal' },
] satisfies Omit<Variant, 'mirrored'>[];
export const COMPLETE_MATCH_CASES: readonly Variant[] = variants.flatMap(variant =>
  [false, true].map(mirrored => ({ ...variant, mirrored })));
export const completeMatchKey = (v: Variant) => `${v.mapId}/${v.roster}/${v.difficulty}/${v.mirrored}`;

/** Development integration inputs. This separate horizon never reclassifies
 * standard pilot caps or claims held-out quality evidence. */
export async function completeMatchInputs(variant: Variant) {
  const manifest = createSuiteManifest('standard');
  manifest.cases = [{ ...manifest.cases.find(c => c.mode === 'match')!, ...variant,
    id: `complete-${variant.mapId}-${variant.roster}-${variant.difficulty}`.replaceAll('_', '-'), seeds: [101],
    simulationSeconds: 900, watchdogSeconds: 1800 }];
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  return { fixture: plan.cases[0], job: plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === variant.mirrored)! };
}

const point = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });
type Host = ReturnType<typeof createAutonomousValidationRuntime>;
/** Observable physical state; internal engine-specific AI/animation storage is
 * not copied between hosts. Angles use vectors to avoid equivalent 2pi wraps. */
export function completeMatchFrame(host: Host, checkpoint: ComposedMatchCheckpoint,
  credits: Readonly<Record<string, { kills: number; deaths: number }>> = {}) {
  const live = host.state, sim = checkpoint.state;
  const pose = (pos: Parameters<typeof point>[0], vel: Parameters<typeof point>[0], yaw: number) =>
    ({ pos: point(pos), vel: point(vel), facing: { x: Math.sin(yaw), z: Math.cos(yaw) } });
  const actors = [...live.otherPlayers.values()];
  const liveActors = actors.map(c => ({ id: c.id, ...pose(c.pos, c.vel, c.yaw - Math.PI), team: c.team,
    hp: c.hp, maxHp: c.maxHp, alive: c.hp > 0, weapon: c.activeWeapon as string, crouching: !!c.isCrouching,
    weaponPhase: c.weaponState || 'ready', weaponElapsed: c.weaponState === 'ready' || !c.weaponState || c.isLunging ? 0 : c.weaponTimer ?? 0,
    kills: c.kills ?? 0, deaths: c.deaths ?? 0,
    lunging: !!c.isLunging, respawn: Math.max(0, c.respawnTimer ?? 0), shield: c.invulnerabilityTimer ?? 0,
    sway: c.aiSwayTimer ?? 0 }));
  if (!sim.localPlayerIsObserver) liveActors.unshift({ id: 'player', ...pose(live.playerPos, live.playerVel, live.yaw - Math.PI),
    team: live.localPlayerTeam, hp: live.playerHP, maxHp: live.playerMaxHP, alive: live.playerHP > 0,
    weapon: live.activeWeapon, crouching: live.isCrouching, lunging: live.isLunging,
    weaponPhase: live.activeWeapon === 'sword' ? live.pSwordState : live.pWeaponState,
    weaponElapsed: live.isLunging || (live.activeWeapon === 'sword' ? live.pSwordState : live.pWeaponState) === 'ready'
      ? 0 : live.activeWeapon === 'sword' ? live.pSwordTimer : live.pWeaponTimer,
    kills: live.scorePlayer, deaths: live.playerDeaths,
    // Live local revival can retain a negative expired timer; effective delay is zero.
    respawn: Math.max(0, live.playerRespawnTimer), shield: live.playerInvulnerabilityTimer, sway: 0 });
  const simActors = liveActors.map(a => {
    const c = sim.combatants.find(c => c.id === a.id)!;
    return { id: c.id, ...pose(c.pos, c.vel, c.yaw), team: c.team, hp: c.hp, maxHp: c.maxHp, alive: c.alive,
      weapon: c.weapon, crouching: c.isCrouching, lunging: c.isLunging, respawn: Math.max(0, c.respawnTimer),
      weaponPhase: observeSimTacticalWeaponTarget(sim, c).weaponState,
      weaponElapsed: c.weaponState === 'idle' || c.isLunging ? 0 : c.weaponPhaseElapsed ?? 0,
      kills: credits[c.id]?.kills ?? 0, deaths: credits[c.id]?.deaths ?? 0,
      shield: c.invulnerabilityTimer, sway: checkpoint.memories[c.id]?.swayTimer ?? 0 };
  });
  const match = (m: typeof sim.match, scores: typeof sim.scores) => ({ phase: m.phase, phaseTimer: m.phaseTimer,
    round: m.roundNumber, winner: m.winningTeam, lastScoringTeam: m.lastScoringTeam,
    ball: { state: m.ball.state, holderId: m.ball.holderId, pos: point(m.ball.pos), vel: point(m.ball.vel), looseTimer: m.ball.looseTimer },
    // Live kills/deaths belong to combatants; its team ledger only owns goals.
    scores: { blue: scores.blue.goals, red: scores.red.goals } });
  return { tick: sim.tick, live: { ...match(live.grifball, live.teamScores), actors: liveActors },
    headless: { ...match(sim.match, sim.scores), actors: simActors } };
}

export interface CompleteMatchDifference { tick: number; field: string; live: unknown; headless: unknown }
export function compareCompleteMatchFrame(frame: ReturnType<typeof completeMatchFrame>): CompleteMatchDifference[] {
  const differences: CompleteMatchDifference[] = [];
  const visit = (a: unknown, b: unknown, field: string) => {
    if (differences.length >= 64) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${field}.${key}`);
    } else if (typeof a === 'number' && typeof b === 'number'
      ? !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) >
        (/\.(pos|vel|facing)\.|\.(phaseTimer|respawn|shield|sway|looseTimer|weaponElapsed)$/.test(field) ? 1e-6
          : /\.(hp|maxHp)$/.test(field) ? 1e-9 : 0) : a !== b)
      differences.push({ tick: frame.tick, field, live: a, headless: b });
  };
  visit(frame.live, frame.headless, 'frame');
  return differences;
}

export async function runCompleteMatchTrace(fixture: FrozenCase, job: ValidationJob) {
  const host = createAutonomousValidationRuntime(fixture, job);
  const { checkpoint } = createComposedValidationMatch(fixture, job), state = checkpoint.state;
  const step = createComposedMatchStepper(fixture, job, checkpoint), recorder = createParityFrameRecorder();
  const differences: CompleteMatchDifference[] = [];
  const credits: Record<string, { kills: number; deaths: number }> =
    Object.fromEntries(state.combatants.map(c => [c.id, { kills: 0, deaths: 0 }]));
  const continuations: { reason: string; startTick: number; verifiedTicks: number }[] = [];
  const replays: { checkpoint: ComposedMatchCheckpoint; step: ReturnType<typeof createComposedMatchStepper>;
    record: typeof continuations[number] }[] = [];
  const restore = (reason: string) => {
    const restored = structuredClone(checkpoint), record = { reason, startTick: state.tick, verifiedTicks: 0 };
    continuations.push(record); replays.push({ checkpoint: restored, step: createComposedMatchStepper(fixture, job, restored), record });
  };
  let kills = 0, revivals = 0, goals = 0, resets = 0;
  let result: Awaited<typeof host.runtime.done> | null = null;
  try {
    restore('initial');
    // Sway defaults initialize at the first production tick, not construction.
    const initial = completeMatchFrame(host, checkpoint);
    differences.push(...compareCompleteMatchFrame(initial)); recorder.add(initial);
    while (!differences.length && state.tick < job.simulationTicks && state.match.phase !== 'matchEnd') {
      const dead = new Set(state.combatants.filter(c => !c.alive).map(c => c.id));
      const event = step()!; host.runtime.step();
      for (const kill of event.kills) { credits[kill.attackerId].kills++; credits[kill.victimId].deaths++; }
      kills += event.kills.length; goals += Number(!!event.goal); resets += Number(event.roundReset);
      revivals += state.combatants.filter(c => c.alive && dead.has(c.id)).length;
      for (const replay of replays) if (replay.record.verifiedTicks < 30) {
        if (!isDeepStrictEqual(replay.step(), event) || !isDeepStrictEqual(replay.checkpoint, checkpoint))
          differences.push({ tick: state.tick, field: `checkpoint.${replay.record.reason}`, live: 'uninterrupted', headless: 'different' });
        else replay.record.verifiedTicks++;
      }
      const frame = completeMatchFrame(host, checkpoint, credits);
      differences.push(...compareCompleteMatchFrame(frame)); recorder.add(frame);
      if (differences.length) break;
      if (state.tick === 180) restore('countdown');
      if (event.kills.length && kills === event.kills.length) restore('first-kill');
      if (event.roundReset) restore(`round-reset-${resets}`);
    }
    if (!differences.length) result = await host.runtime.done;
    return { protocol: 'autonomous-complete-match-v1' as const,
      name: completeMatchKey({ ...fixture.specification, mirrored: job.mirrored }),
      input: { fixture, job }, ticks: state.tick, kills, revivals, goals, resets, continuations,
      termination: result?.termination ?? 'divergence', verdict: result?.check.verdict ?? 'fail', runtimeCheck: result?.check ?? null,
      endTick: result?.end?.tick ?? null, phase: state.match.phase, differenceCount: differences.length, differences,
      ...recorder.finish() };
  } finally { host.runtime.dispose(); }
}

export type CompleteMatchTrace = Awaited<ReturnType<typeof runCompleteMatchTrace>>;
export function completeMatchCoverage(traces: readonly CompleteMatchTrace[]) {
  const errors: string[] = [], expected = new Set(COMPLETE_MATCH_CASES.map(completeMatchKey)), seen = new Set<string>();
  for (const trace of traces) {
    const name = trace.name;
    if (!expected.has(name) || seen.has(name)) errors.push(`${name}: foreign or duplicate case`);
    seen.add(name);
    const { fixture, job } = trace.input;
    if (name !== completeMatchKey({ ...fixture.specification, mirrored: job.mirrored }) || job.seed !== 101 ||
      job.variant !== 'candidate' || job.simulationTicks !== 54000 || job.inputHash !== fixture.inputHash ||
      fixture.mechanics.grifballGoalTarget !== 2 || fixture.specification.simulationSeconds !== 900)
      errors.push(`${name}: incompatible frozen inputs`);
    if (trace.protocol !== 'autonomous-complete-match-v1' || trace.termination !== 'match-end' || trace.verdict !== 'pass' ||
      trace.runtimeCheck?.id !== job.id || trace.runtimeCheck.state !== 'completed' || trace.runtimeCheck.verdict !== 'pass' ||
      trace.phase !== 'matchEnd' || trace.endTick !== trace.ticks || trace.ticks <= 180 || trace.ticks > job.simulationTicks ||
      trace.frameCount !== trace.ticks + 1 || trace.differenceCount !== 0 || trace.differences.length)
      errors.push(`${name}: incomplete or divergent match`);
    const first = trace.frames[0] as { tick?: number } | undefined, last = trace.frames.at(-1) as { tick?: number } | undefined;
    if (first?.tick !== 0 || last?.tick !== trace.ticks || trace.frames.length > 32 ||
      trace.frameEvidence.kind !== 'sampled-frames-v1' || trace.frameEvidence.retainedCount !== trace.frames.length ||
      !/^[a-f0-9]{64}$/.test(trace.frameEvidence.fullTraceSHA256)) errors.push(`${name}: incomplete retained evidence`);
    if (trace.goals < 2 || trace.resets < 1 || trace.kills < 1 || trace.revivals < 1)
      errors.push(`${name}: missing lifecycle coverage`);
    if (![trace.ticks, trace.frameCount, trace.goals, trace.resets, trace.kills, trace.revivals].every(n => Number.isSafeInteger(n) && n >= 0) ||
      trace.continuations.some(c => !Number.isSafeInteger(c.startTick) || c.startTick < 0 || c.startTick + c.verifiedTicks > trace.ticks))
      errors.push(`${name}: invalid counters or checkpoint interval`);
    for (const reason of ['initial', 'countdown', 'first-kill', ...Array.from({ length: trace.resets }, (_, i) => `round-reset-${i + 1}`)])
      if (trace.continuations.filter(c => c.reason === reason && c.verifiedTicks === 30).length !== 1)
        errors.push(`${name}: incomplete checkpoint ${reason}`);
  }
  for (const name of expected) if (!seen.has(name)) errors.push(`${name}: missing case`);
  return { required: expected.size, completed: traces.filter(t => t.termination === 'match-end' && t.differenceCount === 0).length, errors };
}

export async function runCompleteMatchParity() {
  const traces: CompleteMatchTrace[] = [];
  for (const variant of COMPLETE_MATCH_CASES) {
    const { fixture, job } = await completeMatchInputs(variant);
    traces.push(await runCompleteMatchTrace(fixture, job));
  }
  return { traces, coverage: completeMatchCoverage(traces) };
}
