import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  loadCollapsedSections,
  persistCollapsedSections,
  toggleCollapsedSection,
} from './useMainMenuAdminState';

test('loadCollapsedSections reads saved collapsed section state', () => {
  const storage = {
    getItem(key: string) {
      assert.equal(key, COLLAPSED_SECTIONS_STORAGE_KEY);
      return JSON.stringify({ gameplay: true, lighting: false });
    },
  };

  assert.deepEqual(loadCollapsedSections(storage), {
    gameplay: true,
    lighting: false,
  });
});

test('loadCollapsedSections falls back to an empty record when storage is missing or malformed', () => {
  assert.deepEqual(loadCollapsedSections({ getItem: () => null }), {});
  assert.deepEqual(loadCollapsedSections({ getItem: () => '{' }), {});
});

test('toggleCollapsedSection flips one section without mutating the previous record', () => {
  const previous = { gameplay: true, lighting: false };
  const next = toggleCollapsedSection(previous, 'gameplay');

  assert.deepEqual(previous, { gameplay: true, lighting: false });
  assert.deepEqual(next, { gameplay: false, lighting: false });
});

test('persistCollapsedSections writes the expected storage key and JSON payload', () => {
  const writes: Array<[string, string]> = [];
  persistCollapsedSections({ gameplay: true }, {
    setItem(key: string, value: string) {
      writes.push([key, value]);
    },
  });

  assert.deepEqual(writes, [[COLLAPSED_SECTIONS_STORAGE_KEY, '{"gameplay":true}']]);
});
