import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveCombatantVisualModelSystem,
  resolveLoadoutForVisualPolicy,
} from './modelVisualPolicy';

test('visual policy v1 overrides personal loadout model system', () => {
  assert.equal(
    resolveCombatantVisualModelSystem({
      visualModelPolicy: 'v1',
      loadout: { modelSystem: 'v3' },
    }),
    'v1'
  );
});

test('visual policy v2 forces v2 model system', () => {
  assert.equal(
    resolveCombatantVisualModelSystem({
      visualModelPolicy: 'v2',
      loadout: { modelSystem: 'v3' },
    }),
    'v2'
  );
});

test('visual policy v3 preserves advanced visual model system', () => {
  assert.equal(
    resolveCombatantVisualModelSystem({
      visualModelPolicy: 'v3',
      loadout: { modelSystem: 'v1' },
    }),
    'v3'
  );
});

test('v1 visual policy strips personal loadout details', () => {
  assert.deepEqual(
    resolveLoadoutForVisualPolicy({
      visualModelPolicy: 'v1',
      loadout: { modelSystem: 'v3', modelType: 'large' } as any,
    }),
    { modelSystem: 'v1' }
  );
});

test('v2 visual policy forces v2 and normalizes v3 model type to medium', () => {
  assert.deepEqual(
    resolveLoadoutForVisualPolicy({
      visualModelPolicy: 'v2',
      loadout: { modelSystem: 'v3', modelType: 'large' } as any,
    }),
    { modelSystem: 'v2', modelType: 'medium' }
  );
});

test('v3 visual policy preserves sanitized advanced visual loadout details', () => {
  const loadout = resolveLoadoutForVisualPolicy({
      visualModelPolicy: 'v3',
      loadout: {
        modelSystem: 'v1',
        helmet: 'odst',
        hammerPreset: 'gravity-axe',
      },
    }) as any;

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.helmet, 'odst');
  assert.equal(loadout.hammerPreset, 'gravity-axe');
});
