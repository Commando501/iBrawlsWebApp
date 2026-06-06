import {
  getAICombatants,
  getDisplayOpponent,
  getMainAI,
  getRosterCombatant,
} from '../../game/roster';
import {
  resolveDerivedFromRosterSlot,
  resolveKnobsFromRosterSlot,
  resolveRosterSlotForCombatant,
} from '../../game/rosterSlotConfig';
import { resolvePersonalityFlags } from '../../game/aiPersonalities';
import { type AIBehaviorPreset, type AIPreset, type Combatant } from '../../types';
import { buildLegacyRosterProps } from './legacyRosterProps';
import { createMatchScoreContext } from './matchPressure';
import { type GrifballRuntimeState } from './runtimeState';

type MutableRef<T> = { current: T };

export function createAIRosterCallbacksForState({
  getState,
  opponentClientId,
  opponentPlayerName,
  botDifficultiesRef,
  botBehaviorsRef,
  botWeaponBehaviorsRef,
  botArchetypesRef,
  botColorsRef,
  aiPresets,
  matchKillsToWin,
}: {
  getState: () => GrifballRuntimeState;
  opponentClientId: string;
  opponentPlayerName: string;
  botDifficultiesRef: MutableRef<Record<string, string>>;
  botBehaviorsRef: MutableRef<Record<string, AIBehaviorPreset>>;
  botWeaponBehaviorsRef: MutableRef<Record<string, string>>;
  botArchetypesRef: MutableRef<Record<string, string>>;
  botColorsRef: MutableRef<Record<string, number>>;
  aiPresets: AIPreset[];
  matchKillsToWin?: number;
}) {
  /** Offline main AI combatant (roster slot 0). */
  const mai = (): Combatant | undefined => getMainAI(getState().otherPlayers);

  /** All locally ticked AI combatants in the offline roster. */
  const getRosterAI = (): Combatant[] => getAICombatants(getState().otherPlayers);

  const rosterCombatant = (id: string): Combatant | undefined =>
    getRosterCombatant(getState().otherPlayers, id);

  /** Primary opponent for HUD / 1v1 display (main_ai offline, remote online). */
  const opponentDisplay = (): Combatant | undefined => {
    const state = getState();
    return getDisplayOpponent(state.otherPlayers, state.isMultiplayer, opponentClientId);
  };

  const getLegacyRosterProps = () => buildLegacyRosterProps({
    opponentPlayerName,
    botDifficulties: botDifficultiesRef.current,
    botBehaviors: botBehaviorsRef.current,
    botWeaponBehaviors: botWeaponBehaviorsRef.current,
    botArchetypes: botArchetypesRef.current,
    botColors: botColorsRef.current,
  });

  const resolveRosterSlot = (botId: string) => {
    const state = getState();
    return resolveRosterSlotForCombatant(botId, state.settings, getLegacyRosterProps());
  };

  const resolveBotArchetype = (botId: string): string | undefined => {
    const slot = resolveRosterSlot(botId);
    return slot.archetype && slot.archetype !== 'none' ? slot.archetype : undefined;
  };

  const resolveBotKnobs = (botId: string) => {
    const state = getState();
    return resolveKnobsFromRosterSlot(resolveRosterSlot(botId), aiPresets, state.settings);
  };

  const resolveBotDerived = (botId: string) => {
    const state = getState();
    return resolveDerivedFromRosterSlot(resolveRosterSlot(botId), aiPresets, state.settings);
  };

  const resolveBotFlags = (botId: string) => {
    const state = getState();
    const slot = resolveRosterSlot(botId);
    return resolvePersonalityFlags(
      slot.archetype && slot.archetype !== 'none' ? slot.archetype : undefined,
      {
        spacingBand: slot.spacingBand ?? state.settings.aiSpacingBand,
        skipPressure: slot.skipPressure ?? state.settings.aiSkipPressure,
      }
    );
  };

  const getMatchScoreContext = () =>
    createMatchScoreContext(getState(), matchKillsToWin);

  return {
    mai,
    getRosterAI,
    rosterCombatant,
    opponentDisplay,
    getLegacyRosterProps,
    resolveRosterSlot,
    resolveBotArchetype,
    resolveBotKnobs,
    resolveBotDerived,
    resolveBotFlags,
    getMatchScoreContext,
  };
}
