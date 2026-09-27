import type { LegacyRosterProps } from './rosterSlotConfig';
import type { AIPreset, CustomMapData, UniversalSettings } from '../types';
import type { LabScenario, LabScenarioRecord } from './grifballLabStore';
import type { GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics, type GrifballTacticsConfig } from './grifballTacticsConfig';
import { fieldDistance, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import type { GrifballPhase } from './grifballMatch';

export const EVALUATION_VERSION = 1 as const;
export const EVALUATION_STYLES = ['balanced', 'patient', 'aggressive'] as const;
export type EvaluationStyle = typeof EVALUATION_STYLES[number];
export type EvaluationTeam = 'blue' | 'red';
export interface EvaluationRequest {
  scenario: LabScenario; seed: number; seeds: number; seconds: number;
  opponents: EvaluationStyle[]; mirrored: boolean;
  baseline: GrifballTacticsConfig; candidate: GrifballTacticsConfig;
}
export interface EvaluationJob {
  seed: number; opponent: EvaluationStyle; mirrored: boolean;
  variant: 'baseline' | 'candidate'; focalTeam: EvaluationTeam; config: GrifballTacticsConfig;
}
export interface TeamEvaluationMetrics {
  goals: number; possessions: number; completedPossessions: number; turnovers: number; possessionSeconds: number;
  pressuredCarrierSeconds: number; uncoveredCarrierSeconds: number;
  assignedBotSeconds: number; relevantBotSeconds: number; sharedExposureSeconds: number;
  roleChanges: number; stuckSeconds: number;
}
export const emptyTeamEvaluation = (): TeamEvaluationMetrics => ({ goals: 0, possessions: 0, completedPossessions: 0,
  turnovers: 0, possessionSeconds: 0, pressuredCarrierSeconds: 0, uncoveredCarrierSeconds: 0,
  assignedBotSeconds: 0, relevantBotSeconds: 0, sharedExposureSeconds: 0, roleChanges: 0, stuckSeconds: 0 });
export interface EvaluationRun {
  job: EvaluationJob; metrics: Record<EvaluationTeam, TeamEvaluationMetrics>; setup: LabScenarioRecord;
  /** Whole fixed simulation tick, including combat and objectives. Not isolated planner cost. */
  simulationCost: { samples: number; meanMs: number; maxMs: number };
}
export interface EvaluationRosterConfig { legacy: LegacyRosterProps; presets: AIPreset[] }
export interface EvaluationReport {
  schemaVersion: typeof EVALUATION_VERSION; contractVersion: 1;
  status: 'running' | 'complete' | 'cancelled'; request: EvaluationRequest;
  map: CustomMapData | null; mapName: string; arenaRadius: number; mechanics: UniversalSettings;
  rosterConfig?: EvaluationRosterConfig;
  input: 'scripted-observer'; runs: EvaluationRun[]; totalRuns: number;
}
export interface PairedEstimate { seeds: number; pairedRuns: number; mean: number | null; low: number | null; high: number | null }

/** Blue's resolved candidate/baseline follows the same roster onto red in the mirrored leg. */
export function createEvaluationJobs(request: EvaluationRequest): EvaluationJob[] {
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff ||
    !Number.isInteger(request.seeds) || request.seeds < 1 || request.seeds > 20 || request.seed + request.seeds - 1 > 0xffffffff)
    throw new Error('Use 1–20 consecutive unsigned 32-bit seeds without overflow.');
  if (!Number.isFinite(request.seconds) || request.seconds < 1 || request.seconds > 120) throw new Error('Duration must be 1–120 seconds per run.');
  if (!request.opponents.length || request.opponents.length > 3 || new Set(request.opponents).size !== request.opponents.length ||
    request.opponents.some(style => !EVALUATION_STYLES.includes(style))) throw new Error('Choose one or more distinct opponent styles.');
  const configs = { baseline: validateGrifballTactics(request.baseline), candidate: validateGrifballTactics(request.candidate) };
  const jobs: EvaluationJob[] = [];
  for (let offset = 0; offset < request.seeds; offset++) for (const opponent of request.opponents)
    for (const mirrored of request.mirrored ? [false, true] : [false]) for (const variant of ['baseline', 'candidate'] as const) {
      const focalTeam = mirrored ? 'red' : 'blue';
      const config = defaultGrifballTactics();
      const rival = { ...config.defaults, adaptationEnabled: false };
      if (opponent === 'patient') Object.assign(rival, { styleAggression: 0.2, stylePatience: 0.8, styleWidth: 0.7, styleRunnerRisk: 0.25 });
      if (opponent === 'aggressive') Object.assign(rival, { styleAggression: 0.85, stylePatience: 0.2, styleWidth: 0.35, styleRunnerRisk: 0.75 });
      config.teams = { [focalTeam]: resolveTeamTactics(configs[variant], 'blue'), [mirrored ? 'blue' : 'red']: rival };
      jobs.push({ seed: request.seed + offset, opponent, mirrored, variant, focalTeam, config });
    }
  return jobs;
}

/** Observable possession segments: same-team passes and temporary loose balls retain ownership. */
export class GrifballEvaluationTracker {
  readonly teams = { blue: emptyTeamEvaluation(), red: emptyTeamEvaluation() };
  private owner: EvaluationTeam | null = null;
  private scores = { blue: 0, red: 0 };
  private roles = new Map<string, string>();
  private positions = new Map<string, { x: number; z: number; still: number }>();
  sample(frame: { phase: GrifballPhase; holderTeam: string | null; holderId: string | null;
    goals: Record<EvaluationTeam, number>; players: GrifballTacticalPlayer[];
    assignments: Iterable<GrifballAssignment>; geometry?: GrifballTacticalSnapshot['geometry'] }, dt: number) {
    const finish = (turnover: boolean) => {
      if (this.owner) { this.teams[this.owner].completedPossessions++; if (turnover) this.teams[this.owner].turnovers++; }
      this.owner = null;
    };
    for (const team of ['blue', 'red'] as const) {
      const goals = Math.max(0, frame.goals[team] - this.scores[team]);
      this.teams[team].goals += goals;
      if (goals) {
        if (this.owner && this.owner !== team) finish(true);
        if (!this.owner) { this.owner = team; this.teams[team].possessions++; }
        finish(false);
      }
    }
    this.scores = { ...frame.goals };
    if (frame.phase !== 'playing') { this.owner = null; this.roles.clear(); this.positions.clear(); return; }
    const team = frame.holderTeam === 'blue' || frame.holderTeam === 'red' ? frame.holderTeam : null;
    if (team && team !== this.owner) { finish(true); this.owner = team; this.teams[team].possessions++; }
    if (this.owner) this.teams[this.owner].possessionSeconds += dt;
    const open = (a: GrifballTacticalPlayer, b: GrifballTacticalPlayer) => !frame.geometry || isSpaceSegmentOpen(frame.geometry, a.pos, b.pos);
    const threatens = (enemy: GrifballTacticalPlayer, player: GrifballTacticalPlayer) => enemy.space && open(enemy, player) &&
      Math.max(enemy.space.mobileIn, Math.max(0, fieldDistance(enemy.pos, player.pos) - enemy.space.reach) / Math.max(0.1, enemy.space.speed)) + enemy.space.attackIn <= 2;
    const carrier = frame.players.find(p => p.id === frame.holderId);
    if (carrier && team && frame.players.some(p => p.team !== team && threatens(p, carrier))) {
      this.teams[team].pressuredCarrierSeconds += dt;
      if (!frame.players.some(p => p.id !== carrier.id && p.team === team && fieldDistance(p.pos, carrier.pos) <= 8 && open(p, carrier)))
        this.teams[team].uncoveredCarrierSeconds += dt;
    }
    const active = new Set<string>();
    for (const assignment of frame.assignments) {
      const player = frame.players.find(p => p.id === assignment.botId);
      if (!player || (player.team !== 'blue' && player.team !== 'red')) continue;
      active.add(player.id);
      const metrics = this.teams[player.team]; metrics.assignedBotSeconds += dt;
      const role = this.roles.get(player.id);
      if (role && role !== assignment.role) metrics.roleChanges++;
      this.roles.set(player.id, assignment.role);
      const previous = this.positions.get(player.id);
      const still = previous && fieldDistance(previous, player.pos) < 0.1 * dt && fieldDistance(player.pos, assignment.destination) > 2
        ? previous.still + dt : 0;
      if (still >= 1) metrics.stuckSeconds += dt;
      this.positions.set(player.id, { ...player.pos, still });
      const enemies = frame.players.filter(p => p.team !== player.team && threatens(p, player));
      if (!enemies.length) continue;
      metrics.relevantBotSeconds += dt;
      if (enemies.some(enemy => enemy.space!.blastRadius > 0 && frame.players.some(ally => ally.id !== player.id && ally.team === player.team &&
        fieldDistance(ally.pos, player.pos) < 2 * enemy.space!.blastRadius && threatens(enemy, ally) && open(ally, player)))) metrics.sharedExposureSeconds += dt;
    }
    for (const id of this.roles.keys()) if (!active.has(id)) { this.roles.delete(id); this.positions.delete(id); }
  }
}

export type EvaluationMetric = 'goalMargin' | 'goalsPerPossession' | 'turnoversPerPossession' | 'goalPrevention' | 'uncoveredFraction' | 'sharedExposureFraction' | 'roleChangesPerMinute' | 'stuckFraction';
export const EVALUATION_METRICS: Record<EvaluationMetric, string> = {
  goalMargin: 'Goal margin', goalsPerPossession: 'Goals / completed possession', turnoversPerPossession: 'Turnovers / completed possession',
  goalPrevention: 'Non-scoring opponent possession fraction', uncoveredFraction: 'Uncovered / pressured carrier time',
  sharedExposureFraction: 'Shared exposure / threatened bot time', roleChangesPerMinute: 'Role changes / assigned bot minute', stuckFraction: 'Stuck / assigned bot time',
};
export function evaluationValue(run: EvaluationRun, key: EvaluationMetric): number | null {
  const team = run.metrics[run.job.focalTeam], other = run.metrics[run.job.focalTeam === 'blue' ? 'red' : 'blue'];
  const ratio = (n: number, d: number) => d > 0 ? n / d : null;
  switch (key) {
    case 'goalMargin': return team.goals - other.goals;
    case 'goalsPerPossession': return ratio(team.goals, team.completedPossessions);
    case 'turnoversPerPossession': return ratio(team.turnovers, team.completedPossessions);
    case 'goalPrevention': return ratio(other.completedPossessions - other.goals, other.completedPossessions);
    case 'uncoveredFraction': return ratio(team.uncoveredCarrierSeconds, team.pressuredCarrierSeconds);
    case 'sharedExposureFraction': return ratio(team.sharedExposureSeconds, team.relevantBotSeconds);
    case 'roleChangesPerMinute': return ratio(team.roleChanges * 60, team.assignedBotSeconds);
    case 'stuckFraction': return ratio(team.stuckSeconds, team.assignedBotSeconds);
  }
}

/** Pair within setup; average all sides/opponents within seed BEFORE estimating uncertainty. */
export function summarizeEvaluation(report: EvaluationReport, key: EvaluationMetric): PairedEstimate {
  const groups = new Map<string, Partial<Record<EvaluationJob['variant'], EvaluationRun>>>();
  for (const run of report.runs) {
    const id = JSON.stringify([run.job.seed, run.job.opponent, run.job.mirrored]);
    const pair = groups.get(id) ?? {}; pair[run.job.variant] = run; groups.set(id, pair);
  }
  const seeds = new Map<number, number[]>(); let pairedRuns = 0;
  for (const pair of groups.values()) {
    if (!pair.baseline || !pair.candidate) continue;
    const a = evaluationValue(pair.baseline, key), b = evaluationValue(pair.candidate, key);
    if (a === null || b === null) continue;
    const values = seeds.get(pair.baseline.job.seed) ?? []; values.push(b - a); seeds.set(pair.baseline.job.seed, values); pairedRuns++;
  }
  // Partial seed clusters would overweight whichever opponent happened to run first.
  const expected = report.request.opponents.length * (report.request.mirrored ? 2 : 1);
  const values = [...seeds.values()].filter(v => v.length === expected).map(v => v.reduce((sum, n) => sum + n, 0) / v.length);
  const n = values.length, mean = n ? values.reduce((sum, v) => sum + v, 0) / n : null;
  if (n < 2) return { seeds: n, pairedRuns, mean, low: null, high: null };
  // Two-sided Student-t 0.975 quantiles for df 1–19 (batch limit is 20 seeds).
  const critical = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093][n - 1];
  const variance = values.reduce((sum, v) => sum + (v - mean!) ** 2, 0) / (n - 1);
  const margin = critical * Math.sqrt(variance / n);
  return { seeds: n, pairedRuns, mean, low: mean! - margin, high: mean! + margin };
}
