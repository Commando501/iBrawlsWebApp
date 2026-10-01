import * as THREE from 'three';
import { type Combatant, type CustomMapData } from '../../types';
import { recoverAirborneCombatantForFrame } from './aiAirborneRecoveryRuntime';
import { type GrifballAwarenessPoint } from './grifballAITeamAwareness';
import {
  resolveSupportGrifballAIObjectiveMovementForCombatant,
  type GrifballAIObjectiveFrame,
  type GrifballAIObjectiveState,
} from './grifballAIObjectiveMovement';
import { type GrifballCombatantRef } from './grifballObjectiveRuntime';
import {
  resolveNoTargetSpawnGuardForCombatant,
} from './aiSpawnGuardRuntime';

export type AINoTargetResolutionMode = 'airborne' | 'support_objective' | 'spawn_guard';

export function resolveNoTargetAIFrameForCombatant<TSelf extends Pick<Combatant, 'isLunging' | 'isJumping' | 'aiHammerJumpsInAir' | 'aiDashRemaining'>>({
  state,
  botId,
  self,
  frame,
  mainAI,
  alliesList,
  spatialIQ,
  edgeInset,
  dt,
  activeCustomMap,
  gravityAcceleration,
  finishSwordLungeTargetDead,
  recoverCombatantAltitude,
  constrainCombatantToArena,
  getOptimalSpawnPoint,
  getCombatantTeam,
  getCombatantRef,
  getEnemyGoalPos,
}: {
  state: GrifballAIObjectiveState & { arenaRadius: number };
  botId: string;
  self: TSelf;
  frame: GrifballAIObjectiveFrame;
  mainAI: Pick<Combatant, 'hp' | 'aiState' | 'pos'> | undefined;
  alliesList: GrifballAwarenessPoint[];
  spatialIQ: number;
  edgeInset: number;
  dt: number;
  activeCustomMap: CustomMapData | null;
  gravityAcceleration: number;
  finishSwordLungeTargetDead: () => void;
  recoverCombatantAltitude: (self: TSelf, pos: THREE.Vector3, vel: THREE.Vector3) => boolean;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
  getOptimalSpawnPoint: (excludePositions: THREE.Vector3[]) => THREE.Vector3;
  getCombatantTeam: (id: string) => string | undefined;
  getCombatantRef: (id: string) => GrifballCombatantRef | null;
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null;
}): AINoTargetResolutionMode {
  if (self.isLunging) {
    finishSwordLungeTargetDead();
  }
  self.aiDashRemaining = 0;
  // The caller synchronizes its working frame after this function returns.
  // Cancel both copies so airborne/support recovery cannot restore the dash.
  frame.dashRemaining = 0;

  if (recoverAirborneCombatantForFrame({
    self,
    pos: frame.pos,
    vel: frame.vel,
    dt,
    gravityAcceleration,
    recoverCombatantAltitude,
    constrainCombatantToArena,
  })) {
    return 'airborne';
  }

  if (resolveSupportGrifballAIObjectiveMovementForCombatant({
    state,
    botId,
    self,
    frame,
    alliesList,
    dt,
    constrainCombatantToArena,
    getCombatantTeam,
    getCombatantRef,
    getEnemyGoalPos,
  })) {
    return 'support_objective';
  }

  resolveNoTargetSpawnGuardForCombatant({
    state,
    botId,
    mainAI,
    frame,
    spatialIQ,
    edgeInset,
    dt,
    activeCustomMap,
    getOptimalSpawnPoint,
    constrainCombatantToArena,
  });
  return 'spawn_guard';
}
