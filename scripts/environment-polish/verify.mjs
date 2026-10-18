import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const maps = ['stadium', 'canyon', 'hangar', 'cyber', 'jungle', 'asteroid', 'neon', 'rainy', 'glacier', 'circle'];
const sharedRegressions = [
  'src/components/grifball/stadiumVisualState.test.ts',
  'src/components/grifball/environmentShadowDisposal.test.ts',
  'src/components/grifball/environmentVisualFrame.test.ts',
  'src/components/grifball/instancedShockwaveParticles.test.ts',
  'src/components/grifball/v3DeathVoxelBurst.test.ts',
  'src/components/grifball/v3DeathVoxelBurstRuntime.test.ts',
  'src/components/grifball/aiDashMovementRuntime.test.ts',
  'src/components/grifball/replayPlaybackRuntime.test.ts',
  'src/components/grifball/replayMovement.test.ts',
  'src/components/grifball/replayVisualMetadata.test.ts',
  'src/components/iron-vanguard/ironVanguardProxies.test.ts',
  'src/components/iron-vanguard/ironVanguardModel.test.ts',
  'src/components/iron-vanguard/ironVanguardSword.test.ts',
];

// Read only explicit test paths; do not execute or concatenate package shell commands.
const mapTests = maps.flatMap(map => {
  const command = scripts[`test:${map}`];
  if (typeof command !== 'string') throw new Error(`Missing test:${map} package script`);
  const paths = command.split(/\s+/).filter(token => /^(?:src|scripts)\/.+\.test\.[cm]?[jt]sx?$/.test(token));
  if (paths.length === 0) throw new Error(`No explicit test files in test:${map}`);
  return paths;
});
const tests = [...new Set([...mapTests, ...sharedRegressions])].sort();
for (const path of tests) {
  if (!statSync(resolve(root, path)).isFile()) throw new Error(`Test file is unavailable: ${path}`);
}

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--list')) throw new Error('Usage: node scripts/environment-polish/verify.mjs [--list]');
console.log(`Environment polish: ${tests.length} unique test files from ten map suites and shared rendering regressions.`);
if (args.includes('--list')) {
  console.log(tests.join('\n'));
} else {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...tests], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) console.error(`Environment polish tests interrupted by ${result.signal}.`);
  process.exitCode = result.status ?? 1;
}
