import { ACTION_NVEC } from '../sim/env/action';
import { OBS_DIM_V1, OBS_DIM_V3 } from '../sim/env/observation';
import { ENV_SPEC_VERSION, ENV_SPEC_VERSION_V3 } from '../sim/env/spec';

export const NEURAL_NET_DIFFICULTY = 'neural-net' as const;
export type NeuralNetDifficulty = typeof NEURAL_NET_DIFFICULTY;

export type NeuralBrainId = 'combat_dr_v2' | 'combat_dr_v4' | 'combat_upgrade_v3';

export interface NeuralBrainDefinition {
  id: NeuralBrainId;
  label: string;
  mode: 'combat';
  manifestUrl: string;
  observationVersion: number;
  envSpecVersion: number;
  baseObservationDim: number;
  frameStack: number;
  inputDim: number;
  actionNvec: number[];
  decisionInterval: number;
}

export const DEFAULT_NEURAL_BRAIN_ID: NeuralBrainId = 'combat_dr_v2';

export const NEURAL_BRAIN_DEFINITIONS: NeuralBrainDefinition[] = [
  {
    id: DEFAULT_NEURAL_BRAIN_ID,
    label: 'CombatDRV2',
    mode: 'combat',
    manifestUrl: '/brains/combat_dr_v2/manifest.json',
    observationVersion: 1,
    envSpecVersion: ENV_SPEC_VERSION,
    baseObservationDim: OBS_DIM_V1,
    frameStack: 4,
    inputDim: OBS_DIM_V1 * 4,
    actionNvec: [...ACTION_NVEC],
    decisionInterval: 5,
  },
  {
    id: 'combat_dr_v4',
    label: 'CombatDRV4',
    mode: 'combat',
    manifestUrl: '/brains/combat_dr_v4/manifest.json',
    observationVersion: 1,
    envSpecVersion: ENV_SPEC_VERSION,
    baseObservationDim: OBS_DIM_V1,
    frameStack: 4,
    inputDim: OBS_DIM_V1 * 4,
    actionNvec: [...ACTION_NVEC],
    decisionInterval: 5,
  },
  {
    id: 'combat_upgrade_v3',
    label: 'CombatUpgradeV3',
    mode: 'combat',
    manifestUrl: '/brains/combat_upgrade_v3/manifest.json',
    observationVersion: 3,
    envSpecVersion: ENV_SPEC_VERSION_V3,
    baseObservationDim: OBS_DIM_V3,
    frameStack: 4,
    inputDim: OBS_DIM_V3 * 4,
    actionNvec: [...ACTION_NVEC],
    decisionInterval: 5,
  },
];

export function getNeuralBrainDefinition(id: string | undefined): NeuralBrainDefinition {
  const resolvedId = (id || DEFAULT_NEURAL_BRAIN_ID) as NeuralBrainId;
  const brain = NEURAL_BRAIN_DEFINITIONS.find((candidate) => candidate.id === resolvedId);
  if (!brain) {
    throw new Error(`Unknown neural brain: ${resolvedId}`);
  }
  return brain;
}

export function isNeuralNetDifficulty(value: string | null | undefined): value is NeuralNetDifficulty {
  return value === NEURAL_NET_DIFFICULTY;
}
