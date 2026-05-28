import type { BotComboState } from './aiComboEngine';
import type { BotCoordinatorState } from './aiBotCoordinator';
import { createBotCoordinator, resetBotCoordinator } from './aiBotCoordinator';
import type { BotPsychState } from './aiPsychologicalPressure';
import { createBotPsychState, tickBotPsychState as tickPsychState } from './aiPsychologicalPressure';
import type { PlayerModel } from './aiPlayerModel';
import type { BotCalibrationState } from './aiSkillCalibration';

export interface AIMatchContext {
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
  context.playerModels.clear();
  context.feintCooldowns.clear();
  context.weaponSwapFeintTimers.clear();
  context.comboState.clear();
  context.psychState.clear();
  context.skillCalibration.clear();
  resetBotCoordinator(context.coordinator);
}

export function getOrCreateBotPsychState(context: AIMatchContext, botId: string): BotPsychState {
  let state = context.psychState.get(botId);
  if (!state) {
    state = createBotPsychState();
    context.psychState.set(botId, state);
  }
  return state;
}

export function tickBotPsychState(context: AIMatchContext, botId: string, dt: number): BotPsychState {
  const state = getOrCreateBotPsychState(context, botId);
  tickPsychState(state, dt);
  return state;
}

export function tickFeintCooldown(context: AIMatchContext, botId: string, dt: number): void {
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

export function isWeaponSwapFeintActive(context: AIMatchContext, botId: string): boolean {
  return (context.weaponSwapFeintTimers.get(botId) ?? 0) > 0;
}

export function startWeaponSwapFeint(context: AIMatchContext, botId: string, delay: number): void {
  context.weaponSwapFeintTimers.set(botId, delay);
}

/** Returns true when the revert timer just expired this tick. */
export function tickWeaponSwapFeintTimer(context: AIMatchContext, botId: string, dt: number): boolean {
  const remaining = context.weaponSwapFeintTimers.get(botId);
  if (remaining === undefined || remaining <= 0) {
    return false;
  }
  const next = remaining - dt;
  if (next <= 0) {
    context.weaponSwapFeintTimers.delete(botId);
    return true;
  }
  context.weaponSwapFeintTimers.set(botId, next);
  return false;
}

export function getBotComboState(context: AIMatchContext, botId: string): BotComboState | undefined {
  return context.comboState.get(botId);
}

export function setBotComboState(context: AIMatchContext, botId: string, state: BotComboState | null): void {
  if (!state) {
    context.comboState.delete(botId);
  } else {
    context.comboState.set(botId, state);
  }
}

export function clearBotComboState(context: AIMatchContext, botId: string): void {
  context.comboState.delete(botId);
}
