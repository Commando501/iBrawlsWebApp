import type { CodeIdentity, SuiteManifest } from './types';
import type { SuiteProgress, TrialResult } from './runner';

/** Public automation boundary. No React internals or mutable gameplay state are exposed. */
export interface GrifballValidationBridge {
  readonly version: 1;
  readonly buildId: string;
  prepare(manifest: SuiteManifest, code: CodeIdentity, expectedPlanId: string): Promise<string[]>;
  runJob(jobId: string): Promise<TrialResult>;
  /** Optional diagnostics on the dedicated validation page only. Set while idle. */
  observeState?(observer: ((canonicalState: string) => void) | null): void;
  progress(): SuiteProgress | null;
  cancel(): void;
}
declare global {
  interface Window { __grifballValidation?: GrifballValidationBridge }
}
