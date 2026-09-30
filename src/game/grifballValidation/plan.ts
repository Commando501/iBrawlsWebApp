import type { UniversalSettings } from '../../types';
import { createEvaluationJobs } from '../grifballEvaluation';
import { createValidationMap } from './maps';
import { getGoalPlates } from '../grifballGoals';
import { DEFAULT_ADMIN_SETTINGS, stripPlayerIdentitySettings } from '../../settings/gameplaySettings';
import { rosterTemplateFromSettings, resolveKnobsFromRosterSlot, resolveDerivedFromRosterSlot } from '../rosterSlotConfig';
import { boolean, nonempty, object, validateManifest } from './manifest';
import type { CodeIdentity, FrozenActor, FrozenCase, SuitePlan, ValidationJob } from './types';

/** Stable JSON for hashes; undefined optional object fields are omitted as in JSON. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(',')}}`;
  }
  throw new Error('Cannot fingerprint a non-JSON or non-finite value');
}
export async function hashInput(value: unknown): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function snapshot<T>(value: T): T { return JSON.parse(canonicalJSON(value)); }
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validateCode(value: CodeIdentity): CodeIdentity {
  const c = object(value, ['commit', 'dirty', 'workingTreeHash', 'scope'], 'code identity');
  if (c.commit === null && c.dirty === null && c.workingTreeHash === null && Array.isArray(c.scope) && c.scope.length === 0)
    return { commit: null, dirty: null, workingTreeHash: null, scope: [] };
  const commit = nonempty(c.commit, 'commit'), workingTreeHash = nonempty(c.workingTreeHash, 'workingTreeHash');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) || !/^[a-f0-9]{64}$/.test(workingTreeHash))
    throw new Error('Code identity requires a Git commit and SHA-256 working-tree fingerprint');
  if (!Array.isArray(c.scope) || !c.scope.length) throw new Error('Code identity requires a fingerprint scope');
  return { commit, workingTreeHash, dirty: boolean(c.dirty, 'dirty'), scope: c.scope.map(s => nonempty(s, 'scope')).sort() };
}

/** Resolve and copy everything BEFORE the first await, so callers cannot change active inputs. */
export async function createSuitePlan(input: unknown, identity: CodeIdentity): Promise<SuitePlan> {
  const manifest = validateManifest(input), code = validateCode(identity);
  const frozenInputs = manifest.cases.map(specification => {
    const map = snapshot(createValidationMap(specification.mapId));
    const goals = getGoalPlates(map);
    if (!['blue', 'red'].every(team => goals.some(goal => goal.team === team) && map.teamSpawns?.[team]?.length))
      throw new Error(`${specification.mapId}: requires both goals and team spawns`);
    const mechanics = snapshot({ ...stripPlayerIdentitySettings(DEFAULT_ADMIN_SETTINGS),
      gameMode: 'grifball' as const, visualModelPolicy: 'v2' as const, aiDifficulty: specification.difficulty,
      grifballGoalTarget: manifest.mechanics.goalTarget, grifballCountdownDuration: manifest.mechanics.countdownSeconds,
      grifballRoundResetDelay: manifest.mechanics.roundResetSeconds,
      grifballAllowThrowing: manifest.mechanics.allowThrowing, grifballAllowRunnerThrust: manifest.mechanics.allowRunnerThrust } satisfies UniversalSettings);
    const counts = specification.roster === 'scripted-1v1' ? [1, 1] : specification.roster === 'scripted-4v4' ? [4, 4] : [3, 4];
    const roster: FrozenActor[] = [];
    for (const [index, team] of (['blue', 'red'] as const).entries()) for (let i = 0; i < counts[index]; i++) {
      const id = `validation-${team}-${i}`;
      const slot = snapshot({ ...rosterTemplateFromSettings(mechanics), team, hue: team === 'blue' ? 220 : 0, name: id });
      roster.push({ id, owner: 'scripted', slot,
        effectiveKnobs: resolveKnobsFromRosterSlot(slot, [], mechanics), derived: resolveDerivedFromRosterSlot(slot, [], mechanics) });
    }
    return { specification, map, mechanics, roster, observer: 'outside-roster' as const,
      combatPreset: 'built-in' as const, modelPolicy: 'v2' as const, modelType: 'medium' as const };
  });
  const cases: FrozenCase[] = [];
  for (const inputs of frozenInputs) {
    const { map } = inputs;
    const [mapHash, geometryHash, inputHash] = await Promise.all([
      hashInput(map),
      // Conservative geometry input hash: includes full authored objects, goals and spawn data.
      hashInput({ mapShape: map.mapShape, arenaRadius: map.arenaRadius, arenaHalfExtents: map.arenaHalfExtents,
        arenaCeiling: map.arenaCeiling, spawnPoints: map.spawnPoints, teamSpawns: map.teamSpawns, objects: map.objects }),
      hashInput({ inputs, baseline: manifest.baseline, candidate: manifest.candidate, code }),
    ]);
    cases.push({ ...inputs, mapHash, geometryHash, inputHash });
  }
  const jobs: ValidationJob[] = [];
  for (const c of cases) for (const seed of c.specification.seeds) {
    // Reuse paired config/opponent/mirror semantics. The case owns its actual duration;
    // full matches may exceed the existing scenario evaluator's 120-second limit.
    for (const job of createEvaluationJobs({ scenario: c.specification.scenario ?? 'pickup', seed, seeds: 1,
      seconds: 1, opponents: c.specification.opponents, mirrored: c.specification.mirrored,
      baseline: manifest.baseline, candidate: manifest.candidate })) {
      jobs.push({ ...job, id: `${c.specification.id}/${c.inputHash}/${seed}/${job.opponent}/${job.mirrored ? 'mirrored' : 'original'}/${job.variant}`,
        caseId: c.specification.id, inputHash: c.inputHash,
        simulationTicks: c.specification.simulationSeconds * c.specification.fixedHz, watchdogSeconds: c.specification.watchdogSeconds });
    }
  }
  const id = await hashInput({ schemaVersion: 1, manifest, code, cases });
  return freeze({ schemaVersion: 1, id, manifest, code, cases, jobs, preview: {
    caseCount: cases.length, jobCount: jobs.length,
    maxSimulationSeconds: jobs.reduce((n, j) => n + j.simulationTicks / 60, 0),
    maxJobWatchdogSeconds: jobs.reduce((n, j) => n + j.watchdogSeconds, 0),
  } });
}
