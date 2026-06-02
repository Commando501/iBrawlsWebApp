import { type Combatant } from '../../types';

export const tickCombatantInvulnerability = (
  combatant: Combatant,
  dt: number
): void => {
  if ((combatant.invulnerabilityTimer ?? 0) > 0) {
    combatant.invulnerabilityTimer = Math.max(0, combatant.invulnerabilityTimer - dt);
  }
};

export const initializeCombatantAITickDefaults = (
  combatant: Combatant,
  random: () => number = Math.random
): void => {
  if (!combatant.aiState) combatant.aiState = 'APPROACHING';
  if (combatant.aiTimer === undefined) combatant.aiTimer = 0;
  if (combatant.aiSwayTimer === undefined) combatant.aiSwayTimer = random() * Math.PI;
  if (combatant.aiDashCooldownTimer === undefined) combatant.aiDashCooldownTimer = 0;
  if (combatant.aiDashRemaining === undefined) combatant.aiDashRemaining = 0;
  if (combatant.aiDashDir === undefined) combatant.aiDashDir = { x: 0, y: 0, z: 0 };
  if (combatant.aiSlideActive === undefined) combatant.aiSlideActive = false;
  if (combatant.aiSlideDistanceTraveled === undefined) combatant.aiSlideDistanceTraveled = 0;
  if (combatant.aiSlideCooldownTimer === undefined) combatant.aiSlideCooldownTimer = 0;
  if (combatant.aiHammerJumpCooldownTimer === undefined) combatant.aiHammerJumpCooldownTimer = 0;
  if (combatant.aiPostLungeDecisionTimer === undefined) combatant.aiPostLungeDecisionTimer = 0;
  if (combatant.aiPendingPostEvasionCharge === undefined) combatant.aiPendingPostEvasionCharge = false;
};
