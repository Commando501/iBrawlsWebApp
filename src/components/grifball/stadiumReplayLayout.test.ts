import assert from 'node:assert/strict';
import test from 'node:test';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import type { ReplayFile } from '../../types';
import type { LastRecordedReplayEntityState } from './runtimeRefs';
import { resolveActiveCustomMap } from './mapSelection';
import { initializeReplayRecordingForState } from './replayRecordingRuntime';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { resolveReplayHeatmapMapBounds } from '../replay/ReplayHeatmapCanvas';
import { stripReplayPII } from '../../services/replayUpload';
import { resolveTopDownMapBounds } from '../loading/topDownMapModel';

function record(selectedMap: string): ReplayFile {
  const state = createInitialGrifballRuntimeState({ adminSettings: { ...DEFAULT_ADMIN_SETTINGS }, debugMode: false, isMultiplayer: false, multiplayerRole: null });
  const replayRecordingRef: { current: ReplayFile | null } = { current: null };
  initializeReplayRecordingForState({ state, replayData: null, replayRecordingRef, selectedMap,
    adminSettings: state.settings, lastRecordTimeRef: { current: 0 }, replayRecordingElapsedTimeRef: { current: 0 },
    lastRecordedStateRef: { current: new Map<string, LastRecordedReplayEntityState>() },
  });
  return replayRecordingRef.current!;
}

test('new Stadium recordings retain their layout revision through JSON export and playback selection', () => {
  const recording = record('championship_stadium');
  assert.equal(recording.stadiumLayoutRevision, 2);
  const imported = JSON.parse(JSON.stringify(stripReplayPII(recording))) as ReplayFile;
  const map = resolveActiveCustomMap({ selectedMap: 'hangar', replayData: imported, gameMode: 'grifball' })!;
  assert.deepEqual(map.arenaHalfExtents, { x: 61.5, z: 33.08 });
  assert.deepEqual(map.objects.map(object => object.position.x), [-56.5, 56.5]);
  const heatmap = resolveReplayHeatmapMapBounds(imported);
  assert.equal(heatmap.halfX, map.arenaHalfExtents!.x);
  assert.equal(heatmap.halfZ, map.arenaHalfExtents!.z);
  assert.deepEqual(heatmap.map!.objects.map(object => object.position.x), [-56.5, 56.5]);
  const preview = resolveTopDownMapBounds({ selectedMap: 'hangar', replayData: imported });
  assert.equal(preview.halfX, 61.5);
  assert.equal(preview.halfZ, 33.08);
});

test('old Stadium recordings with no revision retain original walls and goals', () => {
  const legacy = record('championship_stadium');
  delete legacy.stadiumLayoutRevision;
  for (const revision of [undefined, 1] as const) {
    legacy.stadiumLayoutRevision = revision;
    const map = resolveActiveCustomMap({ selectedMap: 'circle', replayData: legacy, gameMode: 'grifball' })!;
    assert.deepEqual(map.arenaHalfExtents, { x: 52, z: 23 });
    assert.deepEqual(map.objects.map(object => object.position.x), [-47, 47]);
    assert.equal(map.teamSpawns!.blue[0].x, -47);
    const heatmap = resolveReplayHeatmapMapBounds(legacy);
    assert.equal(heatmap.halfX, 52);
    assert.equal(heatmap.halfZ, 23);
    assert.deepEqual(heatmap.map!.objects.map(object => object.position.x), [-47, 47]);
    const preview = resolveTopDownMapBounds({ selectedMap: 'circle', replayData: legacy });
    assert.equal(preview.halfX, 52);
    assert.equal(preview.halfZ, 23);
  }
  assert.deepEqual(PREMADE_MAPS.find(map => map.id === 'championship_stadium')!.arenaHalfExtents, { x: 61.5, z: 33.08 });
});

test('explicit custom map geometry wins over Stadium revisions for live games and replays', () => {
  const stadium = PREMADE_MAPS.find(map => map.id === 'championship_stadium')!;
  const custom = { ...stadium, arenaRadius: 80, arenaHalfExtents: { x: 80, z: 40 } };
  const legacy = record('championship_stadium');
  delete legacy.stadiumLayoutRevision;
  for (const replayData of [null, legacy, record('championship_stadium')]) {
    const result = resolveActiveCustomMap({ selectedMap: 'championship_stadium', customMap: custom, replayData, gameMode: 'grifball' });
    assert.equal(result, custom);
    assert.equal(resolveTopDownMapBounds({ selectedMap: 'championship_stadium', customMap: custom, replayData }).map, custom);
  }
});

test('non-Stadium recordings and map selection are unchanged', () => {
  const other = PREMADE_MAPS.find(map => map.id === 'forerunner_canyon')!;
  const recording = record(other.id);
  assert.equal(recording.stadiumLayoutRevision, undefined);
  assert.equal(resolveActiveCustomMap({ selectedMap: 'championship_stadium', replayData: recording }), other);
});
