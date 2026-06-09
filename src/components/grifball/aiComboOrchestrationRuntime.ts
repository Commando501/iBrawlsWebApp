import * as THREE from 'three';
import {
  clearBotComboState,
  getBotComboState,
  setBotComboState,
  type AIMatchContext,
} from '../../game/aiMatchContext';
import {
  comboBlocksTacticalSwap,
  createBotComboState,
  notifyComboAttackStarted,
  pickOpeningCombo,
  progressComboState,
  shouldAbortCombo,
} from '../../game/aiComboEngine';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
import { resolveAIComboMeleeStrikeForCombatant } from './aiComboStrikeRuntime';
import { type CombatantWeapon } from './combatantActions';
import { type TacticalTargetCandidate } from './combatGeometry';
import {
  type PlayerModelObserver,
  type PlayerModelSnapshot,
} from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';
import { tryStartAISwordLungeForCombatant } from './aiSwordLungeStartRuntime';
import { type AITacticalWeaponApplyResult } from './aiGroundAttackOpportunityRuntime';

export interface AIComboOrchestrationFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export type AIComboOrchestrationMode = 'continue' | 'sync_return';

export interface AIComboOrchestrationResult {
  mode: AIComboOrchestrationMode;
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
  comboActive: boolean;
}

export function resolveAIComboOrchestrationForCombatant({
  state,
  self,
  aiContext,
  botId,
  target,
  frame,
  activeWeapon,
  canStartWeaponAction,
  tacticalWeapon,
  swapFeintActive,
  targetProtected,
  targetAirborne,
  hasVerticalLungeLine,
  targetIsLunging,
  dt,
  difficulty,
  weaponSwapIQ,
  weaponPrioritization,
  attackDistanceToTarget,
  combatDistanceToTarget,
  distanceToTarget,
  minLungeRange,
  maxLungeRange,
  resolvedAiReach,
  stationarySwingReach,
  swapLockoutRemaining,
  cooldownMultiplier,
  getTargetPlayerModel,
  applyTacticalWeapon,
  triggerCombatantLunge,
  triggerCombatantAttack,
  recordCombatantObservation,
}: {
  state: GrifballRuntimeState;
  self: Combatant;
  aiContext: AIMatchContext;
  botId: string;
  target: TacticalTargetCandidate;
  frame: AIComboOrchestrationFrame;
  activeWeapon: Combatant['activeWeapon'];
  canStartWeaponAction: boolean;
  tacticalWeapon?: CombatantWeapon | null;
  swapFeintActive: boolean;
  targetProtected: boolean;
  targetAirborne: boolean;
  hasVerticalLungeLine: boolean;
  targetIsLunging: boolean;
  dt: number;
  difficulty: string;
  weaponSwapIQ: number;
  weaponPrioritization: number;
  attackDistanceToTarget: number;
  combatDistanceToTarget: number;
  distanceToTarget: number;
  minLungeRange: number;
  maxLungeRange: number;
  resolvedAiReach: number;
  stationarySwingReach: number;
  swapLockoutRemaining: number;
  cooldownMultiplier: number;
  getTargetPlayerModel: (targetId: string) => PlayerModelSnapshot | null;
  applyTacticalWeapon: (tacticalWeapon: CombatantWeapon) => AITacticalWeaponApplyResult;
  triggerCombatantLunge: (
    self: Combatant,
    lungeDir: THREE.Vector3,
    pos: THREE.Vector3,
    vel: THREE.Vector3
  ) => void;
  triggerCombatantAttack: (self: Combatant, weapon: CombatantWeapon, melee?: boolean) => void;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
}): AIComboOrchestrationResult {
  let currentActiveWeapon = activeWeapon;
  let currentCanStartWeaponAction = canStartWeaponAction;
  let currentAIState = frame.aiState;
  let currentTimer = frame.timer;
  let currentWeaponState = frame.weaponState;

  const result = (mode: AIComboOrchestrationMode, comboActive: boolean): AIComboOrchestrationResult => ({
    mode,
    activeWeapon: currentActiveWeapon,
    canStartWeaponAction: currentCanStartWeaponAction,
    aiState: currentAIState,
    timer: currentTimer,
    weaponState: currentWeaponState,
    comboActive,
  });

  const applyWeaponChoice = (weapon: CombatantWeapon) => {
    const applied = applyTacticalWeapon(weapon);
    currentActiveWeapon = applied.activeWeapon;
    currentCanStartWeaponAction = applied.canStartWeaponAction;
    currentWeaponState = applied.weaponState;
  };

  if (
    tacticalWeapon &&
    !swapFeintActive &&
    !comboBlocksTacticalSwap(getBotComboState(aiContext, botId))
  ) {
    applyWeaponChoice(tacticalWeapon);
  }

  let comboState = getBotComboState(aiContext, botId);
  const targetCommitted =
    target.weaponState === 'swing_up' ||
    target.weaponState === 'swing_down' ||
    targetIsLunging;

  if (comboState) {
    if (shouldAbortCombo({
      targetId: target.id,
      targetHp: target.hp,
      targetInvuln: target.invulnerabilityTimer,
      targetIsLunging,
      targetWeaponState: target.weaponState,
      lockedTargetId: comboState.targetId,
      abortOnTargetCommit: comboState.comboId === 'bait_smash',
      targetCommitted,
    })) {
      clearBotComboState(aiContext, botId);
      comboState = undefined;
    }
  }

  if (
    !comboState &&
    currentCanStartWeaponAction &&
    currentWeaponState === 'ready' &&
    !swapFeintActive &&
    !targetProtected &&
    difficulty !== 'easy'
  ) {
    const openingCombo = pickOpeningCombo({
      difficulty,
      weaponSwapIQ,
      weaponPrioritization,
      distanceToTarget: attackDistanceToTarget,
      minLungeRange,
      maxLungeRange,
      targetRecovering: target.weaponState === 'recovering',
    });
    if (openingCombo) {
      setBotComboState(aiContext, botId, createBotComboState(openingCombo, target.id));
      comboState = getBotComboState(aiContext, botId);
      currentAIState = 'CHARGE_ATTACK';
      currentTimer = Math.max(currentTimer as number, 0.25);
    }
  }

  const commitComboAttackAdvance = () => {
    if (!comboState) return;
    const next = notifyComboAttackStarted(comboState);
    setBotComboState(aiContext, botId, next);
    comboState = next ?? undefined;
  };

  const executeComboStrike = (preferLunge: boolean): 'lunge' | 'melee' | false => {
    if (
      !comboState ||
      !currentCanStartWeaponAction ||
      currentWeaponState !== 'ready' ||
      targetProtected ||
      target.hp <= 0
    ) {
      return false;
    }

    const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;

    if (
      preferLunge &&
      currentActiveWeapon === 'sword' &&
      hasVerticalLungeLine &&
      lungeDistanceToTarget >= minLungeRange &&
      lungeDistanceToTarget <= maxLungeRange
    ) {
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
      })) return false;
      commitComboAttackAdvance();
      return 'lunge';
    }

    if (attackDistanceToTarget <= stationarySwingReach) {
      currentAIState = 'COOLDOWN';
      const meleeStrikeFrame = resolveAIComboMeleeStrikeForCombatant({
        state,
        self,
        activeWeapon: currentActiveWeapon as CombatantWeapon,
        attackDistanceToTarget,
        targetModelType: target.modelType,
        cooldownMultiplier,
        triggerCombatantAttack,
      });
      currentTimer = meleeStrikeFrame.timer;
      currentWeaponState = meleeStrikeFrame.weaponState;
      commitComboAttackAdvance();
      return 'melee';
    }

    return false;
  };

  if (comboState) {
    const comboResult = progressComboState({
      state: comboState,
      activeWeapon: currentActiveWeapon as CombatantWeapon,
      weaponReady: currentWeaponState === 'ready',
      swapLockoutRemaining,
      swapFeintActive,
      distanceToTarget: attackDistanceToTarget,
      minLungeRange,
      maxLungeRange,
      inMeleeRange: attackDistanceToTarget <= resolvedAiReach + 0.5,
      dt,
    });
    setBotComboState(aiContext, botId, comboResult.state);
    comboState = comboResult.state ?? undefined;

    if (comboResult.command.kind === 'swap' && comboResult.command.weapon) {
      applyWeaponChoice(comboResult.command.weapon);
    } else if (comboResult.command.kind === 'attack') {
      const strikeResult = executeComboStrike(!!comboResult.command.preferLunge);
      if (strikeResult === 'lunge') {
        return result('sync_return', !!comboState);
      }
      if (!strikeResult) {
        if (currentAIState !== 'PRESSURING' && currentAIState !== 'CHARGE_ATTACK' && currentAIState !== 'LUNGING') {
          currentAIState = 'CHARGE_ATTACK';
          currentTimer = Math.max(currentTimer as number, 0.2);
        }
      }
    } else if (comboResult.command.kind === 'complete') {
      clearBotComboState(aiContext, botId);
      comboState = undefined;
    }
  }

  return result('continue', !!comboState);
}
