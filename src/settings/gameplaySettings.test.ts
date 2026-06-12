import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ADMIN_SETTINGS,
  createDefaultAdminSettings,
  withDefaultGameplaySettings,
} from './gameplaySettings';

test('default gameplay settings use the recommended V2 visual model policy', () => {
  assert.equal(DEFAULT_ADMIN_SETTINGS.visualModelPolicy, 'v2');
  assert.equal(createDefaultAdminSettings('Player').visualModelPolicy, 'v2');
  assert.equal(withDefaultGameplaySettings({}).visualModelPolicy, 'v2');
});

test('default rollout preserves gameplay-ready visual model policy choices and locks V3 to V2', () => {
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v3' }).visualModelPolicy, 'v2');
});
