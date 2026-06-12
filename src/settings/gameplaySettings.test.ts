import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ADMIN_SETTINGS,
  createDefaultAdminSettings,
  withDefaultGameplaySettings,
} from './gameplaySettings';

test('default gameplay settings use the recommended V3 visual model policy', () => {
  assert.equal(DEFAULT_ADMIN_SETTINGS.visualModelPolicy, 'v3');
  assert.equal(createDefaultAdminSettings('Player').visualModelPolicy, 'v3');
  assert.equal(withDefaultGameplaySettings({}).visualModelPolicy, 'v3');
});

test('default rollout preserves explicit legacy visual model policy choices', () => {
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
});
