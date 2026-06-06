import * as THREE from 'three';
import {
  type AIMatchScoreContext,
  type AIResolvedKnobs,
  type DerivedAIParams,
} from '../../game/aiTuning';
import { type RosterSlotConfig } from '../../game/rosterSlotConfig';
import { type Combatant } from '../../types';
import {
  evaluateTacticalWeaponChoiceForState,
  type TacticalWeaponChoiceContext,
} from './aiTacticalWeaponRuntime';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import {
  buildPotentialTacticalTargets,
  getBestTacticalTargetFromState,
  getTacticalTargetByIdFromState,
  isTacticalTargetOnCooldown,
} from './tacticalTargets';
import {
  getEnemyAITargetFromTacticalTarget,
  type EnemyAITarget,
} from './targetSelection';

type TacticalWeaponChoiceResult = ReturnType<typeof evaluateTacticalWeaponChoiceForState>;

export function createTacticalTargetCallbacksForState({
  getState,
  getMainAI,
  getRosterAI,
  resolveRosterSlot,
  resolveBotKnobs,
  resolveBotDerived,
  getMatchScoreContext,
}: {
  getState: () => GrifballRuntimeState;
  getMainAI: () => Combatant | undefined;
  getRosterAI: () => Combatant[];
  resolveRosterSlot: (botId: string) => RosterSlotConfig;
  resolveBotKnobs: (botId: string) => AIResolvedKnobs;
  resolveBotDerived: (botId: string) => DerivedAIParams;
  getMatchScoreContext: () => AIMatchScoreContext;
}): {
  getEnemyAITarget: () => EnemyAITarget | null;
  isTargetOnCooldown: (target: Pick<TacticalTargetCandidate, 'id'>) => boolean;
  buildPotentialTargets: (botId: string) => TacticalTargetCandidate[];
  getTacticalTargetById: (botId: string, targetId: string) => TacticalTargetCandidate | null;
  getBestTacticalTarget: (botId: string, botPos: THREE.Vector3, difficulty: string) => TacticalTargetCandidate | null;
  evaluateTacticalWeaponChoice: (
    botId: string,
    target: TacticalTargetCandidate,
    difficulty: string,
    context?: TacticalWeaponChoiceContext
  ) => TacticalWeaponChoiceResult;
} {
  const getBestTacticalTarget = (botId: string, botPos: THREE.Vector3, difficulty: string) => {
    return getBestTacticalTargetFromState({
      state: getState(),
      botId,
      botPos,
      difficulty,
      mainAI: getMainAI(),
      rosterAI: getRosterAI(),
      resolveBotKnobs,
      resolveBotDerived,
    });
  };

  const getEnemyAITarget = () => {
    const mainAi = getMainAI();
    if (!mainAi) return null;
    // Resolve the main AI's actual engagement target through the same tactical
    // selector used by movement, so close-range impacts land where the bot is facing.
    const difficulty = resolveRosterSlot('main_ai').difficulty || 'normal';
    const best = getBestTacticalTarget('main_ai', mainAi.pos, difficulty);
    return getEnemyAITargetFromTacticalTarget(best);
  };

  const isTargetOnCooldown = (target: Pick<TacticalTargetCandidate, 'id'>) => {
    return isTacticalTargetOnCooldown(getState(), getMainAI(), target);
  };

  const buildPotentialTargets = (botId: string): TacticalTargetCandidate[] => {
    return buildPotentialTacticalTargets(getState(), botId, getRosterAI());
  };

  const getTacticalTargetById = (botId: string, targetId: string): TacticalTargetCandidate | null => {
    return getTacticalTargetByIdFromState(getState(), botId, targetId, getRosterAI());
  };

  const evaluateTacticalWeaponChoice = (
    botId: string,
    target: TacticalTargetCandidate,
    difficulty: string,
    context: TacticalWeaponChoiceContext = {}
  ) => evaluateTacticalWeaponChoiceForState({
    state: getState(),
    botId,
    target,
    difficulty,
    context,
    mainAI: getMainAI(),
    pressureAggression: resolveBotDerived(botId).pressureAggression,
    scoreContext: getMatchScoreContext(),
  });

  return {
    getEnemyAITarget,
    isTargetOnCooldown,
    buildPotentialTargets,
    getTacticalTargetById,
    getBestTacticalTarget,
    evaluateTacticalWeaponChoice,
  };
}
