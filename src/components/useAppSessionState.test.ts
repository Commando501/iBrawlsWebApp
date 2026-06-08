import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATA_NOTICE_SEEN_KEY,
  createInitialAppSessionSnapshot,
  markDataNoticeSeen,
  shouldShowDataNotice,
} from './useAppSessionState';

test('createInitialAppSessionSnapshot preserves App bootstrap defaults', () => {
  assert.deepEqual(createInitialAppSessionSnapshot(true), {
    forceMobileControls: false,
    isPlaying: false,
    matchResult: null,
    showDataNotice: true,
    isPaused: false,
    debugMode: false,
    isTerminated: false,
    showAdminPanel: false,
    showUiAdjustment: false,
    showLightingMenu: false,
    showKeybindsMenu: false,
    chatMessages: [],
  });
});

test('createInitialAppSessionSnapshot returns fresh chat message arrays', () => {
  const snapshot = createInitialAppSessionSnapshot();
  snapshot.chatMessages.push({
    id: 'msg-1',
    sender: 'Spartan',
    text: 'ready',
    timestamp: '2026-06-08T00:00:00.000Z',
    role: 'host',
    isLocal: true,
  });

  assert.deepEqual(createInitialAppSessionSnapshot().chatMessages, []);
});

test('shouldShowDataNotice mirrors the App first-run localStorage rule', () => {
  const values = new Map<string, string | null>([
    [DATA_NOTICE_SEEN_KEY, null],
  ]);

  assert.equal(shouldShowDataNotice({
    getItem: key => values.get(key) ?? null,
    setItem: () => {},
  }), true);

  values.set(DATA_NOTICE_SEEN_KEY, '1');
  assert.equal(shouldShowDataNotice({
    getItem: key => values.get(key) ?? null,
    setItem: () => {},
  }), false);
});

test('data notice helpers fail closed when storage throws', () => {
  assert.equal(shouldShowDataNotice({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
  }), false);

  assert.doesNotThrow(() => markDataNoticeSeen({
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
  }));
});

test('markDataNoticeSeen writes the expected storage key', () => {
  const writes: Array<[string, string]> = [];

  markDataNoticeSeen({
    getItem: () => null,
    setItem: (key, value) => {
      writes.push([key, value]);
    },
  });

  assert.deepEqual(writes, [[DATA_NOTICE_SEEN_KEY, '1']]);
});
