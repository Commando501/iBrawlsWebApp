import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAIN_MENU_NAV,
  getMainMenuContentParent,
  selectMainMenuParentState,
  parseStoredMainMenuNav,
} from './useMainMenuNav';

test('parseStoredMainMenuNav returns defaults when storage is empty', () => {
  assert.deepEqual(parseStoredMainMenuNav(null), DEFAULT_MAIN_MENU_NAV);
});

test('parseStoredMainMenuNav restores a fully valid stored selection', () => {
  const stored = JSON.stringify({
    parent: 'customization',
    contentParent: 'customization',
    playChild: 'theater',
    customizationChild: 'gamepad',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), {
    parent: 'customization',
    contentParent: 'customization',
    playChild: 'theater',
    customizationChild: 'gamepad',
  });
});

test('parseStoredMainMenuNav migrates the removed identity customization page to armory', () => {
  const stored = JSON.stringify({
    parent: 'customization',
    contentParent: 'customization',
    playChild: 'single',
    customizationChild: 'identity',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), {
    parent: 'customization',
    contentParent: 'customization',
    playChild: 'single',
    customizationChild: 'armory',
  });
});

test('parseStoredMainMenuNav keeps a restored tools tab over the default content page', () => {
  const stored = JSON.stringify({
    parent: 'tools',
    playChild: 'battle-royale',
    customizationChild: 'identity',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), {
    parent: 'tools',
    contentParent: DEFAULT_MAIN_MENU_NAV.contentParent,
    playChild: DEFAULT_MAIN_MENU_NAV.playChild,
    customizationChild: DEFAULT_MAIN_MENU_NAV.customizationChild,
  });
});

test('parseStoredMainMenuNav migrates the removed spec tab to the default play child', () => {
  const stored = JSON.stringify({
    parent: 'play',
    playChild: 'spec',
    customizationChild: 'armory',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), DEFAULT_MAIN_MENU_NAV);
});

test('parseStoredMainMenuNav falls back to defaults on malformed JSON', () => {
  assert.deepEqual(parseStoredMainMenuNav('{'), DEFAULT_MAIN_MENU_NAV);
});

test('parseStoredMainMenuNav falls back to defaults on non-object payloads', () => {
  assert.deepEqual(parseStoredMainMenuNav('null'), DEFAULT_MAIN_MENU_NAV);
  assert.deepEqual(parseStoredMainMenuNav('"single"'), DEFAULT_MAIN_MENU_NAV);
});

test('selectMainMenuParentState opens tools without changing the current content parent', () => {
  const previous = {
    parent: 'customization' as const,
    contentParent: 'customization' as const,
    playChild: 'theater' as const,
    customizationChild: 'gamepad' as const,
  };

  assert.deepEqual(selectMainMenuParentState(previous, 'tools'), {
    ...previous,
    parent: 'tools',
    contentParent: 'customization',
  });
});

test('selectMainMenuParentState makes non-tools parents the active content parent', () => {
  const previous = {
    parent: 'tools' as const,
    contentParent: 'customization' as const,
    playChild: 'single' as const,
    customizationChild: 'armory' as const,
  };

  assert.deepEqual(selectMainMenuParentState(previous, 'play'), {
    ...previous,
    parent: 'play',
    contentParent: 'play',
  });
});

test('getMainMenuContentParent resolves missing contentParent for legacy stored nav', () => {
  assert.equal(getMainMenuContentParent({
    parent: 'tools',
  }), DEFAULT_MAIN_MENU_NAV.contentParent);
});
