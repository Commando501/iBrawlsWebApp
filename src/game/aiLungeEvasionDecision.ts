import * as THREE from 'three';
import { simulationRandom } from './simulationRandom';
import { type AIBehaviorState, type Combatant, type UniversalSettings, type WeaponState } from '../types';
import { type PlayerModelSnapshot } from './aiPlayerModel';
import { getBulltrueHammerTriggerBand, getEvasionDashRollChance, getEvasionTimingScale,
  getHammerJumpEvasionChance, isInBulltrueHammerWindow, isWithinEvasionRange, shouldAttemptBaitDodge } from './aiSpatialStrategy';

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

/** Shared evasion arbitration. The host supplies current observations and
 * callbacks that perform the selected action. A rejected hammer jump does not
 * fall through to an emergency hop, matching the live priority chain. Does not advance clocks or integrate movement. */
export interface AILungeEvasionDecisionInput {
  settings: Pick<UniversalSettings, 'swordLungeSpeed' | 'attackRadius'>;
  frame: AILungeEvasionFrame;
  targetWeapon: Combatant['activeWeapon'] | 'pistol';
  distanceToTarget: number; combatDistanceToTarget: number;
  targetIsLunging: boolean; difficulty: string; defensiveEvasionMult: number;
  spatialIQ: number; swayTimer: number; activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean; playerModel: PlayerModelSnapshot | null;
  tuning: AILungeEvasionTuning;
  random?: () => number;
  resolveIncomingDirection: () => { x: number; z: number };
  startSpatialDodge: (x: number, z: number, trackPostEvasion?: boolean) => boolean;
  tryBulltrueCounter: () => { started: boolean; aiState: AIBehaviorState | undefined;
    timer: number | undefined; weaponState: AILungeEvasionFrame['weaponState'] };
  startHammerJump: () => boolean;
  startEmergencyHop: (x: number, z: number) => boolean;
  triggerHammerAttack: () => void;
}

export function resolveAILungeEvasionDecision({ settings, frame, targetWeapon, distanceToTarget,
  combatDistanceToTarget, targetIsLunging, difficulty, defensiveEvasionMult, spatialIQ,
  swayTimer, activeWeapon, canStartWeaponAction, playerModel, tuning, random = simulationRandom,
  resolveIncomingDirection, startSpatialDodge, tryBulltrueCounter, startHammerJump,
  startEmergencyHop, triggerHammerAttack }: AILungeEvasionDecisionInput): AILungeEvasionResult {
  const evasionTimingScale = getEvasionTimingScale(playerModel, tuning.defaultReactionTime);
  const evasionRollInput = { difficulty, defensiveEvasionMult, spatialIQ };
  let isEvadingLunge = false;

  if (
    shouldAttemptBaitDodge({
      distanceToTarget,
      combatDistanceToTarget,
      spatialIQ,
      targetIsLunging,
      targetActiveWeapon: targetWeapon,
      dashCooldownRemaining: frame.dashCooldownTimer,
      difficulty,
      baitDistance: tuning.baitDodgeDistance,
      baitBand: tuning.baitDodgeBand,
      random,
    }) &&
    frame.dashCooldownTimer <= 0
  ) {
    const baitLunge = resolveIncomingDirection();
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
    const incomingLunge = resolveIncomingDirection();

    const bulltrueCounterFrame = tryBulltrueCounter();
    frame.aiState = bulltrueCounterFrame.aiState;
    frame.timer = bulltrueCounterFrame.timer;
    frame.weaponState = bulltrueCounterFrame.weaponState;
    startedBulltrueCounter = bulltrueCounterFrame.started;

    if (
      !startedBulltrueCounter &&
      frame.dashCooldownTimer <= 0 &&
      random() < getEvasionDashRollChance(evasionRollInput)
    ) {
      if (startSpatialDodge(incomingLunge.x, incomingLunge.z)) {
        isEvadingLunge = true;
      }
    } else if (
      !startedBulltrueCounter &&
      canStartWeaponAction &&
      activeWeapon === 'hammer' &&
      frame.weaponState === 'ready' &&
      random() < getHammerJumpEvasionChance(evasionRollInput)
    ) {
      if (startHammerJump()) {
        frame.weaponState = 'swing_up';
        isEvadingLunge = true;
      }
    } else if (!startedBulltrueCounter) {
      if (startEmergencyHop(incomingLunge.x, incomingLunge.z)) {
        isEvadingLunge = true;
      }
    }

    if (!startedBulltrueCounter && canStartWeaponAction && activeWeapon === 'hammer' && frame.weaponState === 'ready') {
      const bulltrueBand = getBulltrueHammerTriggerBand({
        distanceToTarget,
        lungeSpeed: settings.swordLungeSpeed ?? 24.0,
        attackRadius: settings.attackRadius,
        timingScale: evasionTimingScale,
        hammerWindup: tuning.hammerWindupSeconds,
      });
      if (isInBulltrueHammerWindow(distanceToTarget, bulltrueBand)) {
        triggerHammerAttack();
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
