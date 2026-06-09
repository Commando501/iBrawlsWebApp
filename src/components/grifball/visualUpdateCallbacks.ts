import * as THREE from 'three';
import { resolveHammerSlamTiming } from '../../game/hammerSlamTiming';
import { animateSpartanCombatantModel } from './combatantAnimation';
import {
  updateFloatingNameplatesForState,
  updateRadarDomForState,
} from './overlayDom';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { updateInvulnerabilityBlinking } from './visualState';
import { type Combatant } from '../../types';

type MutableRef<T> = { current: T };

export function createVisualUpdateCallbacksForState({
  getState,
  getRefs,
  getMainAI,
  getContainer,
  getNameplateContainer,
  radarDotPoolRef,
  nameplatePoolRef,
  isMultiplayer,
  opponentPlayerName,
  getFallbackOpponentName,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getMainAI: () => Combatant | undefined;
  getContainer: () => HTMLDivElement | null;
  getNameplateContainer: () => HTMLDivElement | null;
  radarDotPoolRef: MutableRef<Map<string, HTMLElement>>;
  nameplatePoolRef: MutableRef<Map<string, HTMLElement>>;
  isMultiplayer: boolean;
  opponentPlayerName: string;
  getFallbackOpponentName: () => string;
}) {
  const updateFloatingNameplate = () => {
    const refs = getRefs();
    updateFloatingNameplatesForState({
      state: getState(),
      camera: refs.camera,
      container: getContainer(),
      nameplateContainer: getNameplateContainer(),
      pool: nameplatePoolRef.current,
      isMultiplayer,
      opponentPlayerName,
      fallbackOpponentName: getFallbackOpponentName(),
    });
  };

  const updateRadarDOM = () => {
    updateRadarDomForState({
      state: getState(),
      mainAI: getMainAI(),
      radarDotPool: radarDotPoolRef.current,
    });
  };

  const animateSpartanModel = (
    mesh: THREE.Group | null,
    vel: THREE.Vector3,
    yaw: number,
    hp: number,
    weaponState: string,
    weaponTimer: number,
    dt: number,
    isSliding = false,
    isSprinting = false
  ) => {
    const state = getState();
    const hammerSlamTiming = resolveHammerSlamTiming(state.settings);
    animateSpartanCombatantModel({
      refs: getRefs(),
      mesh,
      vel,
      yaw,
      hp,
      weaponState,
      weaponTimer,
      dt,
      isSliding,
      isSprinting,
      hammerReloadTime: state.settings.hammerReloadTime ?? 0.6,
      hammerMeleeReload: state.settings.hammerMeleeReload ?? 0.5,
      hammerSlamWindupTime: hammerSlamTiming.windupTime,
      hammerSlamAttackTime: hammerSlamTiming.attackTime,
    });
  };

  const updateBlinking = (group: THREE.Group | null, active: boolean) => {
    const refs = getRefs();
    updateInvulnerabilityBlinking({
      group,
      active,
      skipMeshes: [refs.debugPlayerSphere, refs.debugEnemySphere],
    });
  };

  return {
    updateFloatingNameplate,
    updateRadarDOM,
    animateSpartanModel,
    updateBlinking,
  };
}
