import * as THREE from 'three';
import { type Combatant } from '../../types';
import { ballAsHammer } from '../../game/weaponCompat';
import { type GrifballRuntimeState } from './runtimeState';

export type SpectateTargetRole = 'host' | 'client';
export type SpectateTargetActiveWeapon = 'hammer' | 'sword' | 'pistol';

export interface SpectateTargetData {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  name: string;
  hp: number;
  hue: number;
  isCrouching: boolean;
  activeWeapon: SpectateTargetActiveWeapon;
}

interface ResolveSpectateTargetDataOptions {
  target: SpectateTargetRole;
  state: GrifballRuntimeState;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | 'observer' | null | undefined;
  mainAI: Combatant | undefined;
  opponentName: string;
  opponentClientId: string;
  lastOpponentHue: number | null | undefined;
}

export const resolveSpectateTargetData = ({
  target,
  state: s,
  isMultiplayer,
  multiplayerRole,
  mainAI,
  opponentName,
  opponentClientId,
  lastOpponentHue,
}: ResolveSpectateTargetDataOptions): SpectateTargetData => {
  if (isMultiplayer) {
    if (multiplayerRole === 'observer') {
      if (target === 'host') {
        return {
          pos: s.hostPos,
          yaw: s.hostYaw,
          pitch: s.hostPitch,
          name: s.hostPlayerName || 'Blue (Host)',
          hp: s.hostHP,
          hue: s.hostHue,
          isCrouching: s.hostIsCrouching,
          activeWeapon: s.hostActiveWeapon,
        };
      }

      return {
        pos: s.clientPos,
        yaw: s.clientYaw,
        pitch: s.clientPitch,
        name: s.clientPlayerName || 'Red (Guest)',
        hp: s.clientHP,
        hue: s.clientHue,
        isCrouching: s.clientIsCrouching,
        activeWeapon: s.clientActiveWeapon,
      };
    }

    if (multiplayerRole === 'host') {
      if (target === 'host') {
        return {
          pos: s.playerPos,
          yaw: s.yaw,
          pitch: s.pitch,
          name: s.settings.playerName || 'Blue (You - Host)',
          hp: s.playerHP,
          hue: s.settings.playerHue ?? 200,
          isCrouching: s.isCrouching,
          activeWeapon: ballAsHammer(s.activeWeapon),
        };
      }

      const remote = s.otherPlayers.get(opponentClientId) || Array.from(s.otherPlayers.values()).find(p => p.controller === 'remote');
      return {
        pos: remote ? remote.pos : new THREE.Vector3(),
        yaw: remote ? remote.yaw : 0,
        pitch: remote ? (remote.pitch || 0) : 0,
        name: opponentName || opponentClientId || 'Red (Guest)',
        hp: remote ? remote.hp : 1,
        hue: lastOpponentHue ?? 200,
        isCrouching: remote ? remote.isCrouching : false,
        activeWeapon: ballAsHammer(remote ? remote.activeWeapon : 'hammer'),
      };
    }

    if (multiplayerRole === 'client') {
      if (target === 'host') {
        const remote = s.otherPlayers.get(opponentClientId) || Array.from(s.otherPlayers.values()).find(p => p.controller === 'remote');
        return {
          pos: remote ? remote.pos : new THREE.Vector3(),
          yaw: remote ? remote.yaw : 0,
          pitch: remote ? (remote.pitch || 0) : 0,
          name: opponentName || opponentClientId || 'Blue (Host)',
          hp: remote ? remote.hp : 1,
          hue: lastOpponentHue ?? 200,
          isCrouching: remote ? remote.isCrouching : false,
          activeWeapon: ballAsHammer(remote ? remote.activeWeapon : 'hammer'),
        };
      }

      return {
        pos: s.playerPos,
        yaw: s.yaw,
        pitch: s.pitch,
        name: s.settings.playerName || 'Red (You - Guest)',
        hp: s.playerHP,
        hue: s.settings.playerHue ?? 200,
        isCrouching: s.isCrouching,
        activeWeapon: ballAsHammer(s.activeWeapon),
      };
    }
  }

  if (target === 'host') {
    return {
      pos: s.playerPos,
      yaw: s.yaw,
      pitch: s.pitch,
      name: s.settings.playerName || 'Spartan (You)',
      hp: s.playerHP,
      hue: s.settings.playerHue ?? 200,
      isCrouching: s.isCrouching,
      activeWeapon: ballAsHammer(s.activeWeapon),
    };
  }

  if (mainAI) {
    return {
      pos: mainAI.pos,
      yaw: mainAI.yaw,
      pitch: 0,
      name: 'AI Bot',
      hp: mainAI.hp,
      hue: 0,
      isCrouching: mainAI.isCrouching,
      activeWeapon: ballAsHammer(mainAI.activeWeapon),
    };
  }

  return {
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    name: 'Unknown',
    hp: 1,
    hue: 200,
    isCrouching: false,
    activeWeapon: 'hammer',
  };
};
