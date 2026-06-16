import { type UniversalSettings } from '../../types';
import { DOMAIN_RANDOMIZABLE_KEYS, type RandomizeSpec } from '../env/randomize';

export const MECHANICS_COVERAGE_FIELDS = ['count', 'min', 'max', 'sum'] as const;

export type MechanicsCoverageField = (typeof MECHANICS_COVERAGE_FIELDS)[number];

export function mechanicsCoverageKeys(spec: RandomizeSpec): (keyof UniversalSettings)[] {
  return spec.keys?.length ? [...spec.keys] : [...DOMAIN_RANDOMIZABLE_KEYS];
}

export function mechanicsBaseValues(
  settings: UniversalSettings,
  keys: readonly (keyof UniversalSettings)[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[String(key)] = value;
  }
  return out;
}

export class MechanicsCoverageTracker {
  private readonly count: Float32Array;
  private readonly min: Float32Array;
  private readonly max: Float32Array;
  private readonly sum: Float32Array;

  constructor(private readonly keys: readonly (keyof UniversalSettings)[]) {
    this.count = new Float32Array(keys.length);
    this.min = new Float32Array(keys.length);
    this.max = new Float32Array(keys.length);
    this.sum = new Float32Array(keys.length);
    this.reset();
  }

  record(settings: UniversalSettings): void {
    for (let i = 0; i < this.keys.length; i++) {
      const value = settings[this.keys[i]];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (this.count[i] === 0) {
        this.min[i] = value;
        this.max[i] = value;
      } else {
        this.min[i] = Math.min(this.min[i], value);
        this.max[i] = Math.max(this.max[i], value);
      }
      this.count[i] += 1;
      this.sum[i] += value;
    }
  }

  drain(): Float32Array {
    const out = new Float32Array(this.keys.length * MECHANICS_COVERAGE_FIELDS.length);
    for (let i = 0; i < this.keys.length; i++) {
      const base = i * MECHANICS_COVERAGE_FIELDS.length;
      out[base] = this.count[i];
      out[base + 1] = this.count[i] > 0 ? this.min[i] : 0;
      out[base + 2] = this.count[i] > 0 ? this.max[i] : 0;
      out[base + 3] = this.sum[i];
    }
    this.reset();
    return out;
  }

  private reset(): void {
    this.count.fill(0);
    this.min.fill(0);
    this.max.fill(0);
    this.sum.fill(0);
  }
}
