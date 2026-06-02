import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant, type UniversalSettings } from '../../types';
import { type CombatantMeshRig } from './combatantModels';

export type CombatantWeapon = 'hammer' | 'sword';
export type AIHammerJumpType = 'offensive' | 'defensive';

type HammerJumpSettings = Pick<UniversalSettings, 'hammerJumpAirLimit' | 'hammerJumpPower'>;
type LungeSettings = Pick<UniversalSettings, 'swordLungeSpeed'>;
type WeaponSwapSettings = Pick<UniversalSettings, 'weaponSwapLockout' | 'weaponReadyTime'>;

export const canStartAIHammerJumpForCombatant = (
  self: Combatant,
  settings: HammerJumpSettings
): boolean => {
  const limit = settings.hammerJumpAirLimit ?? 1;
  if (limit <= 0) return false;

  const consecutiveJumps = self.aiHammerJumpsInAir ?? 0;
  const withinLimit = limit === 10 || consecutiveJumps < limit;

  return self.weaponState === 'ready' && withinLimit;
};

export const startAIHammerJumpForCombatant = ({
  self,
  settings,
  vel,
  horizontalHeading,
  jumpType = 'offensive',
  onMainAIHammerSwing,
  playSwing,
  playJump,
}: {
  self: Combatant;
  settings: HammerJumpSettings;
  vel: THREE.Vector3;
  horizontalHeading?: THREE.Vector3;
  jumpType?: AIHammerJumpType;
  onMainAIHammerSwing: () => void;
  playSwing: () => void;
  playJump: () => void;
}): boolean => {
  if (!canStartAIHammerJumpForCombatant(self, settings)) {
    return false;
  }

  if (self.id === MAIN_AI_ID) {
    self.hammerJumpPlanned = true;
    self.hammerJumpType = jumpType;
    onMainAIHammerSwing();
  } else {
    self.weaponState = 'swing_up';
    self.weaponTimer = 0;
    vel.y = 7.2 + (settings.hammerJumpPower ?? 6.5);
    self.isJumping = true;
    self.aiHammerJumpsInAir = (self.aiHammerJumpsInAir ?? 0) + 1;
    if (horizontalHeading && horizontalHeading.lengthSq() > 0.0001) {
      const jumpHeading = horizontalHeading.clone().normalize();
      vel.x = jumpHeading.x * 6.5;
      vel.z = jumpHeading.z * 6.5;
    }
    playSwing();
    playJump();
  }

  return true;
};

export const triggerCombatantAttackAction = ({
  self,
  weapon,
  melee = false,
  recordHammerAttack,
  playSwing,
}: {
  self: Combatant;
  weapon: CombatantWeapon;
  melee?: boolean;
  recordHammerAttack: (combatantId: string) => void;
  playSwing: () => void;
}): void => {
  self.weaponState = melee ? 'melee_up' : 'swing_up';
  self.weaponTimer = 0;
  if (weapon === 'sword') {
    self.lastSwordAttackTime = Date.now();
  } else {
    self.lastHammerAttackTime = Date.now();
    recordHammerAttack(self.id);
  }
  playSwing();
};

export const triggerCombatantLungeAction = ({
  self,
  settings,
  lungeDir,
  pos,
  vel,
  playDash,
}: {
  self: Combatant;
  settings: LungeSettings;
  lungeDir: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  playDash: () => void;
}): void => {
  self.isLunging = true;
  self.lungeTimer = 0;
  self.lungeStartPos = { x: pos.x, y: pos.y, z: pos.z };
  self.lungeTargetDir = { x: lungeDir.x, y: lungeDir.y, z: lungeDir.z };
  const lungeSpeed = settings.swordLungeSpeed ?? 24.0;
  vel.y = Math.max(vel.y, lungeDir.y * lungeSpeed);
  self.isJumping = pos.y > 0.01 || vel.y > 0.01;
  self.weaponState = 'ready';
  self.lastSwordAttackTime = Date.now();
  playDash();
};

export const swapCombatantWeaponAction = ({
  self,
  settings,
  type,
  setLockout = false,
  weaponMeshes,
  recordWeaponSwap,
}: {
  self: Combatant;
  settings: WeaponSwapSettings;
  type: CombatantWeapon;
  setLockout?: boolean;
  weaponMeshes?: CombatantMeshRig;
  recordWeaponSwap: (combatantId: string, type: CombatantWeapon) => void;
}): void => {
  self.activeWeapon = type;
  recordWeaponSwap(self.id, type);
  if (setLockout) {
    if (settings.weaponSwapLockout > 0) {
      self.swapLockoutTimer = settings.weaponSwapLockout;
    }
    if (settings.weaponReadyTime > 0) {
      self.swapCooldownTimer = settings.weaponReadyTime;
    }
  }
  if (weaponMeshes && weaponMeshes.hammer && weaponMeshes.sword) {
    weaponMeshes.hammer.visible = type === 'hammer';
    weaponMeshes.sword.visible = type === 'sword';
  }
};
