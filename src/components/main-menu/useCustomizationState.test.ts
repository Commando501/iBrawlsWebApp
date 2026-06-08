import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOADOUT } from '../VoxelModels';
import {
  PLAYER_LOADOUT_STORAGE_KEY,
  loadStoredPlayerLoadout,
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
