import * as THREE from 'three';
import { type Combatant, type CustomMapData } from '../../types';
import { recoverCombatantAltitude as recoverCombatantAltitudeFromRunaway } from './altitudeRecovery';
import { enforceArenaFrameSyncForState } from './arenaFrameSync';
import { constrainCombatantToArenaBounds } from './arenaBounds';
import { resolvePlayerCombatantCollisionsForState } from './playerCollisionSync';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function createArenaCollisionCallbacksForState({
  getState,
  getRefs,
  getActiveCustomMap,
  getMainAI,
  isMultiplayer,
  multiplayerRole,
  opponentClientId,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getActiveCustomMap: () => CustomMapData | null;
  getMainAI: () => Combatant | undefined;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  opponentClientId: string;
}) {
  const constrainCombatantToArena = (pos: THREE.Vector3, vel?: THREE.Vector3) => {
    const state = getState();
    const result = constrainCombatantToArenaBounds({
      pos,
      vel,
      activeCustomMap: getActiveCustomMap(),
      arenaRadius: state.arenaRadius,
    });

    if (!result.grounded) return;

    if (pos === state.playerPos) {
      state.isJumping = false;
      state.pHammerJumpsInAir = 0;
      return;
    }

    const mainAI = getMainAI();
    if (pos === mainAI?.pos) {
      mainAI.isJumping = false;
      mainAI.aiHammerJumpsInAir = 0;
      return;
    }

    state.otherPlayers.forEach((bot) => {
      if (bot.pos === pos) {
        bot.isJumping = false;
        bot.aiHammerJumpsInAir = 0;
      }
    });
  };

  const resolvePlayerCollisions = () => {
    resolvePlayerCombatantCollisionsForState({
      state: getState(),
      mainAI: getMainAI(),
    });
  };

  const enforceArenaBounds = (dt: number) => {
    enforceArenaFrameSyncForState({
      state: getState(),
      refs: getRefs(),
      dt,
      isMultiplayer,
      multiplayerRole,
      mainAI: getMainAI(),
      opponentClientId,
      resolvePlayerCollisions,
      constrainCombatantToArena,
    });
  };

  const recoverCombatantAltitude = (
    self: any,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ): boolean => recoverCombatantAltitudeFromRunaway(getState().settings, self, pos, vel);

  return {
    constrainCombatantToArena,
    resolvePlayerCollisions,
    enforceArenaBounds,
    recoverCombatantAltitude,
  };
}
