import { simulationTimestamp } from '../../game/simulationRandom';
import { resolveAIWeaponSwapTimers } from '../../game/aiTacticalWeaponSwap';
import * as THREE from 'three';
import { canStartAIHammerJump, startAIHammerJumpAction } from '../../game/aiHammerJump';
import { type Combatant, type UniversalSettings } from '../../types';
import { type CombatantMeshRig } from './combatantModels';

export type CombatantWeapon = 'hammer' | 'sword';
export type { AIHammerJumpType } from '../../game/aiHammerJump';
type LungeSettings = Pick<UniversalSettings, 'swordLungeSpeed'>;
type WeaponSwapSettings = Pick<UniversalSettings, 'weaponSwapLockout' | 'weaponReadyTime'>;

export const canStartAIHammerJumpForCombatant = canStartAIHammerJump;
export const startAIHammerJumpForCombatant = startAIHammerJumpAction;

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
  delete self.punchAttack;
  self.weaponTimer = 0;
  if (weapon === 'sword') {
    self.lastSwordAttackTime = simulationTimestamp();
  } else {
    self.lastHammerAttackTime = simulationTimestamp();
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
  self.swordLungeHit = false;
  self.lungeTimer = 0;
  self.lungeStartPos = { x: pos.x, y: pos.y, z: pos.z };
  self.lungeTargetDir = { x: lungeDir.x, y: lungeDir.y, z: lungeDir.z };
  const lungeSpeed = settings.swordLungeSpeed ?? 24.0;
  vel.y = Math.max(vel.y, lungeDir.y * lungeSpeed);
  self.isJumping = pos.y > 0.01 || vel.y > 0.01;
  self.weaponState = 'ready';
  self.lastSwordAttackTime = simulationTimestamp();
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
    const timers = resolveAIWeaponSwapTimers(settings, self.swapLockoutTimer ?? 0, self.swapCooldownTimer ?? 0);
    self.swapLockoutTimer = timers.lockout;
    self.swapCooldownTimer = timers.readiness;
  }
  if (weaponMeshes && weaponMeshes.hammer && weaponMeshes.sword) {
    weaponMeshes.hammer.visible = type === 'hammer';
    weaponMeshes.sword.visible = type === 'sword';
  }
};
