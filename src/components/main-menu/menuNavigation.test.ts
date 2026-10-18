import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MENU_LOCATION, menuBackTarget, navigateMenu, parseMenuLocation } from './menuNavigation';

test('utility journeys return to the originating screen, including nested settings', () => {
  let location = navigateMenu(DEFAULT_MENU_LOCATION, 'tournament');
  location = navigateMenu(location, 'profile');
  location = navigateMenu(location, 'settings', 'saves');
  assert.equal(menuBackTarget(location), 'tournament');
  assert.equal(location.settingsSection, 'saves');
  location = navigateMenu(location, 'social');
  assert.equal(menuBackTarget(location), 'tournament');
  assert.equal(menuBackTarget(navigateMenu(location, 'ai-editor')), 'create');
});

test('invalid saved navigation cannot trap the user or select missing settings', () => {
  for (const raw of ['broken', 'null', '[]', '{"screen":"missing"}']) assert.deepEqual(parseMenuLocation(raw), DEFAULT_MENU_LOCATION);
  assert.deepEqual(parseMenuLocation('{"screen":"settings","returnScreen":"profile","settingsSection":"missing"}'), { screen:'settings', returnScreen:'play', settingsSection:'controls' });
});

test('sound settings survive navigation persistence', () => {
  const location = navigateMenu(DEFAULT_MENU_LOCATION, 'settings', 'sound');
  assert.deepEqual(parseMenuLocation(JSON.stringify(location)), location);
});

test('legacy menu destinations migrate to their production replacement', () => {
  const legacy = { parent:'customization',playChild:'single',customizationChild:'gamepad',systemChild:'service' };
  assert.equal(parseMenuLocation(null,legacy).settingsSection,'gamepad');
  assert.equal(parseMenuLocation(null,{...legacy,parent:'system'}).screen,'career');
  assert.equal(parseMenuLocation(null,{...legacy,parent:'play',playChild:'theater'}).screen,'theater');
  assert.equal(parseMenuLocation(null,{...legacy,parent:'play',playChild:'multi'}).screen,'online');
  assert.equal(parseMenuLocation(null,{...legacy,parent:'tools'}).screen,'create');
});
