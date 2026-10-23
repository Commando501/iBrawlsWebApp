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

const renderLocalCarrierHud = (passCharge: number, prepareForPlay = false, crosshairColor: 'red' | 'white' = 'white') => {
  const stats: GameStats = {
    ...createInitialGameStats(90, 0),
    activeWeapon: prepareForPlay ? 'hammer' : 'ball',
    crosshairColor,
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
      localCarrying: !prepareForPlay,
      passCharge,
    },
  };

  const before = JSON.stringify(stats);
  const markup = renderToStaticMarkup(
    <HUD
      stats={stats}
      prepareForPlay={prepareForPlay}
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
  assert.equal(JSON.stringify(stats), before, 'rendering must not change gameplay stats');
  return markup;
};

test('local Grifball throw charge meter defaults below center with a larger rail', () => {
  const markup = renderLocalCarrierHud(0.63);

  assert.ok(markup.includes('top-[58%]'));
  assert.ok(markup.includes('-translate-y-1/2'));
  assert.ok(markup.includes('w-96'));
  assert.ok(markup.includes('h-5'));
  assert.ok(markup.includes('width:63%'));
});

test('runner weapon panel identifies the ball and explains dropping to restore a weapon', () => {
  const markup = renderLocalCarrierHud(0);
  assert.ok(markup.includes('Runner · Ball Equipped'));
  assert.ok(markup.includes('PUNCH:'));
  assert.ok(markup.includes('DROP &amp; RESTORE WEAPON:'));
  assert.ok(markup.includes('PUNCH RECOVERY'));
  assert.ok(!markup.includes('Gravity Hammer'));
  assert.ok(!markup.includes('VERTICAL CRUSH:'));
});

test('loading prepares the complete runner HUD without exposing controls or changing the equipped weapon', () => {
  const markup = renderLocalCarrierHud(0, true);
  assert.ok(markup.includes('inert=""'));
  assert.ok(markup.includes('aria-hidden="true"'));
  assert.ok(markup.includes('Runner · Ball Equipped'));
  assert.ok(markup.includes('Hold RMB Pass'));
  assert.ok(markup.includes('width:100%'));
  assert.ok(!markup.includes('Gravity Hammer'));
});

test('ball lock renders a red reticle and punch lunge prompt', () => {
  const markup = renderLocalCarrierHud(0, false, 'red');
  const crosshair = markup.slice(markup.indexOf('data-hud-id="crosshair"'));
  assert.ok(crosshair.includes('border-red-500'));
  assert.ok(crosshair.includes('Punch Lunge Ready'));
});

test('unlocked ball reticle stays white without a lunge prompt', () => {
  const markup = renderLocalCarrierHud(0);
  const crosshair = markup.slice(markup.indexOf('data-hud-id="crosshair"'));
  assert.ok(crosshair.includes('border-white bg-white/5'));
  assert.ok(!crosshair.includes('Punch Lunge Ready'));
});
