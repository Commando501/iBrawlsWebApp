import * as THREE from 'three';
import { type Combatant, type Keybindings } from '../../types';
import { animateCombatantWeaponMeshes, animateSpartanCombatantModel } from './combatantAnimation';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';

export function updateObserverCombatantVisualsForState({
  refs,
  state,
  dt,
  multiplayerRole,
  keysPressed,
  keybindings,
  mainAI,
  getSpectateTargetData,
}: {
  refs: GrifballThreeRefs;
  state: GrifballRuntimeState;
  dt: number;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  keysPressed: Record<string, boolean>;
  keybindings: Keybindings;
  mainAI: Combatant | undefined;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
}): void {
  if (!state.isObserverMode) return;

  if (refs.hostGroup) {
    const hostData = getSpectateTargetData('host');
    const hostVel = multiplayerRole === 'observer' ? state.hostVel : state.playerVel;
    const hostSpeed = hostVel.length();
    let moveForward = 0;
    if (keysPressed[keybindings.moveForward] || keysPressed.arrowup) moveForward += 1;
    if (keysPressed[keybindings.moveBackward] || keysPressed.arrowdown) moveForward -= 1;

    const isHostSprinting =
      state.settings.enableSprint &&
      (multiplayerRole === 'observer'
        ? hostSpeed > 6.0
        : keysPressed[keybindings.sprint] &&
          moveForward > 0 &&
          !state.isCrouching &&
          !state.isJumping &&
          state.playerDashRemaining <= 0);
    const isHostSliding =
      state.settings.enableSlide &&
      (multiplayerRole === 'observer' ? hostSpeed > 3.0 && hostData.isCrouching : state.playerSlideActive);

    let hostWeaponState = 'ready';
    let hostWeaponTimer = 0;
    let hostIsLunging = false;
    if (multiplayerRole === 'observer' && state.hostClientId) {
      const hostPlayer = state.otherPlayers.get(state.hostClientId);
      if (hostPlayer) {
        hostWeaponState = hostPlayer.weaponState || 'ready';
        hostWeaponTimer = hostPlayer.weaponTimer || 0;
        hostIsLunging = Boolean(hostPlayer.isLunging);
      }
    } else if (multiplayerRole !== 'observer') {
      hostWeaponState = state.pWeaponState;
      hostWeaponTimer = state.pWeaponTimer;
      hostIsLunging = state.isLunging;
    }

    animateSpartanCombatantModel({
      refs,
      mesh: refs.hostGroup,
      vel: hostVel,
      yaw: hostData.yaw,
      hp: hostData.hp,
      weaponState: hostWeaponState,
      weaponTimer: hostWeaponTimer,
      dt,
      isSliding: isHostSliding,
      isSprinting: isHostSprinting,
      hammerReloadTime: state.settings.hammerReloadTime ?? 0.6,
      hammerMeleeReload: state.settings.hammerMeleeReload ?? 0.5,
    });

    if (refs.hostHammer || refs.hostSword) {
      animateCombatantWeaponMeshes({
        hammerModel: refs.hostHammer,
        swordModel: refs.hostSword,
        activeWeapon: hostData.activeWeapon || 'hammer',
        weaponState: hostWeaponState,
        weaponTimer: hostWeaponTimer,
        isLunging: hostIsLunging,
        dt,
        settings: state.settings,
        combatantModel: refs.hostGroup,
      });
    }
  }

  if (refs.enemyGroup) {
    const clientData = getSpectateTargetData('client');
    if (multiplayerRole === 'observer' || mainAI) {
      const enemyVel = multiplayerRole === 'observer' ? state.clientVel : mainAI ? mainAI.vel : new THREE.Vector3();
      const enemySpeed = enemyVel.length();
      const isClientSprinting =
        state.settings.enableSprint &&
        (multiplayerRole === 'observer'
          ? enemySpeed > 6.0
          : mainAI
            ? mainAI.aiState === 'APPROACHING' && enemySpeed > 4.5 && !mainAI.isCrouching
            : false);
      const isClientSliding =
        state.settings.enableSlide &&
        (multiplayerRole === 'observer'
          ? enemySpeed > 3.0 && clientData.isCrouching
          : mainAI
            ? mainAI.isCrouching && mainAI.aiState === 'APPROACHING' && enemySpeed > 2.0
            : false);

      let enemyWeaponState = 'ready';
      let enemyWeaponTimer = 0;
      let enemyIsLunging = false;
      if (multiplayerRole === 'observer' && state.clientClientId) {
        const clientPlayer = state.otherPlayers.get(state.clientClientId);
        if (clientPlayer) {
          enemyWeaponState = clientPlayer.weaponState || 'ready';
          enemyWeaponTimer = clientPlayer.weaponTimer || 0;
          enemyIsLunging = Boolean(clientPlayer.isLunging);
        }
      } else if (mainAI) {
        enemyWeaponState = mainAI.weaponState || 'ready';
        enemyWeaponTimer = mainAI.weaponTimer || 0;
        enemyIsLunging = mainAI.aiState === 'LUNGING';
      }

      animateSpartanCombatantModel({
        refs,
        mesh: refs.enemyGroup,
        vel: enemyVel,
        yaw: clientData.yaw,
        hp: clientData.hp,
        weaponState: enemyWeaponState,
        weaponTimer: enemyWeaponTimer,
        dt,
        isSliding: isClientSliding,
        isSprinting: isClientSprinting,
        hammerReloadTime: state.settings.hammerReloadTime ?? 0.6,
        hammerMeleeReload: state.settings.hammerMeleeReload ?? 0.5,
      });

      if (refs.enemyHammer || refs.enemySword) {
        animateCombatantWeaponMeshes({
          hammerModel: refs.enemyHammer,
          swordModel: refs.enemySword,
          activeWeapon: clientData.activeWeapon || 'hammer',
          weaponState: enemyWeaponState,
          weaponTimer: enemyWeaponTimer,
          isLunging: enemyIsLunging,
          dt,
          settings: state.settings,
          combatantModel: refs.enemyGroup,
        });
      }
    }
  }
}
