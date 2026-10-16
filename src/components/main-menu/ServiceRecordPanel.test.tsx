import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceRecordPanel, formatCareerDuration, formatCareerPercent, formatCareerRatio } from './ServiceRecordPanel';
import { statTracker } from '../../stats/statTracker';
import { STAT_DEFINITIONS } from '../../stats/statDefinitions';
import { MEDAL_CATALOG } from '../../game/medalCatalog';

test('Career preserves zero-match and zero-death formatting', () => {
  assert.equal(formatCareerRatio(0, 0), '—');
  assert.equal(formatCareerRatio(14, 0), '14.00');
  assert.equal(formatCareerRatio(9, 4), '2.25');
  assert.equal(formatCareerPercent(0, 0), '—');
  assert.equal(formatCareerPercent(2, 3), '67%');
  assert.equal(formatCareerDuration(3661), '1h 1m');
  assert.equal(formatCareerDuration(119), '1m 59s');
});

test('Career reads real tracker totals and exposes every registered stat and medal', () => {
  const profile = statTracker.getProfile();
  const originalTotals = profile.totals;
  const originalModes = profile.modes;
  try {
    profile.totals = { 'combat.kills': 31, 'combat.deaths': 10, 'match.played': 5, 'match.wins': 3, 'medal.bulltrue': 7 };
    profile.modes = { 'offline:sandbox': { 'combat.kills': 31 } };
    const html = renderToStaticMarkup(<ServiceRecordPanel isSignedIn={false} active={false} onOpenProfile={() => {}} />);
    assert.match(html, />3.10</);
    assert.match(html, />60%</);
    for (const stat of STAT_DEFINITIONS.filter(entry => entry.category !== 'medals')) assert.ok(html.includes(stat.name), stat.id);
    for (const medal of Object.values(MEDAL_CATALOG)) assert.ok(html.includes(medal.name), medal.id);
    assert.match(html, /value="offline:sandbox"/);
    assert.doesNotMatch(html, /value="online:grifball"/);
    assert.match(html, /Sign in to sync/);
    assert.match(html, /merges automatically/);
  } finally {
    profile.totals = originalTotals;
    profile.modes = originalModes;
  }
});

test('An empty Career keeps stats available without invented progress', () => {
  const profile = statTracker.getProfile();
  const originalTotals = profile.totals;
  const originalModes = profile.modes;
  try {
    profile.totals = {};
    profile.modes = {};
    const html = renderToStaticMarkup(<ServiceRecordPanel isSignedIn active={false} onFindMatch={() => {}} />);
    assert.match(html, /Your story starts in the arena/);
    assert.match(html, /Find a match/);
    assert.match(html, /Account connected/);
    assert.doesNotMatch(html, /CLOUD_SYNC_ACTIVE|Level [0-9]|Experience points/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 6);
  } finally {
    profile.totals = originalTotals;
    profile.modes = originalModes;
  }
});
