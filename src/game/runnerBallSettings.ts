import type { UniversalSettings } from '../types';

export type RunnerMovementDirection = 'forward' | 'backward' | 'side';

const DEFAULT_RUNNER_SPEED_PERCENT = 130;
const DEFAULT_TRAJECTORY_COLOR = '#ff2b2b';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentage(value: number | undefined, fallback: number): number {
  return clamp(finiteNumber(value, fallback), 20, 300) / 100;
}

function runnerSpeedForDirection(settings: UniversalSettings, direction: RunnerMovementDirection): number {
  if (direction === 'forward') return settings.grifballRunnerSpeedForward ?? DEFAULT_RUNNER_SPEED_PERCENT;
  if (direction === 'backward') return settings.grifballRunnerSpeedBackward ?? DEFAULT_RUNNER_SPEED_PERCENT;
  return settings.grifballRunnerSpeedSide ?? DEFAULT_RUNNER_SPEED_PERCENT;
}

export function resolveDirectionalSpeedMultiplier(
  settings: UniversalSettings,
  direction: RunnerMovementDirection,
  isRunner: boolean
): number {
  const universalSpeed =
    direction === 'forward'
      ? settings.speedForward
      : direction === 'backward'
        ? settings.speedBackward
        : settings.speedSide;
  const runnerSpeed = isRunner ? runnerSpeedForDirection(settings, direction) : 100;
  return percentage(universalSpeed, 100) * percentage(runnerSpeed, 100);
}

export function resolveRunnerThrowAllowed(settings: UniversalSettings): boolean {
  return settings.grifballAllowThrowing !== false;
}

export function resolveRunnerThrustAllowed(settings: UniversalSettings): boolean {
  return settings.grifballAllowRunnerThrust !== false;
}

export function resolveTrajectoryLineThickness(settings: UniversalSettings): number {
  return clamp(finiteNumber(settings.grifballTrajectoryLineThickness, 0.14), 0.04, 0.35);
}

export function resolveTrajectoryLineColor(settings: UniversalSettings): string {
  const value = settings.grifballTrajectoryLineColor ?? DEFAULT_TRAJECTORY_COLOR;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_TRAJECTORY_COLOR;
}

export function resolvePunchLungeDistance(settings: UniversalSettings): number {
  return clamp(finiteNumber(settings.grifballPunchLungeDistance, 1.8), 0.5, 5.0);
}

export function resolvePunchCooldown(settings: UniversalSettings): number {
  return clamp(finiteNumber(settings.grifballPunchCooldown, 0.5), 0.1, 3.0);
}

export function resolveRunnerMaxHp(settings: UniversalSettings): number {
  return clamp(Math.round(finiteNumber(settings.grifballRunnerHealth, 2)), 1, 100);
}

export function resolveRunnerHealDelay(settings: UniversalSettings): number {
  return clamp(finiteNumber(settings.grifballRunnerHealDelay, 3.0), 0, 15);
}

export function resolveRunnerHealRate(settings: UniversalSettings): number {
  return clamp(finiteNumber(settings.grifballRunnerHealRate, 1.0), 0, 10);
}
