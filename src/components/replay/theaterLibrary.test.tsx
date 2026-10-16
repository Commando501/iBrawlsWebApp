import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReplayFile } from '../../types';
import { TheaterLibraryPanel } from './TheaterLibraryPanel';
import { InlineReplayHeatmap } from './InlineReplayHeatmap';
import {
  getTheaterCollection, getSelectedTheaterReplay, getHeatmapPreviewFrame,
  HEATMAP_PREVIEW_LOOP_MS, HEATMAP_PREVIEW_HOLD_MS,
} from './theaterLibrary';

function recording(id: string, changes: Partial<ReplayFile> = {}): ReplayFile {
  return { id, name: `Match ${id}`, description: 'A close finish', date: '2026-10-16T15:00:00Z', duration: 60,
    playerHue: 200, playerName: 'Pilot', opponentName: 'Rival', mapType: 'circle', mode: 'sandbox',
    maxScore: 25, frames: [], heatmap: { version: 1, events: [0, 10, 60].map((time, i) => ({
      id: `${id}-${i}`, kind: i === 0 ? 'kill' : i === 1 ? 'death' : 'medal', time,
      actorId: 'pilot', team: 'blue', position: { x: i, z: i },
    })) }, ...changes };
}
const noop = () => {};
function panelProps() {
  return { savedReplays: [recording('one'), recording('two')], cachedReplays: [recording('recent')],
    replaySizes: { one: 1024 }, replayUploadStatus: {}, searchQuery: '', mapFilter: 'all' as const, modeFilter: 'all' as const,
    onSearchQueryChange: noop, onMapFilterChange: noop, onModeFilterChange: noop, onEditReplay: noop,
    onDeleteReplay: noop, onContributeReplay: noop, onOpenHeatmapReplay: noop, onSaveCachedReplay: noop, onWatchReplay: noop };
}

test('Saved search intersects map and mode while all five Recent cache entries remain independent', () => {
  const saved = [recording('a'), recording('b', { mode: 'tournament', description: 'THE FINAL' }), recording('c', { mode: 'tournament', mapType: 'rectangular' })];
  const cache = Array.from({ length: 5 }, (_, i) => recording(`cache-${i}`));
  const params = { savedReplays: saved, cachedReplays: cache, searchQuery: '  final ', mapFilter: 'circle' as const, modeFilter: 'tournament' as const };
  assert.deepEqual(getTheaterCollection({ ...params, collection: 'saved' }).map((item) => item.id), ['b']);
  assert.equal(getTheaterCollection({ ...params, collection: 'recent' }), cache);
  assert.equal(cache.length, 5);
});

test('Selection survives metadata replacement, and deletion or filtering falls back to a visible replay', () => {
  const one = recording('one');
  const two = recording('two');
  assert.equal(getSelectedTheaterReplay([one, two], 'two'), two);
  const edited = { ...two, name: 'Edited match' };
  assert.equal(getSelectedTheaterReplay([one, edited], 'two'), edited);
  assert.equal(getSelectedTheaterReplay([one], 'two'), one);
  assert.equal(getSelectedTheaterReplay([], 'two'), null);
  // The same replay ID can exist in the Saved and Recent stores without crossing object identity.
  const recent = { ...two, isAutoSaved: true };
  assert.equal(getSelectedTheaterReplay([recent], 'two'), recent);
});

test('Preview includes events exactly at their timestamps, holds the last frame, then loops', () => {
  const replay = recording('events');
  const movingMs = HEATMAP_PREVIEW_LOOP_MS - HEATMAP_PREVIEW_HOLD_MS;
  assert.equal(getHeatmapPreviewFrame(replay, 0).eventCount, 1);
  assert.equal(getHeatmapPreviewFrame(replay, movingMs / 6 - 1).eventCount, 1);
  assert.equal(getHeatmapPreviewFrame(replay, movingMs / 6).eventCount, 2);
  assert.deepEqual(getHeatmapPreviewFrame(replay, movingMs), { time: 60, progress: 1, eventCount: 3, duration: 60 });
  assert.equal(getHeatmapPreviewFrame(replay, HEATMAP_PREVIEW_LOOP_MS - 1).eventCount, 3);
  assert.equal(getHeatmapPreviewFrame(replay, HEATMAP_PREVIEW_LOOP_MS).eventCount, 1);
  assert.deepEqual(getHeatmapPreviewFrame(replay, null), { time: undefined, progress: 1, eventCount: 3, duration: 60 });
});

test('Preview reaches late events when old duration metadata is short, and handles missing/zero recordings', () => {
  assert.equal(getHeatmapPreviewFrame(recording('late', { duration: 5 }), 10_500).time, 60);
  assert.equal(getHeatmapPreviewFrame(recording('bad', { duration: Number.NaN }), 10_500).eventCount, 3);
  assert.deepEqual(getHeatmapPreviewFrame(null, null), { time: undefined, progress: 1, eventCount: 0, duration: 0 });
  assert.equal(getHeatmapPreviewFrame(recording('zero', { duration: 0, heatmap: undefined }), 0).time, 0);
});

test('Theater renders a single selected match canvas rather than one canvas per replay', () => {
  const html = renderToStaticMarkup(<TheaterLibraryPanel {...panelProps()} />);
  assert.equal((html.match(/<canvas/g) ?? []).length, 1);
  assert.equal((html.match(/class="theater-replay-row"/g) ?? []).length, 2);
  for (const label of ['Watch replay', 'Edit details', 'Open heatmap', 'Contribute', 'Delete']) assert.ok(html.includes(label), label);
  assert.match(html, /3 \/ 3 events/);
});

test('Empty, loading, error, and legacy recordings retain the heatmap surface with meaningful explanations', () => {
  for (const [props, text] of [
    [{ replay: null }, 'Select a replay to see its heatmap'],
    [{ replay: null, libraryStatus: 'loading' as const }, 'Loading replay heatmap'],
    [{ replay: null, libraryStatus: 'error' as const }, 'Replay library unavailable'],
    [{ replay: recording('legacy', { heatmap: undefined }) }, 'No heatmap events in this recording'],
  ] as const) {
    const html = renderToStaticMarkup(<InlineReplayHeatmap {...props} />);
    assert.match(html, /theater-heatmap-surface/);
    assert.ok(html.includes(text));
    assert.match(html, /disabled="" aria-label="Play heatmap preview"/);
  }
});

test('Contribution status is keyed by selected replay and keeps an uploaded replay disabled', () => {
  const html = renderToStaticMarkup(<TheaterLibraryPanel {...panelProps()} replayUploadStatus={{ one: 'done', two: 'uploading' }} />);
  assert.match(html, /disabled=""[^>]*title="Send an anonymous, compressed replay[^>]*>Contributed/);
  assert.match(html, /Replay contributed to AI training/);
  assert.match(html, /Sending/);
  assert.doesNotMatch(html, /Sending anonymous replay/);
});

test('A retained inactive Theater keeps selection markup but releases its map canvas', () => {
  const html = renderToStaticMarkup(<TheaterLibraryPanel {...panelProps()} active={false} />);
  assert.equal((html.match(/<canvas/g) ?? []).length, 0);
  assert.match(html, /Match one/);
  assert.match(html, /data-playing="false"/);
});
