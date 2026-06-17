import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYBINDINGS } from '../types';
import { normalizeKeybindings } from './keybindingNormalization';

test('default keybindings expose explicit pickup and move dash to LB', () => {
  assert.equal(DEFAULT_KEYBINDINGS.pickup, 'e');
  assert.equal(DEFAULT_KEYBINDINGS.gamepadPickup, 2);
  assert.equal(DEFAULT_KEYBINDINGS.gamepadDash, 4);
});

test('normalizing old saves adds pickup and migrates default dash from X to LB', () => {
  const normalized = normalizeKeybindings({
    gamepadDash: 2,
  });

  assert.equal(normalized.pickup, 'e');
  assert.equal(normalized.gamepadPickup, 2);
  assert.equal(normalized.gamepadDash, 4);
});

test('normalizing preserves explicit custom pickup and dash bindings', () => {
  const normalized = normalizeKeybindings({
    pickup: 'f',
    gamepadPickup: 6,
    gamepadDash: 2,
  });

  assert.equal(normalized.pickup, 'f');
  assert.equal(normalized.gamepadPickup, 6);
  assert.equal(normalized.gamepadDash, 2);
});
