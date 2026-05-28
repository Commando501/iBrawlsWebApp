import type { AICombatWeapon } from './aiCombatDecision';

export type AIComboId = 'mixup' | 'safe_finish' | 'bait_smash' | 'double_tap';

export type AIComboStepKind =
  | 'hold'
  | 'swap_hammer'
  | 'swap_sword'
  | 'wait_swap_lockout'
  | 'attack';

export interface AIComboStep {
  kind: AIComboStepKind;
  /** Seconds to hold before advancing (hold steps only). */
  duration?: number;
  /** Prefer sword lunge over slash when in band (attack steps). */
  preferLunge?: boolean;
}

export interface AIComboDefinition {
  id: AIComboId;
  steps: AIComboStep[];
  minWeaponSwapIQ: number;
  /** Opening weapon required to start from a landed hit, if any. */
  openingWeapon?: AICombatWeapon;
}

export interface BotComboState {
  comboId: AIComboId;
  targetId: string;
  stepIndex: number;
  stepTimer: number;
}

export type ComboCommandKind = 'none' | 'swap' | 'attack' | 'wait' | 'complete' | 'abort';

export interface ComboStepCommand {
  kind: ComboCommandKind;
  weapon?: AICombatWeapon;
  preferLunge?: boolean;
}

export interface ComboPickInput {
  difficulty: string;
  weaponSwapIQ: number;
  weaponPrioritization: number;
  openingWeapon: AICombatWeapon;
  distanceToTarget: number;
  minLungeRange: number;
  maxLungeRange: number;
  targetRecovering: boolean;
  random?: () => number;
}

export interface ComboAbortInput {
  targetId: string;
  targetHp: number;
  targetInvuln: number;
  targetIsLunging: boolean;
  targetWeaponState: string;
  lockedTargetId: string;
  /** Snapshot when combo started — abort if target weapon state diverges during bait windows. */
  abortOnTargetCommit?: boolean;
  targetCommitted: boolean;
}

export interface ComboTickInput {
  state: BotComboState;
  activeWeapon: AICombatWeapon;
  weaponReady: boolean;
  swapLockoutRemaining: number;
  swapFeintActive: boolean;
  distanceToTarget: number;
  minLungeRange: number;
  maxLungeRange: number;
  inMeleeRange: boolean;
  dt: number;
}

export const COMBO_MIN_WEAPON_SWAP_IQ = 70;
export const COMBO_ADVANCED_WEAPON_SWAP_IQ = 90;

export const AI_COMBO_DEFINITIONS: Record<AIComboId, AIComboDefinition> = {
  mixup: {
    id: 'mixup',
    minWeaponSwapIQ: COMBO_MIN_WEAPON_SWAP_IQ,
    openingWeapon: 'hammer',
    steps: [
      { kind: 'swap_sword' },
      { kind: 'wait_swap_lockout' },
      { kind: 'attack', preferLunge: true },
    ],
  },
  safe_finish: {
    id: 'safe_finish',
    minWeaponSwapIQ: COMBO_MIN_WEAPON_SWAP_IQ,
    openingWeapon: 'hammer',
    steps: [
      { kind: 'hold', duration: 0.12 },
      { kind: 'attack' },
    ],
  },
  bait_smash: {
    id: 'bait_smash',
    minWeaponSwapIQ: COMBO_ADVANCED_WEAPON_SWAP_IQ,
    steps: [
      { kind: 'swap_sword' },
      { kind: 'hold', duration: 0.32 },
      { kind: 'swap_hammer' },
      { kind: 'wait_swap_lockout' },
      { kind: 'attack' },
    ],
  },
  double_tap: {
    id: 'double_tap',
    minWeaponSwapIQ: COMBO_MIN_WEAPON_SWAP_IQ,
    openingWeapon: 'sword',
    steps: [
      { kind: 'swap_hammer' },
      { kind: 'wait_swap_lockout' },
      { kind: 'attack' },
    ],
  },
};

export function canUseWeaponCombos(difficulty: string, weaponSwapIQ: number): boolean {
  return difficulty !== 'easy' && weaponSwapIQ >= COMBO_MIN_WEAPON_SWAP_IQ;
}

export function isComboWeaponAllowed(
  weapon: AICombatWeapon,
  weaponPrioritization: number
): boolean {
  const pSword = weaponPrioritization / 100;
  if (weapon === 'sword' && pSword <= 0) {
    return false;
  }
  if (weapon === 'hammer' && pSword >= 1) {
    return false;
  }
  return true;
}

export function isComboCompatible(
  comboId: AIComboId,
  weaponPrioritization: number
): boolean {
  const def = AI_COMBO_DEFINITIONS[comboId];
  for (const step of def.steps) {
    if (step.kind === 'swap_sword' && !isComboWeaponAllowed('sword', weaponPrioritization)) {
      return false;
    }
    if (step.kind === 'swap_hammer' && !isComboWeaponAllowed('hammer', weaponPrioritization)) {
      return false;
    }
    if (step.kind === 'attack' && step.preferLunge && !isComboWeaponAllowed('sword', weaponPrioritization)) {
      return false;
    }
  }
  return true;
}

function comboUsesWeapon(comboId: AIComboId, weapon: AICombatWeapon): boolean {
  const def = AI_COMBO_DEFINITIONS[comboId];
  return def.steps.some((step) => {
    if (step.kind === 'swap_sword') return weapon === 'sword';
    if (step.kind === 'swap_hammer') return weapon === 'hammer';
    if (step.kind === 'attack' && step.preferLunge) return weapon === 'sword';
    return false;
  }) || def.openingWeapon === weapon;
}

export function pickComboOnHit(input: ComboPickInput): AIComboId | null {
  if (!canUseWeaponCombos(input.difficulty, input.weaponSwapIQ)) {
    return null;
  }

  const random = input.random ?? Math.random;
  const candidates: AIComboId[] = [];

  if (input.openingWeapon === 'hammer') {
    if (input.weaponSwapIQ >= COMBO_MIN_WEAPON_SWAP_IQ) {
      candidates.push('mixup', 'safe_finish');
    }
    if (
      input.weaponSwapIQ >= COMBO_ADVANCED_WEAPON_SWAP_IQ &&
      input.distanceToTarget >= input.minLungeRange * 0.75 &&
      input.distanceToTarget <= input.maxLungeRange + 2
    ) {
      candidates.push('bait_smash');
    }
  } else if (input.openingWeapon === 'sword') {
    if (input.weaponSwapIQ >= COMBO_MIN_WEAPON_SWAP_IQ && input.targetRecovering) {
      candidates.push('double_tap');
    }
  }

  const eligible = candidates.filter(
    (id) =>
      input.weaponSwapIQ >= AI_COMBO_DEFINITIONS[id].minWeaponSwapIQ &&
      isComboCompatible(id, input.weaponPrioritization) &&
      (!AI_COMBO_DEFINITIONS[id].openingWeapon ||
        AI_COMBO_DEFINITIONS[id].openingWeapon === input.openingWeapon)
  );

  if (eligible.length === 0) {
    return null;
  }

  // Weight toward mixups at high IQ; safe finish when prioritization is hammer-heavy.
  const weights = eligible.map((id) => {
    if (id === 'safe_finish') {
      return input.weaponPrioritization <= 35 ? 1.4 : 0.85;
    }
    if (id === 'mixup') {
      return 1.0 + (input.weaponSwapIQ - COMBO_MIN_WEAPON_SWAP_IQ) / 100;
    }
    if (id === 'bait_smash') {
      return input.weaponSwapIQ >= COMBO_ADVANCED_WEAPON_SWAP_IQ ? 1.15 : 0;
    }
    if (id === 'double_tap') {
      return input.weaponPrioritization >= 45 ? 1.1 : 0.9;
    }
    return 1;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return null;
  }

  let roll = random() * total;
  for (let i = 0; i < eligible.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return eligible[i];
    }
  }

  return eligible[eligible.length - 1];
}

export function pickOpeningCombo(input: Omit<ComboPickInput, 'openingWeapon'>): AIComboId | null {
  if (!canUseWeaponCombos(input.difficulty, input.weaponSwapIQ)) {
    return null;
  }
  if (input.weaponSwapIQ < COMBO_ADVANCED_WEAPON_SWAP_IQ) {
    return null;
  }
  if (!isComboCompatible('bait_smash', input.weaponPrioritization)) {
    return null;
  }
  if (
    input.distanceToTarget < input.minLungeRange * 0.9 ||
    input.distanceToTarget > input.maxLungeRange + 1.5
  ) {
    return null;
  }

  const random = input.random ?? Math.random;
  if (random() > 0.22 + (input.weaponSwapIQ - COMBO_ADVANCED_WEAPON_SWAP_IQ) / 200) {
    return null;
  }

  return 'bait_smash';
}

export function createBotComboState(comboId: AIComboId, targetId: string): BotComboState {
  return {
    comboId,
    targetId,
    stepIndex: 0,
    stepTimer: 0,
  };
}

export function getComboDefinition(state: BotComboState): AIComboDefinition {
  return AI_COMBO_DEFINITIONS[state.comboId];
}

export function getCurrentComboStep(state: BotComboState): AIComboStep | null {
  const def = getComboDefinition(state);
  return def.steps[state.stepIndex] ?? null;
}

export function isComboActive(state: BotComboState | null | undefined): state is BotComboState {
  return !!state && state.stepIndex < AI_COMBO_DEFINITIONS[state.comboId].steps.length;
}

export function shouldAbortCombo(input: ComboAbortInput): boolean {
  if (input.targetId !== input.lockedTargetId) {
    return true;
  }
  if (input.targetHp <= 0) {
    return true;
  }
  if (input.targetInvuln > 0) {
    return true;
  }
  if (input.abortOnTargetCommit && input.targetCommitted) {
    return true;
  }
  return false;
}

export function advanceComboStep(state: BotComboState): BotComboState | null {
  const def = getComboDefinition(state);
  const nextIndex = state.stepIndex + 1;
  if (nextIndex >= def.steps.length) {
    return null;
  }
  return {
    ...state,
    stepIndex: nextIndex,
    stepTimer: 0,
  };
}

export function tickComboHold(state: BotComboState, dt: number): BotComboState {
  return {
    ...state,
    stepTimer: Math.max(0, state.stepTimer - dt),
  };
}

function stepSatisfied(step: AIComboStep, input: ComboTickInput): boolean {
  switch (step.kind) {
    case 'hold':
      return (step.duration ?? 0) <= 0 || input.state.stepTimer <= 0;
    case 'swap_hammer':
      return input.activeWeapon === 'hammer' && input.swapLockoutRemaining <= 0 && !input.swapFeintActive;
    case 'swap_sword':
      return input.activeWeapon === 'sword' && input.swapLockoutRemaining <= 0 && !input.swapFeintActive;
    case 'wait_swap_lockout':
      return input.swapLockoutRemaining <= 0;
    case 'attack':
      return false;
    default:
      return false;
  }
}

export function evaluateComboStep(input: ComboTickInput): ComboStepCommand {
  const step = getCurrentComboStep(input.state);
  if (!step) {
    return { kind: 'complete' };
  }

  if (step.kind === 'hold') {
    if (input.state.stepTimer <= 0 && (step.duration ?? 0) > 0) {
      return { kind: 'wait' };
    }
    if (input.state.stepTimer > 0) {
      return { kind: 'wait' };
    }
    return { kind: 'none' };
  }

  if (step.kind === 'swap_hammer') {
    if (input.activeWeapon === 'hammer' && input.swapLockoutRemaining <= 0) {
      return { kind: 'none' };
    }
    if (input.swapLockoutRemaining > 0 || input.swapFeintActive) {
      return { kind: 'wait' };
    }
    return { kind: 'swap', weapon: 'hammer' };
  }

  if (step.kind === 'swap_sword') {
    if (input.activeWeapon === 'sword' && input.swapLockoutRemaining <= 0) {
      return { kind: 'none' };
    }
    if (input.swapLockoutRemaining > 0 || input.swapFeintActive) {
      return { kind: 'wait' };
    }
    return { kind: 'swap', weapon: 'sword' };
  }

  if (step.kind === 'wait_swap_lockout') {
    if (input.swapLockoutRemaining <= 0) {
      return { kind: 'none' };
    }
    return { kind: 'wait' };
  }

  if (step.kind === 'attack') {
    if (!input.weaponReady) {
      return { kind: 'wait' };
    }
    const inLungeBand =
      input.distanceToTarget >= input.minLungeRange &&
      input.distanceToTarget <= input.maxLungeRange;
    const preferLunge = !!step.preferLunge && inLungeBand && input.activeWeapon === 'sword';
    if (preferLunge || input.inMeleeRange) {
      return { kind: 'attack', weapon: input.activeWeapon, preferLunge };
    }
    return { kind: 'wait' };
  }

  return { kind: 'none' };
}

/** Returns updated state after auto-advancing completed non-attack steps. */
export function progressComboState(input: ComboTickInput): {
  state: BotComboState | null;
  command: ComboStepCommand;
} {
  let state: BotComboState | null = { ...input.state };
  let command = evaluateComboStep({ ...input, state });

  for (let guard = 0; guard < 8 && state; guard++) {
    const step = getCurrentComboStep(state);
    if (!step) {
      return { state: null, command: { kind: 'complete' } };
    }

    if (step.kind === 'hold') {
      const duration = step.duration ?? 0;
      if (duration <= 0) {
        state = advanceComboStep(state);
        continue;
      }
      if (state.stepTimer <= 0) {
        state = { ...state, stepTimer: duration };
        return { state, command: { kind: 'wait' } };
      }
      state = tickComboHold(state, input.dt);
      if (state.stepTimer <= 0) {
        state = advanceComboStep(state);
        continue;
      }
      return { state, command: { kind: 'wait' } };
    }

    if (step.kind === 'attack') {
      command = evaluateComboStep({ ...input, state });
      return { state, command };
    }

    if (stepSatisfied(step, { ...input, state })) {
      state = advanceComboStep(state);
      continue;
    }

    command = evaluateComboStep({ ...input, state });
    return { state, command };
  }

  return { state, command };
}

export function notifyComboAttackStarted(state: BotComboState): BotComboState | null {
  const step = getCurrentComboStep(state);
  if (!step || step.kind !== 'attack') {
    return state;
  }
  return advanceComboStep(state);
}

export function comboRequiresWeapon(state: BotComboState): AICombatWeapon | null {
  const step = getCurrentComboStep(state);
  if (!step) {
    return null;
  }
  if (step.kind === 'swap_hammer') return 'hammer';
  if (step.kind === 'swap_sword') return 'sword';
  if (step.kind === 'attack' && step.preferLunge) return 'sword';
  return null;
}

export function comboBlocksTacticalSwap(state: BotComboState | null | undefined): boolean {
  return isComboActive(state);
}

export function comboUsesSword(comboId: AIComboId): boolean {
  return comboUsesWeapon(comboId, 'sword');
}
