import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { type ReplayFile, type ReplayFrame } from '../../types';
import { type GrifballGameProps } from './GrifballGameProps';

export interface FpsCounterState {
  frameCount: number;
  lastSampleTime: number;
  value: number;
}

export interface LastRecordedReplayEntityState {
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

export const createInitialFpsCounter = (): FpsCounterState => ({
  frameCount: 0,
  lastSampleTime: 0,
  value: 0,
});

export const useLatestRef = <T,>(value: T) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

export const useGrifballReplayRuntimeRefs = () => {
  const replayRecordingRef = useRef<ReplayFile | null>(null);
  const lastRecordTimeRef = useRef<number>(0);
  const replayRecordingElapsedTimeRef = useRef<number>(0);
  const lastRecordedStateRef = useRef<Map<string, LastRecordedReplayEntityState>>(new Map());

  const replayTimeRef = useRef<number>(0);
  const replaySpeedRef = useRef<number>(1.0);
  const isReplayPausedRef = useRef<boolean>(false);
  const replayTargetIdRef = useRef<string>('free');
  const prevReplayFrameRef = useRef<ReplayFrame | null>(null);
  const lastReplayEventFrameIndexRef = useRef<number | null>(null);
  const replayPlayerIdsRef = useRef<string[]>([]);

  return {
    replayRecordingRef,
    lastRecordTimeRef,
    replayRecordingElapsedTimeRef,
    lastRecordedStateRef,
    replayTimeRef,
    replaySpeedRef,
    isReplayPausedRef,
    replayTargetIdRef,
    prevReplayFrameRef,
    lastReplayEventFrameIndexRef,
    replayPlayerIdsRef,
  };
};

type OfflineRosterPropRefsInput = Pick<
  GrifballGameProps,
  | 'offlineBotCount'
  | 'botDifficulties'
  | 'botColors'
  | 'botBehaviors'
  | 'botWeaponBehaviors'
  | 'botArchetypes'
>;

export const useOfflineRosterPropRefs = ({
  offlineBotCount,
  botDifficulties,
  botColors,
  botBehaviors,
  botWeaponBehaviors,
  botArchetypes,
}: OfflineRosterPropRefsInput) => {
  const offlineBotCountRef = useRef(offlineBotCount);
  const botDifficultiesRef = useRef(botDifficulties);
  const botColorsRef = useRef(botColors);
  const botBehaviorsRef = useRef(botBehaviors);
  const botWeaponBehaviorsRef = useRef(botWeaponBehaviors);
  const botArchetypesRef = useRef(botArchetypes);

  useEffect(() => {
    offlineBotCountRef.current = offlineBotCount;
    botDifficultiesRef.current = botDifficulties;
    botColorsRef.current = botColors;
    botBehaviorsRef.current = botBehaviors;
    botWeaponBehaviorsRef.current = botWeaponBehaviors;
    botArchetypesRef.current = botArchetypes;
  }, [offlineBotCount, botDifficulties, botColors, botBehaviors, botWeaponBehaviors, botArchetypes]);

  return {
    offlineBotCountRef,
    botDifficultiesRef,
    botColorsRef,
    botBehaviorsRef,
    botWeaponBehaviorsRef,
    botArchetypesRef,
  };
};
