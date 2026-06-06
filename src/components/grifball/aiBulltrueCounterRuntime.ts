import { type AICombatWeapon } from '../../game/aiCombatDecision';
import { recordCalibrationCounterAttempt } from '../../game/aiSkillCalibration';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTimingRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export interface AIBulltrueCounterFrame {
  activeWeapon: Combatant['activeWeapon'];
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export interface AIBulltrueCounterResult {
  started: boolean;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

export function resolveAIBulltrueCounterForCombatant({
  state,
  frame,
  botId,
  bulltrueCounter,
  canStartWeaponAction,
  cooldownMultiplier,
  calibrationEnabled,
  triggerCombatantAttack,
}: {
  state: GrifballRuntimeState;
  frame: AIBulltrueCounterFrame;
  botId: string;
  bulltrueCounter: AICombatWeapon | null;
  canStartWeaponAction: boolean;
  cooldownMultiplier: number;
  calibrationEnabled: boolean;
  triggerCombatantAttack: (weapon: AICombatWeapon) => void;
}): AIBulltrueCounterResult {
  const canCounter =
    !!bulltrueCounter &&
    canStartWeaponAction &&
    frame.activeWeapon === bulltrueCounter &&
    frame.weaponState === 'ready';

  if (!canCounter) {
    return {
      started: false,
      aiState: frame.aiState,
      timer: frame.timer,
      weaponState: frame.weaponState,
    };
  }

  frame.aiState = 'COOLDOWN';
  frame.timer = resolveScaledAIWeaponReloadTime(state.settings, bulltrueCounter, cooldownMultiplier);
  triggerCombatantAttack(bulltrueCounter);
  frame.weaponState = 'swing_up';

  if (calibrationEnabled) {
    recordCalibrationCounterAttempt(state.aiMatchContext, botId);
  }

  return {
    started: true,
    aiState: frame.aiState,
    timer: frame.timer,
    weaponState: frame.weaponState,
  };
}
