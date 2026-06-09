import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOBBY_CHAT_MAX_TEXT_LENGTH,
  LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS,
  LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES,
  LOBBY_CHAT_RATE_LIMIT_WINDOW_MS,
  createLobbyChatRateLimitState,
  normalizeLobbyChatText,
  validateLobbyChatMessage,
} from '../../worker/src/lobbyChatRateLimit';

test('normalizes global chat text and rejects empty or oversized messages', () => {
  assert.equal(normalizeLobbyChatText('  hello \n world  '), 'hello world');
  assert.equal(normalizeLobbyChatText('   '), null);
  assert.equal(normalizeLobbyChatText('x'.repeat(LOBBY_CHAT_MAX_TEXT_LENGTH + 1)), null);
});

test('allows a short burst before applying global chat cooldown', () => {
  const state = createLobbyChatRateLimitState();
  const now = 1_000;

  for (let i = 0; i < LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES; i++) {
    const result = validateLobbyChatMessage(
      { sender: ' Pilot ', text: ` message ${i} ` },
      state,
      'Fallback',
      now + i,
    );
    assert.deepEqual(result, { ok: true, sender: 'Pilot', text: `message ${i}` });
  }

  const limited = validateLobbyChatMessage(
    { sender: 'Pilot', text: 'too fast' },
    state,
    'Fallback',
    now + LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES,
  );

  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterMs, LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS);
});

test('expires old global chat timestamps after the rate-limit window', () => {
  const state = createLobbyChatRateLimitState();

  for (let i = 0; i < LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES; i++) {
    validateLobbyChatMessage({ text: `message ${i}` }, state, 'Fallback', i);
  }

  const result = validateLobbyChatMessage(
    { text: 'after window' },
    state,
    'Fallback',
    LOBBY_CHAT_RATE_LIMIT_WINDOW_MS + 1,
  );

  assert.deepEqual(result, { ok: true, sender: 'Fallback', text: 'after window' });
});

test('counts invalid global chat attempts against the rate limit', () => {
  const state = createLobbyChatRateLimitState();

  for (let i = 0; i < LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES; i++) {
    const result = validateLobbyChatMessage({ text: '   ' }, state, 'Fallback', i);
    assert.equal(result.ok, false);
  }

  const limited = validateLobbyChatMessage(
    { text: 'valid after invalid spam' },
    state,
    'Fallback',
    LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES,
  );

  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterMs, LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS);
});
