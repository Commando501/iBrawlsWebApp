import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArmoryPanel } from './ArmoryPanel';
import { DEFAULT_LOADOUT } from '../VoxelModels';

const noop = () => {};

const baseProps = (modelSystem: 'v1' | 'v2' | 'v3'): ComponentProps<typeof ArmoryPanel> => ({
  isPainting: false,
  playerLoadout: { ...DEFAULT_LOADOUT, modelSystem },
  customArmorCatalog: { version: 1, pieces: [] },
  playerHue: 200,
  customizerWeapon: 'hammer',
  setPlayerLoadout: noop as React.Dispatch<React.SetStateAction<any>>,
  setIsPainting: noop as React.Dispatch<React.SetStateAction<boolean>>,
  setCustomizerWeapon: noop as React.Dispatch<React.SetStateAction<any>>,
  setAdminSettings: noop as React.Dispatch<React.SetStateAction<any>>,
});

test('ArmoryPanel renders V3 material role controls only for V3 loadouts', () => {
  const v3Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v3')} />);
  const v2Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v2')} />);

  assert.match(v3Html, /V3 Material Roles/);
  assert.match(v3Html, /Primary/);
  assert.match(v3Html, /Emissive/);
  assert.doesNotMatch(v2Html, /V3 Material Roles/);
});

test('ArmoryPanel presents original sword preset labels', () => {
  const html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v2')} />);

  assert.match(html, /Cyan Classic/);
  assert.match(html, /Twin Arc/);
  assert.match(html, /Prism Edge/);
  assert.match(html, /Emberline/);
  assert.match(html, /Aurum V/);
  assert.doesNotMatch(html, /Halo 2/);
  assert.doesNotMatch(html, /Halo 3/);
  assert.doesNotMatch(html, /Halo 4/);
  assert.doesNotMatch(html, /Halo 5/);
});
