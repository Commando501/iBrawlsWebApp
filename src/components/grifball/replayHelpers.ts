import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
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
