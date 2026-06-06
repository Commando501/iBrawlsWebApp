import * as THREE from 'three';
import { type Combatant } from '../../types';
import { triggerCombatantAttackAction } from './combatantActions';
import { type GrifballRuntimeState } from './runtimeState';
import { type EnemyAITarget } from './targetSelection';

const canTriggerEnemyWeaponAction = (enemy: Combatant | undefined): enemy is Combatant => {
  if (!enemy) return false;
  if ((enemy.swapCooldownTimer ?? 0) > 0) return false;
  if ((enemy.aiDashRemaining ?? 0) > 0) return false;
  return true;
};

export function triggerEnemyHammerSwingForCombatant(enemy: Combatant | undefined): void {
  if (!canTriggerEnemyWeaponAction(enemy)) return;
  triggerCombatantAttackAction({
    self: enemy,
    weapon: 'hammer',
    recordHammerAttack: () => {},
    playSwing: () => {},
  });
}

export function triggerEnemyHammerMeleeForCombatant({
  enemy,
  playSwing,
}: {
  enemy: Combatant | undefined;
  playSwing: () => void;
}): void {
  if (!canTriggerEnemyWeaponAction(enemy)) return;
  triggerCombatantAttackAction({
    self: enemy,
    weapon: 'hammer',
    melee: true,
    recordHammerAttack: () => {},
    playSwing,
  });
}

export function triggerEnemySwordSlashForCombatant({
  enemy,
  playSwing,
}: {
  enemy: Combatant | undefined;
  playSwing: () => void;
}): void {
  if (!canTriggerEnemyWeaponAction(enemy)) return;
  triggerCombatantAttackAction({
    self: enemy,
    weapon: 'sword',
    recordHammerAttack: () => {},
    playSwing,
  });
}

export function triggerEnemySwordLungeForCombatant({
  state,
  enemy,
  customDir,
  target,
  playDash,
}: {
  state: GrifballRuntimeState;
  enemy: Combatant | undefined;
  customDir?: THREE.Vector3;
  target: EnemyAITarget | null;
  playDash: () => void;
}): void {
  if (!canTriggerEnemyWeaponAction(enemy)) return;
  enemy.aiState = 'LUNGING';
  enemy.lungeTimer = 0;
  const lungeStart = enemy.lungeStartPos instanceof THREE.Vector3
    ? enemy.lungeStartPos
    : new THREE.Vector3();
  const lungeDir = enemy.lungeTargetDir instanceof THREE.Vector3
    ? enemy.lungeTargetDir
    : new THREE.Vector3();
  if (!(enemy.lungeStartPos instanceof THREE.Vector3)) enemy.lungeStartPos = lungeStart;
  if (!(enemy.lungeTargetDir instanceof THREE.Vector3)) enemy.lungeTargetDir = lungeDir;
  lungeStart.copy(enemy.pos);
  if (customDir) {
    lungeDir.copy(customDir);
  } else {
    const targetPos = target ? target.pos.clone() : state.playerPos.clone();
    const targetAirborne = target
      ? (target.pos.y > 0.35 || (target.vel && Math.abs(target.vel.y) > 1.0))
      : (state.playerPos.y > 0.35 || Math.abs(state.playerVel.y) > 1.0);
    lungeDir.copy(targetPos).sub(enemy.pos);
    if (!targetAirborne) {
      lungeDir.y = 0;
    }
  }
  if (lungeDir.lengthSq() <= 0.0001) {
    enemy.aiState = 'APPROACHING';
    return;
  }
  lungeDir.normalize();
  const lungeSpeed = state.settings.swordLungeSpeed ?? 24.0;
  enemy.vel.y = Math.max(enemy.vel.y, lungeDir.y * lungeSpeed);
  enemy.isJumping = enemy.pos.y > 0.01 || enemy.vel.y > 0.01;
  enemy.weaponState = 'ready';
  enemy.lastSwordAttackTime = Date.now();
  playDash();
}
