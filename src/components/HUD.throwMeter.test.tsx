import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_DESKTOP_UI_POSITIONS } from '../ui/hudLayouts';
import type { DeviceInfo, GameStats } from '../types';
import { HUD } from './HUD';
import { createInitialGameStats } from './hud/useCurrentGameStats';

const desktopDevice: DeviceInfo = {
  isMobile: false,
  os: 'desktop',
};

const renderLocalCarrierHud = (passCharge: number) => {
  const stats: GameStats = {
    ...createInitialGameStats(90, 0),
    grifball: {
      phase: 'playing',
      blueGoals: 0,
      redGoals: 0,
      goalTarget: 3,
      roundNumber: 1,
      countdown: 0,
      ballCarrierName: 'Player',
      ballCarrierTeam: 'blue',
      winningTeam: null,
      localTeam: 'blue',
      localCarrying: true,
      passCharge,
    },
  };

  return renderToStaticMarkup(
    <HUD
      stats={stats}
      onPauseClick={() => {}}
      uiPositions={DEFAULT_DESKTOP_UI_POSITIONS}
      uiDefaultPositions={DEFAULT_DESKTOP_UI_POSITIONS}
      onUpdateUiPositions={() => {}}
      isAdjustmentMode={false}
      deviceInfo={desktopDevice}
      forceMobileControls={false}
      mobileJoystickRef={{ current: { x: 0, y: 0 } }}
      mobileRightJoystickRef={{ current: { x: 0, y: 0 } }}
      mobileRightJoystickActiveRef={{ current: false }}
    />
  );
};

test('local Grifball throw charge meter defaults below center with a larger rail', () => {
  const markup = renderLocalCarrierHud(0.63);

  assert.ok(markup.includes('top-[58%]'));
  assert.ok(markup.includes('-translate-y-1/2'));
  assert.ok(markup.includes('w-96'));
  assert.ok(markup.includes('h-5'));
  assert.ok(markup.includes('width:63%'));
});
