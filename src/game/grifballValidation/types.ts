import type { CustomMapData, UniversalSettings } from '../../types';
import type { EvaluationJob, EvaluationStyle } from '../grifballEvaluation';
import type { LabScenario } from '../grifballLabStore';
import type { GrifballTacticsConfig } from '../grifballTacticsConfig';
import type { RosterSlotConfig } from '../rosterSlotConfig';
import type { AIResolvedKnobs, DerivedAIParams } from '../aiTuning';

// Independent of the existing single-scenario EvaluationReport contract.
export const SUITE_VERSION = 1 as const;
export const PROFILE_VERSION = 1 as const;
export const PROFILES = ['quick', 'standard', 'acceptance'] as const;
export type SuiteProfile = typeof PROFILES[number];
export const GATES = ['correctness', 'reproducibility', 'typecheck', 'build', 'startup',
  'repository-tests', 'lab-ui', 'execution-parity', 'performance', 'quality', 'human-review'] as const;
export type Gate = typeof GATES[number];
export const REQUIRED_GATES: Record<SuiteProfile, readonly Gate[]> = {
  quick: GATES.slice(0, 5), standard: GATES.slice(0, 7), acceptance: GATES,
};
export const MAP_IDS = ['championship_stadium', 'forerunner_canyon'] as const;
export const ROSTERS = ['lab-3v4', 'scripted-1v1', 'scripted-3v4', 'scripted-4v4'] as const;
export const DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'] as const;
export const SCENARIOS = ['pickup', 'escort', 'turnover', 'outnumbered', 'crowding', 'goal',
  'lane', 'pursuit', 'rendezvous', 'tanking', 'double', 'breakthrough', 'delay', 'cut',
  'lastdefender', 'reinforcements', 'pass', 'passdenied', 'stylematch', 'adaptation'] as const satisfies readonly LabScenario[];

export interface ValidationCase {
  id: string;
  mode: 'scenario' | 'match';
  scenario: LabScenario | null;
  mapId: typeof MAP_IDS[number];
  roster: typeof ROSTERS[number];
  difficulty: typeof DIFFICULTIES[number];
  seeds: number[];
  opponents: EvaluationStyle[];
  mirrored: boolean;
  fixedHz: 60;
  simulationSeconds: number;
  watchdogSeconds: number;
}
export interface SuiteManifest {
  schemaVersion: typeof SUITE_VERSION;
  profileVersion: typeof PROFILE_VERSION;
  profile: SuiteProfile;
  comparison: 'same-build';
  baseline: GrifballTacticsConfig;
  candidate: GrifballTacticsConfig;
  mechanics: {
    preset: 'default-grifball-v1';
    goalTarget: number;
    countdownSeconds: number;
    roundResetSeconds: number;
    allowThrowing: boolean;
    allowRunnerThrust: boolean;
  };
  cases: ValidationCase[];
  requiredGates: Gate[];
  performance: { plannerRefreshP95Ms: number; calibrationId: string } | null;
  quality: { primaryMeasure: 'goalMargin'; minIndependentSeeds: number; minEffect: number; heldOut: true } | null;
}
export interface CodeIdentity {
  /** Null together only for a browser development session without verified build identity. */
  commit: string | null;
  dirty: boolean | null;
  workingTreeHash: string | null;
  /** Exact paths included in the commit + changed-content fingerprint. */
  scope: string[];
}
export interface FrozenActor {
  id: string;
  owner: 'scripted';
  slot: RosterSlotConfig;
  effectiveKnobs: AIResolvedKnobs;
  derived: DerivedAIParams;
}
export interface FrozenCase {
  specification: ValidationCase;
  inputHash: string;
  mapHash: string;
  geometryHash: string;
  map: CustomMapData;
  mechanics: UniversalSettings;
  roster: FrozenActor[];
  observer: 'outside-roster';
  combatPreset: 'built-in';
  modelPolicy: 'v2';
  modelType: 'medium';
}
export interface ValidationJob extends EvaluationJob {
  id: string;
  caseId: string;
  inputHash: string;
  simulationTicks: number;
  watchdogSeconds: number;
}
export interface SuitePlan {
  schemaVersion: typeof SUITE_VERSION;
  id: string;
  manifest: SuiteManifest;
  code: CodeIdentity;
  cases: FrozenCase[];
  jobs: ValidationJob[];
  preview: {
    caseCount: number;
    jobCount: number;
    maxSimulationSeconds: number;
    /** Watchdog sum only; not a wall-time estimate or total suite deadline. */
    maxJobWatchdogSeconds: number;
  };
}
export const EXECUTION_STATES = ['queued', 'running', 'completed', 'cancelled', 'error'] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];
export const VERDICTS = ['pass', 'fail', 'inconclusive', 'not-run'] as const;
export type Verdict = typeof VERDICTS[number];
export interface CheckResult {
  id: string;
  state: ExecutionState;
  verdict: Verdict;
  summary: string;
  evidence: string[];
}
export interface SuiteEvidence {
  planId: string;
  jobs: CheckResult[];
  gates: CheckResult[];
}
export interface SuiteReport extends SuiteEvidence {
  schemaVersion: typeof SUITE_VERSION;
  profile: SuiteProfile;
  verdict: Verdict;
  automatedVerdict: Verdict;
  repositoryVerdict: Verdict;
  milestone7Verdict: Verdict;
  missingRequired: string[];
}
