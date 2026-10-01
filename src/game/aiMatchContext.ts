import { isAIWeaponStrikeCommitted } from './aiTacticalWeaponSwap';
import type { BotComboState } from './aiComboEngine';
import { createGrifballTeamPlanState, resetGrifballTeamPlan, type GrifballTeamPlanState } from './aiGrifballTeamPlan';
import type { BotCoordinatorState } from './aiBotCoordinator';
import { createBotCoordinator, resetBotCoordinator } from './aiBotCoordinator';
import type { BotPsychState } from './aiPsychologicalPressure';
import { createBotPsychState, tickBotPsychState as tickPsychState } from './aiPsychologicalPressure';
import type { PlayerModel } from './aiPlayerModel';
import type { BotCalibrationState } from './aiSkillCalibration';

export interface AIMatchContext {
  grifballTeamPlan: GrifballTeamPlanState;
  /** Per-player adaptive models keyed by combatant id (e.g. `player`). */
  playerModels: Map<string, PlayerModel>;
  /** Per-bot feint cooldown timers in seconds. */
  feintCooldowns: Map<string, number>;
  /** Per-bot weapon-swap feint revert timers in seconds. */
  weaponSwapFeintTimers: Map<string, number>;
  /** Per-bot mid-combat weapon combo execution state. */
  comboState: Map<string, BotComboState>;
  /** Per-bot psychological pressure modifiers (tempo, standoff, post-kill). */
  psychState: Map<string, BotPsychState>;
  /** Per-bot rolling skill calibration snapshots. */
  skillCalibration: Map<string, BotCalibrationState>;
  /** Shared multi-bot target and attack coordination. */
  coordinator: BotCoordinatorState;
}

export function createAIMatchContext(): AIMatchContext {
  return {
    grifballTeamPlan: createGrifballTeamPlanState(),
    playerModels: new Map(),
    feintCooldowns: new Map(),
    weaponSwapFeintTimers: new Map(),
    comboState: new Map(),
    psychState: new Map(),
    skillCalibration: new Map(),
    coordinator: createBotCoordinator(),
  };
}

export function resetAIMatchContext(context: AIMatchContext): void {
  resetGrifballTeamPlan(context.grifballTeamPlan);
  context.playerModels.clear();
  context.feintCooldowns.clear();
  context.weaponSwapFeintTimers.clear();
  context.comboState.clear();
  context.psychState.clear();
  context.skillCalibration.clear();
  resetBotCoordinator(context.coordinator);
}

export function getOrCreateBotPsychState(
  context: AIMatchContext,
  botId: string,
  tempoCycleDuration?: number,
): BotPsychState {
  let state = context.psychState.get(botId);
  if (!state) {
    state = createBotPsychState(tempoCycleDuration);
    context.psychState.set(botId, state);
  }
  return state;
}

export function tickBotPsychState(
  context: AIMatchContext,
  botId: string,
  dt: number,
  tempoCycleDuration?: number,
): BotPsychState {
  const state = getOrCreateBotPsychState(context, botId, tempoCycleDuration);
  tickPsychState(state, dt, tempoCycleDuration);
  return state;
}

export function tickFeintCooldown(context: Pick<AIMatchContext, 'feintCooldowns'>, botId: string, dt: number): void {
  const remaining = context.feintCooldowns.get(botId);
  if (remaining === undefined || remaining <= 0) {
    return;
  }
  const next = Math.max(0, remaining - dt);
  if (next <= 0) {
    context.feintCooldowns.delete(botId);
  } else {
    context.feintCooldowns.set(botId, next);
  }
}

export function getFeintCooldownRemaining(context: AIMatchContext, botId: string): number {
  return context.feintCooldowns.get(botId) ?? 0;
}

export function startFeintCooldown(context: AIMatchContext, botId: string, duration: number): void {
  context.feintCooldowns.set(botId, duration);
}

export function isWeaponSwapFeintActive(context: Pick<AIMatchContext, 'weaponSwapFeintTimers'>, botId: string): boolean {
  return (context.weaponSwapFeintTimers.get(botId) ?? 0) > 0;
}

export function startWeaponSwapFeint(context: AIMatchContext, botId: string, delay: number): void {
  context.weaponSwapFeintTimers.set(botId, delay);
}

/** Returns true once expiry can be consumed. An in-flight strike keeps an
 * expired feint pending, so reverting cannot change its weapon before impact. */
export function tickWeaponSwapFeintTimer(context: Pick<AIMatchContext, 'weaponSwapFeintTimers'>, botId: string, dt: number, canRevert = true): boolean {
  const remaining = context.weaponSwapFeintTimers.get(botId);
  if (remaining === undefined || remaining <= 0) {
    return false;
  }
  const next = remaining - dt;
  if (next <= 0) {
    if (!canRevert) return false;
    context.weaponSwapFeintTimers.delete(botId);
    return true;
  }
  context.weaponSwapFeintTimers.set(botId, next);
  return false;
}

export function getBotComboState(context: Pick<AIMatchContext, 'comboState'>, botId: string): BotComboState | undefined {
  return context.comboState.get(botId);
}

export function setBotComboState(context: Pick<AIMatchContext, 'comboState'>, botId: string, state: BotComboState | null): void {
  if (!state) {
    context.comboState.delete(botId);
  } else {
    context.comboState.set(botId, state);
  }
}

export function clearBotComboState(context: Pick<AIMatchContext, 'comboState'>, botId: string): void {
  context.comboState.delete(botId);
}

/** The active flag is sampled before expiry. Combo arbitration deliberately sees
 * that flag for this frame even when the weapon has just reverted. */
export function advanceAIWeaponSwapFeint(context: Pick<AIMatchContext, 'weaponSwapFeintTimers'>,
  botId: string, dt: number, activeWeapon: string, weaponState: string, hammerForbidden: boolean) {
  const swapFeintActive = isWeaponSwapFeintActive(context, botId);
  const expired = tickWeaponSwapFeintTimer(context, botId, dt, !isAIWeaponStrikeCommitted(weaponState));
  return { swapFeintActive, revert: expired && activeWeapon === 'sword' && !hammerForbidden };
}
