import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { captureCodeIdentity, parseArgs } from './validateGrifball';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./validateGrifball.ts', import.meta.url));
function temporary(t: TestContext): string {
  const parent = resolve(tmpdir());
  const dir = mkdtempSync(join(parent, 'ibrawls-validation-test-'));
  t.after(() => {
    // Verify the exact absolute test-owned target before recursive cleanup on Windows.
    assert.equal(dirname(resolve(dir)), parent);
    assert.ok(basename(dir).startsWith('ibrawls-validation-test-'));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function cli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
}

test('CLI arguments reject typos, duplicates and missing values', () => {
  for (const args of [['--suite'], ['--suite', 'other'], ['--bogus'], ['--dry-run', '--dry-run'], ['--out', '--dry-run']])
    assert.throws(() => parseArgs(args));
  assert.deepEqual(parseArgs(['--suite', 'standard', '--dry-run']), { suite: 'standard', dryRun: true, help: false });
  assert.equal(parseArgs(['--port', '0']).port, 0);
  assert.equal(parseArgs(['--port', '3001']).port, 3001);
  assert.equal(parseArgs([]).port, undefined);
  for (const port of ['-1', '65536', '3.5', '1e3', 'NaN']) assert.throws(() => parseArgs(['--port', port]), /--port/);
});

test('CLI exports an exact not-run preview and a reusable manifest without overwriting evidence', t => {
  const temp = temporary(t), out = join(temp, 'preview.json'), manifest = join(temp, 'manifest.json');
  const first = cli('--suite', 'quick', '--dry-run', '--out', out, '--write-manifest', manifest);
  assert.equal(first.status, 0, first.stderr); assert.match(first.stdout, /4 cases; 32 jobs; at most 160 simulated seconds/);
  assert.match(first.stdout, /validation verdict: not-run/);
  const saved = readFileSync(out, 'utf8'), artifact = JSON.parse(saved);
  assert.equal(artifact.kind, 'dry-run'); assert.equal(artifact.plan.preview.jobCount, 32);
  assert.equal(artifact.report.jobs.length, 32); assert.equal(artifact.report.verdict, 'not-run');
  assert.equal(artifact.report.repositoryVerdict, 'not-run'); assert.equal(artifact.report.milestone7Verdict, 'not-run');
  assert.ok(artifact.report.jobs.every((j: any) => j.verdict === 'not-run'));
  assert.deepEqual(first.stdout.split(/\r?\n/).filter(line => line.startsWith('NOT RUN ')).map(line => line.slice(8)),
    artifact.plan.jobs.map((j: any) => j.id));
  const second = cli('--manifest', manifest, '--dry-run');
  assert.equal(second.status, 0, second.stderr); assert.ok(second.stdout.includes(`Plan ${artifact.plan.id}`));
  const overwrite = cli('--dry-run', '--out', out);
  assert.equal(overwrite.status, 3); assert.match(overwrite.stderr, /EEXIST/); assert.equal(readFileSync(out, 'utf8'), saved);
  const mismatch = cli('--suite', 'standard', '--manifest', manifest, '--dry-run');
  assert.equal(mismatch.status, 3); assert.match(mismatch.stderr, /does not match/);
});

test('CLI rejects unavailable resume evidence and acceptance without a manifest', () => {
  const unavailable = cli('--suite', 'quick', '--resume', 'output/does-not-exist');
  assert.equal(unavailable.status, 3); assert.match(unavailable.stderr, /ENOENT/);
  const acceptance = cli('--suite', 'acceptance', '--dry-run');
  assert.equal(acceptance.status, 3); assert.match(acceptance.stderr, /explicit calibrated, held-out/);
  assert.equal(cli('--typo').status, 3);
  const standard = cli('--suite', 'standard', '--dry-run');
  assert.equal(standard.status, 0, standard.stderr); assert.match(standard.stdout, /23 cases; 184 jobs; at most 5280 simulated seconds/);
  assert.match(standard.stdout, /scripted-4v4/); assert.match(standard.stdout, /all NOT RUN/);
});

test('CLI previews the extra performance replay budget and rejects unversioned noise changes', t => {
  const temp = temporary(t), manifestPath = join(temp, 'manifest.json'), protocolPath = join(temp, 'protocol.json');
  const manifest = createSuiteManifest('quick');
  manifest.performance = { plannerRefreshP95Ms: 4, calibrationId: 'replay-preview' };
  const protocol = { version: 2, quality: null, performance: { calibrationId: 'replay-preview',
    environmentHash: 'c'.repeat(64), controlledSerial: true, maxBaselineRatio: 1.2, maxNoiseRatio: 3,
    minRefreshSamples: 20, noise: { method: 'aligned-replay-windows', windowRefreshes: 8 } } };
  writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(protocolPath, JSON.stringify(protocol));
  const result = cli('--manifest', manifestPath, '--protocol', protocolPath, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Performance replay: 32 additional jobs; 160s additional simulation cap/);
  assert.match(result.stdout, /validation verdict: not-run/);
  writeFileSync(protocolPath, JSON.stringify({ ...protocol, version: 1 }));
  const invalid = cli('--manifest', manifestPath, '--protocol', protocolPath, '--dry-run');
  assert.equal(invalid.status, 3); assert.match(invalid.stderr, /Version 1 retains/);
});

test('source identity includes untracked edits and deleted code but excludes unrelated state', async t => {
  const dir = temporary(t);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); mkdirSync(join(dir, 'src'));
  const file = join(dir, 'src', 'example with spaces.ts');
  writeFileSync(file, 'export const value = 1;\n');
  git('add', '--', 'src'); git('-c', 'user.name=Validation test', '-c', 'user.email=validation@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const clean = captureCodeIdentity(dir); assert.equal(clean.dirty, false);
  assert.deepEqual((await createSuitePlan(createSuiteManifest('quick'), clean)).code, clean);
  mkdirSync(join(dir, '.codex')); writeFileSync(join(dir, '.codex', 'state.pid'), '1234');
  assert.deepEqual(captureCodeIdentity(dir), clean);
  writeFileSync(file, 'export const value = 2;\n');
  const changed = captureCodeIdentity(dir); assert.equal(changed.dirty, true); assert.equal(changed.commit, clean.commit);
  assert.notEqual(changed.workingTreeHash, clean.workingTreeHash);
  writeFileSync(join(dir, 'src', 'new.ts'), 'export const added = true;\n');
  const added = captureCodeIdentity(dir); assert.notEqual(added.workingTreeHash, changed.workingTreeHash);
  rmSync(file);
  const deleted = captureCodeIdentity(dir); assert.notEqual(deleted.workingTreeHash, added.workingTreeHash);
  assert.deepEqual(captureCodeIdentity(dir), deleted);
});
