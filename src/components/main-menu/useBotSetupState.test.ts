import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultBotArchetypes,
  createDefaultBotBehaviors,
  createDefaultBotColors,
  createDefaultBotDifficulties,
  createDefaultBotWeaponBehaviors,
} from './useBotSetupState';

const BOT_SETUP_SLOT_IDS = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'];

test('bot setup defaults include every supported bot slot', () => {
  const expectedSlots = [...BOT_SETUP_SLOT_IDS].sort();

  assert.deepEqual(Object.keys(createDefaultBotDifficulties()).sort(), expectedSlots);
  assert.deepEqual(Object.keys(createDefaultBotBehaviors()).sort(), expectedSlots);
  assert.deepEqual(Object.keys(createDefaultBotWeaponBehaviors()).sort(), expectedSlots);
  assert.deepEqual(Object.keys(createDefaultBotArchetypes()).sort(), expectedSlots);
  assert.deepEqual(Object.keys(createDefaultBotColors()).sort(), expectedSlots);
});

test('bot setup defaults preserve the App bootstrap values', () => {
  assert.equal(createDefaultBotDifficulties().main_ai, 'normal');
  assert.equal(createDefaultBotBehaviors().main_ai, 'defensive');
  assert.equal(createDefaultBotWeaponBehaviors().main_ai, 'balanced');
  assert.equal(createDefaultBotArchetypes().main_ai, 'none');
  assert.equal(createDefaultBotColors().bot_3, 280);
});

test('bot setup default builders return fresh records', () => {
  const colors = createDefaultBotColors();
  colors.main_ai = 999;

  assert.equal(createDefaultBotColors().main_ai, 0);
});
