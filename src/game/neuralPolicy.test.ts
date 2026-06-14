import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NeuralFrameStack,
  buildMlpPolicy,
  runGreedyPolicy,
  runSampledPolicy,
  runSampledPolicyWithGreedyFactors,
  selectGreedyFactors,
  selectSampledFactors,
  validateNeuralBrainManifest,
  type NeuralBrainManifest,
} from './neuralPolicy';

const manifest: NeuralBrainManifest = {
  version: 1,
  id: 'unit_brain',
  label: 'Unit Brain',
  framework: 'sb3-ppo',
  policyType: 'mlp-multicategorical',
  mode: 'combat',
  observationVersion: 1,
  envSpecVersion: 4,
  frameStack: 1,
  decisionInterval: 5,
  baseObservationDim: 2,
  inputDim: 2,
  actionNvec: [2, 3],
  weightsFile: 'weights.bin',
  checksumSha256: 'unit',
  layers: [
    {
      name: 'policy.0',
      inputDim: 2,
      outputDim: 2,
      activation: 'tanh',
      weights: { offset: 0, count: 4 },
      bias: { offset: 4, count: 2 },
    },
    {
      name: 'action',
      inputDim: 2,
      outputDim: 5,
      activation: 'linear',
      weights: { offset: 6, count: 10 },
      bias: { offset: 16, count: 5 },
    },
  ],
};

test('validateNeuralBrainManifest rejects shape mismatches before runtime', () => {
  assert.doesNotThrow(() => validateNeuralBrainManifest(manifest));
  assert.throws(
    () => validateNeuralBrainManifest({ ...manifest, inputDim: 3 }),
    /inputDim/
  );
  assert.throws(
    () => validateNeuralBrainManifest({ ...manifest, actionNvec: [2, 2] }),
    /action logits/
  );
});

test('buildMlpPolicy runs dense tanh layers and chooses greedy MultiDiscrete factors', () => {
  const weights = new Float32Array([
    1, 0,
    0, 1,
    0, 0,
    1, 0,
    0, 1,
    -1, 0,
    0, -1,
    0, 0,
    0.2, -0.1, 0.3, -0.4, 0.1,
  ]);
  const policy = buildMlpPolicy(manifest, weights);
  const result = runGreedyPolicy(policy, new Float32Array([2, 1]));

  assert.deepEqual(Array.from(result.factors), [0, 2]);
  assert.equal(result.logits.length, 5);
});

test('selectGreedyFactors splits logits by action nvec', () => {
  assert.deepEqual(
    Array.from(selectGreedyFactors(new Float32Array([0.1, 0.9, -1, 2, 1]), [2, 3])),
    [1, 1]
  );
});

test('selectSampledFactors samples each categorical factor from softmax logits', () => {
  const randomValues = [0.05, 0.95];
  const sampled = selectSampledFactors(
    new Float32Array([0, 0, 0, 0, 0]),
    [2, 3],
    () => randomValues.shift() ?? 0
  );

  assert.deepEqual(Array.from(sampled), [0, 2]);
});

test('runSampledPolicy preserves logits while using sampled factor choices', () => {
  const weights = new Float32Array([
    1, 0,
    0, 1,
    0, 0,
    1, 0,
    0, 1,
    -1, 0,
    0, -1,
    0, 0,
    0.2, -0.1, 0.3, -0.4, 0.1,
  ]);
  const policy = buildMlpPolicy(manifest, weights);
  const result = runSampledPolicy(policy, new Float32Array([2, 1]), () => 0);

  assert.equal(result.logits.length, 5);
  assert.deepEqual(Array.from(result.factors), [0, 0]);
});

test('runSampledPolicyWithGreedyFactors keeps selected factors deterministic', () => {
  const weights = new Float32Array([
    1, 0,
    0, 1,
    0, 0,
    1, 0,
    0, 1,
    -1, 0,
    0, -1,
    0, 0,
    0, 0, 0, 5, 1,
  ]);
  const policy = buildMlpPolicy(manifest, weights);
  const randomValues = [0.95, 0.01];

  const result = runSampledPolicyWithGreedyFactors(
    policy,
    new Float32Array([0, 0]),
    [1],
    () => randomValues.shift() ?? 0
  );

  assert.deepEqual(Array.from(result.factors), [1, 1]);
});

test('NeuralFrameStack appends observations on the trained decision cadence', () => {
  const stack = new NeuralFrameStack(3, 2);

  assert.deepEqual(Array.from(stack.push(new Float32Array([1, 2]))), [0, 0, 0, 0, 1, 2]);
  assert.deepEqual(Array.from(stack.push(new Float32Array([3, 4]))), [0, 0, 1, 2, 3, 4]);
  stack.reset();
  assert.deepEqual(Array.from(stack.current()), [0, 0, 0, 0, 0, 0]);
});

test('exported CombatDRV2 fixture matches the browser MLP runtime', () => {
  const dir = path.resolve('public/brains/combat_dr_v2');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as NeuralBrainManifest;
  const weightsBuffer = fs.readFileSync(path.join(dir, 'weights.bin'));
  const weights = new Float32Array(
    weightsBuffer.buffer.slice(weightsBuffer.byteOffset, weightsBuffer.byteOffset + weightsBuffer.byteLength)
  );
  const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8')) as {
    zeroObservation: { logits: number[]; factors: number[] };
  };

  const policy = buildMlpPolicy(manifest, weights);
  const result = runGreedyPolicy(policy, new Float32Array(manifest.inputDim));

  assert.deepEqual(Array.from(result.factors), fixture.zeroObservation.factors);
  for (let i = 0; i < result.logits.length; i++) {
    assert.ok(Math.abs(result.logits[i] - fixture.zeroObservation.logits[i]) < 1e-5);
  }
});
