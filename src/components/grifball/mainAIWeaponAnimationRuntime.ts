import * as THREE from 'three';
import { type Combatant } from '../../types';
import { resolveHammerSlamTiming } from '../../game/hammerSlamTiming';
import {
  applyWeaponPose,
  getThirdPersonCombatantArmPose,
  getHammerAttackAnimationStyle,
  getSwordAttackAnimationStyle,
  getThirdPersonHammerPose,
  getThirdPersonSwordLungePose,
  getThirdPersonSwordSlashPose,
  toThirdPersonHandPose,
  type WeaponPose,
} from './attackAnimationPresets';
import { applyCombatantArmPose } from './combatantAnimation';
import { getCombatantWeaponMeshes } from './combatantMeshLookup';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

const applyThirdPersonWeaponPose = (group: THREE.Group, pose: WeaponPose): void => {
  applyWeaponPose(group, toThirdPersonHandPose(pose));
};

export function updateMainAIWeaponAnimationsForState({
  state,
  refs,
  mainAI,
  dt,
  applyHammerStrikeImpact,
  applyEnemyHammerMeleeImpact,
  applyEnemySwordSlashImpact,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  mainAI: Combatant | undefined;
  dt: number;
  applyHammerStrikeImpact: (isPlayerStriking: boolean) => void;
  applyEnemyHammerMeleeImpact: () => void;
  applyEnemySwordSlashImpact: () => void;
}): void {
  const mainAiWeapons = getCombatantWeaponMeshes(refs, 'main_ai');
  const enemyHammerModel = mainAiWeapons?.hammer;
  const enemySwordModel = mainAiWeapons?.sword;
  const enemyGroup = mainAiWeapons?.group;

  if (state.isMultiplayer || !enemyHammerModel || !enemySwordModel || !mainAI) return;

  enemyHammerModel.visible = mainAI.hp > 0 && mainAI.aiState !== 'RESPAWNING' && mainAI.activeWeapon === 'hammer';
  enemySwordModel.visible = mainAI.hp > 0 && mainAI.aiState !== 'RESPAWNING' && mainAI.activeWeapon === 'sword';

  if (mainAI.hp <= 0 || mainAI.aiState === 'RESPAWNING') {
    mainAI.weaponState = 'ready';
    mainAI.weaponTimer = 0;
    applyThirdPersonWeaponPose(enemyHammerModel, {
      position: [0.48, 1.08 - 0.64, -0.48],
      rotation: [0.2, 0.1, -0.15],
    });
    applyThirdPersonWeaponPose(enemySwordModel, {
      position: [0.48, 1.08 - 0.64, -0.32],
      rotation: [Math.PI / 2, 0, -Math.PI / 8],
    });
  } else if (mainAI.activeWeapon === 'hammer') {
    const hammerAttackAnimation = getHammerAttackAnimationStyle(state.settings);
    const hammerSlamTiming = resolveHammerSlamTiming(state.settings);
    if (mainAI.weaponState === 'ready') {
      applyThirdPersonWeaponPose(enemyHammerModel, {
        position: [0.48, 1.08 - 0.64, -0.48],
        rotation: [0.2, 0.1, -0.15],
      });
    } else if (mainAI.weaponState === 'swing_up') {
      mainAI.weaponTimer += dt;
      const windup = hammerSlamTiming.windupTime;
      const pct = Math.min(1.0, mainAI.weaponTimer / windup);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('windup', pct));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.48, 0.4, pct),
            THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64,
            THREE.MathUtils.lerp(-0.48, -0.15, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.2, -1.3, pct),
            0.1,
            -0.15,
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'swing_down';
        mainAI.weaponTimer = 0;
      }
    } else if (mainAI.weaponState === 'swing_down') {
      mainAI.weaponTimer += dt;
      const strike = hammerSlamTiming.attackTime;
      const pct = Math.min(1.0, mainAI.weaponTimer / strike);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('strike', pct));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.4, 0.2, pct),
            THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64,
            THREE.MathUtils.lerp(-0.15, -0.9, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(-1.3, 1.1, pct),
            0.1,
            -0.15,
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'recovering';
        mainAI.weaponTimer = 0;
        applyHammerStrikeImpact(false);
      }
    } else if (mainAI.weaponState === 'recovering') {
      mainAI.weaponTimer += dt;
      const recover = state.settings.hammerReloadTime ?? 0.6;
      const pct = Math.min(1.0, mainAI.weaponTimer / recover);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('recover', pct));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.9, -0.48, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(1.1, 0.2, pct),
            0.1,
            -0.15,
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'ready';
        mainAI.weaponTimer = 0;
      }
    } else if (mainAI.weaponState === 'melee_up') {
      mainAI.weaponTimer += dt;
      const windup = state.settings.hammerMeleeSpeed ? state.settings.hammerMeleeSpeed * 0.4 : 0.1;
      const pct = Math.min(1.0, mainAI.weaponTimer / windup);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('melee_swing', pct * 0.35));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.48, 0.58, pct),
            THREE.MathUtils.lerp(1.08, 0.90, pct) - 0.64,
            THREE.MathUtils.lerp(-0.48, -0.3, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.2, 0.35, pct),
            THREE.MathUtils.lerp(0.1, 0.4, pct),
            THREE.MathUtils.lerp(-0.15, -0.25, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'melee_down';
        mainAI.weaponTimer = 0;
      }
    } else if (mainAI.weaponState === 'melee_down') {
      mainAI.weaponTimer += dt;
      const strike = state.settings.hammerMeleeSpeed ? state.settings.hammerMeleeSpeed * 0.6 : 0.14;
      const pct = Math.min(1.0, mainAI.weaponTimer / strike);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('melee_swing', 0.35 + pct * 0.65));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.58, 0.18, pct),
            THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
            THREE.MathUtils.lerp(-0.3, -0.8, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.35, 0.55, pct),
            THREE.MathUtils.lerp(0.4, -0.8, pct),
            THREE.MathUtils.lerp(-0.25, -0.5, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'melee_recover';
        mainAI.weaponTimer = 0;
        applyEnemyHammerMeleeImpact();
      }
    } else if (mainAI.weaponState === 'melee_recover') {
      mainAI.weaponTimer += dt;
      const recover = state.settings.hammerMeleeReload ?? 0.5;
      const pct = Math.min(1.0, mainAI.weaponTimer / recover);

      if (hammerAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemyHammerModel, getThirdPersonHammerPose('melee_recover', pct));
      } else {
        applyThirdPersonWeaponPose(enemyHammerModel, {
          position: [
            THREE.MathUtils.lerp(0.18, 0.48, pct),
            THREE.MathUtils.lerp(1.20, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.8, -0.48, pct),
          ],
          rotation: [
            THREE.MathUtils.lerp(0.55, 0.2, pct),
            THREE.MathUtils.lerp(-0.8, 0.1, pct),
            THREE.MathUtils.lerp(-0.5, -0.15, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'ready';
        mainAI.weaponTimer = 0;
      }
    }
  } else if (mainAI.activeWeapon === 'sword') {
    const swordAttackAnimation = getSwordAttackAnimationStyle(state.settings);
    if (mainAI.aiState === 'LUNGING') {
      if (swordAttackAnimation === 'highFidelity') {
        const lungeTimer = Number(enemySwordModel.userData.lungePoseTimer ?? 0) + dt;
        enemySwordModel.userData.lungePoseTimer = lungeTimer;
        applyWeaponPose(enemySwordModel, getThirdPersonSwordLungePose(lungeTimer));
      } else {
        applyThirdPersonWeaponPose(enemySwordModel, {
          position: [0.0, 1.2 - 0.64, -0.75],
          rotation: [Math.PI / 2 + 0.15, 0, 0],
        });
      }
    } else if (mainAI.weaponState === 'ready') {
      enemySwordModel.userData.lungePoseTimer = 0;
      applyThirdPersonWeaponPose(enemySwordModel, {
        position: [0.48, 1.08 - 0.64, -0.32],
        rotation: [Math.PI / 2, 0, -Math.PI / 8],
      });
    } else if (mainAI.weaponState === 'swing_up') {
      mainAI.weaponTimer += dt;
      const windup = (state.settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, mainAI.weaponTimer / windup);

      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemySwordModel, getThirdPersonSwordSlashPose('slash', pct * 0.5));
      } else {
        applyThirdPersonWeaponPose(enemySwordModel, {
          position: [
            THREE.MathUtils.lerp(0.48, 0.62, pct),
            THREE.MathUtils.lerp(1.08, 1.2, pct) - 0.64,
            THREE.MathUtils.lerp(-0.32, -0.15, pct),
          ],
          rotation: [
            Math.PI / 2,
            THREE.MathUtils.lerp(0, 0.6, pct),
            THREE.MathUtils.lerp(-Math.PI / 8, Math.PI / 4, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'swing_down';
        mainAI.weaponTimer = 0;
        applyEnemySwordSlashImpact();
      }
    } else if (mainAI.weaponState === 'swing_down') {
      mainAI.weaponTimer += dt;
      const strike = (state.settings.swordSlashSpeed ?? 0.22) * 0.5;
      const pct = Math.min(1.0, mainAI.weaponTimer / strike);

      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemySwordModel, getThirdPersonSwordSlashPose('slash', 0.5 + pct * 0.5));
      } else {
        applyThirdPersonWeaponPose(enemySwordModel, {
          position: [
            THREE.MathUtils.lerp(0.62, 0.2, pct),
            THREE.MathUtils.lerp(1.2, 0.9, pct) - 0.64,
            THREE.MathUtils.lerp(-0.15, -0.75, pct),
          ],
          rotation: [
            Math.PI / 2,
            THREE.MathUtils.lerp(0.6, -0.8, pct),
            THREE.MathUtils.lerp(Math.PI / 4, -Math.PI / 3, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'recovering';
        mainAI.weaponTimer = 0;
      }
    } else if (mainAI.weaponState === 'recovering') {
      mainAI.weaponTimer += dt;
      const recover = state.settings.swordSlashReload ?? 0.6;
      const pct = Math.min(1.0, mainAI.weaponTimer / recover);

      if (swordAttackAnimation === 'highFidelity') {
        applyWeaponPose(enemySwordModel, getThirdPersonSwordSlashPose('recover', pct));
      } else {
        applyThirdPersonWeaponPose(enemySwordModel, {
          position: [
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.9, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.75, -0.32, pct),
          ],
          rotation: [
            Math.PI / 2,
            THREE.MathUtils.lerp(-0.8, 0, pct),
            THREE.MathUtils.lerp(-Math.PI / 3, -Math.PI / 8, pct),
          ],
        });
      }

      if (pct >= 1.0) {
        mainAI.weaponState = 'ready';
        mainAI.weaponTimer = 0;
      }
    }
  }

  const armTimer = mainAI.activeWeapon === 'sword' && mainAI.aiState === 'LUNGING'
    ? Number(enemySwordModel.userData.lungePoseTimer ?? mainAI.weaponTimer)
    : mainAI.weaponTimer;
  applyCombatantArmPose(
    enemyGroup,
    getThirdPersonCombatantArmPose({
      activeWeapon: mainAI.activeWeapon,
      weaponState: mainAI.weaponState,
      weaponTimer: armTimer,
      isLunging: mainAI.aiState === 'LUNGING',
      settings: state.settings,
    }),
    dt
  );
}
