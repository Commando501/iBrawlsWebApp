import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTheaterReplays } from './useTheaterReplays';

test('Theater starts with an unresolved loading state instead of presenting an empty library', () => {
  let initial: ReturnType<typeof useTheaterReplays> | undefined;
  function Probe() {
    initial = useTheaterReplays({ isTheaterTabActive: false, onWatchReplay: () => {} });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  assert.equal(initial!.theaterLibraryStatus, 'loading');
  assert.equal(initial!.theaterLibraryError, '');
  assert.equal(initial!.savedReplays.length, 0);
  assert.equal(initial!.cachedReplays.length, 0);
});
