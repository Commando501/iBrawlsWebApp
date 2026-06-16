import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KEYBINDINGS } from '../types';
import { createDefaultAdminSettings } from './gameplaySettings';
import { buildSaveData, decryptSaveCode, encryptSaveData } from './saveCodec';
import { getDefaultUiLayouts } from '../ui/hudLayouts';
import type { V3SuitProfileCatalog } from '../components/main-menu/v3ArmorSuitProfiles';

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

test('save codec round-trips optional V3 suit profile catalog', () => {
  const settings = createDefaultAdminSettings('Sptn-2468', 80);
  const profileCatalog: V3SuitProfileCatalog = {
    version: 1,
    profiles: [{
      version: 1,
      id: 'profile_alpha',
      name: 'Alpha Suit',
      modelSystem: 'v3',
      slotPieceIds: { helmet: 'piece_helmet' },
      createdAt: 1_000,
      updatedAt: 1_000,
    }],
  };
  const data = buildSaveData(
    settings,
    'Sptn-2468',
    getDefaultUiLayouts(),
    DEFAULT_KEYBINDINGS,
    undefined,
    undefined,
    profileCatalog
  );
  const decoded = decryptSaveCode(encryptSaveData(data));

  assert.deepEqual(decoded.v3SuitProfileCatalog, profileCatalog);
});
