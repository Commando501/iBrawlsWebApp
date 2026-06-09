import * as THREE from 'three';
import { type DeathEvent } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MutableRef<T> = { current: T };

export type GrifbSecretSyncPayload = {
  type: 'sync';
  action: 'unlock_secret';
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  isCrouching: boolean;
  activeWeapon: 'pistol';
  respawnTimer: number;
  invulnerabilityTimer: number;
  hue: number;
  playerName: string;
};

export const GRIFB_SECRET_AUDIO_SRC = '/Saudi Smurf Allah.mp3';

export function playGrifbSecretAudio(secretAudioRef: MutableRef<HTMLAudioElement | null>): void {
  if (secretAudioRef.current) {
    secretAudioRef.current.pause();
  }
  const audio = new Audio(GRIFB_SECRET_AUDIO_SRC);
  audio.volume = 0.55;
  audio.play().catch((e) => console.error('Error playing secret song:', e));
  secretAudioRef.current = audio;
}

export function buildGrifbSecretSyncPayload(state: GrifballRuntimeState): GrifbSecretSyncPayload {
  return {
    type: 'sync',
    action: 'unlock_secret',
    pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
    vel: { x: state.playerVel.x, y: state.playerVel.y, z: state.playerVel.z },
    yaw: state.yaw,
    pitch: state.pitch,
    hp: state.playerHP,
    maxHp: state.playerMaxHP,
    isCrouching: state.isCrouching,
    activeWeapon: 'pistol',
    respawnTimer: state.playerRespawnTimer,
    invulnerabilityTimer: state.playerInvulnerabilityTimer,
    hue: state.settings.playerHue,
    playerName: state.settings.playerName,
  };
}

export function unlockLocalGrifbSecretForState({
  state,
  refs,
  secretAudioRef,
  spawnVoxelShockwaveParticles,
  playRespawn,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  secretAudioRef: MutableRef<HTMLAudioElement | null>;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
  playRespawn: () => void;
  pushStatsUpdate: () => void;
}): void {
  state.activeWeapon = 'pistol';

  if (refs.playerHammer) refs.playerHammer.visible = false;
  if (refs.playerSword) refs.playerSword.visible = false;
  if (refs.playerPistol) refs.playerPistol.visible = true;

  spawnVoxelShockwaveParticles(state.playerPos, '#38bdf8');
  spawnVoxelShockwaveParticles(state.playerPos, '#fffa00');

  playRespawn();
  playGrifbSecretAudio(secretAudioRef);

  const secretAnnouncement: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: 'SECRET',
    victim: 'UNLOCKED: GRIFB Pistol!',
    weapon: 'sword',
  };
  state.lastDeaths = [secretAnnouncement, ...state.lastDeaths].slice(0, 3);
  pushStatsUpdate();
}

export function applyRemoteGrifbSecretUnlockForState({
  state,
  refs,
  senderId,
  secretAudioRef,
  spawnVoxelShockwaveParticles,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  senderId?: string;
  secretAudioRef: MutableRef<HTMLAudioElement | null>;
  spawnVoxelShockwaveParticles: (impactCenter: THREE.Vector3, color: string) => void;
}): void {
  playGrifbSecretAudio(secretAudioRef);

  if (!senderId || !state.otherPlayers.has(senderId)) return;
  const player = state.otherPlayers.get(senderId);
  if (!player) return;

  player.activeWeapon = 'pistol' as typeof player.activeWeapon;
  const meshes = refs.otherPlayerMeshes.get(senderId);
  if (meshes) {
    meshes.hammer.visible = false;
    meshes.sword.visible = false;
    if (meshes.pistol) meshes.pistol.visible = true;
  }

  const announcement: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker: 'SECRET UNLOCKED',
    victim: `${player.playerName || 'Blue'} equipped GRIFB Pistol!`,
    weapon: 'sword',
  };
  state.lastDeaths = [announcement, ...state.lastDeaths].slice(0, 3);
  spawnVoxelShockwaveParticles(new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z), '#38bdf8');
  spawnVoxelShockwaveParticles(new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z), '#fffa00');
}
