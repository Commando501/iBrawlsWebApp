import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAIN_MENU_NAV,
  parseStoredMainMenuNav,
} from './useMainMenuNav';

test('parseStoredMainMenuNav returns defaults when storage is empty', () => {
  assert.deepEqual(parseStoredMainMenuNav(null), DEFAULT_MAIN_MENU_NAV);
});

test('parseStoredMainMenuNav restores a fully valid stored selection', () => {
  const stored = JSON.stringify({
    parent: 'customization',
    playChild: 'theater',
    customizationChild: 'gamepad',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), {
    parent: 'customization',
    playChild: 'theater',
    customizationChild: 'gamepad',
  });
});

test('parseStoredMainMenuNav replaces unknown values field-by-field', () => {
  const stored = JSON.stringify({
    parent: 'tools',
    playChild: 'battle-royale',
    customizationChild: 'identity',
  });

  assert.deepEqual(parseStoredMainMenuNav(stored), {
    parent: 'tools',
    playChild: DEFAULT_MAIN_MENU_NAV.playChild,
    customizationChild: 'identity',
  });
});

test('parseStoredMainMenuNav falls back to defaults on malformed JSON', () => {
  assert.deepEqual(parseStoredMainMenuNav('{'), DEFAULT_MAIN_MENU_NAV);
});

test('parseStoredMainMenuNav falls back to defaults on non-object payloads', () => {
  assert.deepEqual(parseStoredMainMenuNav('null'), DEFAULT_MAIN_MENU_NAV);
  assert.deepEqual(parseStoredMainMenuNav('"single"'), DEFAULT_MAIN_MENU_NAV);
});
