import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { LightingSettingsModal } from './LightingSettingsModal';

test('LightingSettingsModal no longer exposes removed team overlay controls', () => {
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

  assert.doesNotMatch(html, /Team Outline Thickness/);
  assert.doesNotMatch(html, /Team Outline Brightness/);
  assert.doesNotMatch(html, /Team Outline Color/);


});

test('shared lighting settings expose local environment quality and explain when it takes effect', () => {
  const html = renderToStaticMarkup(
    <LightingSettingsModal adminSettings={DEFAULT_ADMIN_SETTINGS} setAdminSettings={() => {}} onClose={() => {}} />
  );
  assert.match(html, /<label[^>]*for="environment-quality"[^>]*>Environment quality<\/label>/);
  assert.match(html, /<select[^>]*id="environment-quality"/);
  for (const label of ['Auto', 'High', 'Balanced', 'Low']) assert.ok(html.includes(`>${label}</option>`));
  assert.match(html, /Applies when you start the next match\. Saved on this device\./);
  assert.match(html, /Direct Sunlight Intensity/);
  assert.match(html, /Skybox &amp; Fog Brightness/);
});
