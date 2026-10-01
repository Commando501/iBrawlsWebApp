import type { Browser } from 'playwright';
import type { SuitePlan, ValidationJob } from '../../src/game/grifballValidation/types';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { runBrowserJob } from './grifballValidationBrowser';

export const CROSS_HOST_PROTOCOL = 'production-browser-vs-node-v2';
// Same linear/health/time budgets as execution parity; angles have their own
// allowance for accumulated Node/Chromium transcendental rounding. At 1000 units,
// 1e-10 radians displaces a heading by only 1e-7 units, below the linear budget.
// This affects comparison only; gameplay values and exact replay hashes are intact.
export const CROSS_HOST_TOLERANCES = { position: 1e-6, velocity: 1e-6, health: 1e-9, timer: 1e-6, angle: 1e-10, discrete: 0 };
type Kind = keyof typeof CROSS_HOST_TOLERANCES;
function kind(path: string[]): Kind {
  const field = path.at(-1);
  if (field === 'yaw' || field === 'pitch') return 'angle';
  if (['hp', 'maxHp'].includes(field ?? '')) return 'health';
  if (['clock', 'phaseTimer', 'respawn', 'weaponTimer', 'charge', 'dash', 'swap', 'invulnerability',
    'looseTimer', 'elapsed', 'swordElapsed', 'shield'].includes(field ?? '')) return 'timer';
  if (path.includes('vel')) return 'velocity';
  if (path.includes('pos') || path.includes('home') || path.includes('destination')) return 'position';
  return 'discrete';
}
export class CrossHostStateComparison {
  comparedFrames = 0;
  failureCount = 0;
  failures: { frame: number; path: string; node: unknown; browser: unknown }[] = [];
  maxAbsoluteErrors: Record<Kind, number> = { position: 0, velocity: 0, health: 0, timer: 0, angle: 0, discrete: 0 };
  fail(path: string, node: unknown, browser: unknown) {
    this.failureCount++;
    if (this.failures.length < 32) this.failures.push({ frame: this.comparedFrames, path, node, browser });
  }
  compare(node: string, browser: string) {
    const visit = (a: unknown, b: unknown, path: string[]) => {
      if (typeof a === 'number' && typeof b === 'number') {
        const unit = kind(path), error = Math.abs(a - b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) this.fail(path.join('.'), a, b);
        else {
          this.maxAbsoluteErrors[unit] = Math.max(this.maxAbsoluteErrors[unit], error);
          if (error > CROSS_HOST_TOLERANCES[unit]) this.fail(path.join('.'), a, b);
        }
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        if (Array.isArray(a) !== Array.isArray(b)) { this.fail(path.join('.'), a, b); return; }
        if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) this.fail([...path, 'length'].join('.'), a.length, b.length);
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) this.fail([...path, key].join('.'), Object.hasOwn(a, key), Object.hasOwn(b, key));
          else visit((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [...path, key]);
        }
      } else if (a !== b) this.fail(path.join('.'), a, b);
    };
    const a = JSON.parse(node), b = JSON.parse(browser);
    if (a?.frame?.tick !== this.comparedFrames || b?.frame?.tick !== this.comparedFrames)
      this.fail('frame sequence', a?.frame?.tick, b?.frame?.tick);
    visit(a, b, []); this.comparedFrames++;
  }
}

/** Every browser snapshot advances the production Node host by one tick. Only
 * one Node snapshot and at most 64 browser transfer batches are buffered. */
export async function runCrossHostJob(browser: Browser, origin: string, buildId: string, plan: SuitePlan,
  job: ValidationJob, directory: string, signal: AbortSignal) {
  const fixture = plan.cases.find(c => c.specification.id === job.caseId && c.inputHash === job.inputHash);
  if (!fixture) throw new Error('Cross-host job has no matching frozen fixture');
  const comparison = new CrossHostStateComparison();
  let pending: string | null = null, observed = 0, steps = 0;
  const host = createAutonomousValidationRuntime(fixture, job, state => {
    if (pending !== null) throw new Error('Node state observer lost a frame');
    pending = state; observed++;
  });
  try {
    const result = await runBrowserJob(browser, origin, buildId, plan, job, directory, signal, states => {
      for (const state of states) {
        if (pending === null && steps < job.simulationTicks) { host.runtime.step(); steps++; }
        if (pending === null) { comparison.fail('missing Node frame', null, JSON.parse(state).frame?.tick); continue; }
        comparison.compare(pending, state); pending = null;
      }
    });
    // If the browser stopped early, cancel rather than hanging on an unfinished
    // Node promise or pretending a prefix is a complete match.
    if (steps < job.simulationTicks) host.runtime.stop('cancelled', 'Browser state stream ended');
    const node = await host.runtime.done;
    if (result.check.verdict !== 'pass' || node.check.verdict !== 'pass') comparison.fail('completed trials', node.termination, result.termination);
    if (node.termination !== result.termination) comparison.fail('termination', node.termination, result.termination);
    if (pending !== null || comparison.comparedFrames !== observed || observed !== node.deterministic?.ticks || observed !== result.deterministic?.ticks)
      comparison.fail('complete frame counts', { observed, ticks: node.deterministic?.ticks, pending: pending !== null },
        { compared: comparison.comparedFrames, ticks: result.deterministic?.ticks });
    return { protocol: CROSS_HOST_PROTOCOL, jobId: job.id, tolerances: CROSS_HOST_TOLERANCES,
      verdict: comparison.failureCount ? 'fail' : 'pass', comparedFrames: comparison.comparedFrames,
      failureCount: comparison.failureCount, failures: comparison.failures, maxAbsoluteErrors: comparison.maxAbsoluteErrors,
      node, browser: result };
  } finally { host.runtime.dispose(); }
}
