import React from 'react';
import { applyArchetypeToSettings, type AIArchetypeId } from '../../game/aiPersonalities';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { UniversalSettings } from '../../types';
import { BotSetupModal } from './BotSetupModal';

type BotSetupModalProps = React.ComponentProps<typeof BotSetupModal>;

interface BotSetupOverlayProps extends Omit<BotSetupModalProps, 'onToggleGrifballMode' | 'onMainAiArchetypeChange'> {
  isOpen: boolean;
  setAdminSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
}

export function BotSetupOverlay({
  isOpen,
  isPlaying,
  offlineBotCount,
  onOfflineBotCountChange,
  adminSettings,
  playerName,
  selectedMap,
  onSelectedMapChange,
  lobbyCustomMapData,
  onCustomMapDataChange,
  botColors,
  setBotColors,
  botDifficulties,
  setBotDifficulties,
  botArchetypes,
  setAdminSettings,
  setBotArchetypes,
  aiPresets,
  onClose,
  onApplyAndResume,
  onInitializeSimulation,
}: BotSetupOverlayProps) {
  if (!isOpen) {
    return null;
  }

  const handleToggleGrifballMode = () => {
    const enabling = adminSettings.gameMode !== 'grifball';
    setAdminSettings((prev) => ({ ...prev, gameMode: enabling ? 'grifball' : 'sandbox' }));
    if (enabling) {
      const isRectangularMap = PREMADE_MAPS.find((map) => map.id === selectedMap)?.mapShape === 'rectangular';
      if (!isRectangularMap) {
        onSelectedMapChange('championship_stadium');
      }
    }
  };

  const handleMainAiArchetypeChange = (archetypeId: AIArchetypeId) => {
    setBotArchetypes((prev) => ({ ...prev, main_ai: archetypeId }));
    if (archetypeId === 'none') {
      setAdminSettings((prev) => ({ ...prev, aiArchetype: 'none' }));
    } else {
      setAdminSettings((prev) => applyArchetypeToSettings(prev, archetypeId));
    }
  };

  return (
    <BotSetupModal
      isPlaying={isPlaying}
      offlineBotCount={offlineBotCount}
      onOfflineBotCountChange={onOfflineBotCountChange}
      adminSettings={adminSettings}
      playerName={playerName}
      selectedMap={selectedMap}
      onSelectedMapChange={onSelectedMapChange}
      lobbyCustomMapData={lobbyCustomMapData}
      onCustomMapDataChange={onCustomMapDataChange}
      botColors={botColors}
      setBotColors={setBotColors}
      botDifficulties={botDifficulties}
      setBotDifficulties={setBotDifficulties}
      botArchetypes={botArchetypes}
      setBotArchetypes={setBotArchetypes}
      aiPresets={aiPresets}
      onToggleGrifballMode={handleToggleGrifballMode}
      onMainAiArchetypeChange={handleMainAiArchetypeChange}
      onClose={onClose}
      onApplyAndResume={onApplyAndResume}
      onInitializeSimulation={onInitializeSimulation}
    />
  );
}
