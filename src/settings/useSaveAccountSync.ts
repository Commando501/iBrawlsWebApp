import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Keybindings, UniversalSettings } from '../types';
import type { UiLayoutState } from '../ui/hudLayouts';
import { DEFAULT_KEYBINDINGS } from '../types';
import { createDefaultAdminSettings, withDefaultGameplaySettings } from './gameplaySettings';
import { type SaveData, buildSaveData, decryptSaveCode, encryptSaveData } from './saveCodec';
import { DEFAULT_LOADOUT, type CharacterLoadout } from '../components/VoxelModels';
import {
  CUSTOM_ARMOR_CATALOG_STORAGE_KEY,
  type CustomArmorCatalog,
  createEmptyCustomArmorCatalog,
  normalizeCustomArmorCatalog,
  persistCustomArmorCatalog,
} from '../components/customArmor';
import {
  type AccountInfo,
  fetchCloudSave,
  fetchMe,
  getStoredToken,
  pushCloudSave,
} from '../services/account';

export type SaveSystemStatus = {
  type: 'success' | 'error' | null;
  message: string;
};

interface UseSaveAccountSyncOptions {
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  playerName: string;
  setPlayerName: Dispatch<SetStateAction<string>>;
  onPlayerNameChange: (newName: string) => void;
  uiLayouts: UiLayoutState;
  applySavedUiLayouts: (rawLayouts: unknown) => void;
  resetUiLayouts: () => void;
  keybindings: Keybindings;
  setKeybindings: Dispatch<SetStateAction<Keybindings>>;
  playerLoadout: CharacterLoadout;
  setPlayerLoadout: Dispatch<SetStateAction<CharacterLoadout>>;
  customArmorCatalog: CustomArmorCatalog;
  setCustomArmorCatalog: Dispatch<SetStateAction<CustomArmorCatalog>>;
  setCollapsedSections: Dispatch<SetStateAction<Record<string, boolean>>>;
  onLoggedOut?: () => void;
}

export function useSaveAccountSync({
  adminSettings,
  setAdminSettings,
  playerName,
  setPlayerName,
  onPlayerNameChange,
  uiLayouts,
  applySavedUiLayouts,
  resetUiLayouts,
  keybindings,
  setKeybindings,
  playerLoadout,
  setPlayerLoadout,
  customArmorCatalog,
  setCustomArmorCatalog,
  setCollapsedSections,
  onLoggedOut,
}: UseSaveAccountSyncOptions) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [saveCodeImportInput, setSaveCodeImportInput] = useState('');
  const [saveSystemStatus, setSaveSystemStatus] = useState<SaveSystemStatus>({ type: null, message: '' });
  const cloudPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySaveData = useCallback((decrypted: SaveData) => {
    onPlayerNameChange(decrypted.playerName);
    localStorage.setItem('grifball_player_hue', decrypted.playerHue.toString());

    if (decrypted.uiLayouts) {
      applySavedUiLayouts(decrypted.uiLayouts);
    } else if (decrypted.uiPositions && Array.isArray(decrypted.uiPositions)) {
      applySavedUiLayouts(decrypted.uiPositions);
    }

    if (decrypted.adminSettings) {
      const importedAdminSettings = withDefaultGameplaySettings(decrypted.adminSettings);
      const fullSettings: UniversalSettings = {
        ...adminSettings,
        ...importedAdminSettings,
        playerHue: decrypted.playerHue,
        playerName: decrypted.playerName,
      };
      setAdminSettings(fullSettings);
      localStorage.setItem('grifball_admin_settings', JSON.stringify(importedAdminSettings));
    }

    if (decrypted.keybindings) {
      const merged = { ...DEFAULT_KEYBINDINGS, ...decrypted.keybindings };
      setKeybindings(merged);
      localStorage.setItem('grifball_keybindings', JSON.stringify(merged));
    }

    if (decrypted.playerLoadout) {
      const mergedLoadout = { ...DEFAULT_LOADOUT, ...decrypted.playerLoadout };
      setPlayerLoadout(mergedLoadout);
      localStorage.setItem('grifball_player_loadout', JSON.stringify(mergedLoadout));
    }

    if (decrypted.customArmorCatalog) {
      const normalizedCatalog = normalizeCustomArmorCatalog(decrypted.customArmorCatalog);
      setCustomArmorCatalog(normalizedCatalog);
      persistCustomArmorCatalog(normalizedCatalog);
    }
  }, [adminSettings, applySavedUiLayouts, onPlayerNameChange, setAdminSettings, setCustomArmorCatalog, setKeybindings, setPlayerLoadout]);

  const buildCurrentSaveData = useCallback(
    () => buildSaveData(adminSettings, playerName, uiLayouts, keybindings, playerLoadout, customArmorCatalog),
    [adminSettings, playerName, uiLayouts, keybindings, playerLoadout, customArmorCatalog]
  );

  const pullAndApplyCloudSave = useCallback(async () => {
    const res = await fetchCloudSave<SaveData>();
    if (res.ok && res.data && res.data.save) {
      applySaveData(res.data.save);
    }
  }, [applySaveData]);

  const handleExportSaveCode = useCallback(() => {
    try {
      const code = encryptSaveData(buildCurrentSaveData());
      navigator.clipboard.writeText(code);

      setSaveSystemStatus({
        type: 'success',
        message: 'Neural Backup Copied to Clipboard!',
      });
      setTimeout(() => setSaveSystemStatus({ type: null, message: '' }), 4000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Export failed.',
      });
    }
  }, [buildCurrentSaveData]);

  const handleImportSaveCode = useCallback((code: string) => {
    if (!code) {
      setSaveSystemStatus({ type: 'error', message: 'Please paste a save code first.' });
      return;
    }
    try {
      const decrypted = decryptSaveCode(code);
      if (!decrypted || !decrypted.playerName || decrypted.playerHue === undefined) {
        throw new Error('Malformed save data structure.');
      }

      applySaveData(decrypted);

      setSaveSystemStatus({
        type: 'success',
        message: `Neural Link Synced! Welcome back, ${decrypted.playerName}.`,
      });
      setSaveCodeImportInput('');
      setTimeout(() => setSaveSystemStatus({ type: null, message: '' }), 6000);
    } catch (err: any) {
      setSaveSystemStatus({
        type: 'error',
        message: err.message || 'Import failed.',
      });
    }
  }, [applySaveData]);

  const handleResetAllSettings = useCallback(() => {
    if (confirm('Are you sure you want to completely erase all client saves, custom layout configurations, and restore all default values?')) {
      try {
        localStorage.removeItem('grifball_player_name');
        localStorage.removeItem('grifball_player_hue');
        localStorage.removeItem('grifball_ui_positions');
        localStorage.removeItem('grifball_admin_settings');
        localStorage.removeItem('grifball_keybindings');
        localStorage.removeItem('grifball_player_loadout');
        localStorage.removeItem(CUSTOM_ARMOR_CATALOG_STORAGE_KEY);
        localStorage.removeItem('grifball_settings_version');
        localStorage.removeItem('grifball_collapsed_sections');

        const defaultName = `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
        setPlayerName(defaultName);
        resetUiLayouts();
        setKeybindings({ ...DEFAULT_KEYBINDINGS });
        setPlayerLoadout(DEFAULT_LOADOUT);
        setCustomArmorCatalog(createEmptyCustomArmorCatalog());
        setAdminSettings(createDefaultAdminSettings(defaultName));
        setCollapsedSections({});

        setSaveSystemStatus({
          type: 'success',
          message: 'All saves purged. Neural connection reset.',
        });
        setTimeout(() => setSaveSystemStatus({ type: null, message: '' }), 4000);
      } catch (err) {
        console.error(err);
      }
    }
  }, [resetUiLayouts, setAdminSettings, setCollapsedSections, setCustomArmorCatalog, setKeybindings, setPlayerLoadout, setPlayerName]);

  const handleLoggedIn = useCallback(async (acct: AccountInfo) => {
    await pullAndApplyCloudSave();
    setAccount(acct);
  }, [pullAndApplyCloudSave]);

  const handleRegistered = useCallback((acct: AccountInfo) => {
    setAccount(acct);
    void pushCloudSave(buildCurrentSaveData());
  }, [buildCurrentSaveData]);

  const handleLoggedOut = useCallback(() => {
    setAccount(null);
    onLoggedOut?.();
  }, [onLoggedOut]);

  const handleAccountChanged = useCallback((acct: AccountInfo) => {
    setAccount(acct);
  }, []);

  useEffect(() => {
    if (!getStoredToken()) return;
    (async () => {
      const res = await fetchMe();
      if (res.ok && res.data) {
        setAccount(res.data.account);
        try { await pullAndApplyCloudSave(); } catch { /* ignore */ }
      }
    })();
  }, []);

  useEffect(() => {
    if (!account) return;
    if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    cloudPushTimer.current = setTimeout(() => {
      void pushCloudSave(buildCurrentSaveData());
    }, 1500);
    return () => {
      if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    };
  }, [account, buildCurrentSaveData]);

  return {
    account,
    saveCodeImportInput,
    saveSystemStatus,
    setSaveCodeImportInput,
    handleExportSaveCode,
    handleImportSaveCode,
    handleResetAllSettings,
    handleLoggedIn,
    handleRegistered,
    handleLoggedOut,
    handleAccountChanged,
  };
}
