export type NeuralActivation = 'tanh' | 'linear';

export interface NeuralTensorLayout {
  offset: number;
  count: number;
}

export interface NeuralLayerManifest {
  name: string;
  inputDim: number;
  outputDim: number;
  activation: NeuralActivation;
  weights: NeuralTensorLayout;
  bias: NeuralTensorLayout;
}

export interface NeuralBrainManifest {
  version: 1;
  id: string;
  label: string;
  framework: 'sb3-ppo';
  policyType: 'mlp-multicategorical';
  mode: 'combat';
  observationVersion: number;
  envSpecVersion: number;
  frameStack: number;
  decisionInterval: number;
  baseObservationDim: number;
  inputDim: number;
  actionNvec: number[];
  weightsFile: string;
  checksumSha256: string;
  layers: NeuralLayerManifest[];
}

export interface NeuralDenseLayer {
  name: string;
  inputDim: number;
  outputDim: number;
  activation: NeuralActivation;
  weights: Float32Array;
  bias: Float32Array;
}

export interface NeuralMlpPolicy {
  manifest: NeuralBrainManifest;
  layers: NeuralDenseLayer[];
}

export interface NeuralPolicyResult {
  factors: Int32Array;
  logits: Float32Array;
}

export function validateNeuralBrainManifest(manifest: NeuralBrainManifest): void {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported neural brain manifest version: ${manifest.version}`);
  }
  if (manifest.inputDim !== manifest.baseObservationDim * manifest.frameStack) {
    throw new Error(
      `Invalid inputDim ${manifest.inputDim}; expected baseObservationDim * frameStack`
    );
  }
  const outputDim = manifest.actionNvec.reduce((sum, n) => sum + n, 0);
  if (manifest.layers.length === 0) {
    throw new Error('Neural brain manifest has no layers');
  }
  const lastLayer = manifest.layers[manifest.layers.length - 1];
  if (lastLayer.outputDim !== outputDim) {
    throw new Error(`Invalid action logits ${lastLayer.outputDim}; expected ${outputDim}`);
  }

  let previousOutput = manifest.inputDim;
  for (const layer of manifest.layers) {
    if (layer.inputDim !== previousOutput) {
      throw new Error(`Layer ${layer.name} inputDim ${layer.inputDim} does not match ${previousOutput}`);
    }
    if (layer.weights.count !== layer.inputDim * layer.outputDim) {
      throw new Error(`Layer ${layer.name} weight count mismatch`);
    }
    if (layer.bias.count !== layer.outputDim) {
      throw new Error(`Layer ${layer.name} bias count mismatch`);
    }
    previousOutput = layer.outputDim;
  }
}

export function buildMlpPolicy(
  manifest: NeuralBrainManifest,
  packedWeights: Float32Array
): NeuralMlpPolicy {
  validateNeuralBrainManifest(manifest);
  const layers = manifest.layers.map((layer) => {
    const weightEnd = layer.weights.offset + layer.weights.count;
    const biasEnd = layer.bias.offset + layer.bias.count;
    if (weightEnd > packedWeights.length || biasEnd > packedWeights.length) {
      throw new Error(`Layer ${layer.name} reads beyond packed weight buffer`);
    }
    return {
      name: layer.name,
      inputDim: layer.inputDim,
      outputDim: layer.outputDim,
      activation: layer.activation,
      weights: packedWeights.subarray(layer.weights.offset, weightEnd),
      bias: packedWeights.subarray(layer.bias.offset, biasEnd),
    };
  });

  return { manifest, layers };
}

export function runGreedyPolicy(policy: NeuralMlpPolicy, input: Float32Array): NeuralPolicyResult {
  const logits = runMlp(policy, input);
  return {
    logits,
    factors: selectGreedyFactors(logits, policy.manifest.actionNvec),
  };
}

export function runSampledPolicy(
  policy: NeuralMlpPolicy,
  input: Float32Array,
  random: () => number = Math.random
): NeuralPolicyResult {
  const logits = runMlp(policy, input);
  return {
    logits,
    factors: selectSampledFactors(logits, policy.manifest.actionNvec, random),
  };
}

export function runSampledPolicyWithGreedyFactors(
  policy: NeuralMlpPolicy,
  input: Float32Array,
  greedyFactorIndexes: Iterable<number>,
  random: () => number = Math.random
): NeuralPolicyResult {
  const logits = runMlp(policy, input);
  const factors = selectSampledFactors(logits, policy.manifest.actionNvec, random);
  const greedy = selectGreedyFactors(logits, policy.manifest.actionNvec);
  for (const factorIndex of greedyFactorIndexes) {
    if (factorIndex >= 0 && factorIndex < factors.length) {
      factors[factorIndex] = greedy[factorIndex];
    }
  }
  return { logits, factors };
}

export function runMlp(policy: NeuralMlpPolicy, input: Float32Array): Float32Array {
  if (input.length !== policy.manifest.inputDim) {
    throw new Error(`Neural input length ${input.length} does not match ${policy.manifest.inputDim}`);
  }

  let current = input;
  for (const layer of policy.layers) {
    const next = new Float32Array(layer.outputDim);
    for (let out = 0; out < layer.outputDim; out++) {
      let sum = layer.bias[out];
      const row = out * layer.inputDim;
      for (let i = 0; i < layer.inputDim; i++) {
        sum += layer.weights[row + i] * current[i];
      }
      next[out] = layer.activation === 'tanh' ? Math.tanh(sum) : sum;
    }
    current = next;
  }
  return current;
}

export function selectGreedyFactors(logits: Float32Array, actionNvec: ArrayLike<number>): Int32Array {
  const factors = new Int32Array(actionNvec.length);
  let offset = 0;
  for (let factorIndex = 0; factorIndex < actionNvec.length; factorIndex++) {
    const width = actionNvec[factorIndex];
    if (width <= 0) {
      throw new Error(`Invalid action factor width ${width}`);
    }
    let best = 0;
    let bestLogit = -Infinity;
    for (let i = 0; i < width; i++) {
      const value = logits[offset + i];
      if (value > bestLogit) {
        bestLogit = value;
        best = i;
      }
    }
    factors[factorIndex] = best;
    offset += width;
  }
  if (offset !== logits.length) {
    throw new Error(`Logit length ${logits.length} does not match action factors ${offset}`);
  }
  return factors;
}

export function selectSampledFactors(
  logits: Float32Array,
  actionNvec: ArrayLike<number>,
  random: () => number = Math.random
): Int32Array {
  const factors = new Int32Array(actionNvec.length);
  let offset = 0;
  for (let factorIndex = 0; factorIndex < actionNvec.length; factorIndex++) {
    const width = actionNvec[factorIndex];
    if (width <= 0) {
      throw new Error(`Invalid action factor width ${width}`);
    }

    let maxLogit = -Infinity;
    for (let i = 0; i < width; i++) {
      maxLogit = Math.max(maxLogit, logits[offset + i]);
    }

    let total = 0;
    for (let i = 0; i < width; i++) {
      total += Math.exp(logits[offset + i] - maxLogit);
    }

    let draw = Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * total;
    let selected = width - 1;
    for (let i = 0; i < width; i++) {
      draw -= Math.exp(logits[offset + i] - maxLogit);
      if (draw <= 0) {
        selected = i;
        break;
      }
    }
    factors[factorIndex] = selected;
    offset += width;
  }
  if (offset !== logits.length) {
    throw new Error(`Logit length ${logits.length} does not match action factors ${offset}`);
  }
  return factors;
}

export class NeuralFrameStack {
  private readonly buffer: Float32Array;

  constructor(
    private readonly frameStack: number,
    private readonly baseObservationDim: number
  ) {
    if (frameStack <= 0 || baseObservationDim <= 0) {
      throw new Error('NeuralFrameStack requires positive dimensions');
    }
    this.buffer = new Float32Array(frameStack * baseObservationDim);
  }

  reset(): void {
    this.buffer.fill(0);
  }

  push(observation: Float32Array): Float32Array {
    if (observation.length !== this.baseObservationDim) {
      throw new Error(
        `Observation length ${observation.length} does not match ${this.baseObservationDim}`
      );
    }
    this.buffer.copyWithin(0, this.baseObservationDim);
    this.buffer.set(observation, (this.frameStack - 1) * this.baseObservationDim);
    return this.buffer;
  }

  current(): Float32Array {
    return this.buffer;
  }
}
