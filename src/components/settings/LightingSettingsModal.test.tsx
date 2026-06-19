import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { LightingSettingsModal } from './LightingSettingsModal';

test('LightingSettingsModal exposes team outline controls', () => {
  const html = renderToStaticMarkup(
    <LightingSettingsModal
      adminSettings={{
        ...DEFAULT_ADMIN_SETTINGS,
        teamOutlineThickness: 0.1,
        teamOutlineBrightness: 0.85,
        teamOutlineColorMode: 'custom',
        teamOutlineColor: '#facc15',
      }}
      setAdminSettings={() => {}}
      onClose={() => {}}
    />
  );

  assert.match(html, /Team Outline Thickness/);
  assert.match(html, /Team Outline Brightness/);
  assert.match(html, /Team Outline Color/);
  assert.match(html, /type="color"/);
  assert.match(html, /value="#facc15"/);
});
