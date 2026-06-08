import { useCallback, useEffect, useState } from 'react';
import type { UniversalSettings } from '../types';
import { MAX_PLAYER_NAME_LENGTH } from '../network/onlineClients';
import { DEFAULT_ADMIN_SETTINGS } from './gameplaySettings';

const DEFAULT_PLAYER_HUE = 200;

const createDefaultPlayerName = () => `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;

const getSavedPlayerName = () => {
  try {
    const savedName = localStorage.getItem('grifball_player_name');
    if (savedName) return savedName;
  } catch {
    /* ignore */
  }
  return createDefaultPlayerName();
};

export const getSavedPlayerHue = (): number => {
  try {
    const saved = localStorage.getItem('grifball_player_hue');
    return saved ? parseInt(saved, 10) : DEFAULT_PLAYER_HUE;
  } catch {
    return DEFAULT_PLAYER_HUE;
  }
};

const getSavedAdminSettings = (): UniversalSettings => {
  try {
    const savedAdmin = localStorage.getItem('grifball_admin_settings');
    const admin = savedAdmin ? JSON.parse(savedAdmin) : {};

    const savedVersion = localStorage.getItem('grifball_settings_version');
    if (savedVersion !== 'v2') {
      admin.enableSprint = false;
      admin.enableSlide = false;
      try {
        localStorage.setItem('grifball_settings_version', 'v2');
        const { playerHue, playerName: _name, ...rest } = admin;
        localStorage.setItem('grifball_admin_settings', JSON.stringify(rest));
      } catch {
        /* ignore */
      }
    }

    const savedName = localStorage.getItem('grifball_player_name');

    return {
      ...DEFAULT_ADMIN_SETTINGS,
      ...admin,
      playerHue: getSavedPlayerHue(),
      playerName: savedName || createDefaultPlayerName(),
    };
  } catch {
    return DEFAULT_ADMIN_SETTINGS;
  }
};

export function usePlayerSettings() {
  const [playerName, setPlayerName] = useState<string>(() => getSavedPlayerName());
  const [adminSettings, setAdminSettings] = useState<UniversalSettings>(() => getSavedAdminSettings());

  const handlePlayerNameChange = useCallback((newName: string) => {
    const trimmed = newName.substring(0, MAX_PLAYER_NAME_LENGTH);
    setPlayerName(trimmed);
    setAdminSettings(prev => ({ ...prev, playerName: trimmed }));
    try {
      localStorage.setItem('grifball_player_name', trimmed);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const { playerHue, playerName: _playerName, ...restSettings } = adminSettings;
      localStorage.setItem('grifball_admin_settings', JSON.stringify(restSettings));
      if (playerHue !== undefined) {
        localStorage.setItem('grifball_player_hue', playerHue.toString());
      }
    } catch (e) {
      console.error('Failed to save settings locally:', e);
    }
  }, [adminSettings]);

  const localPlayerHue = adminSettings.playerHue ?? DEFAULT_PLAYER_HUE;

  return {
    adminSettings,
    setAdminSettings,
    playerName,
    setPlayerName,
    localPlayerHue,
    getSavedPlayerHue,
    handlePlayerNameChange,
  };
}
