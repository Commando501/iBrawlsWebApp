import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MOBILE_UI_POSITIONS,
  getDefaultUiLayouts,
  normalizeUiLayouts,
} from './hudLayouts';

test('default HUD layouts include medal popup on desktop and mobile', () => {
  const layouts = getDefaultUiLayouts();
  assert.ok(layouts.desktop.some(item => item.id === 'medalPopup'));
  assert.ok(layouts.mobile.some(item => item.id === 'medalPopup'));
});

test('legacy single-array HUD layout migrates to desktop and default mobile', () => {
  const layouts = normalizeUiLayouts([
    { id: 'scoreboard', name: 'Scoreboard', x: 40, y: 6, locked: false, scale: 1.25 },
  ]);

  assert.equal(layouts.desktop.find(item => item.id === 'scoreboard')?.x, 40);
  assert.equal(layouts.mobile.find(item => item.id === 'scoreboard')?.x, DEFAULT_MOBILE_UI_POSITIONS.find(item => item.id === 'scoreboard')?.x);
});

test('mobile reset discards saved mobile layout but preserves desktop', () => {
  const layouts = normalizeUiLayouts({
    desktop: [{ id: 'scoreboard', name: 'Scoreboard', x: 42, y: 3, locked: true, scale: 1 }],
    mobile: [{ id: 'scoreboard', name: 'Scoreboard', x: 12, y: 99, locked: true, scale: 1 }],
  }, true);

  assert.equal(layouts.desktop.find(item => item.id === 'scoreboard')?.x, 42);
  assert.notEqual(layouts.mobile.find(item => item.id === 'scoreboard')?.x, 12);
});
