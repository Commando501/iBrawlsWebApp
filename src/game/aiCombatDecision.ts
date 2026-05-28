export type AICombatWeapon = 'hammer' | 'sword';

export type AILungeOutcome = 'hit' | 'miss_timeout' | 'miss_arena' | 'target_dead';

export interface AILungeMemory {
  outcome: AILungeOutcome;
  targetId?: string;
  timeRemaining: number;
}

export interface AITacticalTarget {
  id: string;
  hp: number;
  activeWeapon: AICombatWeapon;
  weaponState: string;
  isLunging: boolean;
  invulnerabilityTimer?: number;
}

export interface AICombatDecisionInput {
  difficulty: string;
  weaponSwapIQ: number;
  currentWeapon: AICombatWeapon;
  botHP: number;
  botMaxHP: number;
  distanceToTarget: number;
  combatDistanceToTarget?: number;
  nearbyEnemiesCount: number;
  target: AITacticalTarget;
  attackRange: number;
  attackRadius: number;
  swordLungeDistance: number;
  swordLungeSpeed: number;
  swordTradeWindowMs: number;
  canStartWeaponAction: boolean;
  canUseHammerCounter?: boolean;
  weaponState: string;
  recentLungeMemory?: AILungeMemory | null;
  weaponPrioritization: number;
  random?: () => number;
}

export interface AICombatDecision {
  weapon: AICombatWeapon | null;
  bulltrueCounter: AICombatWeapon | null;
  postMissSpacing: boolean;
  bypassedRandomGate: boolean;
}

const MECHANIC_AWARE_IQ = 70;
const HIGH_IQ_OVERRIDE = 80;
const HAMMER_WINDUP_SECONDS = 0.32;

export function isMechanicAwareDifficulty(difficulty: string, weaponSwapIQ: number): boolean {
  return difficulty === 'hard' ||
    difficulty === 'nightmare' ||
    (difficulty === 'custom' && weaponSwapIQ >= MECHANIC_AWARE_IQ) ||
    weaponSwapIQ >= HIGH_IQ_OVERRIDE;
}

export function isMissedLungeMemory(memory?: AILungeMemory | null): boolean {
  return !!memory &&
    memory.timeRemaining > 0 &&
    (memory.outcome === 'miss_timeout' || memory.outcome === 'miss_arena');
}

export function evaluateAICombatDecision(input: AICombatDecisionInput): AICombatDecision {
  const random = input.random ?? Math.random;
  const pSword = input.weaponPrioritization / 100;
  const targetIsProtected = (input.target.invulnerabilityTimer ?? 0) > 0;
  const minDistance = Math.min(input.distanceToTarget, input.combatDistanceToTarget ?? input.distanceToTarget);
  const playerDangerZone = input.attackRange + input.attackRadius * 0.85;
  const minLunge = playerDangerZone * 0.85;
  const maxLunge = Math.min(18.0, input.swordLungeDistance);
  const mechanicAware = isMechanicAwareDifficulty(input.difficulty, input.weaponSwapIQ);
  const decision: AICombatDecision = {
    weapon: null,
    bulltrueCounter: null,
    postMissSpacing: false,
    bypassedRandomGate: false,
  };

  if (input.difficulty === 'easy') {
    return decision;
  }

  if (mechanicAware && input.target.isLunging && minDistance < 15.0 && !targetIsProtected) {
    const timeToImpact = minDistance / Math.max(1, input.swordLungeSpeed);
    const hammerCounterDistance = input.swordLungeSpeed * HAMMER_WINDUP_SECONDS + input.attackRadius * 0.85;
    const hammerCanCounter = input.canUseHammerCounter !== false &&
      input.canStartWeaponAction &&
      input.weaponState === 'ready' &&
      minDistance <= hammerCounterDistance + 0.75;

    if (hammerCanCounter) {
      decision.weapon = 'hammer';
      decision.bulltrueCounter = 'hammer';
      decision.bypassedRandomGate = true;
      return decision;
    }

    const swordTradeWindow = Math.max(0.08, input.swordTradeWindowMs / 1000);
    const swordCanCounter = input.canStartWeaponAction &&
      input.weaponState === 'ready' &&
      input.currentWeapon === 'sword' &&
      timeToImpact <= swordTradeWindow + 0.12;

    if (swordCanCounter) {
      decision.weapon = 'sword';
      decision.bulltrueCounter = 'sword';
      decision.bypassedRandomGate = true;
      return decision;
    }

    decision.weapon = 'hammer';
    decision.postMissSpacing = true;
    decision.bypassedRandomGate = true;
    return decision;
  }

  if (mechanicAware && isMissedLungeMemory(input.recentLungeMemory)) {
    const sameTarget = !input.recentLungeMemory?.targetId || input.recentLungeMemory.targetId === input.target.id;
    if (sameTarget) {
      const targetCanPunish = input.target.activeWeapon === 'hammer' ||
        input.target.isLunging ||
        input.target.weaponState === 'swing_up' ||
        input.target.weaponState === 'swing_down' ||
        input.distanceToTarget <= maxLunge + 1.5;

      if (input.target.hp <= 1 || input.distanceToTarget <= playerDangerZone + 1.2 || targetCanPunish) {
        decision.weapon = 'hammer';
        decision.postMissSpacing = input.distanceToTarget > playerDangerZone * 0.8 || targetCanPunish;
        decision.bypassedRandomGate = true;
        return decision;
      }
    }
  }

  if (random() * 100 > input.weaponSwapIQ + 10) {
    return decision;
  }

  if (targetIsProtected) {
    decision.weapon = 'hammer';
    return decision;
  }

  if (input.nearbyEnemiesCount >= 2) {
    decision.weapon = 'hammer';
    return decision;
  }

  if (input.target.hp <= 1 && input.distanceToTarget <= maxLunge && input.target.hp > 0) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.target.isLunging) {
    decision.weapon = 'hammer';
    return decision;
  }

  if (input.target.weaponState === 'recovering' && input.distanceToTarget >= minLunge && input.distanceToTarget <= maxLunge) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.distanceToTarget >= minLunge && input.distanceToTarget <= maxLunge) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  if (input.distanceToTarget < playerDangerZone * 0.7 && input.botHP >= input.botMaxHP * 0.35 && input.nearbyEnemiesCount < 2) {
    decision.weapon = random() < pSword ? 'sword' : 'hammer';
    return decision;
  }

  return decision;
}
