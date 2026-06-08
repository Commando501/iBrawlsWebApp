import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UniversalSettings } from '../types';
import type { MultiplayerBotConfig } from '../components/AdminDashboard';
import { getStoredToken } from '../services/account';
import {
  type LiveConfig,
  fetchLiveConfig,
  getCachedLiveConfig,
  publishLiveConfig,
} from '../services/liveConfig';
import {
  createDefaultAdminSettings,
  gameplaySettingsAreEqual,
  stripPlayerIdentitySettings,
  withDefaultGameplaySettings,
} from './gameplaySettings';

export const OFFICIAL_MP_PRESET_NAME = '★ Official Multiplayer';

export interface GameplayPreset {
  name: string;
  settings: Omit<UniversalSettings, 'playerHue' | 'playerName'>;
}

const DEFAULT_MULTIPLAYER_BOT_CONFIG: MultiplayerBotConfig = {
  enabled: false,
  count: 2,
  difficulty: 50,
};

interface UseGameplayPresetControlsOptions {
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  isMultiplayer: boolean;
  officialPresetName?: string;
}

export function useGameplayPresetControls({
  adminSettings,
  setAdminSettings,
  isMultiplayer,
  officialPresetName = OFFICIAL_MP_PRESET_NAME,
}: UseGameplayPresetControlsOptions) {
  const [gameplayPresets, setGameplayPresets] = useState<GameplayPreset[]>(() => {
    try {
      const saved = localStorage.getItem('grifball_gameplay_presets');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load gameplay presets:', e);
      return [];
    }
  });
  const [selectedPresetName, setSelectedPresetName] = useState('');
  const [newPresetNameInput, setNewPresetNameInput] = useState('');
  const [multiplayerPreset, setMultiplayerPreset] = useState<LiveConfig | null>(() =>
    getCachedLiveConfig()
  );
  const [mpAdminSettings, setMpAdminSettings] = useState<UniversalSettings>(() => {
    const base = createDefaultAdminSettings('');
    const customAi = 'custom' as UniversalSettings['aiDifficulty'];
    try {
      const saved = localStorage.getItem('ibrawls_mp_ruleset');
      if (saved) return { ...base, ...JSON.parse(saved), aiDifficulty: customAi };
    } catch { /* ignore */ }
    const cached = getCachedLiveConfig();
    const seeded = cached?.settings ? { ...base, ...withDefaultGameplaySettings(cached.settings) } : base;
    return { ...seeded, aiDifficulty: customAi };
  });
  const [publishStatus, setPublishStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [multiplayerBotConfig, setMultiplayerBotConfig] = useState<MultiplayerBotConfig>(() => {
    try {
      const saved = localStorage.getItem('ibrawls_mp_bot_config');
      return saved ? { ...DEFAULT_MULTIPLAYER_BOT_CONFIG, ...JSON.parse(saved) } : DEFAULT_MULTIPLAYER_BOT_CONFIG;
    } catch {
      return DEFAULT_MULTIPLAYER_BOT_CONFIG;
    }
  });

  useEffect(() => {
    let cancelled = false;
    fetchLiveConfig().then((config) => {
      if (!cancelled && config) setMultiplayerPreset(config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ibrawls_mp_ruleset', JSON.stringify(stripPlayerIdentitySettings(mpAdminSettings)));
    } catch { /* ignore disabled / full storage */ }
  }, [mpAdminSettings]);

  const handleSavePreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === officialPresetName.toLowerCase()) return;

    const { playerHue, playerName: sName, ...restSettings } = adminSettings;
    const newPreset: GameplayPreset = {
      name: trimmed,
      settings: restSettings,
    };

    setGameplayPresets(prev => {
      const index = prev.findIndex(p => p.name.toLowerCase() === trimmed.toLowerCase());
      let updated;
      if (index >= 0) {
        updated = [...prev];
        updated[index] = newPreset;
      } else {
        updated = [...prev, newPreset];
      }
      try {
        localStorage.setItem('grifball_gameplay_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save gameplay presets:', e);
      }
      return updated;
    });
    setSelectedPresetName(trimmed);
    setNewPresetNameInput('');
  }, [adminSettings, officialPresetName]);

  const handleDeletePreset = useCallback((nameToDelete: string) => {
    if (nameToDelete === officialPresetName) return;
    setGameplayPresets(prev => {
      const updated = prev.filter(p => p.name !== nameToDelete);
      try {
        localStorage.setItem('grifball_gameplay_presets', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to delete gameplay preset:', e);
      }
      return updated;
    });
    if (selectedPresetName === nameToDelete) {
      setSelectedPresetName('');
    }
  }, [officialPresetName, selectedPresetName]);

  const handleSelectPreset = useCallback((name: string) => {
    setSelectedPresetName(name);
    if (!name) return;
    if (name === officialPresetName) {
      if (multiplayerPreset) {
        setAdminSettings(prev => ({
          ...prev,
          ...withDefaultGameplaySettings(multiplayerPreset.settings),
          playerHue: prev.playerHue,
          playerName: prev.playerName,
        }));
      }
      return;
    }
    const preset = gameplayPresets.find(p => p.name === name);
    if (preset) {
      setAdminSettings(prev => ({
        ...prev,
        ...withDefaultGameplaySettings(preset.settings),
      }));
    }
  }, [gameplayPresets, multiplayerPreset, officialPresetName, setAdminSettings]);

  useEffect(() => {
    if (!selectedPresetName) return;
    if (selectedPresetName === officialPresetName) {
      if (multiplayerPreset) {
        const restSettings = stripPlayerIdentitySettings(adminSettings);
        if (!gameplaySettingsAreEqual(restSettings, withDefaultGameplaySettings(multiplayerPreset.settings))) {
          setSelectedPresetName('');
        }
      }
      return;
    }
    const activePreset = gameplayPresets.find(p => p.name === selectedPresetName);
    if (activePreset) {
      const restSettings = stripPlayerIdentitySettings(adminSettings);
      if (!gameplaySettingsAreEqual(restSettings, withDefaultGameplaySettings(activePreset.settings))) {
        setSelectedPresetName('');
      }
    }
  }, [adminSettings, gameplayPresets, officialPresetName, selectedPresetName, multiplayerPreset]);

  const effectiveAdminSettings = useMemo<UniversalSettings>(() => {
    if (isMultiplayer && multiplayerPreset) {
      return {
        ...adminSettings,
        ...withDefaultGameplaySettings(multiplayerPreset.settings),
        playerHue: adminSettings.playerHue,
        playerName: adminSettings.playerName,
      };
    }
    return adminSettings;
  }, [isMultiplayer, multiplayerPreset, adminSettings]);

  const handleBotConfigChange = useCallback((next: MultiplayerBotConfig) => {
    setMultiplayerBotConfig(next);
    try { localStorage.setItem('ibrawls_mp_bot_config', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const refreshMultiplayerPreset = useCallback((serverVersion?: number) => {
    setMultiplayerPreset(prev => {
      if (prev && typeof serverVersion === 'number' && serverVersion <= prev.version) {
        return prev;
      }
      fetchLiveConfig().then(config => {
        if (config) setMultiplayerPreset(config);
      });
      return prev;
    });
  }, []);

  const handlePublishOfficial = useCallback(async () => {
    const sessionToken = getStoredToken();
    if (!sessionToken || isPublishing) return;
    setIsPublishing(true);
    setPublishStatus(null);
    const label = (multiplayerPreset?.version ? `v${multiplayerPreset.version + 1}` : 'v1');
    const result = await publishLiveConfig(
      sessionToken,
      stripPlayerIdentitySettings(mpAdminSettings),
      label
    );
    if (result.ok) {
      setPublishStatus({ ok: true, msg: `Published official preset v${result.version}.` });
      const fresh = await fetchLiveConfig();
      if (fresh) setMultiplayerPreset(fresh);
    } else {
      setPublishStatus({ ok: false, msg: result.error || 'Publish failed.' });
    }
    setIsPublishing(false);
  }, [isPublishing, mpAdminSettings, multiplayerPreset]);

  return {
    gameplayPresets,
    selectedPresetName,
    newPresetNameInput,
    setNewPresetNameInput,
    multiplayerPreset,
    mpAdminSettings,
    setMpAdminSettings,
    effectiveAdminSettings,
    publishStatus,
    isPublishing,
    multiplayerBotConfig,
    handleSavePreset,
    handleDeletePreset,
    handleSelectPreset,
    handleBotConfigChange,
    refreshMultiplayerPreset,
    handlePublishOfficial,
  };
}
