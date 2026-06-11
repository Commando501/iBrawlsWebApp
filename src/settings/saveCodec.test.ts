import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYBINDINGS } from '../types';
import { createDefaultAdminSettings } from './gameplaySettings';
import { buildSaveData, decryptSaveCode, encryptSaveData } from './saveCodec';
import { getDefaultUiLayouts } from '../ui/hudLayouts';

test('save codec round-trips exported data', () => {
  const settings = createDefaultAdminSettings('Sptn-1234', 210);
  const data = buildSaveData(settings, 'Sptn-1234', getDefaultUiLayouts(), DEFAULT_KEYBINDINGS);
  const encoded = encryptSaveData(data);
  const decoded = decryptSaveCode(encoded);

  assert.equal(decoded.playerName, 'Sptn-1234');
  assert.equal(decoded.playerHue, 210);
  assert.equal(decoded.adminSettings.swordLungeVfx, 'current');
  assert.ok(decoded.uiLayouts?.desktop.some(item => item.id === 'medalPopup'));
});

test('save codec preserves the selected visual model policy', () => {
  const settings = {
    ...createDefaultAdminSettings('Sptn-4321', 120),
    visualModelPolicy: 'v2' as const,
  };
  const data = buildSaveData(settings, 'Sptn-4321', getDefaultUiLayouts(), DEFAULT_KEYBINDINGS);
  const decoded = decryptSaveCode(encryptSaveData(data));

  assert.equal(decoded.adminSettings.visualModelPolicy, 'v2');
});
