import { simulationRandom } from '../../game/simulationRandom';
import * as THREE from 'three';
import { type AICombatWeapon } from '../../game/aiCombatDecision';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant } from '../../types';
import { resolveAIBulltrueCounterForCombatant } from './aiBulltrueCounterRuntime';
import { resolveIncomingLungeDirectionForTarget } from './aiIncomingLungeRuntime';
import {
  resolveAIEmergencyHopDodgeForCombatant,
  startAISpatialDodgeFrameForCombatant,
} from './aiSpatialDodgeRuntime';
import { type CombatantWeapon } from './combatantActions';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type PlayerModelObserver, type PlayerModelSnapshot } from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';

import { resolveAILungeEvasionDecision, type AILungeEvasionFrame, type AILungeEvasionResult, type AILungeEvasionTuning } from '../../game/aiLungeEvasionDecision';
export type { AILungeEvasionFrame, AILungeEvasionResult, AILungeEvasionTuning } from '../../game/aiLungeEvasionDecision';

export function resolveAILungeEvasionForCombatant({
  state,
  self,
  frame,
  botId,
  target,
  toTarget,
  distanceToTarget,
  combatDistanceToTarget,
  resolvedAiReach,
  targetIsProtected,
  targetIsLunging,
  dt,
  difficulty,
  defensiveEvasionMult,
  spatialIQ,
  swayTimer,
  activeWeapon,
  canStartWeaponAction,
  cooldownMultiplier,
  calibrationEnabled,
  bulltrueCounter,
  getTargetPlayerModel,
  mainAI,
  triggerCombatantAttack,
  startAIHammerJump,
  spawnVoxelShockwaveParticles,
  recordCombatantObservation,
  playDash,
  playJump,
  tuning,
  random = simulationRandom,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  frame: AILungeEvasionFrame;
  botId: string;
  target: TacticalTargetCandidate;
  toTarget: THREE.Vector3;
  distanceToTarget: number;
  combatDistanceToTarget: number;
  resolvedAiReach: number;
  targetIsProtected: boolean;
  targetIsLunging: boolean;
  dt: number;
  difficulty: string;
  defensiveEvasionMult: number;
  spatialIQ: number;
  swayTimer: number;
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  cooldownMultiplier: number;
  calibrationEnabled: boolean;
  bulltrueCounter: AICombatWeapon | null;
  getTargetPlayerModel: (targetId: string) => PlayerModelSnapshot | null;
  mainAI: Combatant | undefined;
  triggerCombatantAttack: (self: Combatant, weapon: CombatantWeapon) => void;
  startAIHammerJump: (
    self: Combatant,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType?: 'offensive' | 'defensive'
  ) => boolean;
  spawnVoxelShockwaveParticles: (position: THREE.Vector3, color: string) => void;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
  playDash: () => void;
  playJump: () => void;
  tuning: AILungeEvasionTuning;
  random?: () => number;
}): AILungeEvasionResult {
  const evasionPlayerModel = getTargetPlayerModel(target.id);
  const targetOtherBot =
    target.id !== 'player' && target.id !== MAIN_AI_ID ? state.otherPlayers.get(target.id) : undefined;

  const startSpatialDodge = (lungeDirX: number, lungeDirZ: number, trackPostEvasion = true) => {
    const spatialDodgeFrame = startAISpatialDodgeFrameForCombatant({
      state,
      pos: frame.pos,
      dashDir: frame.dashDir,
      dashRemaining: frame.dashRemaining,
      dashCooldownTimer: frame.dashCooldownTimer,
      pendingPostEvasionCharge: frame.pendingPostEvasionCharge,
      botId,
      target,
      lungeDirX,
      lungeDirZ,
      playerModel: evasionPlayerModel,
      calibrationEnabled,
      trackPostEvasion,
      attackDistanceToTarget: combatDistanceToTarget,
      resolvedAiReach,
      targetProtected: targetIsProtected,
      spatialIQ,
      weaponReady: frame.weaponState === 'ready',
      recordCombatantObservation,
      playDash,
      random,
    });
    frame.dashRemaining = spatialDodgeFrame.dashRemaining;
    frame.dashCooldownTimer = spatialDodgeFrame.dashCooldownTimer;
    frame.pendingPostEvasionCharge = spatialDodgeFrame.pendingPostEvasionCharge;
    return true;
  };

  return resolveAILungeEvasionDecision({ settings: state.settings, frame, targetWeapon: target.activeWeapon,
    distanceToTarget, combatDistanceToTarget, targetIsLunging, difficulty, defensiveEvasionMult,
    spatialIQ, swayTimer, activeWeapon, canStartWeaponAction, playerModel: evasionPlayerModel, tuning, random,
    startSpatialDodge,
    resolveIncomingDirection: () => resolveIncomingLungeDirectionForTarget({ target, toTarget,
      playerIsLunging: state.isLunging, playerLungeDir: state.lungeTargetDir, mainAi: mainAI, targetOtherBot }),
    tryBulltrueCounter: () => resolveAIBulltrueCounterForCombatant({ state,
      frame: { activeWeapon, aiState: frame.aiState, timer: frame.timer, weaponState: frame.weaponState },
      botId, bulltrueCounter, canStartWeaponAction, cooldownMultiplier, calibrationEnabled,
      triggerCombatantAttack: weapon => triggerCombatantAttack(self, weapon) }),
    startHammerJump: () => {
      const started = startAIHammerJump(self, frame.pos, frame.vel, undefined, 'defensive');
      if (started) spawnVoxelShockwaveParticles(frame.pos, '#f59e0b');
      return started;
    },
    startEmergencyHop: (lungeDirX, lungeDirZ) => resolveAIEmergencyHopDodgeForCombatant({ state, self,
      pos: frame.pos, vel: frame.vel, dt, lungeDirX, lungeDirZ, playerModel: evasionPlayerModel, playJump, random }),
    triggerHammerAttack: () => triggerCombatantAttack(self, 'hammer'),
  });
}
