import * as THREE from 'three';
import { type Combatant, type MedalInfo } from '../../types';
import {
  triggerEnemyHammerMeleeForCombatant,
  triggerEnemyHammerSwingForCombatant,
  triggerEnemySwordLungeForCombatant,
  triggerEnemySwordSlashForCombatant,
} from './enemyWeaponActions';
import {
  observePlayerHammerAttack,
  observePlayerLungeStart,
  observePlayerWeaponSwap,
  type PlayerModelObserver,
} from './playerModelObservations';
import { triggerPlayerPistolFireForState } from './playerPistolRuntime';
import {
  swapPlayerWeaponForState,
  triggerPlayerHammerMeleeForState,
  triggerPlayerHammerSwingForState,
  triggerPlayerSwordLungeForState,
  triggerPlayerSwordSlashForState,
  type PlayerSwappableWeapon,
} from './playerWeaponActions';
import { type GrifballRuntimeState } from './runtimeState';
import { getPlayerSwordLockTarget as getPlayerSwordLockTargetForState, type EnemyAITarget } from './targetSelection';
import { type GrifballThreeRefs } from './threeRefs';

type LocalPlayerObservationRecorder = (observe: PlayerModelObserver) => void;

export function createWeaponActionCallbacksForState({
  getState,
  getRefs,
  getMainAI,
  getOpponentDisplay,
  getEnemyAITarget,
  isMultiplayer,
  multiplayerSocket,
  getIsPaused,
  getIsPlaying,
  recordLocalPlayerObservation,
  spawnVoxelShockwaveParticles,
  evaluatePlayerKillMedals,
  recordBotCalibrationDeath,
  pushStatsUpdate,
  playSwing,
  playDash,
  playImpact,
  playDeath,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getMainAI: () => Combatant | undefined;
  getOpponentDisplay: () => Combatant | undefined;
  getEnemyAITarget: () => EnemyAITarget | null;
  isMultiplayer: boolean;
  multiplayerSocket: WebSocket | null;
  getIsPaused: () => boolean;
  getIsPlaying: () => boolean;
  recordLocalPlayerObservation: LocalPlayerObservationRecorder;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  evaluatePlayerKillMedals: (victimId: string) => MedalInfo[];
  recordBotCalibrationDeath: (botId: string) => void;
  pushStatsUpdate: () => void;
  playSwing: () => void;
  playDash: () => void;
  playImpact: () => void;
  playDeath: () => void;
}) {
  const getPlayerSwordLockTarget = () =>
    getPlayerSwordLockTargetForState(getState(), getMainAI(), isMultiplayer);

  const sendPlayerWeaponSync = (payload: object): boolean => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const triggerPlayerHammerSwing = () =>
    triggerPlayerHammerSwingForState({
      state: getState(),
      recordHammerAttack: () => recordLocalPlayerObservation((model) => observePlayerHammerAttack(model)),
      playSwing,
      sendSync: sendPlayerWeaponSync,
    });

  const triggerPlayerHammerMelee = () =>
    triggerPlayerHammerMeleeForState({
      state: getState(),
      playSwing,
      sendSync: sendPlayerWeaponSync,
    });

  const triggerPlayerPistolFire = () =>
    triggerPlayerPistolFireForState({
      state: getState(),
      refs: getRefs(),
      isPaused: getIsPaused(),
      isPlaying: getIsPlaying(),
      sendSync: sendPlayerWeaponSync,
      spawnVoxelShockwaveParticles,
      playImpact,
      playDeath,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
    });

  const swapPlayerWeapon = (type: PlayerSwappableWeapon) =>
    swapPlayerWeaponForState({
      state: getState(),
      refs: getRefs(),
      type,
      isPaused: getIsPaused(),
      isPlaying: getIsPlaying(),
      recordWeaponSwap: (weapon) =>
        recordLocalPlayerObservation((model) => observePlayerWeaponSwap(model, weapon)),
      pushStatsUpdate,
    });

  const triggerPlayerSwordSlash = () =>
    triggerPlayerSwordSlashForState({
      state: getState(),
      playSwing,
      sendSync: sendPlayerWeaponSync,
    });

  const triggerPlayerSwordLunge = () =>
    triggerPlayerSwordLungeForState({
      state: getState(),
      lockTarget: getPlayerSwordLockTarget(),
      recordLungeStart: (lungeDistance) =>
        recordLocalPlayerObservation((model) => observePlayerLungeStart(model, lungeDistance)),
      playDash,
      sendSync: sendPlayerWeaponSync,
    });

  const enemyCombatProxy = (): Combatant | undefined => getOpponentDisplay() ?? getMainAI();

  const triggerEnemyHammerSwing = () =>
    triggerEnemyHammerSwingForCombatant(enemyCombatProxy());

  const triggerEnemyHammerMelee = () =>
    triggerEnemyHammerMeleeForCombatant({
      enemy: enemyCombatProxy(),
      playSwing,
    });

  const triggerEnemySwordSlash = () =>
    triggerEnemySwordSlashForCombatant({
      enemy: enemyCombatProxy(),
      playSwing,
    });

  const triggerEnemySwordLunge = (customDir?: THREE.Vector3) =>
    triggerEnemySwordLungeForCombatant({
      state: getState(),
      enemy: enemyCombatProxy(),
      customDir,
      target: getEnemyAITarget(),
      playDash,
    });

  return {
    getPlayerSwordLockTarget,
    sendPlayerWeaponSync,
    triggerPlayerHammerSwing,
    triggerPlayerHammerMelee,
    triggerPlayerPistolFire,
    swapPlayerWeapon,
    triggerPlayerSwordSlash,
    triggerPlayerSwordLunge,
    triggerEnemyHammerSwing,
    triggerEnemyHammerMelee,
    triggerEnemySwordSlash,
    triggerEnemySwordLunge,
  };
}
