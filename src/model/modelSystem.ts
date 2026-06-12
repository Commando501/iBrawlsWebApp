export const MODEL_SYSTEMS = ['v1', 'v2', 'v3'] as const;

export type ModelSystem = (typeof MODEL_SYSTEMS)[number];

export type VisualModelPolicy = ModelSystem;

export const DEFAULT_MODEL_SYSTEM: ModelSystem = 'v3';
export const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v2';

export interface VisualModelPolicyOption {
  value: VisualModelPolicy;
  label: string;
  recommended: boolean;
}

export const VISUAL_MODEL_POLICY_OPTIONS = [
  { value: 'v1', label: 'Version 1 Classic', recommended: false },
  { value: 'v2', label: 'Version 2 Rigged', recommended: true },
] as const satisfies readonly VisualModelPolicyOption[];

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
  if (value === 'v1' || value === 'v2') return value;
  return fallback === 'v1' || fallback === 'v2' ? fallback : DEFAULT_VISUAL_MODEL_POLICY;
}

export function getRecommendedVisualModelPolicy(): VisualModelPolicy {
  return VISUAL_MODEL_POLICY_OPTIONS.find((option) => option.recommended)?.value
    ?? DEFAULT_VISUAL_MODEL_POLICY;
}

export function isRecommendedVisualModelPolicy(value: unknown): value is VisualModelPolicy {
  const normalized = normalizeVisualModelPolicy(value);
  return VISUAL_MODEL_POLICY_OPTIONS.some(
    (option) => option.value === normalized && option.recommended && value === normalized
  );
}

export function getVisualModelPolicyLabel(value: unknown): string {
  const normalized = normalizeVisualModelPolicy(value);
  return VISUAL_MODEL_POLICY_OPTIONS.find((option) => option.value === normalized)?.label
    ?? VISUAL_MODEL_POLICY_OPTIONS[VISUAL_MODEL_POLICY_OPTIONS.length - 1].label;
}
