import { defaultGrifballTactics } from '../grifballTacticsConfig';
import { EVALUATION_STYLES } from '../grifballEvaluation';
import { REQUIRED_GATES, SCENARIOS, type SuiteManifest, type ValidationCase } from './types';

/** Pilot fixtures only. Acceptance needs an authored, held-out manifest after calibration. */
export function createSuiteManifest(profile: 'quick' | 'standard'): SuiteManifest {
  const scenarios = profile === 'quick' ? ['pickup', 'goal', 'pass', 'reinforcements'] as const : SCENARIOS;
  const cases: ValidationCase[] = scenarios.map((scenario, i): ValidationCase => ({
    id: `${scenario}-${profile}`, mode: 'scenario', scenario,
    mapId: profile === 'standard' && i % 2 ? 'forerunner_canyon' : 'championship_stadium',
    roster: 'lab-3v4', difficulty: 'normal', seeds: [101, 102],
    opponents: [profile === 'quick' ? 'balanced' : EVALUATION_STYLES[i % 3]],
    mirrored: true, fixedHz: 60, simulationSeconds: profile === 'quick' ? 5 : 15, watchdogSeconds: 120,
  }));
  if (profile === 'standard') for (const roster of ['scripted-1v1', 'scripted-3v4', 'scripted-4v4'] as const) {
    cases.push({ id: `match-${roster}`, mode: 'match', scenario: null,
      mapId: roster === 'scripted-4v4' ? 'forerunner_canyon' : 'championship_stadium',
      roster, difficulty: 'normal', seeds: [101, 102], opponents: ['balanced'],
      mirrored: true, fixedHz: 60, simulationSeconds: 120, watchdogSeconds: 600 });
  }
  return {
    schemaVersion: 1, profileVersion: 1, profile, comparison: 'same-build',
    baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics(),
    mechanics: { preset: 'default-grifball-v1', goalTarget: 2, countdownSeconds: 3, roundResetSeconds: 4,
      allowThrowing: true, allowRunnerThrust: true },
    cases, requiredGates: [...REQUIRED_GATES[profile]], performance: null, quality: null,
  };
}
