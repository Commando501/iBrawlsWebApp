import { DeterministicTrace, LiveTimings, liveTimings, type BehaviorEvidence } from '../../game/grifballValidation/telemetry';
import * as THREE from 'three';
import { retainDecisionTrace, type DecisionTrace } from '../../game/grifballValidation/decisionTrace';
import type { Combatant } from '../../types';
import { createOfflineBotCombatant } from '../../game/roster';
import { seededRandom, withSimulationRandom } from '../../game/simulationRandom';
import { GrifballEvaluationTracker } from '../../game/grifballEvaluation';
import { freeze } from '../../game/grifballValidation/plan';
import { trialCheck, type TrialFailureState, type TrialFrame, type TrialHandle, type TrialResult, type TrialTermination } from '../../game/grifballValidation/runner';
import type { FrozenCase, ValidationJob } from '../../game/grifballValidation/types';
import { createInitialGrifballRuntimeState, type GrifballRuntimeState } from './runtimeState';
import { createLiveGrifballTacticalSnapshot } from './grifballTeamPlanRuntime';
import { getGrifballEnemyGoalPosForMap } from './grifballObjectiveRuntime';
import { getGrifballTeamSpawn } from './arenaSpawns';
import { getInwardSpawnYaw } from './combatGeometry';
import { LAB_TICK, cloneLabState, mirrorGrifballTrial, prepareGrifballScenario } from './grifballTrialSetup';

export interface ValidationRuntimePort {
  state: GrifballRuntimeState;
  tick: (dt: number) => void;
  resetControls: () => void;
  removeActor: (id: string) => void;
  provisionActor: (actor: Combatant) => void;
  hasActorMesh: (id: string) => boolean;
}
const MAX_TRACE = 512;
function frame(state: GrifballRuntimeState, tick: number): TrialFrame {
  return { tick, phase: state.grifball.phase, round: state.grifball.roundNumber,
    scores: { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals }, clock: state.gameTime,
    holder: state.grifball.ball.holderId, ballState: state.grifball.ball.state,
    alive: [...state.otherPlayers.values()].filter(p => p.hp > 0 && p.respawnTimer <= 0).map(p => p.id).sort() };
}

/** Runs the actual live tick supplied by GrifballGame; no alternate policy or physics engine. */
export class GrifballValidationRuntime implements TrialHandle {
  readonly done: Promise<TrialResult>;
  private resolve!: (result: TrialResult) => void;
  private result: TrialResult | null = null;
  private origin: GrifballRuntimeState;
  private tickCount = 0;
  private stage: TrialFailureState['stage'] = 'setup';
  private random: () => number;
  private tracker = new GrifballEvaluationTracker();
  private first!: TrialFrame;
  private last!: TrialFrame;
  private trace: TrialFrame[] = [];
  private dropped = 0;
  private totalCost = 0;
  private maxCost = 0;
  private restored = false;
  private settingsKey: string;
  private configKey: string;
  private slotKey = '';
  private deterministic = new DeterministicTrace();
  private timings = new LiveTimings();
  private behavior: BehaviorEvidence = { version: 1, ticks: 0, pickups: 0, throws: 0, recoveries: 0, respawns: 0,
    goals: { blue: 0, red: 0 }, roleReleases: 0, staleRoleTicks: 0 };
  private pendingThrow = false;
  private deadAssignments = new Map<string, number>();
  private decisions: DecisionTrace = { version: 1, intervalTicks: 120, droppedFrames: 0, frames: [] };

  constructor(private port: ValidationRuntimePort, readonly fixture: FrozenCase, readonly job: ValidationJob) {
    this.origin = cloneLabState(port.state);
    this.done = new Promise(resolve => { this.resolve = resolve; });
    this.random = seededRandom(job.seed);
    this.settingsKey = JSON.stringify(fixture.mechanics); this.configKey = JSON.stringify(job.config);
    try {
      if (port.state.isMultiplayer || job.caseId !== fixture.specification.id || job.inputHash !== fixture.inputHash)
        throw new Error('Validation requires an offline matching frozen case/job.');
      withSimulationRandom(this.random, 0, () => this.prepare());
      this.checkInvariants();
      this.first = this.last = frame(port.state, 0); this.trace.push(this.first); this.sample(0);
      liveTimings.set(port.state, this.timings); this.observe();
    } catch (error) { this.stop('setup-error', error instanceof Error ? error.message : String(error)); }
  }
  private goal = (team: string) => getGrifballEnemyGoalPosForMap(team, this.fixture.map);
  private prepare() {
    const { state } = this.port, { fixture, job } = this;
    this.port.resetControls();
    for (const id of state.otherPlayers.keys()) this.port.removeActor(id);
    const fresh = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: cloneLabState(fixture.mechanics),
      isMultiplayer: false, multiplayerRole: null });
    for (const key of Object.keys(state)) if (!Object.hasOwn(fresh, key)) delete (state as any)[key];
    Object.assign(state, fresh);
    state.arenaRadius = fixture.map.arenaRadius;
    state.isObserverMode = true; state.hideLocalObserverAvatar = true;
    state.observerCamMode = 'free'; state.playerPos.set(0, 35, 30); state.playerVel.set(0, 0, 0);
    state.yaw = 0; state.pitch = -Math.PI / 3;
    state.grifballLabRosterLocked = true;
    state.grifballTactics = cloneLabState(job.config);
    state.grifballValidationSlots = {};
    const used: THREE.Vector3[] = [];
    const fallback = fixture.map.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
    for (const actor of fixture.roster) {
      const slot = cloneLabState(actor.slot);
      const spawn = getGrifballTeamSpawn(fixture.map, slot.team, fallback, used);
      used.push(spawn.clone());
      const bot = createOfflineBotCombatant({ id: actor.id, playerName: slot.name, team: slot.team, spawnPos: spawn,
        yaw: spawn.spawnYaw ?? getInwardSpawnYaw(spawn), hue: slot.hue, difficulty: slot.difficulty,
        settings: state.settings, modelType: slot.modelType });
      bot.spawnTime = 1_000_000;
      state.otherPlayers.set(bot.id, bot); state.grifballValidationSlots[bot.id] = slot;
    }
    if (fixture.specification.mode === 'scenario') prepareGrifballScenario(state, fixture.specification.scenario!, job.seed, this.goal);
    // A full match retains createInitialGrifballRuntimeState's real clock, health,
    // cooldowns and countdown. No carrier placement or scripted scoring is involved.
    if (job.mirrored) {
      mirrorGrifballTrial(state, this.goal);
      for (const slot of Object.values(state.grifballValidationSlots)) slot.team = slot.team === 'blue' ? 'red' : 'blue';
    }
    state.aiMatchContext.grifballTeamPlan.styleSeed = job.seed;
    for (const actor of state.otherPlayers.values()) this.port.provisionActor(actor);
    this.slotKey = JSON.stringify(state.grifballValidationSlots);
  }
  private checkInvariants(previous?: TrialFrame) {
    const { state } = this.port;
    const finite = (value: number, label: string) => { if (!Number.isFinite(value)) throw new Error(`Non-finite ${label}`); };
    if (state.isMultiplayer || !state.isObserverMode || !state.hideLocalObserverAvatar || !state.grifballLabRosterLocked)
      throw new Error('Validation ownership/observer lock changed.');
    if (JSON.stringify(state.settings) !== this.settingsKey || JSON.stringify(state.grifballTactics) !== this.configKey ||
      JSON.stringify(state.grifballValidationSlots) !== this.slotKey) throw new Error('Frozen mechanics, tactics or combat profiles changed.');
    if (state.otherPlayers.size !== this.fixture.roster.length) throw new Error('Frozen roster size changed.');
    for (const expected of this.fixture.roster) {
      const p = state.otherPlayers.get(expected.id);
      const team = this.job.mirrored ? expected.slot.team === 'blue' ? 'red' : 'blue' : expected.slot.team;
      if (!p || p.controller !== 'ai' || p.isObserver || p.team !== team || p.difficulty !== expected.slot.difficulty || p.modelType !== expected.slot.modelType)
        throw new Error(`Frozen actor ownership changed: ${expected.id}`);
      if (!this.port.hasActorMesh(p.id)) throw new Error(`Actor mesh missing: ${p.id}`);
      for (const key of ['x', 'y', 'z'] as const) { finite(p.pos[key], `${p.id}.pos.${key}`); finite(p.vel[key], `${p.id}.vel.${key}`); }
      for (const key of ['hp', 'maxHp', 'yaw', 'respawnTimer'] as const) finite(p[key], `${p.id}.${key}`);
      for (const key of ['invulnerabilityTimer', 'weaponTimer', 'swapCooldownTimer'] as const)
        if (p[key] !== undefined) finite(p[key] as number, `${p.id}.${key}`);
      if (p.maxHp <= 0 || p.hp > p.maxHp + 1e-6 || p.respawnTimer < 0 || (p.invulnerabilityTimer ?? 0) < 0)
        throw new Error(`Invalid health or cooldown: ${p.id}`);
    }
    for (const [id] of state.aiMatchContext.grifballTeamPlan.assignments)
      if (!state.grifballValidationSlots?.[id]) throw new Error(`Scripted order assigned outside owned roster: ${id}`);
    const ball = state.grifball.ball;
    for (const v of [ball.pos, ball.vel, ball.home]) for (const key of ['x', 'y', 'z'] as const) finite(v[key], `ball.${key}`);
    finite(state.gameTime, 'match clock'); finite(state.grifball.phaseTimer, 'phase timer');
    if (!['countdown', 'playing', 'scored', 'matchEnd'].includes(state.grifball.phase) ||
      !Number.isInteger(state.grifball.roundNumber) || state.grifball.roundNumber < 1) throw new Error('Invalid match phase or round.');
    for (const team of ['blue', 'red'] as const)
      if (!Number.isInteger(state.teamScores[team].goals) || state.teamScores[team].goals < 0) throw new Error('Invalid goal total.');
    if (state.grifball.goalTarget !== (this.fixture.mechanics.grifballGoalTarget ?? 5)) throw new Error('Frozen goal target changed.');
    const winner = state.grifball.winningTeam;
    if (state.grifball.phase === 'matchEnd' && (winner !== 'blue' && winner !== 'red' ||
      state.teamScores[winner].goals < state.grifball.goalTarget)) throw new Error('Terminal phase without a goal-target winner.');
    if (ball.holderId && (ball.state !== 'held' || !state.otherPlayers.has(ball.holderId) || state.otherPlayers.get(ball.holderId)!.hp <= 0 || state.otherPlayers.get(ball.holderId)!.respawnTimer > 0))
      throw new Error(`Invalid ball holder ${ball.holderId} at tick ${this.tickCount}: state=${ball.state}, hp=${state.otherPlayers.get(ball.holderId!)?.hp}, respawn=${state.otherPlayers.get(ball.holderId!)?.respawnTimer}.`);
    if (ball.state === 'held' && !ball.holderId) throw new Error('Held ball has no owner.');
    if (previous) {
      const scoreDelta = state.teamScores.blue.goals + state.teamScores.red.goals - previous.scores.blue - previous.scores.red;
      if (scoreDelta > 1 || scoreDelta && state.grifball.phase !== 'scored') throw new Error('Score outside scored transition.');
      for (const team of ['blue', 'red'] as const) {
        const score = state.teamScores[team].goals, delta = score - previous.scores[team];
        if (!Number.isInteger(score) || delta < 0 || delta > 1 || delta && !['playing', 'countdown'].includes(previous.phase))
          throw new Error('Illegal score transition.');
      }
      if (ball.holderId && ball.holderId !== previous.holder && state.grifball.phase !== 'playing')
        throw new Error('Pickup outside playing phase.');
    }
  }
  private sample(dt: number) {
    const { state } = this.port;
    const snapshot = createLiveGrifballTacticalSnapshot(state, this.goal, this.fixture.map);
    const holder = snapshot.players.find(p => p.id === snapshot.holderId);
    this.tracker.sample({ phase: state.grifball.phase, holderTeam: holder?.team ?? null, holderId: snapshot.holderId,
      players: snapshot.players, geometry: snapshot.geometry, assignments: state.aiMatchContext.grifballTeamPlan.assignments.values(),
      goals: { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals } }, dt);
  }
  private observe() {
    const s = this.port.state, next = frame(s, this.tickCount), previous = this.last;
    const assignments = s.aiMatchContext.grifballTeamPlan.assignments;
    if (this.tickCount % this.decisions.intervalTicks === 0 || this.tickCount === this.job.simulationTicks ||
      next.phase !== previous.phase || next.holder !== previous.holder || next.ballState !== previous.ballState ||
      next.alive.join() !== previous.alive.join()) {
      this.decisions.frames.push({ frame: next, revision: s.aiMatchContext.grifballTeamPlan.revision,
        ball: [s.grifball.ball.pos.x, s.grifball.ball.pos.y, s.grifball.ball.pos.z],
        actors: [...s.otherPlayers.values()].map(p => {
          const a = assignments.get(p.id);
          return { id: p.id, team: p.team!, position: [p.pos.x, p.pos.y, p.pos.z], velocity: [p.vel.x, p.vel.y, p.vel.z], hp: p.hp,
            weapon: p.activeWeapon, weaponState: p.weaponState ?? null, aiState: p.aiState ?? null,
            plannedTargetId: a?.tanking?.targetId ?? a?.defense?.targetId ?? null,
            pressureTargetId: p.aiPressureTargetId ?? null, lungeTargetId: p.aiLastLungeTargetId ?? null,
            role: a?.role ?? null, reason: a?.reason.slice(0, 500) ?? null,
            destination: a ? [a.destination.x, a.destination.z] : null, route: a?.space?.route.status ?? null,
            runner: a?.runner?.selected.action ?? null, defense: a?.defense?.mode ?? null, tanking: a?.tanking?.mode ?? null,
            pickup: !!p.pickupRequested };
        }) });
      this.decisions = retainDecisionTrace(this.decisions);
    }
    if (this.tickCount) {
      if (next.holder && next.holder !== previous.holder) {
        this.behavior.pickups++;
        if (this.pendingThrow) { this.behavior.recoveries++; this.pendingThrow = false; }
      }
      if (next.ballState === 'thrown' && previous.ballState !== 'thrown') { this.behavior.throws++; this.pendingThrow = true; }
      if (next.phase !== 'playing') this.pendingThrow = false;
      this.behavior.respawns += next.alive.filter(id => !previous.alive.includes(id)).length;
      for (const team of ['blue', 'red'] as const) this.behavior.goals[team] += next.scores[team] - previous.scores[team];
    }
    for (const [id, since] of this.deadAssignments) {
      if (!assignments.has(id)) { this.behavior.roleReleases++; this.deadAssignments.delete(id); }
      else if (next.alive.includes(id)) this.deadAssignments.delete(id);
      else if (this.tickCount - since > 60) this.behavior.staleRoleTicks++;
    }
    for (const id of assignments.keys()) if (!next.alive.includes(id) && !this.deadAssignments.has(id)) this.deadAssignments.set(id, this.tickCount);
    this.behavior.ticks = this.tickCount;
    const vector = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
    this.deterministic.add({ frame: next, ball: s.grifball.ball, phaseTimer: s.grifball.phaseTimer,
      actors: [...s.otherPlayers.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(p => ({
        id: p.id, pos: vector(p.pos), vel: vector(p.vel), yaw: p.yaw, hp: p.hp, maxHp: p.maxHp,
        respawn: p.respawnTimer, weapon: p.activeWeapon, weaponState: p.weaponState, weaponTimer: p.weaponTimer,
        charge: p.grifballPassCharge, dash: p.aiDashRemaining, aiState: p.aiState, swap: p.swapCooldownTimer,
        invulnerability: p.invulnerabilityTimer, assignment: assignments.has(p.id) ? {
          role: assignments.get(p.id)!.role, destination: assignments.get(p.id)!.destination,
          carrierId: assignments.get(p.id)!.carrierId, slot: assignments.get(p.id)!.slot,
        } : null,
      })) });
  }
  recordRender(ms: number) { if (!this.result) this.timings.record('render', ms); }
  private failureState(): TrialFailureState {
    // Keep malformed numbers explicit and capture bounded scalars only, never scene/runtime objects.
    const number = (value: unknown): number | string | null => typeof value === 'number'
      ? Number.isFinite(value) ? value : String(value) : null;
    const position = (value: { x?: number; y?: number; z?: number } | undefined) =>
      [number(value?.x), number(value?.y), number(value?.z)];
    const result: TrialFailureState = { version: 1, stage: this.stage,
      tick: this.tickCount + (this.stage === 'tick' ? 1 : 0), lastValidTick: this.last?.tick ?? null,
      ball: { state: null, holderId: null, position: [] }, holder: null, actors: [], omittedActors: 0 };
    try {
      const state = this.port.state, ball = state.grifball?.ball;
      result.ball = { state: ball?.state ?? null, holderId: ball?.holderId ?? null, position: position(ball?.pos) };
      const holder = state.otherPlayers?.get(ball?.holderId ?? '');
      if (holder) result.holder = { id: holder.id, hp: number(holder.hp), respawnTimer: number(holder.respawnTimer), weapon: holder.activeWeapon ?? null };
      const actors = [...(state.otherPlayers?.values() ?? [])];
      result.actors = actors.slice(0, 32).map(p => ({ id: p.id, hp: number(p.hp), respawnTimer: number(p.respawnTimer), position: position(p.pos) }));
      result.omittedActors = Math.max(0, actors.length - result.actors.length);
    } catch (error) { result.captureError = String(error).slice(0, 200); }
    return result;
  }
  step() {
    if (this.result) return;
    try {
      this.stage = 'before-tick'; this.checkInvariants(); this.port.resetControls();
      const started = performance.now(), playingBefore = this.port.state.grifball.phase === 'playing';
      this.stage = 'tick';
      withSimulationRandom(this.random, this.tickCount * LAB_TICK, () => this.port.tick(LAB_TICK));
      const cost = performance.now() - started;
      this.timings.record('tick', cost);
      this.totalCost += cost; this.maxCost = Math.max(this.maxCost, cost);
      this.tickCount++; this.stage = 'after-tick'; this.checkInvariants(this.last);
      const evaluated = performance.now();
      this.stage = 'sampling'; this.sample(LAB_TICK); this.observe();
      this.timings.record('evaluation', performance.now() - evaluated);
      // Countdown and round-reset time cannot warm code that has not executed.
      if (playingBefore || this.port.state.grifball.phase === 'playing') this.timings.playingTicks++;
      const next = frame(this.port.state, this.tickCount);
      if (next.phase !== this.last.phase || next.round !== this.last.round || next.holder !== this.last.holder ||
        next.ballState !== this.last.ballState || JSON.stringify(next.scores) !== JSON.stringify(this.last.scores) ||
        next.alive.join() !== this.last.alive.join()) {
        if (this.trace.length === MAX_TRACE) { this.trace.splice(1, 1); this.dropped++; }
        this.trace.push(next);
      }
      this.last = next;
      if (next.phase === 'matchEnd') this.stop('match-end', 'Live goal-target match reached matchEnd.');
      else if (this.tickCount >= this.job.simulationTicks) this.stop(this.fixture.specification.mode === 'match' ? 'simulation-cap' : 'scenario-complete');
    } catch (error) { this.stop('invalid-state', error instanceof Error ? error.message : String(error)); }
  }
  stop(reason: TrialTermination, message = reason as string): TrialResult {
    if (this.result) return this.result;
    this.result = freeze({ jobId: this.job.id, termination: reason, check: trialCheck(this.job.id, reason, message),
      start: this.first ?? null, end: this.last ?? null, trace: [...this.trace], droppedTraceEntries: this.dropped,
      ...(['invalid-state', 'setup-error'].includes(reason) ? { failureState: this.failureState() } : {}),
      metrics: cloneLabState(this.tracker.teams), behavior: cloneLabState(this.behavior), timings: this.timings.finish(),
      decisions: this.decisions,
      simulationCost: { samples: this.tickCount, meanMs: this.tickCount ? this.totalCost / this.tickCount : 0, maxMs: this.maxCost } });
    const result = this.result;
    void this.deterministic.finish().then(deterministic => {
      this.result = freeze({ ...result, deterministic }); this.resolve(this.result);
    }).catch(error => {
      this.result = freeze({ ...result, deterministic: { version: 1, algorithm: 'sha256-pages-v1', ticks: 0, hash: null, error: String(error) } });
      this.resolve(this.result);
    });
    return result;
  }
  dispose() {
    if (this.restored) return;
    this.stop('cancelled'); this.restored = true; liveTimings.delete(this.port.state);
    for (const id of this.port.state.otherPlayers.keys()) this.port.removeActor(id);
    for (const key of Object.keys(this.port.state)) if (!Object.hasOwn(this.origin, key)) delete (this.port.state as any)[key];
    Object.assign(this.port.state, cloneLabState(this.origin));
    this.port.state.grifballLabRosterLocked = this.origin.grifballLabRosterLocked ?? false;
    for (const bot of this.port.state.otherPlayers.values()) this.port.provisionActor(bot);
    this.port.resetControls();
  }
}
