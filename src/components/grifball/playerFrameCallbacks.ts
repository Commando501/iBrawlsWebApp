import * as THREE from 'three';
import { type Combatant, type CustomMapData, type Keybindings, type MedalInfo } from '../../types';
import {
  observePlayerCounter,
  observePlayerDash,
  observePlayerReaction,
  type PlayerModelObserver,
} from './playerModelObservations';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { GRAVITY_ACCELERATION, type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { type PlayerSwappableWeapon } from './playerWeaponActions';
import { updatePlayerPhysicsForState } from './playerPhysicsRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { type CombatTradeReason } from './tradeRuntime';
import { updateWeaponAnimationFrameForState } from './weaponAnimationFrameRuntime';

type RefLike<T> = { current: T };
type JoystickVector = { x: number; y: number };

export function createPlayerFrameCallbacksForState({
  getState,
  getRefs,
  getMainAI,
  getIsPaused,
  getKeyboardKeybindings,
  getActionKeybindings,
  getKeysPressed,
  prevGamepadButtonsRef,
  sprintToggleActiveRef,
  prevSprintInputRef,
  getMobileJoystick,
  getMobileRightJoystick,
  getMobileRightJoystickActive,
  getActiveCustomMap,
  spawnPoints,
  isMultiplayer,
  isPlaying,
  deviceIsMobile,
  forceMobileControls,
  multiplayerSocket,
  areCombatantsHostile,
  constrainCombatantToArena,
  renderHammerSplashVfx,
  renderSwordLungeTrailVfx,
  spawnVoxelShockwaveParticles,
  recordLocalPlayerObservation,
  recordPlayerLungeEnd,
  recordPlayerDamageDealt,
  recordBotPsychKill,
  recordBotCalibrationDeath,
  evaluatePlayerKillMedals,
  executeTrade,
  applyOutgoingMultiplayerHitLocally,
  getPlayerSwordLockTarget,
  triggerPlayerHammerSwing,
  triggerPlayerHammerMelee,
  triggerPlayerSwordSlash,
  triggerPlayerSwordLunge,
  swapPlayerWeapon,
  applyHammerStrikeImpact,
  applyPlayerHammerMeleeImpact,
  applyPlayerSwordSlashImpact,
  applyEnemyHammerMeleeImpact,
  applyEnemySwordSlashImpact,
  playJump,
  playDash,
  playCrouch,
  playRespawn,
  playExplosion,
  playDeath,
  playSwing,
  pushStatsUpdate,
  onPauseToggle,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getMainAI: () => Combatant | undefined;
  getIsPaused: () => boolean;
  getKeyboardKeybindings: () => Keybindings;
  getActionKeybindings: () => Keybindings;
  getKeysPressed: () => Record<string, boolean>;
  prevGamepadButtonsRef: RefLike<boolean[]>;
  sprintToggleActiveRef: RefLike<boolean>;
  prevSprintInputRef: RefLike<boolean>;
  getMobileJoystick: () => JoystickVector | null;
  getMobileRightJoystick: () => JoystickVector | null;
  getMobileRightJoystickActive: () => boolean;
  getActiveCustomMap: () => CustomMapData | null;
  spawnPoints: THREE.Vector3[];
  isMultiplayer: boolean;
  isPlaying: boolean;
  deviceIsMobile: boolean;
  forceMobileControls: boolean;
  multiplayerSocket: WebSocket | null;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
  renderHammerSplashVfx: (impactCenter: THREE.Vector3, color: string, radius: number) => void;
  renderSwordLungeTrailVfx: (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle?: SwordLungeCurrentTrailStyle
  ) => void;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  recordLocalPlayerObservation: (observe: PlayerModelObserver) => void;
  recordPlayerLungeEnd: (hit: boolean) => void;
  recordPlayerDamageDealt: (targetWasCountering: boolean) => void;
  recordBotPsychKill: (botId: string, victimId: string, wasLungeKill: boolean) => void;
  recordBotCalibrationDeath: (botId: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  executeTrade: (reason: CombatTradeReason) => void;
  applyOutgoingMultiplayerHitLocally: (targetId: string, damage?: number) => void;
  getPlayerSwordLockTarget: () => unknown;
  triggerPlayerHammerSwing: () => void;
  triggerPlayerHammerMelee: () => void;
  triggerPlayerSwordSlash: () => void;
  triggerPlayerSwordLunge: () => void;
  swapPlayerWeapon: (type: PlayerSwappableWeapon) => void;
  applyHammerStrikeImpact: (isPlayerStriking: boolean) => void;
  applyPlayerHammerMeleeImpact: () => void;
  applyPlayerSwordSlashImpact: () => boolean;
  applyEnemyHammerMeleeImpact: () => void;
  applyEnemySwordSlashImpact: () => void;
  playJump: () => void;
  playDash: () => void;
  playCrouch: () => void;
  playRespawn: () => void;
  playExplosion: () => void;
  playDeath: () => void;
  playSwing: () => void;
  pushStatsUpdate: () => void;
  onPauseToggle: () => void;
}) {
  const applyBotMeleeImpact = (botId: string) =>
    applyBotMeleeImpactForState({
      state: getState(),
      botId,
      renderHammerSplashVfx,
      spawnVoxelShockwaveParticles,
      playExplosion,
      playDeath,
      playSwing,
      recordBotPsychKill,
      recordBotCalibrationDeath,
    });

  const updatePhysics = (dt: number) => {
    updatePlayerPhysicsForState({
      state: getState(),
      refs: getRefs(),
      dt,
      isMultiplayer,
      isPaused: getIsPaused(),
      isPlaying,
      deviceIsMobile,
      forceMobileControls,
      keyboardKeybindings: getKeyboardKeybindings(),
      actionKeybindings: getActionKeybindings(),
      keysPressed: getKeysPressed(),
      prevGamepadButtonsRef,
      sprintToggleActiveRef,
      prevSprintInputRef,
      mobileJoystick: getMobileJoystick(),
      mobileRightJoystick: getMobileRightJoystick(),
      mobileRightJoystickActive: getMobileRightJoystickActive(),
      multiplayerSocket,
      activeCustomMap: getActiveCustomMap(),
      spawnPoints,
      gravityAcceleration: GRAVITY_ACCELERATION,
      getMainAi: getMainAI,
      areCombatantsHostile,
      constrainCombatantToArena,
      renderSwordLungeTrailVfx,
      recordGamepadDash: (dashDir) => {
        recordLocalPlayerObservation((model) => {
          observePlayerDash(model, dashDir.x, dashDir.z);
          const mainAi = getMainAI();
          if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.weaponState === 'swing_up') {
            observePlayerReaction(model, mainAi.weaponTimer ?? 0);
          }
        });
      },
      recordPlayerLungeEnd,
      recordPlayerCounterSuccess: () =>
        recordLocalPlayerObservation((model) => observePlayerCounter(model, true)),
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
    });
  };

  const updateHammerAnimations = (dt: number) => {
    updateWeaponAnimationFrameForState({
      state: getState(),
      refs: getRefs(),
      mainAI: getMainAI(),
      dt,
      getPlayerSwordLockTarget,
      applyHammerStrikeImpact,
      applyPlayerHammerMeleeImpact,
      applyPlayerSwordSlashImpact,
      applyEnemyHammerMeleeImpact,
      applyEnemySwordSlashImpact,
    });
  };

  return {
    applyBotMeleeImpact,
    updatePhysics,
    updateHammerAnimations,
  };
}
