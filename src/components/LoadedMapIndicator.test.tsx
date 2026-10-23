import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadedMapIndicator } from './LoadedMapIndicator';
import { createPublishedMapSnapshot } from '../game/mapBalancing';

test('host, client and training indicators describe their loaded map, including all three axes', () => {
  const map = createPublishedMapSnapshot('championship_stadium', { version: 17, settings: { mapScaleStadiumLength: 125, mapScaleStadiumWidth: 75, mapScaleStadiumHeight: 60 } })!;
  for (const session of ['Training', 'Host', 'Client', 'Observer']) {
    const html = renderToStaticMarkup(<LoadedMapIndicator map={map} session={session} />);
    for (const text of ['Loaded map', session, 'Championship Stadium', 'Length 125%', 'Width 75%', 'Height 60%', 'Preset v17']) assert.ok(html.includes(text), text);
  }
});

test('missing and legacy preset metadata never claims the latest published version', () => {
  const fallback = createPublishedMapSnapshot('championship_stadium', null)!;
  assert.match(renderToStaticMarkup(<LoadedMapIndicator map={fallback} session="Training" />), /No published preset · authored size/);
  for (const version of [undefined, NaN, -1, 0, 1.5]) {
    const html = renderToStaticMarkup(<LoadedMapIndicator map={{ ...fallback, balancePresetVersion: version }} session="Client" />);
    assert.match(html, /Preset version unavailable/);
    assert.doesNotMatch(html, /Preset v\d/);
  }
});
