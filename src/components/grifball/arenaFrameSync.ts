import * as THREE from 'three';
import { getPrimaryRemoteOpponent } from '../../game/roster';
import { type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function enforceArenaFrameSyncForState({
  state,
  refs,
  dt,
  isMultiplayer,
  multiplayerRole,
  mainAI,
  opponentClientId,
  resolvePlayerCollisions,
  constrainCombatantToArena,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  dt: number;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  mainAI: Combatant | undefined;
  opponentClientId: string;
  resolvePlayerCollisions: () => void;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
}): void {
  if (isMultiplayer) {
    if (multiplayerRole === 'observer') {
      state.hostPos.addScaledVector(state.hostVel, dt);
      state.clientPos.addScaledVector(state.clientVel, dt);
    } else {
      state.otherPlayers.forEach((other) => {
        if (other.pos && other.vel && other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
          other.pos.addScaledVector(other.vel, dt);
        }
      });
    }
  }

  resolvePlayerCollisions();

  if (!state.isObserverMode) {
    constrainCombatantToArena(state.playerPos, state.playerVel);
  }

  if (mainAI) {
    constrainCombatantToArena(mainAI.pos, mainAI.vel);
  }
  constrainCombatantToArena(state.hostPos, state.hostVel);
  constrainCombatantToArena(state.clientPos, state.clientVel);

  state.otherPlayers.forEach((other) => {
    if (other.pos && other.vel) {
      constrainCombatantToArena(other.pos, other.vel);
    }
  });

  state.otherPlayers.forEach((bot, id) => {
    const meshes = refs.otherPlayerMeshes.get(id);
    if (meshes?.group && bot.pos) {
      meshes.group.position.copy(bot.pos);
    }
  });

  if (state.isMultiplayer) {
    if (state.multiplayerRole === 'observer') {
      if (refs.enemyGroup) refs.enemyGroup.position.copy(state.clientPos);
      if (refs.hostGroup) refs.hostGroup.position.copy(state.hostPos);
    } else {
      const remote = getPrimaryRemoteOpponent(state.otherPlayers, opponentClientId);
      if (refs.enemyGroup && remote) {
        refs.enemyGroup.position.copy(remote.pos);
      }
      if (refs.hostGroup) {
        refs.hostGroup.position.copy(state.playerPos);
      }
    }
  }
}
