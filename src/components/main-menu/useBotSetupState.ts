import { useState } from 'react';
import { type AIBehaviorPreset, type CharacterModelType, type CustomMapData } from '../../types';
import type { AIArchetypeId } from '../../game/aiPersonalities';

const BOT_SETUP_SLOT_IDS = ['main_ai', 'bot_2', 'bot_3', 'bot_4', 'bot_5', 'bot_6', 'bot_7'] as const;

export function createDefaultBotDifficulties(): Record<string, string> {
  return Object.fromEntries(BOT_SETUP_SLOT_IDS.map((id) => [id, 'normal']));
}

export function createDefaultBotBehaviors(): Record<string, AIBehaviorPreset> {
  return Object.fromEntries(BOT_SETUP_SLOT_IDS.map((id) => [id, 'defensive'])) as Record<string, AIBehaviorPreset>;
}

export function createDefaultBotWeaponBehaviors(): Record<string, string> {
  return Object.fromEntries(BOT_SETUP_SLOT_IDS.map((id) => [id, 'balanced']));
}

export function createDefaultBotArchetypes(): Record<string, AIArchetypeId> {
  return Object.fromEntries(BOT_SETUP_SLOT_IDS.map((id) => [id, 'none'])) as Record<string, AIArchetypeId>;
}

export function createDefaultBotModelTypes(): Record<string, CharacterModelType> {
  return Object.fromEntries(BOT_SETUP_SLOT_IDS.map((id) => [id, 'medium'])) as Record<string, CharacterModelType>;
}

export function createDefaultBotColors(): Record<string, number> {
  return {
    main_ai: 0,
    bot_2: 120,
    bot_3: 280,
    bot_4: 45,
    bot_5: 60,
    bot_6: 320,
    bot_7: 180,
  };
}

export function useBotSetupState() {
  const [offlineBotCount, setOfflineBotCount] = useState<number>(3);
  const [botDifficulties, setBotDifficulties] = useState<Record<string, string>>(createDefaultBotDifficulties);
  const [botBehaviors, setBotBehaviors] = useState<Record<string, AIBehaviorPreset>>(createDefaultBotBehaviors);
  const [botWeaponBehaviors, setBotWeaponBehaviors] = useState<Record<string, string>>(createDefaultBotWeaponBehaviors);
  const [botArchetypes, setBotArchetypes] = useState<Record<string, AIArchetypeId>>(createDefaultBotArchetypes);
  const [botModelTypes, setBotModelTypes] = useState<Record<string, CharacterModelType>>(createDefaultBotModelTypes);
  const [botColors, setBotColors] = useState<Record<string, number>>(createDefaultBotColors);
  const [showBotSetupMenu, setShowBotSetupMenu] = useState<boolean>(false);
  const [selectedMap, setSelectedMap] = useState<string>('hangar');
  const [lobbyCustomMapData, setLobbyCustomMapData] = useState<CustomMapData | null>(null);

  return {
    offlineBotCount,
    setOfflineBotCount,
    botDifficulties,
    setBotDifficulties,
    botBehaviors,
    setBotBehaviors,
    botWeaponBehaviors,
    setBotWeaponBehaviors,
    botArchetypes,
    setBotArchetypes,
    botModelTypes,
    setBotModelTypes,
    botColors,
    setBotColors,
    showBotSetupMenu,
    setShowBotSetupMenu,
    selectedMap,
    setSelectedMap,
    lobbyCustomMapData,
    setLobbyCustomMapData,
  };
}
