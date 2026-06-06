import * as THREE from 'three';
import { type AICombatWeapon } from '../../game/aiCombatDecision';
import {
  getBulltrueHammerTriggerBand,
  getEvasionDashRollChance,
  getEvasionTimingScale,
  getHammerJumpEvasionChance,
  isInBulltrueHammerWindow,
  isWithinEvasionRange,
  shouldAttemptBaitDodge,
} from '../../game/aiSpatialStrategy';
import { MAIN_AI_ID } from '../../game/roster';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
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

export interface AILungeEvasionFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dashDir: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  dashRemaining: number;
  dashCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export interface AILungeEvasionTuning {
  defaultReactionTime: number;
  baitDodgeDistance: number;
  baitDodgeBand: number;
  baseEvasionDetectRange: number;
  evasionTriggerJitter: number;
  hammerWindupSeconds: number;
}

export interface AILungeEvasionResult {
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  dashRemaining: number;
  dashCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
  weaponState: WeaponState | 'slashing' | 'recovering';
  isEvadingLunge: boolean;
}

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
}): AILungeEvasionResult {
  const evasionPlayerModel = getTargetPlayerModel(target.id);
  const evasionTimingScale = getEvasionTimingScale(evasionPlayerModel, tuning.defaultReactionTime);
  const targetOtherBot =
    target.id !== 'player' && target.id !== MAIN_AI_ID ? state.otherPlayers.get(target.id) : undefined;
  const evasionRollInput = { difficulty, defensiveEvasionMult, spatialIQ };

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
    });
    frame.dashRemaining = spatialDodgeFrame.dashRemaining;
    frame.dashCooldownTimer = spatialDodgeFrame.dashCooldownTimer;
    frame.pendingPostEvasionCharge = spatialDodgeFrame.pendingPostEvasionCharge;
    return true;
  };

  let isEvadingLunge = false;

  if (
    shouldAttemptBaitDodge({
      distanceToTarget,
      combatDistanceToTarget,
      spatialIQ,
      targetIsLunging,
      targetActiveWeapon: target.activeWeapon,
      dashCooldownRemaining: frame.dashCooldownTimer,
      difficulty,
      baitDistance: tuning.baitDodgeDistance,
      baitBand: tuning.baitDodgeBand,
    }) &&
    frame.dashCooldownTimer <= 0
  ) {
    const baitLunge = resolveIncomingLungeDirectionForTarget({
      target,
      toTarget,
      playerIsLunging: state.isLunging,
      playerLungeDir: state.lungeTargetDir,
      mainAi: mainAI,
      targetOtherBot,
    });
    if (startSpatialDodge(baitLunge.x, baitLunge.z, false)) {
      isEvadingLunge = true;
    }
  }

  if (
    targetIsLunging &&
    isWithinEvasionRange({
      distanceToTarget: distanceToTarget / evasionTimingScale,
      combatDistanceToTarget: combatDistanceToTarget / evasionTimingScale,
      spatialIQ,
      swayPhase: swayTimer,
      baseRange: tuning.baseEvasionDetectRange,
      jitterAmount: tuning.evasionTriggerJitter,
    }) &&
    difficulty !== 'easy'
  ) {
    let startedBulltrueCounter = false;
    const incomingLunge = resolveIncomingLungeDirectionForTarget({
      target,
      toTarget,
      playerIsLunging: state.isLunging,
      playerLungeDir: state.lungeTargetDir,
      mainAi: mainAI,
      targetOtherBot,
    });

    const bulltrueCounterFrame = resolveAIBulltrueCounterForCombatant({
      state,
      frame: {
        activeWeapon,
        aiState: frame.aiState,
        timer: frame.timer,
        weaponState: frame.weaponState,
      },
      botId,
      bulltrueCounter,
      canStartWeaponAction,
      cooldownMultiplier,
      calibrationEnabled,
      triggerCombatantAttack: (weapon) => triggerCombatantAttack(self, weapon),
    });
    frame.aiState = bulltrueCounterFrame.aiState;
    frame.timer = bulltrueCounterFrame.timer;
    frame.weaponState = bulltrueCounterFrame.weaponState;
    startedBulltrueCounter = bulltrueCounterFrame.started;

    if (
      !startedBulltrueCounter &&
      frame.dashCooldownTimer <= 0 &&
      Math.random() < getEvasionDashRollChance(evasionRollInput)
    ) {
      if (startSpatialDodge(incomingLunge.x, incomingLunge.z)) {
        isEvadingLunge = true;
      }
    } else if (
      !startedBulltrueCounter &&
      canStartWeaponAction &&
      activeWeapon === 'hammer' &&
      frame.weaponState === 'ready' &&
      Math.random() < getHammerJumpEvasionChance(evasionRollInput)
    ) {
      if (startAIHammerJump(self, frame.pos, frame.vel, undefined, 'defensive')) {
        frame.weaponState = 'swing_up';
        spawnVoxelShockwaveParticles(frame.pos, '#f59e0b');
        isEvadingLunge = true;
      }
    } else if (!startedBulltrueCounter) {
      if (resolveAIEmergencyHopDodgeForCombatant({
        state,
        self,
        pos: frame.pos,
        vel: frame.vel,
        dt,
        lungeDirX: incomingLunge.x,
        lungeDirZ: incomingLunge.z,
        playerModel: evasionPlayerModel,
        playJump,
      })) {
        isEvadingLunge = true;
      }
    }

    if (!startedBulltrueCounter && canStartWeaponAction && activeWeapon === 'hammer' && frame.weaponState === 'ready') {
      const bulltrueBand = getBulltrueHammerTriggerBand({
        distanceToTarget,
        lungeSpeed: state.settings.swordLungeSpeed ?? 24.0,
        attackRadius: state.settings.attackRadius,
        timingScale: evasionTimingScale,
        hammerWindup: tuning.hammerWindupSeconds,
      });
      if (isInBulltrueHammerWindow(distanceToTarget, bulltrueBand)) {
        triggerCombatantAttack(self, 'hammer');
      }
    }
  }

  return {
    aiState: frame.aiState,
    timer: frame.timer,
    dashRemaining: frame.dashRemaining,
    dashCooldownTimer: frame.dashCooldownTimer,
    pendingPostEvasionCharge: frame.pendingPostEvasionCharge,
    weaponState: frame.weaponState,
    isEvadingLunge,
  };
}
