import { isDeepStrictEqual } from 'node:util';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { createComposedValidationMatch, createComposedMatchStepper } from './grifballComposedMatch';
import { completeMatchFrame, compareCompleteMatchFrame } from './grifballCompleteMatchParity';
import { createParityFrameRecorder } from './grifballParityEvidence';

export type AutonomousMobilityCase = {
  profile: 'loose' | 'loose-opposed' | 'runner-rise' | 'runner-fall' | 'local-rise' | 'local-fall' |
    'opposed-rise' | 'opposed-fall' | 'local-opposed-rise' | 'local-opposed-fall';
  mirrored: boolean; reversed: boolean; seed: number;
};
export const AUTONOMOUS_MOBILITY_CASES: readonly AutonomousMobilityCase[] =
  (['loose', 'runner-rise', 'runner-fall', 'local-rise', 'local-fall',
    'opposed-rise', 'opposed-fall', 'local-opposed-rise', 'local-opposed-fall', 'loose-opposed'] as const).flatMap(profile =>
    [false, true].flatMap(mirrored => [false, true].flatMap(reversed =>
      [101, 102].map(seed => ({ profile, mirrored, reversed, seed })))));
const nameOf = (s: AutonomousMobilityCase) => `${s.profile}/${s.mirrored}/${s.reversed}/${s.seed}`;
export const AUTONOMOUS_MOBILITY_PAIRS = [
  ['loose', 'loose-opposed'], ['runner-rise', 'opposed-rise'], ['runner-fall', 'opposed-fall'],
  ['local-rise', 'local-opposed-rise'], ['local-fall', 'local-opposed-fall'],
] as const;

/** Authored encounter starts, followed exclusively by own-state autonomous
 * decisions (and the standard local-input policy). No live action or position
 * is injected into the simulator. This is bounded execution, not match quality. */
export async function runAutonomousMobilityTrace(spec: AutonomousMobilityCase) {
  const local = spec.profile.startsWith('local'), manifest = createSuiteManifest('quick');
  manifest.cases = [{ id: 'autonomous-mobility', mode: 'match', scenario: null,
    mapId: 'championship_stadium', roster: local ? 'local-4v4' : 'scripted-4v4', difficulty: 'nightmare',
    seeds: [spec.seed], opponents: ['balanced'], mirrored: true, fixedHz: 60,
    simulationSeconds: 30, watchdogSeconds: 120 }];
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  const fixture = plan.cases[0], job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === spec.mirrored)!;
  const host = createAutonomousValidationRuntime(fixture, job), { checkpoint } = createComposedValidationMatch(fixture, job);
  const state = checkpoint.state, step = createComposedMatchStepper(fixture, job, checkpoint);
  const recorder = createParityFrameRecorder(), differences: ReturnType<typeof compareCompleteMatchFrame> = [];
  const credits = Object.fromEntries(state.combatants.map(a => [a.id, { kills: 0, deaths: 0 }]));
  const witnesses: { tick: number; actor: string; kind: string; carrier: string | null; airborneCarrier: boolean }[] = [];
  let restoredFrames = 0;
  try {
    // Finish normal initialization before arranging the explicitly recorded start.
    for (let i = 0; i < 182; i++) { step(); host.runtime.step(); }
    if (state.match.phase !== 'playing' || host.state.grifball.phase !== 'playing')
      throw new Error('Mobility start must follow the production countdown transition');
    const sign = spec.mirrored ? -1 : 1;
    const initial = fixture.roster.map(a => a.id);
    const carrierId = local ? 'player' : initial[spec.reversed ? 1 : 0];
    const actorIds = [...(local ? ['player'] : []), ...initial];
    const counters: Record<string, number> = {};
    const opposed = spec.profile.includes('opposed');
    const starts = actorIds.map(id => {
      const actor = state.combatants.find(a => a.id === id)!;
      const side = actor.team === job.focalTeam ? -1 : 1, index = counters[actor.team] ?? 0;
      counters[actor.team] = index + 1;
      const carrier = !spec.profile.startsWith('loose') && id === carrierId;
      const airborneOpponent = opposed && side === 1;
      return { id, pos: { x: side * (spec.profile.startsWith('loose') ? 7 : 3) * sign,
        y: carrier ? 2 : airborneOpponent ? 1.5 : 0, z: (index - 1.5) * 4 * sign },
        vel: { x: carrier ? 3 * sign : 0,
          y: carrier ? (spec.profile.endsWith('rise') ? 6 : -4) : airborneOpponent ? 4 : 0, z: 0 },
        yaw: -side * sign * Math.PI / 2, weapon: airborneOpponent ? 'sword' as const : 'hammer' as const };
    });
    for (const start of starts) {
      const actor = state.combatants.find(a => a.id === start.id)!;
      Object.assign(actor, { pos: { ...start.pos }, vel: { ...start.vel }, yaw: start.yaw, weapon: start.weapon,
        isJumping: start.pos.y > 0, grounded: start.pos.y === 0,
        invulnerabilityTimer: 0, weaponReadyTimer: 0, swapLockoutTimer: 0 });
      if (start.id === 'player') {
        host.state.playerPos.set(start.pos.x, start.pos.y, start.pos.z);
        host.state.playerVel.set(start.vel.x, start.vel.y, start.vel.z);
        host.state.yaw = start.yaw + Math.PI; host.state.playerInvulnerabilityTimer = 0;
        host.state.isJumping = start.pos.y > 0;
      } else {
        const live = host.state.otherPlayers.get(start.id)!;
        live.pos.set(start.pos.x, start.pos.y, start.pos.z); live.vel.set(start.vel.x, start.vel.y, start.vel.z);
        live.yaw = start.yaw + Math.PI;
        live.activeWeapon = start.weapon;
        live.isJumping = start.pos.y > 0;
        live.invulnerabilityTimer = live.swapLockoutTimer = 0;
      }
    }
    if (!spec.profile.startsWith('loose')) {
      const carrier = state.combatants.find(a => a.id === carrierId)!;
      setSimCarrier(carrier, true, state.settings, state);
      setGrifballCarrierForState({ state: host.state, id: carrierId, carrying: true });
      for (const ball of [state.match.ball, host.state.grifball.ball]) {
        ball.state = 'held'; ball.holderId = carrierId; Object.assign(ball.pos, carrier.pos);
      }
    }
    // The opposed profiles begin during an already committed sword flight.
    // Subsequent steering, carrier reactions, targeting and recovery are owned
    // by each runtime. Initial flights never count as autonomous launch witnesses.
    if (opposed) {
      const target = starts.find(s => s.id === carrierId)!;
      for (const start of starts.filter(s => s.weapon === 'sword')) {
        const dx = target.pos.x - start.pos.x, dy = target.pos.y - start.pos.y, dz = target.pos.z - start.pos.z;
        const length = Math.hypot(dx, dy, dz), direction = { x: dx / length, y: dy / length, z: dz / length };
        const actor = state.combatants.find(a => a.id === start.id)!, live = host.state.otherPlayers.get(start.id)!;
        Object.assign(actor, { isLunging: true, lungeTimer: 0, lungeStartPos: { ...start.pos },
          lungeDir: { ...direction }, lungeAimDirection: { ...direction }, lungeTargetId: carrierId });
        Object.assign(live, { isLunging: true, lungeTimer: 0, lungeStartPos: { ...start.pos }, lungeTargetDir: { ...direction } });
      }
    }
    if (spec.reversed) {
      host.state.otherPlayers = new Map([...host.state.otherPlayers].reverse());
      state.combatants = [state.combatants[0], ...state.combatants.slice(1).reverse()];
    }
    let restored = structuredClone(checkpoint), replay = createComposedMatchStepper(fixture, job, restored);
    for (let tick = 0; tick <= 900; tick++) {
      const frame = completeMatchFrame(host, checkpoint, credits);
      const mobility = frame.live.actors.map(a => {
        const live = host.state.otherPlayers.get(a.id), sim = state.combatants.find(c => c.id === a.id)!;
        const left = live ? { dash: live.aiDashRemaining ?? 0, cooldown: live.aiDashCooldownTimer ?? 0,
          slide: !!live.aiSlideActive, jumping: !!live.isJumping }
          : { dash: host.state.playerDashRemaining, cooldown: host.state.playerDashCooldownTimer,
            slide: host.state.playerSlideActive, jumping: host.state.isJumping };
        const right = { dash: sim.dashRemaining, cooldown: sim.dashCooldownTimer, slide: sim.slideActive, jumping: sim.isJumping };
        for (const key of ['dash', 'cooldown', 'slide', 'jumping'] as const) {
          const x = left[key], y = right[key];
          if (typeof x === 'number' && typeof y === 'number' ? !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 1e-6 : x !== y)
            differences.push({ tick: state.tick, field: `${a.id}.mobility.${key}`, live: x, headless: y });
        }
        return { id: a.id, live: left, headless: right };
      });
      differences.push(...compareCompleteMatchFrame(frame)); recorder.add({ ...frame, mobility });
      if (differences.length || tick === 900) break;
      const before = new Map(state.combatants.map(a => [a.id, structuredClone(a)]));
      const event = step()!; host.runtime.step();
      for (const kill of event.kills) { credits[kill.attackerId].kills++; credits[kill.victimId].deaths++; }
      if (!isDeepStrictEqual(replay(), event) || !isDeepStrictEqual(restored, checkpoint))
        differences.push({ tick: state.tick, field: 'checkpoint', live: 'uninterrupted', headless: 'different' });
      else restoredFrames++;
      const held = state.combatants.find(a => a.id === state.match.ball.holderId);
      const priorHolder = before.get(state.match.ball.holderId ?? '');
      const airborneCarrier = !!held && held.alive && held.pos.y > .01;
      for (const actor of state.combatants) {
        const prior = before.get(actor.id)!;
        const add = (kind: string) => witnesses.push({ tick: state.tick, actor: actor.id, kind, carrier: state.match.ball.holderId, airborneCarrier });
        if (held === actor && airborneCarrier) {
          if (actor.vel.y > 0) add('carrier-rising');
          if (actor.vel.y < 0) add('carrier-falling');
          if (Math.hypot(actor.pos.x - prior.pos.x, actor.pos.z - prior.pos.z) > .001) add('carrier-moving-airborne');
        }
        if (actor.team !== held?.team && actor.isLunging && actor.lungeTargetId === held?.id && airborneCarrier) {
          add('flight-at-airborne-carrier');
          if (actor.pos.y > .01) add('opposed-flight-at-carrier');
        }
        if (actor.hp < prior.hp && (actor === held && airborneCarrier || actor.id === priorHolder?.id && prior.pos.y > .01)) add('airborne-carrier-damage');
        if (actor.dashRemaining > 0 && prior.dashRemaining <= 0) add('dash');
        if (actor.isLunging && !prior.isLunging) add('lunge');
        if (actor.vel.y > 1 && prior.vel.y <= 0 && actor.alive) add('jump');
        if (actor.pos.y <= .001 && prior.pos.y > .001 && actor.alive) add('landing');
        if (actor.hp < prior.hp) add('damage');
        if (!actor.isLunging && actor.alive && Math.hypot(actor.vel.x, actor.vel.z) > 1 &&
          Math.hypot(prior.vel.x, prior.vel.z) > 1 && Math.abs(actor.vel.x * prior.vel.z - actor.vel.z * prior.vel.x) > 1) add('steering');
      }
      if (tick === 30 || tick === 180) { restored = structuredClone(checkpoint); replay = createComposedMatchStepper(fixture, job, restored); }
    }
    return { protocol: 'autonomous-mobility-v1' as const, name: nameOf(spec), spec, starts,
      authoredFlights: opposed ? starts.filter(s => s.weapon === 'sword').map(s => s.id) : [],
      startTick: 182, endTick: state.tick,
      input: { fixture, job }, differences, differenceCount: differences.length, restoredFrames, witnesses, ...recorder.finish() };
  } finally { host.runtime.dispose(); }
}

export type AutonomousMobilityTrace = Awaited<ReturnType<typeof runAutonomousMobilityTrace>>;
export function autonomousMobilityCoverage(traces: readonly AutonomousMobilityTrace[]) {
  const expected = new Map(AUTONOMOUS_MOBILITY_CASES.map(s => [nameOf(s), s] as const));
  const seen = new Set<string>(), errors: string[] = [];
  for (const trace of traces) {
    const spec = expected.get(trace.name);
    if (!spec || !isDeepStrictEqual(trace.spec, spec) || seen.has(trace.name)) errors.push(`${trace.name}: foreign or duplicate case`);
    seen.add(trace.name);
    const { fixture, job } = trace.input;
    if (fixture.specification.mapId !== 'championship_stadium' || fixture.specification.difficulty !== 'nightmare' ||
      fixture.specification.roster !== (trace.spec.profile.startsWith('local') ? 'local-4v4' : 'scripted-4v4') ||
      !isDeepStrictEqual(fixture.specification.seeds, [trace.spec.seed]) || job.seed !== trace.spec.seed ||
      job.mirrored !== trace.spec.mirrored || job.variant !== 'candidate' || job.opponent !== 'balanced' ||
      job.simulationTicks !== 1800 || job.inputHash !== fixture.inputHash)
      errors.push(`${trace.name}: incompatible encounter inputs`);
    if (trace.protocol !== 'autonomous-mobility-v1' || trace.differenceCount !== 0 || trace.differences.length ||
      trace.startTick !== 182 || trace.endTick !== 1082 || trace.frameCount !== 901 || trace.restoredFrames !== 900 ||
      (trace.frames[0] as { tick: number })?.tick !== 182 || (trace.frames.at(-1) as { tick: number })?.tick !== 1082 ||
      trace.frameEvidence.kind !== 'sampled-frames-v1' || trace.frameEvidence.retainedCount !== trace.frames.length ||
      trace.frames.length > 32 || !/^[a-f0-9]{64}$/.test(trace.frameEvidence.fullTraceSHA256))
      errors.push(`${trace.name}: incomplete or divergent encounter`);
    const has = (kind: string) => trace.witnesses.some(w => w.kind === kind);
    // Quiet encounters can resolve through grounded combat. Their matched sword
    // threats must demonstrate jump responses; every original frame still agrees.
    for (const kind of ['dash', 'steering', 'damage',
      ...(!trace.spec.profile.startsWith('loose') || trace.spec.profile.includes('opposed') ? ['landing'] : []),
      ...(trace.spec.profile.includes('opposed') ? ['jump'] : [])])
      if (!has(kind)) errors.push(`${trace.name}: missing ${kind}`);
    if (!trace.spec.profile.startsWith('loose')) for (const kind of [trace.spec.profile.endsWith('rise') ? 'carrier-rising' : 'carrier-falling', 'carrier-moving-airborne'])
      if (!has(kind)) errors.push(`${trace.name}: missing ${kind}`);
    if (trace.spec.profile.includes('opposed') && !trace.spec.profile.startsWith('loose')) for (const kind of ['opposed-flight-at-carrier', 'airborne-carrier-damage'])
      if (!has(kind)) errors.push(`${trace.name}: missing ${kind}`);
    if (trace.witnesses.some(w => !Number.isSafeInteger(w.tick) || w.tick <= trace.startTick || w.tick > trace.endTick ||
      !trace.starts.some(a => a.id === w.actor))) errors.push(`${trace.name}: invalid witness`);
  }
  for (const name of expected.keys()) if (!seen.has(name)) errors.push(`${name}: missing case`);
  // Every quiet condition has its own required threat companion with the same
  // seed, team mirror and roster order. Other groups cannot fill a missing pair.
  for (const [quiet, threat] of AUTONOMOUS_MOBILITY_PAIRS) for (const spec of AUTONOMOUS_MOBILITY_CASES.filter(s => s.profile === quiet)) {
    const pair = [nameOf(spec), nameOf({ ...spec, profile: threat })];
    for (const name of pair) if (traces.filter(t => t.name === name).length !== 1)
      errors.push(`${nameOf(spec)}: missing or duplicate matched encounter ${name}`);
  }
  // Launches must actually be chosen after setup in both execution rosters and
  // team mirrors. Starting committed flights cannot satisfy this requirement.
  for (const local of [false, true]) for (const mirrored of [false, true])
    if (!traces.some(t => t.differenceCount === 0 && !t.differences.length && t.frameCount === 901 &&
      t.spec.profile.startsWith('local') === local && t.spec.mirrored === mirrored && t.witnesses.some(w => w.kind === 'lunge')))
      errors.push(`${local ? 'local' : 'observer'}/${mirrored}: missing autonomous lunge`);
  return { required: expected.size, completed: traces.filter(t => t.frameCount === 901 && !t.differenceCount && !t.differences.length).length, errors };
}

export async function runAutonomousMobilityParity() {
  const traces: AutonomousMobilityTrace[] = [];
  for (const spec of AUTONOMOUS_MOBILITY_CASES) traces.push(await runAutonomousMobilityTrace(spec));
  return { traces, coverage: autonomousMobilityCoverage(traces) };
}
