import { type AICombatWeapon } from '../../game/aiCombatDecision';
import { recordCalibrationCounterAttempt } from '../../game/aiSkillCalibration';
import { type GrifballRuntimeState } from './runtimeState';

import { resolveAIBulltrueCounterDecision, type AIBulltrueCounterFrame, type AIBulltrueCounterResult } from '../../game/aiBulltrueCounterDecision';
export type { AIBulltrueCounterFrame, AIBulltrueCounterResult } from '../../game/aiBulltrueCounterDecision';

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
  const result = resolveAIBulltrueCounterDecision({ settings: state.settings, frame, bulltrueCounter,
    canStartWeaponAction, cooldownMultiplier, triggerCombatantAttack });
  if (result.started && calibrationEnabled) recordCalibrationCounterAttempt(state.aiMatchContext, botId);
  return result;
}
