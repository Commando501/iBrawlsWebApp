export const MODEL_SYSTEMS = ['v1', 'v2', 'v3'] as const;

export type ModelSystem = (typeof MODEL_SYSTEMS)[number];

export type VisualModelPolicy = ModelSystem;

export type VisualModelSelectionContext = 'standard' | 'trainingSandbox';

export const DEFAULT_MODEL_SYSTEM: ModelSystem = 'v3';
export const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v3';

export interface VisualModelPolicyOption {
  value: VisualModelPolicy;
  label: string;
  recommended: boolean;
}

export const VISUAL_MODEL_POLICY_OPTIONS = [
  { value: 'v1', label: 'Version 1 Classic', recommended: false },
  { value: 'v2', label: 'Version 2 Rigged', recommended: false },
  { value: 'v3', label: 'Version 3 Iron Vanguard', recommended: true },
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
  if (isModelSystem(value)) return value;
  return isModelSystem(fallback) ? fallback : DEFAULT_VISUAL_MODEL_POLICY;
}

export function normalizeSelectableVisualModelPolicy(
  value: unknown,
  allowModelVariants: boolean = false,
  fallback: VisualModelPolicy = DEFAULT_VISUAL_MODEL_POLICY,
  context: VisualModelSelectionContext = 'standard'
): VisualModelPolicy {
  void context;
  return allowModelVariants ? normalizeVisualModelPolicy(value, fallback) : DEFAULT_VISUAL_MODEL_POLICY;
}

export function getSelectableVisualModelPolicyOptions(
  allowModelVariants: boolean = false,
  context: VisualModelSelectionContext = 'standard'
): readonly VisualModelPolicyOption[] {
  void context;
  return allowModelVariants ? VISUAL_MODEL_POLICY_OPTIONS : [VISUAL_MODEL_POLICY_OPTIONS[2]];
}

/** Multiplayer follows the lobby; local sessions follow their selected model set. */
export function resolveSessionVisualModelPolicy(input: {
  localPolicy: unknown;
  lobbyPolicy?: unknown;
  isMultiplayer: boolean;
  isLocalTraining: boolean;
  isReplay: boolean;
  isAdmin: boolean;
  allowModelVariants?: boolean;
}): VisualModelPolicy {
  return normalizeSelectableVisualModelPolicy(
    input.isMultiplayer ? input.lobbyPolicy ?? input.localPolicy : input.localPolicy,
    input.allowModelVariants === true,
    DEFAULT_VISUAL_MODEL_POLICY,
    input.isLocalTraining && !input.isMultiplayer && !input.isReplay ? 'trainingSandbox' : 'standard'
  );
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
