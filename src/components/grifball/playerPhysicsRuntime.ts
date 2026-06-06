import * as THREE from 'three';
import { type Combatant, type CustomMapData, type Keybindings, type MedalInfo } from '../../types';
import {
  applyGamepadLookForState,
  applyMobileRightJoystickLookForState,
  getPrimaryGamepad,
  updateFreeObserverMovementForState,
} from './playerInputRuntime';
import {
  updatePlayerHorizontalMovementForState,
  updatePlayerVerticalIntegrationForState,
} from './playerMovementRuntime';
import { updatePlayerRespawnForState } from './playerRespawnRuntime';
import { updatePlayerSwordLungeForState } from './playerSwordLungeRuntime';
import { type PlayerSwappableWeapon } from './playerWeaponActions';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { type CombatTradeReason } from './tradeRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MutableRef<T> = { current: T };

type JoystickVector = {
  x: number;
  y: number;
};

export function updatePlayerPhysicsForState({
  state,
  refs,
  dt,
  isMultiplayer,
  isPaused,
  isPlaying,
  deviceIsMobile,
  forceMobileControls,
  keyboardKeybindings,
  actionKeybindings,
  keysPressed,
  prevGamepadButtonsRef,
  sprintToggleActiveRef,
  prevSprintInputRef,
  mobileJoystick,
  mobileRightJoystick,
  mobileRightJoystickActive,
  multiplayerSocket,
  activeCustomMap,
  spawnPoints,
  gravityAcceleration,
  getMainAi,
  areCombatantsHostile,
  constrainCombatantToArena,
  renderSwordLungeTrailVfx,
  recordGamepadDash,
  recordPlayerLungeEnd,
  recordPlayerCounterSuccess,
  recordPlayerDamageDealt,
  recordBotCalibrationDeath,
  evaluatePlayerKillMedals,
  executeTrade,
  applyOutgoingMultiplayerHitLocally,
  triggerPlayerHammerSwing,
  triggerPlayerHammerMelee,
  triggerPlayerSwordSlash,
  triggerPlayerSwordLunge,
  swapPlayerWeapon,
  playJump,
  playDash,
  playCrouch,
  playRespawn,
  playExplosion,
  playDeath,
  playSwing,
  spawnVoxelShockwaveParticles,
  pushStatsUpdate,
  onPauseToggle,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  dt: number;
  isMultiplayer: boolean;
  isPaused: boolean;
  isPlaying: boolean;
  deviceIsMobile: boolean;
  forceMobileControls: boolean;
  keyboardKeybindings: Keybindings;
  actionKeybindings: Keybindings;
  keysPressed: Record<string, boolean>;
  prevGamepadButtonsRef: MutableRef<boolean[]>;
  sprintToggleActiveRef: MutableRef<boolean>;
  prevSprintInputRef: MutableRef<boolean>;
  mobileJoystick: JoystickVector | null;
  mobileRightJoystick: JoystickVector | null;
  mobileRightJoystickActive: boolean;
  multiplayerSocket: WebSocket | null;
  activeCustomMap: CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  gravityAcceleration: number;
  getMainAi: () => Combatant | undefined;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
  renderSwordLungeTrailVfx: (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle?: SwordLungeCurrentTrailStyle
  ) => void;
  recordGamepadDash: (dashDir: THREE.Vector3) => void;
  recordPlayerLungeEnd: (hit: boolean) => void;
  recordPlayerCounterSuccess: () => void;
  recordPlayerDamageDealt: (targetWasCountering: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  executeTrade: (reason: CombatTradeReason) => void;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  triggerPlayerHammerSwing: () => void;
  triggerPlayerHammerMelee: () => void;
  triggerPlayerSwordSlash: () => void;
  triggerPlayerSwordLunge: () => void;
  swapPlayerWeapon: (type: PlayerSwappableWeapon) => void;
  playJump: () => void;
  playDash: () => void;
  playCrouch: () => void;
  playRespawn: () => void;
  playExplosion: () => void;
  playDeath: () => void;
  playSwing: () => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  pushStatsUpdate: () => void;
  onPauseToggle: () => void;
}): void {
  applyMobileRightJoystickLookForState({
    state,
    joystick: mobileRightJoystick,
    active: (deviceIsMobile || forceMobileControls) && mobileRightJoystickActive,
    mouseSensitivity: keyboardKeybindings.mouseSensitivity ?? 1.0,
    dt,
  });

  const gamepad = getPrimaryGamepad();
  applyGamepadLookForState({
    state,
    gamepad,
    keybindings: actionKeybindings,
    dt,
  });

  if (gamepad) {
    const curButtons = gamepad.buttons.map((button) => button.pressed);
    const prevButtons = prevGamepadButtonsRef.current;

    const isNewlyPressed = (btnIndex: number) => {
      return curButtons[btnIndex] && !prevButtons[btnIndex];
    };
    const isNewlyReleased = (btnIndex: number) => {
      return !curButtons[btnIndex] && prevButtons[btnIndex];
    };

    const jumpBtn = actionKeybindings.gamepadJump ?? 0;
    if (isNewlyPressed(jumpBtn)) {
      if (state.playerHP > 0 && !isPaused && isPlaying) {
        const limit = state.settings.hammerJumpAirLimit ?? 1;
        const withinLimit = limit === 10 || (state.pHammerJumpsInAir ?? 0) < limit;

        if (state.pHammerJumpWindowTimer > 0 && limit > 0 && withinLimit) {
          const gate = state.settings.hammerJumpInputGate ?? 0;
          const elapsed = (state.settings.hammerJumpWindow ?? 0.6) - state.pHammerJumpWindowTimer;
          const passesGate = gate === 0 || elapsed <= gate;

          if (passesGate) {
            state.isJumping = true;
            state.playerVel.y = 7.2 + (state.settings.hammerJumpPower ?? 6.5);
            state.pHammerJumpWindowTimer = 0;
            state.pHammerJumpsInAir = (state.pHammerJumpsInAir ?? 0) + 1;
            playJump();
            spawnVoxelShockwaveParticles(state.playerPos, '#f59e0b');
          } else if (!state.isJumping) {
            state.isJumping = true;
            state.playerVel.y = 7.2;
            playJump();
          }
        } else if (!state.isJumping) {
          state.isJumping = true;
          state.playerVel.y = 7.2;
          playJump();
        }
      }
    }

    const dashBtn = actionKeybindings.gamepadDash ?? 2;
    if (isNewlyPressed(dashBtn)) {
      if (
        state.playerHP > 0 &&
        !isPaused &&
        isPlaying &&
        state.playerDashCooldownTimer <= 0 &&
        state.playerDashRemaining <= 0
      ) {
        const lx = gamepad.axes[0];
        const ly = gamepad.axes[1];
        const moveDeadzone = 0.18;

        let fMove = 0;
        let rMove = 0;
        if (keysPressed[actionKeybindings.moveForward] || keysPressed['arrowup']) fMove += 1;
        if (keysPressed[actionKeybindings.moveBackward] || keysPressed['arrowdown']) fMove -= 1;
        if (keysPressed[actionKeybindings.moveRight] || keysPressed['arrowright']) rMove += 1;
        if (keysPressed[actionKeybindings.moveLeft] || keysPressed['arrowleft']) rMove -= 1;

        if (Math.abs(ly) > moveDeadzone) fMove -= ly;
        if (Math.abs(lx) > moveDeadzone) rMove += lx;

        const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
        const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

        const dDir = new THREE.Vector3(0, 0, 0);
        if (fMove !== 0 || rMove !== 0) {
          dDir.addScaledVector(forwardDir, fMove).addScaledVector(rightDir, rMove).normalize();
        } else {
          dDir.copy(forwardDir).normalize();
        }

        state.playerDashDir.copy(dDir);
        state.playerDashRemaining = state.settings.dashDuration || 0.25;
        state.playerDashCooldownTimer = state.settings.dashCooldown || 2.0;
        recordGamepadDash(dDir);
        playDash();
      }
    }

    const crouchBtn = actionKeybindings.gamepadCrouch ?? 1;
    if (isNewlyPressed(crouchBtn)) {
      state.isCrouching = true;
      playCrouch();
    } else if (isNewlyReleased(crouchBtn)) {
      state.isCrouching = false;
    }

    const swapBtn = actionKeybindings.gamepadSwapWeapon ?? 3;
    if (isNewlyPressed(swapBtn)) {
      if (state.playerHP > 0 && !state.isLunging) {
        const current = state.activeWeapon;
        const next = current === 'hammer' ? 'sword' : 'hammer';
        swapPlayerWeapon(next);
      }
    }

    const attackBtn = actionKeybindings.gamepadAttack ?? 7;
    if (isNewlyPressed(attackBtn)) {
      if (state.playerHP > 0 && !isPaused && isPlaying) {
        if (state.activeWeapon === 'hammer') {
          if (state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
            triggerPlayerHammerSwing();
          }
        } else if (state.crosshairColor === 'red' && state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
          triggerPlayerSwordLunge();
        }
      }
    }

    const altAttackBtn = actionKeybindings.gamepadAltAttack ?? 5;
    if (isNewlyPressed(altAttackBtn)) {
      if (state.playerHP > 0 && !isPaused && isPlaying) {
        if (state.activeWeapon === 'sword') {
          if (state.pSwordReady && state.pSwordState === 'ready' && !state.isLunging) {
            triggerPlayerSwordSlash();
          }
        } else if (state.activeWeapon === 'hammer') {
          if (state.pWeaponReady && state.pWeaponState === 'ready' && state.playerDashRemaining <= 0) {
            triggerPlayerHammerMelee();
          }
        }
      }
    }

    const scoreboardBtn = actionKeybindings.gamepadScoreboard ?? 8;
    if (isNewlyPressed(scoreboardBtn)) {
      state.showScoreboard = true;
      pushStatsUpdate();
    } else if (isNewlyReleased(scoreboardBtn)) {
      state.showScoreboard = false;
      pushStatsUpdate();
    }

    const pauseBtn = actionKeybindings.gamepadPause ?? 9;
    if (isNewlyPressed(pauseBtn)) {
      onPauseToggle();
    }

    prevGamepadButtonsRef.current = curButtons;
  } else {
    prevGamepadButtonsRef.current = [];
  }

  if (state.isObserverMode) {
    updateFreeObserverMovementForState({
      state,
      keysPressed,
      keyboardKeybindings,
      gamepadKeybindings: actionKeybindings,
      gamepad,
      dt,
    });
    return;
  }

  const playerIsDead = updatePlayerRespawnForState({
    state,
    dt,
    isMultiplayer,
    getMainAi,
    activeCustomMap,
    spawnPoints,
    playRespawn,
  });

  if (!playerIsDead) {
    if (state.isLunging) {
      updatePlayerSwordLungeForState({
        state,
        dt,
        isMultiplayer,
        activeCustomMap,
        multiplayerSocket,
        getMainAi,
        areCombatantsHostile,
        constrainCombatantToArena,
        renderSwordLungeTrailVfx,
        recordPlayerLungeEnd,
        recordPlayerCounterSuccess,
        recordPlayerDamageDealt,
        recordBotCalibrationDeath,
        evaluatePlayerKillMedals,
        executeTrade,
        applyOutgoingMultiplayerHitLocally,
        playExplosion,
        playDeath,
        playSwing,
        spawnVoxelShockwaveParticles,
        pushStatsUpdate,
      });
      return;
    }

    updatePlayerHorizontalMovementForState({
      state,
      refs,
      dt,
      keysPressed,
      movementKeybindings: keyboardKeybindings,
      actionKeybindings,
      gamepad: getPrimaryGamepad(),
      mobileJoystick,
      mobileControlsActive: deviceIsMobile || forceMobileControls,
      sprintToggleActiveRef,
      prevSprintInputRef,
    });

    updatePlayerVerticalIntegrationForState({
      state,
      dt,
      gravityAcceleration,
      constrainCombatantToArena,
    });
  }
}
