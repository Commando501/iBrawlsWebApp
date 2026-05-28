export type BotCoordRole = 'pressure' | 'flanker' | 'punisher';

/** Seconds before shared focus on a tagged target expires. */
export const PRIORITY_TARGET_TTL = 8;
/** Seconds a per-bot damage tag remains visible to allies. */
export const DAMAGE_TAG_TTL = 6;
/** Delay between coordinated attack phases (seconds). */
export const ATTACK_STAGGER_STEP = 0.38;

export interface BotCoordinatorState {
  priorityTargetId?: string;
  taggerBotId?: string;
  priorityAge: number;
  /** targetId -> botId -> seconds remaining */
  recentTags: Map<string, Map<string, number>>;
  /** Cleared each AI tick; bots re-register current focus. */
  engagements: Map<string, string>;
}

export function createBotCoordinator(): BotCoordinatorState {
  return {
    priorityAge: 0,
    recentTags: new Map(),
    engagements: new Map(),
  };
}

export function resetBotCoordinator(state: BotCoordinatorState): void {
  state.priorityTargetId = undefined;
  state.taggerBotId = undefined;
  state.priorityAge = 0;
  state.recentTags.clear();
  state.engagements.clear();
}

export function isCoordinationEnabled(difficulty: string): boolean {
  return difficulty !== 'easy';
}

export function tickBotCoordinator(state: BotCoordinatorState, dt: number): void {
  if (state.priorityTargetId) {
    state.priorityAge += dt;
    if (state.priorityAge >= PRIORITY_TARGET_TTL) {
      state.priorityTargetId = undefined;
      state.taggerBotId = undefined;
      state.priorityAge = 0;
    }
  }

  for (const [targetId, taggers] of state.recentTags) {
    for (const [botId, remaining] of taggers) {
      const next = remaining - dt;
      if (next <= 0) {
        taggers.delete(botId);
      } else {
        taggers.set(botId, next);
      }
    }
    if (taggers.size === 0) {
      state.recentTags.delete(targetId);
    }
  }
}

export function clearBotEngagements(state: BotCoordinatorState): void {
  state.engagements.clear();
}

export function registerBotEngagement(
  state: BotCoordinatorState,
  botId: string,
  targetId: string
): void {
  state.engagements.set(botId, targetId);
}

export function notifyBotDamageTag(
  state: BotCoordinatorState,
  botId: string,
  targetId: string
): void {
  if (!state.priorityTargetId) {
    state.priorityTargetId = targetId;
    state.taggerBotId = botId;
    state.priorityAge = 0;
  }

  let taggers = state.recentTags.get(targetId);
  if (!taggers) {
    taggers = new Map();
    state.recentTags.set(targetId, taggers);
  }
  taggers.set(botId, DAMAGE_TAG_TTL);
}

export function getEngagingBotIds(state: BotCoordinatorState, targetId: string): string[] {
  const ids: string[] = [];
  for (const [botId, focusTargetId] of state.engagements) {
    if (focusTargetId === targetId) {
      ids.push(botId);
    }
  }
  return ids.sort();
}

export interface CoordinatedTargetBonusInput {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
}

/** Score bonus applied in tactical target selection for focus fire. */
export function getCoordinatedTargetBonus(input: CoordinatedTargetBonusInput): number {
  if (!isCoordinationEnabled(input.difficulty)) {
    return 0;
  }

  const { coordinator, botId, targetId } = input;
  let bonus = 0;

  if (coordinator.priorityTargetId === targetId) {
    bonus += 420;
    if (coordinator.taggerBotId && coordinator.taggerBotId !== botId) {
      bonus += 80;
    }
  }

  const taggers = coordinator.recentTags.get(targetId);
  if (taggers && taggers.size > 0) {
    const allyTagged = [...taggers.keys()].some((id) => id !== botId);
    if (allyTagged) {
      bonus += 160;
    }
  }

  return bonus;
}

export interface BotCoordRoleInput {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
}

export function getBotCoordRole(input: BotCoordRoleInput): BotCoordRole {
  if (!isCoordinationEnabled(input.difficulty)) {
    return 'pressure';
  }

  const engaging = getEngagingBotIds(input.coordinator, input.targetId);
  if (engaging.length < 2) {
    return 'pressure';
  }

  const index = engaging.indexOf(input.botId);
  if (index < 0) {
    return 'flanker';
  }

  if (engaging.length >= 3) {
    if (index === 0) return 'pressure';
    if (index === engaging.length - 1) return 'punisher';
    return 'flanker';
  }

  return index === 0 ? 'pressure' : 'flanker';
}

export interface PincerApproachInput {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
}

/** Lateral approach offset multiplier when multiple bots converge on one target. */
export function getPincerApproachOffset(input: PincerApproachInput): number {
  if (!isCoordinationEnabled(input.difficulty)) {
    return 0;
  }

  const engaging = getEngagingBotIds(input.coordinator, input.targetId);
  if (engaging.length < 2) {
    return 0;
  }

  const role = getBotCoordRole(input);
  const index = engaging.indexOf(input.botId);
  if (index < 0) {
    return 0;
  }

  const side = index % 2 === 0 ? 1 : -1;

  switch (role) {
    case 'pressure':
      return 0;
    case 'flanker':
      return side * (1.0 + Math.floor(index / 2) * 0.35);
    case 'punisher':
      return side * 0.55;
    default:
      return 0;
  }
}

export interface AttackStaggerInput {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
  /** Elapsed seconds since this bot entered melee commit range with weapon ready. */
  commitTimer: number;
  /** True when an ally with an earlier phase is mid swing or lunge. */
  allyAttacking: boolean;
}

export function getAttackPhaseIndex(input: BotCoordRoleInput): number {
  const role = getBotCoordRole(input);
  switch (role) {
    case 'pressure':
      return 0;
    case 'flanker':
      return 1;
    case 'punisher':
      return 2;
    default:
      return 0;
  }
}

export function getAttackPhaseDelay(input: BotCoordRoleInput): number {
  if (!isCoordinationEnabled(input.difficulty)) {
    return 0;
  }

  const engaging = getEngagingBotIds(input.coordinator, input.targetId);
  if (engaging.length < 2) {
    return 0;
  }

  return getAttackPhaseIndex(input) * ATTACK_STAGGER_STEP;
}

/** Returns true when this bot should wait for allies' attack phase. */
export function shouldDeferCoordinatedAttack(input: AttackStaggerInput): boolean {
  if (!isCoordinationEnabled(input.difficulty)) {
    return false;
  }

  const engaging = getEngagingBotIds(input.coordinator, input.targetId);
  if (engaging.length < 2) {
    return false;
  }

  const requiredDelay = getAttackPhaseDelay(input);
  if (input.commitTimer < requiredDelay) {
    return true;
  }

  if (!input.allyAttacking) {
    return false;
  }

  const myPhase = getAttackPhaseIndex(input);
  return myPhase > 0;
}

export interface PunisherCommitInput {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
  targetWeaponState: string;
  targetRecovering: boolean;
}

/** Punisher role waits for openings unless alone on target. */
export function shouldPunisherHold(input: PunisherCommitInput): boolean {
  if (!isCoordinationEnabled(input.difficulty)) {
    return false;
  }

  const role = getBotCoordRole(input);
  if (role !== 'punisher') {
    return false;
  }

  const engaging = getEngagingBotIds(input.coordinator, input.targetId);
  if (engaging.length < 3) {
    return false;
  }

  return !input.targetRecovering &&
    input.targetWeaponState !== 'recovering' &&
    input.targetWeaponState !== 'swing_up' &&
    input.targetWeaponState !== 'swing_down';
}
