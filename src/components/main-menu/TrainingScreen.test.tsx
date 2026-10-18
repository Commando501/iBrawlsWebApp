import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { TrainingScreen, parseTrainingMap, trainingDifficultyPreset, type TrainingScreenProps } from './TrainingScreen';

const noop = () => {};
const base = (): TrainingScreenProps => ({
  isOpen: true, isPlaying: false, offlineBotCount: 3,
  onOfflineBotCountChange: noop,
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'sandbox' },
  setAdminSettings: noop, playerName: 'Player', selectedMap: 'hangar',
  onSelectedMapChange: noop, lobbyCustomMapData: null, onCustomMapDataChange: noop,
  botColors: {}, setBotColors: noop, botDifficulties: {}, setBotDifficulties: noop,
  botArchetypes: {}, setBotArchetypes: noop, botModelTypes: {}, setBotModelTypes: noop,
  aiPresets: [], onClose: noop, onApplyAndResume: noop, onInitializeSimulation: noop,
});

test('Training keeps all actual arena maps and V1/V2/V3 policies available', () => {
  const html = renderToStaticMarkup(<TrainingScreen {...base()} />);
  for (const map of PREMADE_MAPS) assert.ok(html.includes(`value="${map.id}"`), map.id);
  assert.match(html, /Industrial Hangar/);
  assert.match(html, /Circle Arena/);
  assert.match(html, /Import custom map/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.match(html, /Version 3 Iron Vanguard/);
  assert.match(html, /You \+ 3 AI bots/);
  assert.match(html, /Start Training/);
});

test('Grifball shows the actual forced seven-bot roster and fixed count', () => {
  const props = base();
  props.adminSettings.gameMode = 'grifball';
  props.offlineBotCount = 2;
  const html = renderToStaticMarkup(<TrainingScreen {...props} />);
  assert.match(html, /You \+ 7 AI bots/);
  assert.match(html, /id="training-count"[^>]*disabled=""[^>]*value="7"/);
  assert.doesNotMatch(html, /Inactive slot/);
});

test('Custom AI presets keep their behavior without showing an archetype override', () => {
  const props = base();
  props.botDifficulties = { main_ai: 'custom-one' };
  props.aiPresets = [{ id: 'custom-one', name: 'Saved fighter', tuning: { aiReactionLatency: .25 } }];
  const html = renderToStaticMarkup(<TrainingScreen {...props} />);
  assert.match(html, /Saved fighter/);
  assert.match(html, /saved preset supplies/);
  assert.doesNotMatch(html, /id="training-bot-style"/);
});

test('Training presets cover all seven existing roster slots in their original order', () => {
  assert.deepEqual(Object.values(trainingDifficultyPreset('graduated')), ['easy', 'normal', 'normal', 'hard', 'hard', 'nightmare', 'nightmare']);
  assert.equal(Object.keys(trainingDifficultyPreset('normal')).length, 7);
  assert.equal(trainingDifficultyPreset('nightmare').main_ai, 'nightmare');
  assert.equal(trainingDifficultyPreset('nightmare').bot_7, 'nightmare');
});

test('Map import accepts every shipped map and preserves all authored metadata', () => {
  for (const map of PREMADE_MAPS) assert.deepEqual(parseTrainingMap(JSON.stringify(map)), map, map.id);
  const map = { name: 'Empty custom arena', objects: [], author: 'Author', arenaRadius: 32, arbitraryMetadata: true };
  const parsed = parseTrainingMap(JSON.stringify(map));
  assert.equal(parsed.name, map.name);
  assert.equal(parsed.author, 'Author');
  assert.equal(parsed.arenaRadius, 32);
  assert.deepEqual(parsed.spawnPoints, []);
});

test('Map import rejects broken objects and invalid JSON before invoking the game callback', () => {
  assert.throws(() => parseTrainingMap('{bad'), /not valid JSON/);
  assert.throws(() => parseTrainingMap('{"name":"Bad","objects":{}}'), /objects array/);
  assert.throws(() => parseTrainingMap('{"name":"Bad","objects":[{}]}'), /invalid shape or transform/);
  assert.throws(() => parseTrainingMap('{"name":"Bad","objects":[],"spawnPoints":[{}]}'), /invalid spawn points/);
  const props = { ...base(), selectedMap: 'custom_file' };
  const html = renderToStaticMarkup(<TrainingScreen {...props} />);
  assert.match(html, /Import a custom map to continue/);
  assert.match(html, /disabled=""[^>]*>Start Training/);
});
