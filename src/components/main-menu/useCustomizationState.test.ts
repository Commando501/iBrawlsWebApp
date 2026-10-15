import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOADOUT } from '../VoxelModels';
import {
  PLAYER_LOADOUT_STORAGE_KEY,
  loadStoredPlayerLoadout,
  retainUnchangedCustomization,
} from './useCustomizationState';

const storageWithValue = (value: string | null) => ({
  getItem(key: string) {
    assert.equal(key, PLAYER_LOADOUT_STORAGE_KEY);
    return value;
  },
});

test('loadStoredPlayerLoadout returns the default loadout when storage is empty', () => {
  assert.deepEqual(loadStoredPlayerLoadout(storageWithValue(null)), DEFAULT_LOADOUT);
});

test('loadStoredPlayerLoadout merges saved partial loadout over defaults', () => {
  const loadout = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({
    helmet: 'odst',
    hammerPreset: 'gravity-axe',
  })));

  assert.equal(loadout.helmet, 'odst');
  assert.equal(loadout.torso, DEFAULT_LOADOUT.torso);
  assert.equal(loadout.hammerPreset, 'gravity-axe');
});

test('loadStoredPlayerLoadout falls back to defaults when storage is malformed', () => {
  assert.deepEqual(loadStoredPlayerLoadout(storageWithValue('{')), DEFAULT_LOADOUT);
});

test('loadStoredPlayerLoadout preserves V3 model system and valid V3 custom armor slots', () => {
  const voxels = Array.from({ length: 40 }, (_, index) => ({
    x: index % 7,
    y: Math.floor(index / 7) % 6,
    z: Math.floor(index / 42),
    role: 'primary' as const,
  }));
  const loadout = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({
    modelSystem: 'v3',
    customArmor: {
      forearmRight: {
        version: 1,
        id: 'v3-forearm',
        name: 'V3 Forearm',
        slot: 'forearmRight',
        modelSystem: 'v3',
        voxels,
        updatedAt: 1,
      },
    },
  })));

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.customArmor?.forearmRight?.modelSystem, 'v3');
  assert.equal(loadout.modelType, 'medium');
  assert.equal(loadout.characterAsset, 'iron-vanguard');
});

test('loadStoredPlayerLoadout keeps malformed saved loadouts on safe defaults', () => {
  const loadout = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({
    modelSystem: 'v4',
    modelType: 'large',
    customArmor: { rawMesh: { vertices: [1] } },
  })));

  assert.notEqual(loadout.modelSystem, 'v4' as any);
  assert.equal(loadout.customArmor, undefined);
});


test('repeated storage refreshes retain the loadout identity used to initialize the game scene', () => {
  const storage = storageWithValue(JSON.stringify({ helmet: 'odst', hammerPreset: 'gravity-axe' }));
  const current = loadStoredPlayerLoadout(storage);
  for (let focus = 0; focus < 3; focus += 1) {
    const refreshed = loadStoredPlayerLoadout(storage);
    assert.notEqual(refreshed, current);
    assert.equal(retainUnchangedCustomization(current, refreshed), current);
  }
});

test('storage refresh still applies a loadout edited in another window', () => {
  const current = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({ helmet: 'odst' })));
  const edited = loadStoredPlayerLoadout(storageWithValue(JSON.stringify({ hammerPreset: 'gravity-axe' })));
  assert.notDeepEqual(current, edited);
  assert.equal(retainUnchangedCustomization(current, edited), edited);
});

test('unchanged nested customization catalogs retain identity while nested edits are applied', () => {
  const current = { entries: [{ id: 'armor', voxels: [{ x: 1, y: 2, z: 3, role: 'primary' }] }] };
  const refreshed = JSON.parse(JSON.stringify(current));
  assert.equal(retainUnchangedCustomization(current, refreshed), current);
  refreshed.entries[0].voxels[0].x = 4;
  assert.equal(retainUnchangedCustomization(current, refreshed), refreshed);
});
