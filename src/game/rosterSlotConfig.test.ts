import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import {
  mergeRosterSlotConfig,
  resolveKnobsFromRosterSlot,
  resolveRosterSlotForCombatant,
  rosterOverrideFromLegacyProps,
  rosterTemplateFromSettings,
} from './rosterSlotConfig';

test('rosterTemplateFromSettings mirrors sandbox AI panel fields', () => {
  const template = rosterTemplateFromSettings({
    ...DEFAULT_ADMIN_SETTINGS,
    aiDifficulty: 'custom',
    aiPlaystyle: 80,
    aiWeaponPrioritization: 100,
    aiArchetype: 'zoner',
  });

  assert.equal(template.difficulty, 'custom');
  assert.equal(template.playstyle, 80);
  assert.equal(template.weaponPrioritization, 100);
  assert.equal(template.archetype, 'zoner');
});

test('bots inherit template weapon prioritization when legacy props are defaults', () => {
  const settings = {
    ...DEFAULT_ADMIN_SETTINGS,
    aiDifficulty: 'custom',
    aiWeaponPrioritization: 100,
  };

  const slot = resolveRosterSlotForCombatant('bot_2', settings, {
    botDifficulties: { bot_2: 'normal' },
    botBehaviors: { bot_2: 'defensive' },
    botWeaponBehaviors: { bot_2: 'balanced' },
    botArchetypes: { bot_2: 'none' },
  });

  assert.equal(slot.weaponPrioritization, 100);

  const knobs = resolveKnobsFromRosterSlot(slot, [], settings);
  assert.equal(knobs.weaponPrioritization, 100);
});

test('legacy non-default weapon behavior still maps to prioritization override', () => {
  const override = rosterOverrideFromLegacyProps({
    weaponBehavior: 'sword_75_25',
  });
  const merged = mergeRosterSlotConfig(rosterTemplateFromSettings(DEFAULT_ADMIN_SETTINGS), override);
  assert.equal(merged.weaponPrioritization, 75);
});

test('main_ai slot reads sandbox settings, not stale botDifficulties defaults', () => {
  const settings = {
    ...DEFAULT_ADMIN_SETTINGS,
    aiDifficulty: 'custom',
    aiWeaponPrioritization: 100,
  };

  const slot = resolveRosterSlotForCombatant('main_ai', settings, {
    botDifficulties: { main_ai: 'normal' },
    botArchetypes: { main_ai: 'none' },
  });

  assert.equal(slot.difficulty, 'custom');
  assert.equal(slot.weaponPrioritization, 100);
});

test('main_ai and bot_2 share resolveKnobsFromRosterSlot path for custom template', () => {
  const settings = {
    ...DEFAULT_ADMIN_SETTINGS,
    aiDifficulty: 'custom',
    aiWeaponPrioritization: 100,
    aiPlaystyle: 25,
  };

  const mainSlot = resolveRosterSlotForCombatant('main_ai', settings, {});
  const botSlot = resolveRosterSlotForCombatant('bot_2', settings, {
    botDifficulties: { bot_2: 'custom' },
  });

  const mainKnobs = resolveKnobsFromRosterSlot(mainSlot, [], settings);
  const botKnobs = resolveKnobsFromRosterSlot(botSlot, [], settings);

  assert.equal(mainKnobs.weaponPrioritization, 100);
  assert.equal(botKnobs.weaponPrioritization, 100);
  assert.equal(mainKnobs.aiPlaystyle, 25);
  assert.equal(botKnobs.aiPlaystyle, 25);
});

test('preset difficulty with archetype resets playstyle before personality merge', () => {
  const slot = mergeRosterSlotConfig(
    rosterTemplateFromSettings(DEFAULT_ADMIN_SETTINGS),
    { difficulty: 'hard', archetype: 'zoner', playstyle: 100, weaponPrioritization: 100 }
  );

  const knobs = resolveKnobsFromRosterSlot(slot, [], DEFAULT_ADMIN_SETTINGS);
  assert.equal(knobs.aiPlaystyle, 28);
  assert.equal(knobs.weaponPrioritization, 82);
});
