import { resolveAIHitCombo } from '../../game/aiHitCombo';
import {
  getBotComboState,
  setBotComboState,
} from '../../game/aiMatchContext';
import { type AIResolvedKnobs } from '../../game/aiTuning';
import { type Combatant, type UniversalSettings } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

type ComboRuntimeSettings = Pick<UniversalSettings, 'attackRange' | 'attackRadius' | 'swordLungeDistance'>;
type ComboRuntimeKnobs = Pick<AIResolvedKnobs, 'difficulty' | 'weaponSwapIQ' | 'weaponPrioritization'>;

export const tryStartComboOnHitForState = ({
  state,
  botId,
  targetId,
  openingWeapon,
  bot,
  candidate,
  knobs,
  settings = state.settings,
  targetRecovering,
  random,
}: {
  state: GrifballRuntimeState;
  botId: string;
  targetId: string;
  openingWeapon: 'hammer' | 'sword';
  bot?: Combatant;
  candidate: TacticalTargetCandidate | null;
  knobs: ComboRuntimeKnobs;
  settings?: ComboRuntimeSettings;
  targetRecovering?: boolean;
  random?: () => number;
}): void => {
  const current = getBotComboState(state.aiMatchContext, botId) ?? null;
  const next = resolveAIHitCombo({ current, targetId, openingWeapon, botPos: bot?.pos,
    target: candidate, knobs, settings, targetRecovering, random });
  if (next !== current) setBotComboState(state.aiMatchContext, botId, next);
};
