import { simulationRandom } from '../../game/simulationRandom';
import { applyAIEmergencyHopMotion } from '../../game/aiEmergencyHop';
import { startAISpatialDodgeMotion } from '../../game/aiDashMotion';
import * as THREE from 'three';
import {
  pickPerpendicularDodgeDirection,
  shouldCommitChargeAfterEvasion,
} from '../../game/aiSpatialStrategy';
import { recordCalibrationDodgeAttempt } from '../../game/aiSkillCalibration';
import { type Combatant } from '../../types';
import { observePlayerDash, type PlayerModelObserver, type PlayerModelSnapshot } from './playerModelObservations';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

export interface AISpatialDodgeFrame {
  pos: THREE.Vector3;
  dashDir: THREE.Vector3;
  dashRemaining: number;
  dashCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
}

interface AISpatialDodgeContext {
  state: GrifballRuntimeState;
  botId: string;
  target: TacticalTargetCandidate;
  lungeDirX: number;
  lungeDirZ: number;
  playerModel: PlayerModelSnapshot | null;
  calibrationEnabled: boolean;
  trackPostEvasion?: boolean;
  attackDistanceToTarget: number;
  resolvedAiReach: number;
  targetProtected: boolean;
  spatialIQ: number;
  weaponReady: boolean;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
  playDash: () => void;
  random?: () => number;
}

export interface AISpatialDodgeResult {
  dashRemaining: number;
  dashCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
}

export function startAISpatialDodgeForCombatant({
  state,
  frame,
  botId,
  target,
  lungeDirX,
  lungeDirZ,
  playerModel,
  calibrationEnabled,
  trackPostEvasion = true,
  attackDistanceToTarget,
  resolvedAiReach,
  targetProtected,
  spatialIQ,
  weaponReady,
  recordCombatantObservation,
  playDash,
  random = simulationRandom,
}: AISpatialDodgeContext & {
  frame: AISpatialDodgeFrame;
}): true {
  const dodgePick = pickPerpendicularDodgeDirection({
    botPosX: frame.pos.x,
    botPosZ: frame.pos.z,
    lungeDirX,
    lungeDirZ,
    arenaRadius: state.arenaRadius,
    playerModel,
    rng: random(),
  });
  startAISpatialDodgeMotion(state.settings, frame, dodgePick);
  recordCombatantObservation(botId, (model) => observePlayerDash(model, frame.dashDir.x, frame.dashDir.z));
  playDash();

  if (calibrationEnabled) {
    recordCalibrationDodgeAttempt(state.aiMatchContext, botId);
  }

  if (trackPostEvasion) {
    frame.pendingPostEvasionCharge = shouldCommitChargeAfterEvasion({
      targetWeaponState: target.weaponState,
      attackDistanceToTarget,
      resolvedAiReach,
      targetProtected,
      spatialIQ,
      weaponReady,
    });
  }

  return true;
}

export function startAISpatialDodgeFrameForCombatant({
  pos,
  dashDir,
  dashRemaining,
  dashCooldownTimer,
  pendingPostEvasionCharge,
  ...context
}: AISpatialDodgeContext & AISpatialDodgeFrame): AISpatialDodgeResult {
  const frame: AISpatialDodgeFrame = {
    pos,
    dashDir,
    dashRemaining,
    dashCooldownTimer,
    pendingPostEvasionCharge,
  };

  startAISpatialDodgeForCombatant({
    ...context,
    frame,
  });

  return {
    dashRemaining: frame.dashRemaining,
    dashCooldownTimer: frame.dashCooldownTimer,
    pendingPostEvasionCharge: frame.pendingPostEvasionCharge,
  };
}

export function resolveAIEmergencyHopDodgeForCombatant({
  state,
  self,
  pos,
  vel,
  dt,
  lungeDirX,
  lungeDirZ,
  playerModel,
  playJump,
  random = simulationRandom,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dt: number;
  lungeDirX: number;
  lungeDirZ: number;
  playerModel: PlayerModelSnapshot | null;
  playJump: () => void;
  random?: () => number;
}): true {
  const dodgePick = pickPerpendicularDodgeDirection({
    botPosX: pos.x,
    botPosZ: pos.z,
    lungeDirX,
    lungeDirZ,
    arenaRadius: state.arenaRadius,
    playerModel,
    rng: random(),
  });
  if (applyAIEmergencyHopMotion(self, pos, vel, dodgePick, dt)) playJump();
  return true;
}
