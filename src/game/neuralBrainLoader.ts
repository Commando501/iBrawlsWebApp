import {
  DEFAULT_NEURAL_BRAIN_ID,
  getNeuralBrainDefinition,
  type NeuralBrainDefinition,
} from './neuralBrains';
import {
  NeuralFrameStack,
  buildMlpPolicy,
  validateNeuralBrainManifest,
  type NeuralBrainManifest,
  type NeuralMlpPolicy,
} from './neuralPolicy';

export interface NeuralAgentRuntime {
  frameStack: NeuralFrameStack;
  ticksUntilDecision: number;
  lastFactors: Int32Array | null;
  lastActionLogits: Float32Array | null;
}

export interface NeuralBrainTelemetry {
  brainId: string;
  status: 'loading' | 'ready' | 'error';
  decisions: number;
  reusedActions: number;
  blockedFrames: number;
  lastDecisionAt: number;
  lastError?: string;
  lastFactors?: number[];
}

export interface LoadedNeuralBrain {
  definition: NeuralBrainDefinition;
  manifest: NeuralBrainManifest;
  policy: NeuralMlpPolicy;
  agents: Map<string, NeuralAgentRuntime>;
  telemetry: NeuralBrainTelemetry;
}

const cache = new Map<string, Promise<LoadedNeuralBrain>>();

export function createNeuralBrainTelemetry(brainId: string): NeuralBrainTelemetry {
  return {
    brainId,
    status: 'loading',
    decisions: 0,
    reusedActions: 0,
    blockedFrames: 0,
    lastDecisionAt: 0,
  };
}

export function getNeuralAgentRuntime(
  brain: LoadedNeuralBrain,
  agentId: string
): NeuralAgentRuntime {
  let agent = brain.agents.get(agentId);
  if (!agent) {
    agent = {
      frameStack: new NeuralFrameStack(brain.manifest.frameStack, brain.manifest.baseObservationDim),
      ticksUntilDecision: 0,
      lastFactors: null,
      lastActionLogits: null,
    };
    brain.agents.set(agentId, agent);
  }
  return agent;
}

export async function loadNeuralBrain(id: string = DEFAULT_NEURAL_BRAIN_ID): Promise<LoadedNeuralBrain> {
  if (cache.has(id)) return cache.get(id)!;
  const promise = loadNeuralBrainUncached(id);
  cache.set(id, promise);
  return promise;
}

async function loadNeuralBrainUncached(id: string): Promise<LoadedNeuralBrain> {
  const definition = getNeuralBrainDefinition(id);
  const telemetry = createNeuralBrainTelemetry(definition.id);
  try {
    const manifestResponse = await fetch(definition.manifestUrl);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load ${definition.manifestUrl}: ${manifestResponse.status}`);
    }
    const manifest = await manifestResponse.json() as NeuralBrainManifest;
    validateLoadedManifest(definition, manifest);

    const weightsUrl = new URL(manifest.weightsFile, new URL(definition.manifestUrl, globalThis.location?.origin ?? 'http://localhost')).toString();
    const weightsResponse = await fetch(weightsUrl);
    if (!weightsResponse.ok) {
      throw new Error(`Failed to load ${weightsUrl}: ${weightsResponse.status}`);
    }
    const weights = new Float32Array(await weightsResponse.arrayBuffer());
    const policy = buildMlpPolicy(manifest, weights);
    telemetry.status = 'ready';
    return {
      definition,
      manifest,
      policy,
      agents: new Map(),
      telemetry,
    };
  } catch (error) {
    telemetry.status = 'error';
    telemetry.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function validateLoadedManifest(definition: NeuralBrainDefinition, manifest: NeuralBrainManifest): void {
  validateNeuralBrainManifest(manifest);
  if (manifest.id !== definition.id) {
    throw new Error(`Manifest id ${manifest.id} does not match ${definition.id}`);
  }
  if (manifest.mode !== definition.mode) {
    throw new Error(`Manifest mode ${manifest.mode} does not match ${definition.mode}`);
  }
  if (manifest.observationVersion !== definition.observationVersion) {
    throw new Error(`Manifest observationVersion ${manifest.observationVersion} does not match ${definition.observationVersion}`);
  }
  if (manifest.envSpecVersion !== definition.envSpecVersion) {
    throw new Error(`Manifest envSpecVersion ${manifest.envSpecVersion} does not match ${definition.envSpecVersion}`);
  }
  if (manifest.frameStack !== definition.frameStack) {
    throw new Error(`Manifest frameStack ${manifest.frameStack} does not match ${definition.frameStack}`);
  }
  if (manifest.baseObservationDim !== definition.baseObservationDim) {
    throw new Error(`Manifest baseObservationDim ${manifest.baseObservationDim} does not match ${definition.baseObservationDim}`);
  }
  if (manifest.inputDim !== definition.inputDim) {
    throw new Error(`Manifest inputDim ${manifest.inputDim} does not match ${definition.inputDim}`);
  }
  if (manifest.actionNvec.join(',') !== definition.actionNvec.join(',')) {
    throw new Error(`Manifest actionNvec ${manifest.actionNvec.join(',')} does not match ${definition.actionNvec.join(',')}`);
  }
}
