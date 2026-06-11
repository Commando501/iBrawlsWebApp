export const MODEL_SYSTEMS = ['v1', 'v2', 'v3'] as const;

export type ModelSystem = (typeof MODEL_SYSTEMS)[number];

export type VisualModelPolicy = ModelSystem;

export const DEFAULT_MODEL_SYSTEM: ModelSystem = 'v3';
export const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = DEFAULT_MODEL_SYSTEM;

export function isModelSystem(value: unknown): value is ModelSystem {
  return value === 'v1' || value === 'v2' || value === 'v3';
}

export function normalizeModelSystem(
  value: unknown,
  fallback: ModelSystem = DEFAULT_MODEL_SYSTEM
): ModelSystem {
  return isModelSystem(value) ? value : fallback;
}

export function normalizeVisualModelPolicy(
  value: unknown,
  fallback: VisualModelPolicy = DEFAULT_VISUAL_MODEL_POLICY
): VisualModelPolicy {
  return normalizeModelSystem(value, fallback);
}
