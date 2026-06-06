import * as THREE from 'three';
import {
  canAttemptLungeFakeout,
  canAttemptWeaponSwapFeint,
} from '../../game/aiFeints';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
import { resolveAIPressureLungeChance } from './aiPressureStateRuntime';
import { tryStartAISwordLungeForCombatant } from './aiSwordLungeStartRuntime';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTimingRuntime';
import { type CombatantWeapon } from './combatantActions';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type PlayerModelObserver, type PlayerModelSnapshot } from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';

export interface AIGroundAttackOpportunityFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export type AIGroundAttackOpportunityMode = 'continue' | 'sync_return' | 'return';

export interface AIGroundAttackOpportunityResult {
  mode: AIGroundAttackOpportunityMode;
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
  feintLungeFakeout: boolean;
}

export interface AITacticalWeaponApplyResult {
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export interface AIGroundAttackOpportunityTuning {
  weaponSwapFeintDelay: number;
  lungeChanceAirborneBase: number;
  lungeChanceAirborneAnticipation: number;
  lungeChanceGroundBase: number;
  lungeChanceGroundAnticipation: number;
  lungeFakeoutForwardTimer: number;
}

export function resolveAIGroundAttackOpportunityForCombatant({
  state,
  self,
  frame,
  botId,
  target,
  targetAirborne,
  targetProtected,
  activeWeapon,
  canStartWeaponAction,
  enemyInKillRange,
  selfGrounded,
  slideActive,
  cooldownMultiplier,
  swordForbidden,
  swapLockoutRemaining,
  swapFeintActive,
  comboActive,
  feintChance,
  lungeDistanceToTarget,
  hasVerticalLungeLine,
  minLungeRange,
  maxLungeRange,
  combatDistanceToTarget,
  distanceToTarget,
  resolvedAiReach,
  aggressiveLungeMult,
  tunedAnticipationFactor,
  playstyleFactor,
  tuning,
  constrainCombatantToArena,
  triggerCombatantAttack,
  applyTacticalWeapon,
  startWeaponSwapFeintTimer,
  commitFeint,
  tryFeintRoll,
  getTargetPlayerModel,
  triggerCombatantLunge,
  recordCombatantObservation,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  frame: AIGroundAttackOpportunityFrame;
  botId: string;
  target: TacticalTargetCandidate;
  targetAirborne: boolean;
  targetProtected: boolean;
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  enemyInKillRange: boolean;
  selfGrounded: boolean;
  slideActive: boolean;
  cooldownMultiplier: number;
  swordForbidden: boolean;
  swapLockoutRemaining: number;
  swapFeintActive: boolean;
  comboActive: boolean;
  feintChance: number;
  lungeDistanceToTarget: number;
  hasVerticalLungeLine: boolean;
  minLungeRange: number;
  maxLungeRange: number;
  combatDistanceToTarget: number;
  distanceToTarget: number;
  resolvedAiReach: number;
  aggressiveLungeMult: number;
  tunedAnticipationFactor: number;
  playstyleFactor: number;
  tuning: AIGroundAttackOpportunityTuning;
  constrainCombatantToArena: (pos: THREE.Vector3, vel: THREE.Vector3) => void;
  triggerCombatantAttack: (self: Combatant, weapon: CombatantWeapon) => void;
  applyTacticalWeapon: (tacticalWeapon: CombatantWeapon) => AITacticalWeaponApplyResult;
  startWeaponSwapFeintTimer: () => void;
  commitFeint: () => void;
  tryFeintRoll: (rollScale?: number) => boolean;
  getTargetPlayerModel: (targetId: string) => PlayerModelSnapshot | null;
  triggerCombatantLunge: (
    self: Combatant,
    lungeDir: THREE.Vector3,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ) => void;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
}): AIGroundAttackOpportunityResult {
  let feintLungeFakeout = false;
  let currentActiveWeapon = activeWeapon;
  let currentCanStartWeaponAction = canStartWeaponAction;

  if (
    enemyInKillRange &&
    selfGrounded &&
    currentCanStartWeaponAction &&
    frame.weaponState === 'ready' &&
    !slideActive
  ) {
    frame.vel.x = 0;
    frame.vel.z = 0;
    frame.aiState = 'COOLDOWN';
    frame.timer = resolveScaledAIWeaponReloadTime(state.settings, currentActiveWeapon, cooldownMultiplier);
    triggerCombatantAttack(self, currentActiveWeapon as CombatantWeapon);
    frame.weaponState = 'swing_up';
    constrainCombatantToArena(frame.pos, frame.vel);
    return {
      mode: 'sync_return',
      activeWeapon: currentActiveWeapon,
      canStartWeaponAction: currentCanStartWeaponAction,
      aiState: frame.aiState,
      timer: frame.timer,
      weaponState: frame.weaponState,
      feintLungeFakeout,
    };
  }

  if (
    !swordForbidden &&
    canAttemptWeaponSwapFeint({
      activeWeapon: currentActiveWeapon as CombatantWeapon,
      weaponReady: frame.weaponState === 'ready',
      swapLockoutRemaining,
      distanceToTarget: lungeDistanceToTarget,
      minLungeRange,
      maxLungeRange,
      swapFeintActive,
      state: frame.aiState,
      feintEligible: feintChance > 0,
    }) &&
    !comboActive &&
    tryFeintRoll(0.5)
  ) {
    const applied = applyTacticalWeapon('sword');
    currentActiveWeapon = applied.activeWeapon;
    currentCanStartWeaponAction = applied.canStartWeaponAction;
    frame.weaponState = applied.weaponState;
    startWeaponSwapFeintTimer();
    commitFeint();
  }

  if (
    currentCanStartWeaponAction &&
    currentActiveWeapon === 'sword' &&
    frame.weaponState === 'ready' &&
    hasVerticalLungeLine &&
    lungeDistanceToTarget >= minLungeRange &&
    lungeDistanceToTarget <= maxLungeRange &&
    target.hp > 0 &&
    !targetProtected
  ) {
    const baseLungeChance = (
      targetAirborne
        ? tuning.lungeChanceAirborneBase + (tunedAnticipationFactor * tuning.lungeChanceAirborneAnticipation)
        : tuning.lungeChanceGroundBase + (tunedAnticipationFactor * tuning.lungeChanceGroundAnticipation)
    ) * aggressiveLungeMult;
    const lungeChance = resolveAIPressureLungeChance({
      aiState: frame.aiState,
      baseLungeChance,
      activeWeapon: currentActiveWeapon,
      lungeDistanceToTarget,
      resolvedAiReach,
      minLungeRange,
      maxLungeRange,
      targetProtected,
      playstyleFactor,
    });
    if (Math.random() < lungeChance) {
      const lungeFakeoutEligible = canAttemptLungeFakeout({
        activeWeapon: currentActiveWeapon,
        weaponReady: frame.weaponState === 'ready',
        inLungeRange: true,
        targetProtected,
        feintEligible: feintChance > 0,
      });
      if (lungeFakeoutEligible && tryFeintRoll(0.55)) {
        commitFeint();
        feintLungeFakeout = true;
        frame.aiState = 'DANCING_FORWARD';
        frame.timer = tuning.lungeFakeoutForwardTimer;
      } else {
        if (!tryStartAISwordLungeForCombatant({
          self,
          target,
          pos: frame.pos,
          vel: frame.vel,
          targetAirborne,
          playerModel: getTargetPlayerModel(target.id),
          botId,
          lungeDistanceToTarget,
          triggerCombatantLunge,
          recordCombatantObservation,
        })) {
          return {
            mode: 'return',
            activeWeapon: currentActiveWeapon,
            canStartWeaponAction: currentCanStartWeaponAction,
            aiState: frame.aiState,
            timer: frame.timer,
            weaponState: frame.weaponState,
            feintLungeFakeout,
          };
        }
        return {
          mode: 'return',
          activeWeapon: currentActiveWeapon,
          canStartWeaponAction: currentCanStartWeaponAction,
          aiState: frame.aiState,
          timer: frame.timer,
          weaponState: frame.weaponState,
          feintLungeFakeout,
        };
      }
    }
  }

  return {
    mode: 'continue',
    activeWeapon: currentActiveWeapon,
    canStartWeaponAction: currentCanStartWeaponAction,
    aiState: frame.aiState,
    timer: frame.timer,
    weaponState: frame.weaponState,
    feintLungeFakeout,
  };
}
