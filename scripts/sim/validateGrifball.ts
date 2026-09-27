import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJSON, createSuitePlan } from '../../src/game/grifballValidation/plan';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { aggregateSuiteReport } from '../../src/game/grifballValidation/report';
import { PROFILES, type CodeIdentity, type SuiteProfile } from '../../src/game/grifballValidation/types';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Source/config fingerprint scope, not a fingerprint of installed dependencies or public assets.
// Browser/runtime/build asset identity will be added with the actual executor (VS3).
const CODE_SCOPE = ['src', 'scripts/sim', 'server.ts', 'package.json', 'package-lock.json',
  'tsconfig.json', 'vite.config.ts', 'index.html'];
export function captureCodeIdentity(root: string): CodeIdentity {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = git('rev-parse', 'HEAD').trim();
  const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', ...CODE_SCOPE);
  const paths = status.split('\0').filter(Boolean).map(entry => entry.slice(3)).sort();
  const changes = paths.map(path => {
    const absolute = resolve(root, path);
    let stat;
    try { stat = lstatSync(absolute); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, hash: null };
      throw error;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported code input: ${path}`);
    const bytes = stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute);
    return { path, hash: createHash('sha256').update(bytes).digest('hex'), symlink: stat.isSymbolicLink() };
  });
  const workingTreeHash = createHash('sha256').update(canonicalJSON({ version: 1, commit, scope: CODE_SCOPE, changes })).digest('hex');
  return { commit, dirty: paths.length > 0, workingTreeHash, scope: [...CODE_SCOPE] };
}
export interface Options { suite?: SuiteProfile; manifest?: string; out?: string; writeManifest?: string; dryRun: boolean; help: boolean }
export function parseArgs(args: string[]): Options {
  const result: Options = { dryRun: false, help: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    seen.add(arg);
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help') result.help = true;
    else if (['--suite', '--manifest', '--out', '--write-manifest'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--suite') {
        if (!PROFILES.includes(value as SuiteProfile)) throw new Error(`Unknown suite ${value}`);
        result.suite = value as SuiteProfile;
      } else if (arg === '--manifest') result.manifest = value;
      else if (arg === '--out') result.out = value;
      else result.writeManifest = value;
    } else throw new Error(`Unknown option ${arg}`);
  }
  return result;
}
function saveJSON(path: string, value: unknown) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Saved ${absolute}`);
}
export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Grifball validation suite (VS1 preview only)\n' +
      'npm run validate:grifball -- --suite quick|standard --dry-run [--out file.json] [--write-manifest file.json]\n' +
      'npm run validate:grifball -- --manifest file.json --dry-run [--suite acceptance]\n' +
      'Exit: 0 preview/help succeeded (no validation ran); 2 execution unavailable; 3 invalid input/setup.');
    return 0;
  }
  if (!options.dryRun) {
    console.error('Suite execution is not implemented yet. Use --dry-run to preview; no validation has run.');
    return 2;
  }
  if (!options.manifest && options.suite === 'acceptance') throw new Error('Acceptance requires an explicit calibrated, held-out --manifest');
  const input = options.manifest ? JSON.parse(readFileSync(resolve(options.manifest), 'utf8').replace(/^\uFEFF/, ''))
    : createSuiteManifest(options.suite === 'standard' ? 'standard' : 'quick');
  const plan = await createSuitePlan(input, captureCodeIdentity(ROOT));
  if (options.suite && options.suite !== plan.manifest.profile) throw new Error('--suite does not match manifest.profile');
  const report = aggregateSuiteReport(plan, { planId: plan.id, jobs: [], gates: [] });
  console.log(`DRY RUN — ${plan.manifest.profile} v${plan.manifest.profileVersion}; validation verdict: ${report.verdict}`);
  console.log(`Plan ${plan.id}\nCode ${plan.code.commit}${plan.code.dirty ? ' (dirty in fingerprint scope)' : ''}; input fingerprint ${plan.code.workingTreeHash}`);
  console.log(`${plan.preview.caseCount} cases; ${plan.preview.jobCount} jobs; at most ${plan.preview.maxSimulationSeconds} simulated seconds.`);
  console.log(`Per-job watchdog sum: ${plan.preview.maxJobWatchdogSeconds}s; this is not an estimated completion time.`);
  for (const c of plan.cases) {
    const s = c.specification;
    console.log(`Case ${s.id}: ${s.mode}${s.scenario ? `/${s.scenario}` : ''}; ${s.mapId}; ${s.roster}; ${s.difficulty}; ${s.simulationSeconds}s cap`);
  }
  for (const job of plan.jobs) console.log(`NOT RUN ${job.id}`);
  console.log(`Required gates (all NOT RUN): ${plan.manifest.requiredGates.join(', ')}`);
  console.log('Executors are unavailable in VS1. This preview does not certify gameplay, repository health, or milestone 7.');
  if (options.out) saveJSON(options.out, { artifactVersion: 1, kind: 'dry-run', plan, report,
    environment: { node: process.version, platform: process.platform, arch: process.arch } });
  if (options.writeManifest) saveJSON(options.writeManifest, plan.manifest);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Grifball validation setup error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 3;
  });
}
