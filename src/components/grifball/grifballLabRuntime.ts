import { createOfflineBotCombatant } from '../../game/roster';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import * as THREE from 'three';
import { grifballLab, type LabCommand, type LabMetrics, type LabResult, type LabScenario } from '../../game/grifballLabStore';
import { validateGrifballTactics, type GrifballTacticsConfig } from '../../game/grifballTacticsConfig';
import { resetAIMatchContext } from '../../game/aiMatchContext';
import { selectGrifballAssignmentThreat } from '../../game/aiGrifballTeamPlan';
import { seededRandom, withSimulationRandom } from '../../game/simulationRandom';
import { createEmptyTeamScores } from '../../game/teamScoring';
import { createInitialGrifballMatchState } from '../../game/grifballMatch';
import type { GrifballRuntimeState } from './runtimeState';
import type { GrifballThreeRefs } from './threeRefs';

export const LAB_TICK = 1 / 60;
export const emptyLabMetrics = (): LabMetrics => ({ adaptedSeconds: 0, styleSeconds: 0, seconds: 0, goals: 0, possessionLosses: 0, roleChanges: 0, outsideSeconds: 0, botSeconds: 0, stuckSeconds: 0, sharedExposureSeconds: 0, blockedRouteSeconds: 0, runnerWaitSeconds: 0, runnerRouteChanges: 0, tankingSeconds: 0, doubleCommitSeconds: 0, delaySeconds: 0, engagementReleases: 0, containmentSeconds: 0, safetySeconds: 0, passes: 0, completedPasses: 0, interceptedPasses: 0 });

/** Clone simulation data, retaining Three vector methods and Map/Set semantics. */
export function cloneLabState<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof THREE.Vector3 || value instanceof THREE.Vector2 || value instanceof THREE.Quaternion || value instanceof THREE.Euler) return value.clone() as T;
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, cloneLabState(item)])) as T;
  if (value instanceof Set) return new Set([...value].map(cloneLabState)) as T;
  if (Array.isArray(value)) return value.map(cloneLabState) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneLabState(item)])) as T;
}

export class GrifballLabRuntime {
  private checkpoint: GrifballRuntimeState | null = null;
  private random = seededRandom(1);
  private accumulator = 0;
  private tickCount = 0;
  private metrics = emptyLabMetrics();
  private pendingPassTeam: string | null = null;
  private previousHolder: string | null = null;
  private runnerActions = new Map<string, string>();
  private roles = new Map<string, string>();
  private tankingOrders = new Map<string, string>();
  private positions = new Map<string, { x: number; z: number; still: number }>();
  private history: string[] = [];
  private scenario: LabScenario = 'pickup';
  private seed = 1;
  private comparison: { command: Extract<LabCommand, { type: 'compare' }>; results: LabResult[]; ticks: number } | null = null;
  private overlay: THREE.Group | null = null;
  private overlayKey = '';
  private publishElapsed = 0;
  private secondsOrigin = 0;
  private clockEpoch = 1_000_000;

  constructor(private readonly mapName = 'Current arena', private readonly getEnemyGoal?: (team: string) => { x: number; z: number } | null) {}

  dispose() { this.clearOverlay(); }
  suspend() { this.comparison = null; this.checkpoint = null; this.accumulator = 0; this.clearOverlay(); }
  private clearOverlay() {
    this.overlay?.traverse(item => {
      if (item instanceof THREE.Line || item instanceof THREE.Mesh) { item.geometry.dispose(); (item.material as THREE.Material).dispose(); }
    });
    this.overlay?.removeFromParent(); this.overlay = null; this.overlayKey = '';
  }
  private resetMetrics() {
    this.tickCount = 0; this.accumulator = 0; this.random = seededRandom(this.seed);
    this.metrics = emptyLabMetrics(); this.previousHolder = null; this.pendingPassTeam = null;
    this.runnerActions.clear(); this.roles.clear(); this.tankingOrders.clear(); this.positions.clear(); this.history = [];
  }
  private restore(state: GrifballRuntimeState) {
    if (!this.checkpoint) return;
    Object.assign(state, cloneLabState(this.checkpoint));
    this.resetMetrics(); this.clearOverlay();
  }
  private capture(state: GrifballRuntimeState) {
    if (this.checkpoint) this.secondsOrigin += this.tickCount * LAB_TICK;
    else {
      this.secondsOrigin = performance.now() / 1000;
      this.clockEpoch = Date.now() - this.secondsOrigin * 1000;
    }
    this.checkpoint = cloneLabState(state);
    this.resetMetrics();
  }
  private prepare(state: GrifballRuntimeState, scenario: LabScenario, seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an integer from 0 to 4294967295.');
    const bots = [...state.otherPlayers.values()].filter(bot => bot.controller === 'ai');
    const goals = state.aiMatchContext.grifballTeamPlan.snapshot?.goals;
    if (!bots.some(bot => bot.team === 'blue') || !bots.some(bot => bot.team === 'red')) throw new Error('Start a Grifball match with bots on both teams first.');
    if (bots.some(bot => isNeuralNetDifficulty(bot.difficulty)) || isNeuralNetDifficulty(state.settings.aiDifficulty)) throw new Error('Lab scenarios require scripted AI. Choose a scripted difficulty in Bot Configuration.');
    this.seed = seed; this.scenario = scenario;
    this.secondsOrigin = 0; this.clockEpoch = 1_000_000;
    state.isObserverMode = true;
    state.hideLocalObserverAvatar = true;
    state.playerPickupRequested = false;
    state.playerVel.set(0, 0, 0);
    state.teamScores = createEmptyTeamScores();
    state.scorePlayer = state.scoreEnemy = state.playerKills = state.enemyKills = state.playerDeaths = state.enemyDeaths = state.gameTime = 0;
    state.lastDeaths = []; state.activeMedalPopup = null;
    state.grifball = createInitialGrifballMatchState(state.settings, state.grifball.ball.home);
    state.grifball.phase = 'playing';
    resetAIMatchContext(state.aiMatchContext);
    state.aiMatchContext.grifballTeamPlan.styleSeed = seed;
    // Positions follow the actual goal axis instead of assuming an arena orientation.
    const blue = this.getEnemyGoal?.('red') ?? goals?.blue ?? { x: 0, z: -state.arenaRadius * 0.8 };
    const red = this.getEnemyGoal?.('blue') ?? goals?.red ?? { x: 0, z: state.arenaRadius * 0.8 };
    const axis = new THREE.Vector3(red.x - blue.x, 0, red.z - blue.z).normalize();
    const lateral = new THREE.Vector3(-axis.z, 0, axis.x);
    const center = new THREE.Vector3(state.grifball.ball.home.x, 0, state.grifball.ball.home.z);
    state.observerCamMode = 'free';
    state.playerPos.copy(center).add(new THREE.Vector3(0, 25, 25));
    state.yaw = 0; state.pitch = -Math.PI / 4;
    const counts = { blue: 0, red: 0 };
    for (const bot of bots) {
      const team = bot.team === 'blue' ? 'blue' : 'red'; const slot = counts[team]++;
      const fresh = createOfflineBotCombatant({ id: bot.id, playerName: bot.playerName, team: bot.team,
        spawnPos: center.clone().addScaledVector(axis, (team === 'blue' ? -1 : 1) * (7 + Math.floor(slot / 2) * 5)).addScaledVector(lateral, (slot % 2 ? -1 : 1) * (2 + slot)),
        yaw: Math.atan2(-axis.x * (team === 'blue' ? 1 : -1), -axis.z * (team === 'blue' ? 1 : -1)),
        hue: bot.hue, difficulty: bot.difficulty ?? 'normal', settings: { ...state.settings, maxHP: bot.maxHp }, modelType: bot.modelType });
      // Keep object identities but remove every per-bot decision left by the old play.
      for (const key of Object.keys(bot)) delete (bot as any)[key];
      Object.assign(bot, fresh, { spawnTime: 1_000_000, invulnerabilityTimer: 0, weaponState: 'ready', aiSwayTimer: 0 });
      if (['outnumbered', 'delay'].includes(scenario) && team === 'blue' && slot > 0) { bot.hp = 0; bot.respawnTimer = 3600; }
    }
    if (scenario !== 'pickup') {
      const carrier = bots.find(bot => bot.team === (['escort', 'crowding', 'goal', 'lane', 'pursuit', 'rendezvous', 'tanking', 'breakthrough', 'pass', 'passdenied', 'stylematch'].includes(scenario) ? 'blue' : 'red'))!;
      carrier.pos.copy(center); state.grifball.ball.holderId = carrier.id; state.grifball.ball.state = 'held';
      carrier.activeWeapon = 'ball';
      if (scenario === 'crowding') {
        bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, 2).addScaledVector(lateral, (i - 1) * 0.7));
        bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, state.settings.attackRange + state.settings.attackRadius + 1 + i * 2));
      }
      if (scenario === 'goal') {
        carrier.pos.set(red.x - axis.x * 3, 0, red.z - axis.z * 3);
        bots.filter(bot => bot !== carrier).forEach((bot, i) => bot.pos.copy(carrier.pos).addScaledVector(axis, -(4 + Math.floor(i / 2) * 3)).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3));
      }
      if (['lane', 'pursuit', 'rendezvous'].includes(scenario)) {
        bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'rendezvous' ? -8 - i : 2 - i * 3).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3));
        bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'pursuit' ? -7 - i * 3 : 7 + i * 3).addScaledVector(lateral, scenario === 'lane' ? -3 + i : (i % 2 ? -1 : 1) * 2));
      }
      if (['tanking', 'double', 'breakthrough', 'delay'].includes(scenario)) {
        const attackingBlue = scenario === 'tanking' || scenario === 'breakthrough';
        const attackers = bots.filter(bot => bot.team === 'blue' && bot !== carrier);
        const targets = bots.filter(bot => bot.team === 'red');
        attackers.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i < 2 ? 1 : -10).addScaledVector(lateral, i < 2 ? (i % 2 ? -1 : 1) * 3 : 0));
        targets.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i === 0 ? 4 : 18 + i * 4).addScaledVector(lateral, i === 0 ? 0 : (i % 2 ? -1 : 1) * 10));
        if (attackingBlue) carrier.pos.copy(center).addScaledVector(axis, scenario === 'breakthrough' ? 23 : -4);
        if (scenario === 'double') { carrier.weaponState = 'recovering'; carrier.weaponTimer = 0; }
        if (scenario === 'delay') { bots.find(bot => bot.team === 'blue' && bot.hp > 0)?.pos.copy(center).addScaledVector(axis, -10); carrier.pos.copy(center); targets.filter(bot => bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, 3 + i).addScaledVector(lateral, (i % 2 ? -1 : 1) * 3)); }
      }
      if (['cut', 'lastdefender', 'reinforcements'].includes(scenario)) {
        const defenders = bots.filter(bot => bot.team === 'blue');
        defenders.forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, i === 0 ? -14 : -8).addScaledVector(lateral, i === 0 ? 0 : (i % 2 ? -1 : 1) * 5));
        carrier.vel.copy(axis).multiplyScalar(-3).addScaledVector(lateral, 3);
        if (scenario !== 'cut') defenders.slice(1).forEach((bot, i) => { bot.hp = 0; bot.respawnTimer = scenario === 'reinforcements' ? 1 + i * 0.5 : 3600; });
        if (scenario === 'lastdefender') carrier.pos.set(blue.x + axis.x * 7, 0, blue.z + axis.z * 7);
      }
      if (scenario === 'pass' || scenario === 'passdenied') {
        carrier.pos.copy(center).addScaledVector(axis, -20);
        bots.filter(bot => bot.team === 'blue' && bot !== carrier).forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, -8 - i * 6).addScaledVector(lateral, i * 5));
        bots.filter(bot => bot.team === 'red').forEach((bot, i) => bot.pos.copy(center).addScaledVector(axis, scenario === 'pass' ? -40 + i * 2 : -8 + i * 3).addScaledVector(lateral, scenario === 'pass' ? 15 : (i % 2 ? -1 : 1) * 3));
      }
      if (scenario === 'stylematch' || scenario === 'adaptation') {
        carrier.pos.copy(center).addScaledVector(axis, scenario === 'stylematch' ? -8 : 8);
        bots.filter(bot => bot !== carrier).forEach((bot, i) => {
          const sign = bot.team === 'blue' ? -1 : 1;
          bot.pos.copy(center).addScaledVector(axis, sign * (4 + Math.floor(i / 2) * 3)).addScaledVector(lateral, (i % 2 ? -1 : 1) * (scenario === 'adaptation' ? 1.5 : 4));
          bot.vel.copy(axis).multiplyScalar(-sign * 3);
        });
        carrier.vel.copy(axis).multiplyScalar(scenario === 'stylematch' ? 3 : -3);
      }
      state.grifball.ball.pos = { x: carrier.pos.x, y: carrier.pos.y, z: carrier.pos.z };
    }
    this.checkpoint = cloneLabState(state); this.resetMetrics(); this.clearOverlay();
    grifballLab.update({ message: 'Scenario ready. Observer mode uses scripted bots; Join runner enables exploratory human play.', results: [] });
  }
  private sample(state: GrifballRuntimeState) {
    const plan = state.aiMatchContext.grifballTeamPlan;
    this.tickCount++; this.metrics.seconds = this.tickCount * LAB_TICK;
    this.metrics.goals = state.teamScores.blue.goals + state.teamScores.red.goals;
    const holder = state.grifball.ball.holderId;
    if (this.previousHolder && this.previousHolder !== holder && state.grifball.phase === 'playing') this.metrics.possessionLosses++;
    this.previousHolder = holder;
    if (plan.passFlight && !this.pendingPassTeam && state.grifball.ball.state === 'thrown') {
      this.pendingPassTeam = plan.passFlight.team; this.metrics.passes++;
      this.history.push(`${this.metrics.seconds.toFixed(2)}s · pass released to ${plan.passFlight.receiverId}`);
    }
    if (this.pendingPassTeam && holder) {
      const team = holder === 'player' ? state.localPlayerTeam : state.otherPlayers.get(holder)?.team;
      if (team === this.pendingPassTeam) this.metrics.completedPasses++; else this.metrics.interceptedPasses++;
      this.pendingPassTeam = null;
    }
    if (state.grifball.phase !== 'playing' || state.grifball.ball.state === 'idle') this.pendingPassTeam = null;
    for (const style of Object.values(plan.stylePlans)) {
      if (state.grifball.phase !== 'playing' || ![...plan.assignments.values()].some(a => a.team === style.team)) continue;
      this.metrics.styleSeconds += LAB_TICK;
      if (style.adapting) this.metrics.adaptedSeconds += LAB_TICK;
    }
    const activeRunners = new Set<string>();
    for (const play of Object.values(plan.runnerPlans)) {
      activeRunners.add(play.carrierId);
      const action = play.selected.action;
      if (action === 'wait') this.metrics.runnerWaitSeconds += LAB_TICK;
      const previous = this.runnerActions.get(play.carrierId);
      if (previous !== action) {
        if (previous) this.metrics.runnerRouteChanges++;
        this.history.push(`${this.metrics.seconds.toFixed(2)}s · ${play.carrierId} route → ${action}: ${play.reason}`);
      }
      this.runnerActions.set(play.carrierId, action);
    }
    for (const id of this.runnerActions.keys()) if (!activeRunners.has(id)) this.runnerActions.delete(id);
    const doubleTeams = new Set<string>();
    for (const [id, assignment] of plan.assignments) {
      const bot = state.otherPlayers.get(id); if (!bot || bot.hp <= 0 || bot.respawnTimer > 0) continue;
      if (assignment.defense?.mode === 'contain') this.metrics.containmentSeconds += LAB_TICK;
      if (assignment.defense?.mode === 'last-defender') this.metrics.safetySeconds += LAB_TICK;
      const tank = assignment.tanking;
      if (tank) {
        const key = `${tank.mode}:${tank.targetId ?? '-'}:${tank.attack}`;
        if (this.tankingOrders.get(id) !== key) {
          if (tank.mode === 'release' && this.tankingOrders.has(id)) this.metrics.engagementReleases++;
          this.history.push(`${this.metrics.seconds.toFixed(2)}s · ${id} ${tank.mode} → ${tank.targetId ?? 'coverage'}: ${tank.reason}`);
        }
        this.tankingOrders.set(id, key);
        if (tank.attack) this.metrics.tankingSeconds += LAB_TICK;
        if (tank.doubleCommit) doubleTeams.add(assignment.team);
        if (tank.mode === 'delay') this.metrics.delaySeconds += LAB_TICK;
      } else this.tankingOrders.delete(id);
      const role = `${assignment.role}:${assignment.slot}`;
      if (this.roles.get(id) !== role) {
        if (this.roles.has(id)) this.metrics.roleChanges++;
        this.history.push(`${this.metrics.seconds.toFixed(2)}s · ${id} → ${assignment.role}: ${assignment.reason}`);
      }
      this.roles.set(id, role);
      this.metrics.botSeconds += LAB_TICK;
      if ((assignment.space?.selected?.sharedExposure ?? 0) > 0) this.metrics.sharedExposureSeconds += LAB_TICK;
      if (assignment.space?.route.status === 'blocked') this.metrics.blockedRouteSeconds += LAB_TICK;
      const distance = Math.hypot(bot.pos.x - assignment.destination.x, bot.pos.z - assignment.destination.z);
      if (distance > (assignment.tuning?.coverageBoundary ?? 9)) this.metrics.outsideSeconds += LAB_TICK;
      const previous = this.positions.get(id);
      const still = previous && distance > 2 && Math.hypot(previous.x - bot.pos.x, previous.z - bot.pos.z) < 0.1 * LAB_TICK ? previous.still + LAB_TICK : 0;
      if (still >= 1) this.metrics.stuckSeconds += LAB_TICK;
      this.positions.set(id, { x: bot.pos.x, z: bot.pos.z, still });
    }
    this.metrics.doubleCommitSeconds += doubleTeams.size * LAB_TICK;
    for (const id of this.tankingOrders.keys()) if (!plan.assignments.has(id)) this.tankingOrders.delete(id);
    for (const id of this.roles.keys()) if (!plan.assignments.has(id)) { this.roles.delete(id); this.positions.delete(id); this.history.push(`${this.metrics.seconds.toFixed(2)}s · ${id} assignment cleared`); }
    this.history = this.history.slice(-100);
  }
  private publish(state: GrifballRuntimeState) {
    const plan = state.aiMatchContext.grifballTeamPlan;
    const threats: Record<string, string | null> = {};
    for (const [id, assignment] of plan.assignments) {
      const bot = state.otherPlayers.get(id);
      threats[id] = bot ? selectGrifballAssignmentThreat(assignment, bot.pos, plan.snapshot?.players ?? []) : null;
    }
    grifballLab.update({ diagnostics: { stylePlans: Object.values(plan.stylePlans), passPlans: Object.values(plan.passPlans), runnerPlans: Object.values(plan.runnerPlans), assignments: [...plan.assignments.values()], snapshot: plan.snapshot, history: [...this.history], metrics: { ...this.metrics }, threats } });
  }
  /** Called every rendered frame, even while the host application is paused. */
  frame(state: GrifballRuntimeState, elapsed: number, tick: (dt: number) => void): void {
    const lab = grifballLab.getSnapshot();
    if (!lab.open) { this.comparison = null; this.accumulator = 0; this.clearOverlay(); return; }
    let steps = 0;
    const commands = grifballLab.takeCommands();
    for (const command of commands) {
      try {
        if (command.type === 'step') steps++;
        if (command.type === 'capture') { this.capture(state); grifballLab.update({ message: 'Current simulation captured. Restart restores its mechanics, roster, timers and AI memory.' }); }
        if (command.type === 'restart') { this.comparison = null; this.restore(state); grifballLab.update({ comparing: false, running: false }); }
        if (command.type === 'scenario') { this.comparison = null; this.prepare(state, command.scenario, command.seed); grifballLab.update({ comparing: false, running: false }); }
        if (command.type === 'join') {
          const carrier = state.otherPlayers.get(state.grifball.ball.holderId ?? '');
          if (!carrier) throw new Error('Load an escort scenario before joining the runner.');
          state.isObserverMode = false; state.hideLocalObserverAvatar = false; state.playerHP = state.playerMaxHP; state.playerRespawnTimer = 0;
          state.localPlayerTeam = carrier.team!; state.playerPos.copy(carrier.pos); state.playerVel.set(0, 0, 0);
          carrier.activeWeapon = 'hammer'; state.grifball.ball.holderId = 'player'; state.activeWeapon = 'ball';
          grifballLab.update({ message: 'Exploratory human run. Close the lab and resume to control the runner. Automated comparisons always restart in observer mode.' });
        }
        if (command.type === 'compare') {
          if (!Number.isFinite(command.seconds) || command.seconds < 1 || command.seconds > 120) throw new Error('Comparison duration must be 1–120 seconds.');
          this.prepare(state, command.scenario, command.seed);
          this.comparison = { command, results: [], ticks: Math.round(command.seconds / LAB_TICK) };
          grifballLab.update({ running: true, comparing: true, results: [], message: 'Running baseline, then candidate with the same starting state and seed.' });
        }
      } catch (error) { grifballLab.update({ message: (error as Error).message, running: false, comparing: false }); this.comparison = null; }
    }
    if (!this.checkpoint) this.capture(state);
    if (grifballLab.getSnapshot().running) {
      this.accumulator += Math.min(elapsed, 0.1);
      steps = Math.min(6, Math.floor((this.accumulator + 1e-9) / LAB_TICK));
      this.accumulator -= steps * LAB_TICK;
    } else this.accumulator = 0;
    for (let index = 0; index < steps; index++) {
      const comparison = this.comparison;
      state.grifballTactics = comparison ? (comparison.results.length ? comparison.command.candidate : comparison.command.baseline) : grifballLab.getSnapshot().config;
      withSimulationRandom(this.random, this.secondsOrigin + this.tickCount * LAB_TICK, () => tick(LAB_TICK), this.clockEpoch);
      this.sample(state);
      if (comparison && this.tickCount >= comparison.ticks) {
        comparison.results.push({ config: validateGrifballTactics(state.grifballTactics), seed: this.seed, scenario: this.scenario, metrics: { ...this.metrics }, setup: {
          map: this.mapName, mechanics: cloneLabState(this.checkpoint!.settings), holderId: this.checkpoint!.grifball.ball.holderId,
          roster: [...this.checkpoint!.otherPlayers.values()].map(bot => ({ id: bot.id, team: bot.team ?? '', difficulty: bot.difficulty ?? 'normal', position: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z } })),
        } });
        if (comparison.results.length === 1) this.restore(state);
        else { grifballLab.update({ results: comparison.results, running: false, comparing: false, message: 'A/B complete. This is one scenario and seed, not a general win-rate estimate.' }); this.comparison = null; break; }
      }
    }
    this.publishElapsed += elapsed;
    if (commands.length || steps && !grifballLab.getSnapshot().running || this.publishElapsed >= 0.2) { this.publish(state); this.publishElapsed = 0; }
  }
  draw(state: GrifballRuntimeState, refs: GrifballThreeRefs) {
    const lab = grifballLab.getSnapshot();
    if (!lab.open || !refs.scene || !Object.values(lab.overlays).some(Boolean)) { this.clearOverlay(); return; }
    const plan = state.aiMatchContext.grifballTeamPlan;
    const key = JSON.stringify([plan.revision, lab.overlays, lab.selectedBot, lab.selectedTeam]);
    if (key === this.overlayKey) return;
    this.clearOverlay(); this.overlayKey = key; this.overlay = new THREE.Group(); this.overlay.name = 'grifball-ai-lab';
    const line = (points: THREE.Vector3[], color: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      this.overlay!.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 })));
    };
    for (const assignment of plan.assignments.values()) {
      if (lab.selectedBot && assignment.botId !== lab.selectedBot || lab.selectedTeam !== 'all' && assignment.team !== lab.selectedTeam) continue;
      const bot = state.otherPlayers.get(assignment.botId); if (!bot) continue;
      const { x, z } = assignment.destination; const color = assignment.team === 'blue' ? 0x38bdf8 : 0xfb7185;
      if (lab.overlays.lines) line([new THREE.Vector3(bot.pos.x, 0.15, bot.pos.z), new THREE.Vector3(x, 0.15, z)], color);
      if (lab.overlays.destinations) { line([new THREE.Vector3(x - 0.5, 0.2, z), new THREE.Vector3(x + 0.5, 0.2, z)], color); line([new THREE.Vector3(x, 0.2, z - 0.5), new THREE.Vector3(x, 0.2, z + 0.5)], color); }
      if (lab.overlays.routes && assignment.space) line([bot.pos.clone().setY(0.25), ...assignment.space.route.points.map(p => new THREE.Vector3(p.x, 0.25, p.z))], 0xfacc15);
      if (lab.overlays.candidates && assignment.space) for (const candidate of assignment.space.candidates) {
        const p = candidate.point; const tint = candidate.route === 'blocked' ? 0xef4444 : candidate.sharedExposure ? 0xf97316 : 0x4ade80;
        line([new THREE.Vector3(p.x - 0.2, 0.3, p.z), new THREE.Vector3(p.x + 0.2, 0.3, p.z)], tint);
      }
      if (lab.overlays.intercepts && assignment.escort) {
        const p = assignment.escort.destination;
        line([new THREE.Vector3(p.x - 0.5, 0.4, p.z - 0.5), new THREE.Vector3(p.x + 0.5, 0.4, p.z + 0.5)], 0xa78bfa);
        line([new THREE.Vector3(p.x - 0.5, 0.4, p.z + 0.5), new THREE.Vector3(p.x + 0.5, 0.4, p.z - 0.5)], 0xa78bfa);
      }
      if (lab.overlays.defense && assignment.defense) {
        const p = assignment.defense.intercept;
        line([bot.pos.clone().setY(0.6), new THREE.Vector3(p.x, 0.6, p.z)], assignment.defense.mode === 'last-defender' ? 0x34d399 : 0xe879f9);
        line([new THREE.Vector3(p.x - 0.7, 0.6, p.z), new THREE.Vector3(p.x, 0.6, p.z + 0.7), new THREE.Vector3(p.x + 0.7, 0.6, p.z), new THREE.Vector3(p.x, 0.6, p.z - 0.7), new THREE.Vector3(p.x - 0.7, 0.6, p.z)], 0xe879f9);
      }
      if (lab.overlays.passes && assignment.pass) for (const candidate of assignment.pass.candidates) {
        if (candidate !== assignment.pass.selected && !lab.overlays.candidates) continue;
        line(candidate.path.map(p => new THREE.Vector3(p.x, p.y + 0.2, p.z)), candidate === assignment.pass.selected ? 0x22d3ee : candidate.viable ? 0x4ade80 : 0xf87171);
      }
      if (lab.overlays.engagements && assignment.tanking?.targetId) {
        const target = plan.snapshot?.players.find(p => p.id === assignment.tanking!.targetId);
        if (target) line([bot.pos.clone().setY(0.5), new THREE.Vector3(target.pos.x, 0.5, target.pos.z)], assignment.tanking.attack ? 0xf97316 : 0xa78bfa);
      }
      if (lab.overlays.coverage) line(Array.from({ length: 49 }, (_, i) => { const angle = i / 48 * Math.PI * 2; const radius = assignment.tuning?.coverageBoundary ?? 9; return new THREE.Vector3(x + Math.cos(angle) * radius, 0.1, z + Math.sin(angle) * radius); }), color);
    }
    if (lab.overlays.runnerRoutes) for (const play of Object.values(plan.runnerPlans)) {
      const carrier = plan.snapshot?.players.find(p => p.id === play.carrierId);
      if (lab.selectedTeam !== 'all' && carrier?.team !== lab.selectedTeam) continue;
      for (const candidate of play.candidates) {
        if (!candidate.route.points.length) continue;
        line([new THREE.Vector3(play.origin.x, 0.35, play.origin.z), ...candidate.route.points.map(p => new THREE.Vector3(p.x, 0.35, p.z))], candidate === play.selected ? 0xfacc15 : 0x64748b);
      }
    }
    refs.scene.add(this.overlay);
  }
}
