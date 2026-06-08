import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, UniversalSettings } from '../types';
import {
  applyArchetypeToSettings,
  type AIArchetypeId,
} from '../game/aiPersonalities';

const STANDARD_AI_DIFFICULTIES = new Set(['easy', 'normal', 'hard', 'nightmare', 'custom']);

interface UseAiPresetControlsOptions {
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  setBotDifficulties: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useAiPresetControls({
  adminSettings,
  setAdminSettings,
  setBotDifficulties,
}: UseAiPresetControlsOptions) {
  const [aiPresets, setAiPresets] = useState<AIPreset[]>(() => {
    try {
      const saved = localStorage.getItem('grifball_ai_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load AI presets:', e);
      return [];
    }
  });

  const [newAiPresetNameInput, setNewAiPresetNameInput] = useState('');

  const handleSaveAIPreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const id = 'ai_preset_' + Date.now();
    const newPreset: AIPreset = {
      id,
      name: trimmed,
      tuning: {
        aiReactionLatency: adminSettings.aiReactionLatency ?? 0.25,
        aiAnticipationFactor: adminSettings.aiAnticipationFactor ?? 0.40,
        aiMovementComplexity: adminSettings.aiMovementComplexity ?? 50,
        aiWeaponSwapIQ: adminSettings.aiWeaponSwapIQ ?? 50,
        aiPlaystyle: adminSettings.aiPlaystyle ?? 50,
        aiWeaponPrioritization: adminSettings.aiWeaponPrioritization ?? 50,
        aiSpatialIQ: adminSettings.aiSpatialIQ,
        aiFeintChance: adminSettings.aiFeintChance,
        aiPressureAggression: adminSettings.aiPressureAggression,
        aiSpacingBand: adminSettings.aiSpacingBand,
        aiSkipPressure: adminSettings.aiSkipPressure,
      },
    };

    setAiPresets(prev => {
      const updated = [...prev, newPreset];
      try {
        localStorage.setItem('grifball_ai_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save AI presets:', e);
      }
      return updated;
    });

    setAdminSettings(prev => ({
      ...prev,
      aiDifficulty: id,
    }));
    setNewAiPresetNameInput('');
  }, [adminSettings, setAdminSettings]);

  const handleDeleteAIPreset = useCallback((idToDelete: string) => {
    setAiPresets(prev => {
      const updated = prev.filter(p => p.id !== idToDelete);
      try {
        localStorage.setItem('grifball_ai_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to delete AI preset:', e);
      }
      return updated;
    });

    setBotDifficulties(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        if (updated[key] === idToDelete) {
          updated[key] = 'normal';
        }
      });
      return updated;
    });

    if (adminSettings.aiDifficulty === idToDelete) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: 'normal',
      }));
    }
  }, [adminSettings.aiDifficulty, setAdminSettings, setBotDifficulties]);

  const handleSelectAIPreset = useCallback((id: string) => {
    if (STANDARD_AI_DIFFICULTIES.has(id)) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: id,
      }));
      return;
    }

    const preset = aiPresets.find(p => p.id === id);
    if (preset) {
      setAdminSettings(prev => ({
        ...prev,
        aiDifficulty: id,
        aiReactionLatency: preset.tuning.aiReactionLatency ?? 0.25,
        aiAnticipationFactor: preset.tuning.aiAnticipationFactor ?? 0.40,
        aiMovementComplexity: preset.tuning.aiMovementComplexity ?? 50,
        aiWeaponSwapIQ: preset.tuning.aiWeaponSwapIQ ?? 50,
        aiPlaystyle: preset.tuning.aiPlaystyle ?? 50,
        aiWeaponPrioritization: preset.tuning.aiWeaponPrioritization ?? 50,
        aiSpatialIQ: preset.tuning.aiSpatialIQ,
        aiFeintChance: preset.tuning.aiFeintChance,
        aiPressureAggression: preset.tuning.aiPressureAggression,
        aiSpacingBand: preset.tuning.aiSpacingBand,
        aiSkipPressure: preset.tuning.aiSkipPressure,
      }));
    }
  }, [aiPresets, setAdminSettings]);

  const handleSelectAIArchetype = useCallback((archetypeId: string) => {
    if (archetypeId === 'none') {
      setAdminSettings(prev => ({ ...prev, aiArchetype: 'none' }));
      return;
    }

    setAdminSettings(prev => applyArchetypeToSettings(prev, archetypeId as Exclude<AIArchetypeId, 'none'>));
  }, [setAdminSettings]);

  return {
    aiPresets,
    newAiPresetNameInput,
    setNewAiPresetNameInput,
    handleSaveAIPreset,
    handleDeleteAIPreset,
    handleSelectAIPreset,
    handleSelectAIArchetype,
  };
}
