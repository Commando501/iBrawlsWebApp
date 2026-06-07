import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAdminSettings } from '../../settings/gameplaySettings';
import type { ReplayFile } from '../../types';
import { getVisibleReplayHeatmapEvents } from '../replay/ReplayHeatmapCanvas';
import {
  flushReplayHeatmapEventsForState,
  queueReplayHeatmapDeathEventsForState,
  queueReplayHeatmapMedalEventsForState,
} from './replayHeatmapRuntime';
import { createInitialGrifballRuntimeState } from './runtimeState';

function makeState() {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: createDefaultAdminSettings('Player'),
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.replayHeatmapRecordingActive = true;
  state.replayHeatmapElapsedTime = 12.5;
  state.playerPos.set(1, 0, 2);
  return state;
}

function makeReplay(): ReplayFile {
  return {
    id: 'rp_heatmap',
    name: 'Heatmap Test',
    description: '',
    date: new Date(0).toISOString(),
    duration: 30,
    playerHue: 200,
    playerName: 'Player',
    opponentName: 'Bot',
    mapType: 'rectangular',
    mode: 'sandbox',
    maxScore: 10,
    frames: [],
  };
}

test('queueReplayHeatmapDeathEventsForState records paired kill and death points', () => {
  const state = makeState();

  const events = queueReplayHeatmapDeathEventsForState({
    state,
    attacker: { id: 'player', team: 'blue', pos: { x: 1, z: 2 } },
    victim: { id: 'bot_1', team: 'red', pos: { x: -3, z: 4 } },
    weapon: 'sword',
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'kill');
  assert.equal(events[0].time, 12.5);
  assert.equal(events[0].actorId, 'player');
  assert.equal(events[0].victimId, 'bot_1');
  assert.deepEqual(events[0].position, { x: 1, z: 2 });
  assert.equal(events[0].team, 'blue');
  assert.equal(events[1].kind, 'death');
  assert.equal(events[1].actorId, 'bot_1');
  assert.equal(events[1].victimId, 'player');
  assert.deepEqual(events[1].position, { x: -3, z: 4 });
  assert.equal(events[1].team, 'red');
});

test('queueReplayHeatmapDeathEventsForState is a no-op when recording is inactive', () => {
  const state = makeState();
  state.replayHeatmapRecordingActive = false;

  const events = queueReplayHeatmapDeathEventsForState({
    state,
    attacker: { id: 'player', team: 'blue', pos: { x: 1, z: 2 } },
    victim: { id: 'bot_1', team: 'red', pos: { x: -3, z: 4 } },
  });

  assert.equal(events.length, 0);
  assert.equal(state.pendingReplayHeatmapEvents.length, 0);
});

test('queueReplayHeatmapMedalEventsForState preserves medal payload and actor location', () => {
  const state = makeState();

  const events = queueReplayHeatmapMedalEventsForState({
    state,
    actor: { id: 'player', team: 'blue', pos: { x: 1, z: 2 } },
    medals: [
      {
        id: 'killing_spree',
        name: 'Killing Spree',
        icon: 'killingspree',
        color: '#facc15',
        description: '5 kills without dying',
      },
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'medal');
  assert.equal(events[0].medalId, 'killing_spree');
  assert.equal(events[0].medalName, 'Killing Spree');
  assert.equal(events[0].medalColor, '#facc15');
  assert.deepEqual(events[0].position, { x: 1, z: 2 });
});

test('flushReplayHeatmapEventsForState appends queued events and clears state', () => {
  const state = makeState();
  const replay = makeReplay();
  const replayRecordingRef = { current: replay };

  queueReplayHeatmapDeathEventsForState({
    state,
    attacker: { id: 'player', team: 'blue', pos: { x: 1, z: 2 } },
    victim: { id: 'bot_1', team: 'red', pos: { x: -3, z: 4 } },
  });
  flushReplayHeatmapEventsForState({ state, replayRecordingRef });

  assert.equal(replay.heatmap?.version, 1);
  assert.equal(replay.heatmap?.events.length, 2);
  assert.equal(state.pendingReplayHeatmapEvents.length, 0);
});

test('getVisibleReplayHeatmapEvents honors time and layer filters', () => {
  const replay = makeReplay();
  replay.heatmap = {
    version: 1,
    events: [
      { id: 'a', kind: 'kill', time: 1, actorId: 'player', team: 'blue', position: { x: 0, z: 0 } },
      { id: 'b', kind: 'death', time: 2, actorId: 'bot', team: 'red', position: { x: 1, z: 1 } },
      { id: 'c', kind: 'medal', time: 3, actorId: 'player', team: 'blue', position: { x: 2, z: 2 } },
    ],
  };

  const visible = getVisibleReplayHeatmapEvents({
    replay,
    time: 2,
    filters: { kills: true, deaths: false, medals: true },
  });

  assert.deepEqual(visible.map((event) => event.id), ['a']);
});
