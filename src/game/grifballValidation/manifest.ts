import { EVALUATION_STYLES } from '../grifballEvaluation';
import { validateGrifballTactics } from '../grifballTacticsConfig';
import { DIFFICULTIES, GATES, MAP_IDS, PROFILE_VERSION, PROFILES, REQUIRED_GATES, ROSTERS,
  SCENARIOS, SUITE_VERSION, type SuiteManifest, type ValidationCase } from './types';

export function object(value: unknown, keys: readonly string[], at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${at}: expected an object`);
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!keys.includes(key)) throw new Error(`${at}: unknown field ${key}`);
  for (const key of keys) if (!Object.hasOwn(result, key)) throw new Error(`${at}: missing ${key}`);
  return result;
}
export function choice<T extends string | number>(value: unknown, values: readonly T[], at: string): T {
  if (!values.includes(value as T)) throw new Error(`${at}: expected ${values.join(', ')}`);
  return value as T;
}
export function number(value: unknown, low: number, high: number, at: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high ||
    (integer && !Number.isInteger(value))) throw new Error(`${at}: expected ${integer ? 'integer ' : ''}${low}–${high}`);
  return value;
}
export function boolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${at}: expected boolean`);
  return value;
}
export function nonempty(value: unknown, at: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${at}: expected nonempty text (max 500 characters)`);
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T, max: number, at: string): T[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error(`${at}: expected 1–${max} entries`);
  const result = Array.from(value, parse);
  if (new Set(result).size !== result.length) throw new Error(`${at}: duplicate entries`);
  return result;
}
function parseCase(value: unknown): ValidationCase {
  const c = object(value, ['id', 'mode', 'scenario', 'mapId', 'roster', 'difficulty', 'seeds', 'opponents',
    'mirrored', 'fixedHz', 'simulationSeconds', 'watchdogSeconds'], 'case');
  const id = nonempty(c.id, 'case.id');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('case.id: use 1–64 lowercase letters, numbers or hyphens');
  const mode = choice(c.mode, ['scenario', 'match'], `${id}.mode`);
  const roster = choice(c.roster, ROSTERS, `${id}.roster`);
  if (mode === 'scenario' ? roster !== 'lab-3v4' : roster === 'lab-3v4')
    throw new Error(`${id}: scenario fixtures require lab-3v4; matches require a scripted roster`);
  if (mode === 'match' && c.scenario !== null) throw new Error(`${id}: match scenario must be null`);
  return {
    id, mode, roster,
    scenario: mode === 'scenario' ? choice(c.scenario, SCENARIOS, `${id}.scenario`) : null,
    mapId: choice(c.mapId, MAP_IDS, `${id}.mapId`), difficulty: choice(c.difficulty, DIFFICULTIES, `${id}.difficulty`),
    seeds: list(c.seeds, s => number(s, 0, 0xffffffff, `${id}.seed`, true), 20, `${id}.seeds`).sort((a, b) => a - b),
    opponents: list(c.opponents, s => choice(s, EVALUATION_STYLES, `${id}.opponent`), 3, `${id}.opponents`)
      .sort((a, b) => EVALUATION_STYLES.indexOf(a) - EVALUATION_STYLES.indexOf(b)),
    mirrored: boolean(c.mirrored, `${id}.mirrored`), fixedHz: choice(c.fixedHz, [60], `${id}.fixedHz`),
    simulationSeconds: number(c.simulationSeconds, 1, mode === 'scenario' ? 120 : 3600, `${id}.simulationSeconds`, true),
    watchdogSeconds: number(c.watchdogSeconds, 1, 7200, `${id}.watchdogSeconds`, true),
  };
}
export function validateManifest(value: unknown): SuiteManifest {
  const m = object(value, ['schemaVersion', 'profileVersion', 'profile', 'comparison', 'baseline', 'candidate',
    'mechanics', 'cases', 'requiredGates', 'performance', 'quality'], 'manifest');
  const profile = choice(m.profile, PROFILES, 'profile');
  const mechanics = object(m.mechanics, ['preset', 'goalTarget', 'countdownSeconds', 'roundResetSeconds',
    'allowThrowing', 'allowRunnerThrust'], 'mechanics');
  const cases = list(m.cases, parseCase, 100, 'cases').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('cases: duplicate case IDs');
  const requiredGates = list(m.requiredGates, g => choice(g, GATES, 'requiredGates'), GATES.length, 'requiredGates')
    .sort((a, b) => GATES.indexOf(a) - GATES.indexOf(b));
  for (const gate of REQUIRED_GATES[profile]) if (!requiredGates.includes(gate)) throw new Error(`${profile}: required gate ${gate} missing`);
  const p = m.performance === null ? null : object(m.performance, ['plannerRefreshP95Ms', 'calibrationId'], 'performance');
  const q = m.quality === null ? null : object(m.quality, ['primaryMeasure', 'minIndependentSeeds', 'minEffect', 'heldOut'], 'quality');
  const performance = p && {
    plannerRefreshP95Ms: number(p.plannerRefreshP95Ms, 0.001, 1000, 'plannerRefreshP95Ms'),
    calibrationId: nonempty(p.calibrationId, 'calibrationId'),
  };
  const quality = q && {
    primaryMeasure: choice(q.primaryMeasure, ['goalMargin'], 'primaryMeasure'),
    minIndependentSeeds: number(q.minIndependentSeeds, 2, 20, 'minIndependentSeeds', true),
    minEffect: number(q.minEffect, 0, 100, 'minEffect'), heldOut: boolean(q.heldOut, 'heldOut') as true,
  };
  if (quality && !quality.heldOut) throw new Error('quality: requires held-out seeds');
  if (requiredGates.includes('performance') && !performance) throw new Error('performance gate requires a calibrated budget');
  if (requiredGates.includes('quality')) {
    if (!quality) throw new Error('quality gate requires a predeclared measure and evidence minimum');
    const matches = cases.filter(c => c.mode === 'match');
    if (!matches.length || matches.some(c => !c.mirrored || c.opponents.length !== 3 || c.seeds.length < quality.minIndependentSeeds))
      throw new Error('quality gate requires full matches, both sides, all styles and the minimum independent seeds per case');
  }
  // Bound accidental Cartesian explosions even in explicit custom manifests.
  const jobs = cases.reduce((n, c) => n + c.seeds.length * c.opponents.length * (c.mirrored ? 4 : 2), 0);
  if (jobs > 10000) throw new Error('manifest exceeds 10,000 jobs');
  return {
    schemaVersion: choice(m.schemaVersion, [SUITE_VERSION], 'schemaVersion'),
    profileVersion: choice(m.profileVersion, [PROFILE_VERSION], 'profileVersion'),
    profile, comparison: choice(m.comparison, ['same-build'], 'comparison'),
    baseline: validateGrifballTactics(m.baseline), candidate: validateGrifballTactics(m.candidate),
    mechanics: {
      preset: choice(mechanics.preset, ['default-grifball-v1'], 'mechanics.preset'),
      goalTarget: number(mechanics.goalTarget, 1, 100, 'goalTarget', true),
      countdownSeconds: number(mechanics.countdownSeconds, 0, 30, 'countdownSeconds'),
      roundResetSeconds: number(mechanics.roundResetSeconds, 0, 30, 'roundResetSeconds'),
      allowThrowing: boolean(mechanics.allowThrowing, 'allowThrowing'),
      allowRunnerThrust: boolean(mechanics.allowRunnerThrust, 'allowRunnerThrust'),
    },
    cases, requiredGates, performance, quality,
  };
}
