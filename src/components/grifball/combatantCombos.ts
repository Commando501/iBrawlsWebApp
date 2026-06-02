import * as THREE from 'three';
import {
  canUseWeaponCombos,
  createBotComboState,
  pickComboOnHit,
} from '../../game/aiComboEngine';
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
}): void => {
  if (getBotComboState(state.aiMatchContext, botId)) {
    return;
  }

  if (!canUseWeaponCombos(knobs.difficulty, knobs.weaponSwapIQ)) {
    return;
  }

  if (!candidate || candidate.hp <= 0 || !bot) {
    return;
  }

  const botPos = new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z);
  const dist = botPos.distanceTo(candidate.pos);
  const dangerZone = settings.attackRange + settings.attackRadius * 0.85;
  const minLungeRange = dangerZone * 0.85;
  const maxLungeRange = Math.min(18.0, settings.swordLungeDistance ?? 14.5);

  const comboId = pickComboOnHit({
    difficulty: knobs.difficulty,
    weaponSwapIQ: knobs.weaponSwapIQ,
    weaponPrioritization: knobs.weaponPrioritization,
    openingWeapon,
    distanceToTarget: dist,
    minLungeRange,
    maxLungeRange,
    targetRecovering: targetRecovering ?? candidate.weaponState === 'recovering',
  });

  if (comboId) {
    setBotComboState(state.aiMatchContext, botId, createBotComboState(comboId, targetId));
  }
};
