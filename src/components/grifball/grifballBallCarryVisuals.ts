import * as THREE from 'three';
import { getForwardHeadingForYaw } from '../../game/yaw';
import type { UniversalSettings } from '../../types';

export type HeldGrifballBallVisualPositionInput = {
  basePosition: THREE.Vector3;
  yaw: number;
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  settings: Partial<UniversalSettings>;
  modelSystem?: unknown;
};

type LocalBallOffset = {
  right: number;
  up: number;
  forward: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number): number => {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
};
const lerp = THREE.MathUtils.lerp;

const HOLD_OFFSET: LocalBallOffset = { right: 0.34, up: 0.03, forward: 0.28 };
const COCKED_OFFSET: LocalBallOffset = { right: 0.48, up: 0.08, forward: 0.14 };
const STRIKE_OFFSET: LocalBallOffset = { right: -0.32, up: 0.02, forward: 0.86 };

export const isV1CombatantModelSystem = (modelSystem: unknown): boolean =>
  modelSystem !== 'v2' && modelSystem !== 'v3';

const mixOffset = (from: LocalBallOffset, to: LocalBallOffset, progress: number): LocalBallOffset => ({
  right: lerp(from.right, to.right, progress),
  up: lerp(from.up, to.up, progress),
  forward: lerp(from.forward, to.forward, progress),
});

const resolvePunchOffset = ({
  weaponState,
  weaponTimer,
  settings,
}: Pick<HeldGrifballBallVisualPositionInput, 'weaponState' | 'weaponTimer' | 'settings'>): LocalBallOffset | null => {
  const meleeSpeed = Math.max(settings.hammerMeleeSpeed ?? 0.24, 0.001);
  const strikeDuration = Math.max(0.03, meleeSpeed * 0.5);
  const recoveryDuration = Math.max(settings.grifballPunchCooldown ?? 0.5, 0.001);

  if (weaponState === 'swing_up') {
    return mixOffset(HOLD_OFFSET, COCKED_OFFSET, easeOutCubic(weaponTimer / meleeSpeed));
  }

  if (weaponState === 'swing_down') {
    return mixOffset(COCKED_OFFSET, STRIKE_OFFSET, easeOutCubic(weaponTimer / strikeDuration));
  }

  if (weaponState === 'recovering') {
    return mixOffset(STRIKE_OFFSET, HOLD_OFFSET, easeOutCubic(weaponTimer / recoveryDuration));
  }

  if (weaponState === 'melee_up' || weaponState === 'melee_swing' || weaponState === 'melee_down') {
    const progress = weaponState === 'melee_down'
      ? Math.min(1, 0.4 + (weaponTimer / Math.max(meleeSpeed * 0.6, 0.001)) * 0.6)
      : Math.min(1, weaponTimer / meleeSpeed);
    if (progress < 0.35) {
      return mixOffset(HOLD_OFFSET, COCKED_OFFSET, easeOutCubic(progress / 0.35));
    }
    return mixOffset(COCKED_OFFSET, STRIKE_OFFSET, easeOutCubic((progress - 0.35) / 0.65));
  }

  if (weaponState === 'melee_recover') {
    return mixOffset(STRIKE_OFFSET, HOLD_OFFSET, easeOutCubic(weaponTimer / recoveryDuration));
  }

  return null;
};

export function resolveHeldGrifballBallVisualPosition({
  basePosition,
  yaw,
  activeWeapon,
  weaponState,
  weaponTimer,
  settings,
  modelSystem,
}: HeldGrifballBallVisualPositionInput): THREE.Vector3 {
  if (activeWeapon !== 'ball' || !isV1CombatantModelSystem(modelSystem)) {
    return basePosition.clone();
  }

  const offset = resolvePunchOffset({ weaponState, weaponTimer, settings }) ?? HOLD_OFFSET;

  const forward = getForwardHeadingForYaw(yaw);
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  return basePosition.clone()
    .add(new THREE.Vector3(
      right.x * offset.right + forward.x * offset.forward,
      offset.up,
      right.z * offset.right + forward.z * offset.forward
    ));
}
