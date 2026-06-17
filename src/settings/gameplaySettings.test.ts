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

test('default rollout preserves supported visual model policy choices', () => {
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v3' }).visualModelPolicy, 'v3');
});

test('default gameplay settings include Runner / Ball mechanics controls', () => {
  const defaults = DEFAULT_ADMIN_SETTINGS as any;

  assert.equal(defaults.grifballRunnerSpeedForward, 130);
  assert.equal(defaults.grifballRunnerSpeedSide, 130);
  assert.equal(defaults.grifballRunnerSpeedBackward, 130);
  assert.equal(defaults.grifballAllowThrowing, true);
  assert.equal(defaults.grifballTrajectoryLineThickness, 0.14);
  assert.equal(defaults.grifballTrajectoryLineColor, '#ff2b2b');
  assert.equal(defaults.grifballPunchLungeDistance, 1.8);
  assert.equal(defaults.grifballPunchCooldown, 0.5);
  assert.equal(defaults.grifballRunnerHealth, 2);
  assert.equal(defaults.grifballRunnerHealDelay, 3.0);
  assert.equal(defaults.grifballRunnerHealRate, 1.0);
  assert.equal(defaults.grifballAllowRunnerThrust, true);
});

test('saved gameplay settings backfill Runner / Ball defaults', () => {
  const settings = withDefaultGameplaySettings({ maxHP: 7 } as any) as any;

  assert.equal(settings.maxHP, 7);
  assert.equal(settings.grifballRunnerSpeedForward, 130);
  assert.equal(settings.grifballRunnerSpeedSide, 130);
  assert.equal(settings.grifballRunnerSpeedBackward, 130);
  assert.equal(settings.grifballAllowThrowing, true);
  assert.equal(settings.grifballTrajectoryLineThickness, 0.14);
  assert.equal(settings.grifballTrajectoryLineColor, '#ff2b2b');
  assert.equal(settings.grifballPunchLungeDistance, 1.8);
  assert.equal(settings.grifballPunchCooldown, 0.5);
  assert.equal(settings.grifballRunnerHealth, 2);
  assert.equal(settings.grifballRunnerHealDelay, 3.0);
  assert.equal(settings.grifballRunnerHealRate, 1.0);
  assert.equal(settings.grifballAllowRunnerThrust, true);
});
