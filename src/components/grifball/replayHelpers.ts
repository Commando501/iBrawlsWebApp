import * as THREE from 'three';
import { resolveGrifballTeam } from '../../game/grifballTeams';
import { MAIN_AI_ID } from '../../game/roster';
import type { TeamId } from '../../game/teamScoring';
import { type ReplayFile, type ReplayFrame } from '../../types';
import { type LastRecordedReplayEntityState } from './runtimeRefs';

export type ReplayTargetCycleDirection = 'next' | 'prev';
export type ReconstructedReplayState =
  | NonNullable<ReplayFrame['player']>
  | NonNullable<ReplayFrame['ai']>
  | NonNullable<ReplayFrame['otherPlayers']>[number];

export interface ReplayEntityComparisonState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  activeWeapon: string;
  weaponState: string;
  isCrouching: boolean;
  score: number;
  kills: number;
  deaths: number;
}

export interface ReplayInterpolatedPlayer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  crouchScaleY: number;
  hp: number;
  activeWeapon: string;
  weaponState: string;
  isCrouching: boolean;
  isLunging: boolean;
  isDashing: boolean;
  isSprinting: boolean;
  isSliding: boolean;
  weaponTimer: number;
  score: number;
  kills: number;
  deaths: number;
  respawnTimer: number;
  invulnerabilityTimer: number;
  name: string;
  hue: number;
  playerName?: string;
  maxHp?: number;
  team?: TeamId;
}

export interface ReplayPlaybackFrameSlice {
  indexA: number;
  indexB: number;
  frameA: ReplayFrame;
  frameB: ReplayFrame;
  alpha: number;
  updatedPlayers: Map<string, ReplayInterpolatedPlayer>;
}

export const getNextReplayTargetId = (
  playerIds: string[],
  currentTarget: string,
  direction: ReplayTargetCycleDirection = 'next'
): string | null => {
  if (playerIds.length === 0) return null;

  const targets = ['free', ...playerIds];
  const currentIndex = Math.max(0, targets.indexOf(currentTarget || 'free'));
  const nextIndex =
    direction === 'next'
      ? (currentIndex + 1) % targets.length
      : (currentIndex - 1 + targets.length) % targets.length;

  return targets[nextIndex];
};

export const getReconstructedReplayState = (
  replayData: ReplayFile | null,
  playerType: 'player' | typeof MAIN_AI_ID | string,
  frameIdx: number
): ReconstructedReplayState | null => {
  if (!replayData) return null;
  const frames = replayData.frames;

  for (let i = frameIdx; i >= 0; i--) {
    const f = frames[i];
    if (playerType === 'player' && f.player) return f.player;
    if (playerType !== 'player' && f.otherPlayers) {
      const found = f.otherPlayers.find(p => p.id === playerType);
      if (found) return found;
    }
    if (playerType === MAIN_AI_ID && f.ai) return f.ai;
  }

  const f0 = frames[0];
  if (playerType === 'player') return f0.player ?? null;
  if (f0.otherPlayers) {
    const found = f0.otherPlayers.find(p => p.id === playerType);
    if (found) return found;
  }
  if (playerType === MAIN_AI_ID) return f0.ai ?? null;
  return null;
};

const interpolateReplayPlayer = (
  replayData: ReplayFile,
  id: string,
  indexA: number,
  indexB: number,
  alpha: number
): Omit<ReplayInterpolatedPlayer, 'name' | 'hue'> | null => {
  const stateA = getReconstructedReplayState(replayData, id, indexA);
  const stateB = getReconstructedReplayState(replayData, id, indexB);
  if (!stateA || !stateB) return null;

  const pos = new THREE.Vector3(
    stateA.pos.x + (stateB.pos.x - stateA.pos.x) * alpha,
    stateA.pos.y + (stateB.pos.y - stateA.pos.y) * alpha,
    stateA.pos.z + (stateB.pos.z - stateA.pos.z) * alpha
  );

  const vel = new THREE.Vector3(
    stateA.vel.x + (stateB.vel.x - stateA.vel.x) * alpha,
    stateA.vel.y + (stateB.vel.y - stateA.vel.y) * alpha,
    stateA.vel.z + (stateB.vel.z - stateA.vel.z) * alpha
  );

  const yawA = stateA.yaw;
  const yawB = stateB.yaw;
  const diffYaw = Math.atan2(Math.sin(yawB - yawA), Math.cos(yawB - yawA));
  const yaw = yawA + diffYaw * alpha;

  const pitchA = stateA.pitch || 0;
  const pitchB = stateB.pitch || 0;
  const pitch = pitchA + (pitchB - pitchA) * alpha;

  const crouchA = stateA.isCrouching ? 0.65 : 1.0;
  const crouchB = stateB.isCrouching ? 0.65 : 1.0;
  const crouchScaleY = crouchA + (crouchB - crouchA) * alpha;

  const nearestState = alpha > 0.5 ? stateB : stateA;
  const team = nearestState.team ?? (
    replayData.gameMode === 'grifball' ? resolveGrifballTeam(id) : undefined
  );

  return {
    pos,
    vel,
    yaw,
    pitch,
    crouchScaleY,
    hp: nearestState.hp,
    activeWeapon: nearestState.activeWeapon,
    weaponState: nearestState.weaponState,
    isCrouching: nearestState.isCrouching,
    isLunging: nearestState.isLunging || false,
    isDashing: nearestState.isDashing || false,
    isSprinting: nearestState.isSprinting || false,
    isSliding: nearestState.isSliding || false,
    weaponTimer: nearestState.weaponTimer || 0,
    score: nearestState.score,
    kills: nearestState.kills,
    deaths: nearestState.deaths,
    respawnTimer: nearestState.respawnTimer,
    invulnerabilityTimer: nearestState.invulnerabilityTimer,
    team,
  };
};

export function buildReplayPlaybackFrameSlice({
  replayData,
  time,
  botColors,
}: {
  replayData: ReplayFile;
  time: number;
  botColors: Record<string, number>;
}): ReplayPlaybackFrameSlice | null {
  const frames = replayData.frames;
  if (frames.length === 0) return null;

  let indexA = 0;
  let indexB = 0;

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].time <= time) {
      indexA = i;
    } else {
      indexB = i;
      break;
    }
  }

  if (indexB === 0) indexB = indexA;

  const frameA = frames[indexA];
  const frameB = frames[indexB];
  const timeA = frameA.time;
  const timeB = frameB.time;
  const alpha = timeB === timeA ? 0 : (time - timeA) / (timeB - timeA);
  const updatedPlayers = new Map<string, ReplayInterpolatedPlayer>();

  const playerInterp = interpolateReplayPlayer(replayData, 'player', indexA, indexB, alpha);
  const mode = replayData.mode as string;
  const isRecordedObserver = replayData.recordedAsObserver === true ||
    (mode === 'multiplayer' &&
      replayData.frames.some(f =>
        f.otherPlayers &&
        f.otherPlayers.length >= 2 &&
        f.otherPlayers.some(p => p.playerName.includes('(Host)')) &&
        f.otherPlayers.some(p => p.playerName.includes('(Guest)'))
      ));

  if (playerInterp && !isRecordedObserver) {
    updatedPlayers.set('player', { ...playerInterp, name: replayData.playerName, hue: replayData.playerHue });
  }

  const allBotIds = new Set<string>();
  if (mode !== 'multiplayer') {
    allBotIds.add(MAIN_AI_ID);
  }
  frames.forEach(f => {
    if (f.otherPlayers) f.otherPlayers.forEach(p => allBotIds.add(p.id));
    if (f.ai && mode !== 'multiplayer') allBotIds.add(MAIN_AI_ID);
  });

  allBotIds.forEach(id => {
    let name = id === MAIN_AI_ID ? replayData.opponentName : 'Bot';
    let hue = id === MAIN_AI_ID ? (botColors[MAIN_AI_ID] ?? 0) : 0;
    for (const frame of frames) {
      const found = frame.otherPlayers?.find(p => p.id === id);
      if (found) {
        name = found.playerName;
        hue = found.hue;
        break;
      }
    }

    const botInterp = interpolateReplayPlayer(replayData, id, indexA, indexB, alpha);
    if (botInterp) {
      updatedPlayers.set(id, { ...botInterp, name, hue });
    }
  });

  return { indexA, indexB, frameA, frameB, alpha, updatedPlayers };
}

export const hasReplayEntityStateChanged = (
  current: ReplayEntityComparisonState,
  prev: LastRecordedReplayEntityState | undefined
): boolean => {
  if (!prev) return true;

  const posDiff = current.pos.distanceTo(prev.pos);
  const velDiff = current.vel.distanceTo(prev.vel);
  const yawDiff = Math.abs(current.yaw - prev.yaw);

  return (
    posDiff >= 0.001 ||
    velDiff >= 0.001 ||
    yawDiff >= 0.005 ||
    current.hp !== prev.hp ||
    current.activeWeapon !== prev.activeWeapon ||
    current.weaponState !== prev.weaponState ||
    current.isCrouching !== prev.isCrouching ||
    current.score !== prev.score ||
    current.kills !== prev.kills ||
    current.deaths !== prev.deaths
  );
};
