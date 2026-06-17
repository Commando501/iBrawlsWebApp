import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Keybindings, UniversalSettings } from '../types';
import type { UiLayoutState } from '../ui/hudLayouts';
import { DEFAULT_KEYBINDINGS } from '../types';
import { createDefaultAdminSettings, withDefaultGameplaySettings } from './gameplaySettings';
import { KEYBINDINGS_STORAGE_KEY, normalizeKeybindings } from './keybindingNormalization';
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
  V3_SUIT_PROFILE_CATALOG_STORAGE_KEY,
  type V3SuitProfileCatalog,
  createEmptyV3SuitProfileCatalog,
  normalizeV3SuitProfileCatalog,
  persistV3SuitProfileCatalog,
} from '../components/main-menu/v3ArmorSuitProfiles';
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

export interface CloudSaveSyncDecision {
  payload: string;
  shouldPush: boolean;
}

export function getCloudSaveSyncDecision(
  lastPushedPayload: string | null,
  saveData: SaveData
): CloudSaveSyncDecision {
  const payload = JSON.stringify(saveData);
  return {
    payload,
    shouldPush: payload !== lastPushedPayload,
  };
}

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
  v3SuitProfileCatalog: V3SuitProfileCatalog;
  setV3SuitProfileCatalog: Dispatch<SetStateAction<V3SuitProfileCatalog>>;
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
  v3SuitProfileCatalog,
  setV3SuitProfileCatalog,
  setCollapsedSections,
  onLoggedOut,
}: UseSaveAccountSyncOptions) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [saveCodeImportInput, setSaveCodeImportInput] = useState('');
  const [saveSystemStatus, setSaveSystemStatus] = useState<SaveSystemStatus>({ type: null, message: '' });
  const cloudPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloudSavePayload = useRef<string | null>(null);

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
      const merged = normalizeKeybindings(decrypted.keybindings);
      setKeybindings(merged);
      localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(merged));
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

    if (decrypted.v3SuitProfileCatalog) {
      const normalizedProfiles = normalizeV3SuitProfileCatalog(decrypted.v3SuitProfileCatalog);
      setV3SuitProfileCatalog(normalizedProfiles);
      persistV3SuitProfileCatalog(normalizedProfiles);
    }
  }, [adminSettings, applySavedUiLayouts, onPlayerNameChange, setAdminSettings, setCustomArmorCatalog, setKeybindings, setPlayerLoadout, setV3SuitProfileCatalog]);

  const buildCurrentSaveData = useCallback(
    () => buildSaveData(adminSettings, playerName, uiLayouts, keybindings, playerLoadout, customArmorCatalog, v3SuitProfileCatalog),
    [adminSettings, playerName, uiLayouts, keybindings, playerLoadout, customArmorCatalog, v3SuitProfileCatalog]
  );

  const pullAndApplyCloudSave = useCallback(async () => {
    const res = await fetchCloudSave<SaveData>();
    if (res.ok && res.data && res.data.save) {
      lastCloudSavePayload.current = JSON.stringify(res.data.save);
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
        localStorage.removeItem(KEYBINDINGS_STORAGE_KEY);
        localStorage.removeItem('grifball_player_loadout');
        localStorage.removeItem(CUSTOM_ARMOR_CATALOG_STORAGE_KEY);
        localStorage.removeItem(V3_SUIT_PROFILE_CATALOG_STORAGE_KEY);
        localStorage.removeItem('grifball_settings_version');
        localStorage.removeItem('grifball_collapsed_sections');

        const defaultName = `Sptn-${Math.floor(1000 + Math.random() * 9000)}`;
        setPlayerName(defaultName);
        resetUiLayouts();
        setKeybindings({ ...DEFAULT_KEYBINDINGS });
        setPlayerLoadout(DEFAULT_LOADOUT);
        setCustomArmorCatalog(createEmptyCustomArmorCatalog());
        setV3SuitProfileCatalog(createEmptyV3SuitProfileCatalog());
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
  }, [resetUiLayouts, setAdminSettings, setCollapsedSections, setCustomArmorCatalog, setKeybindings, setPlayerLoadout, setPlayerName, setV3SuitProfileCatalog]);

  const handleCloudSavePushResult = useCallback((
    res: Awaited<ReturnType<typeof pushCloudSave>>,
    sourceAccount: AccountInfo | null = account,
  ) => {
    if (res.ok) {
      if (res.data?.account) setAccount(res.data.account);
      return;
    }

    if (res.error && /display name/i.test(res.error)) {
      const fallbackName = sourceAccount?.registeredDisplayName || sourceAccount?.username;
      if (fallbackName) {
        onPlayerNameChange(fallbackName);
      }
      setSaveSystemStatus({
        type: 'error',
        message: res.error,
      });
      setTimeout(() => setSaveSystemStatus({ type: null, message: '' }), 6000);
    }
  }, [account, onPlayerNameChange]);

  const handleLoggedIn = useCallback(async (acct: AccountInfo) => {
    await pullAndApplyCloudSave();
    setAccount(acct);
  }, [pullAndApplyCloudSave]);

  const handleRegistered = useCallback((acct: AccountInfo) => {
    setAccount(acct);
    void (async () => {
      const saveData = buildCurrentSaveData();
      const decision = getCloudSaveSyncDecision(lastCloudSavePayload.current, saveData);
      if (!decision.shouldPush) return;
      const res = await pushCloudSave(saveData);
      if (res.ok) lastCloudSavePayload.current = decision.payload;
      handleCloudSavePushResult(res, acct);
    })();
  }, [buildCurrentSaveData, handleCloudSavePushResult]);

  const handleLoggedOut = useCallback(() => {
    setAccount(null);
    lastCloudSavePayload.current = null;
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
        try { await pullAndApplyCloudSave(); } catch { /* ignore */ }
        setAccount(res.data.account);
      }
    })();
  }, []);

  useEffect(() => {
    if (!account) return;
    if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    cloudPushTimer.current = setTimeout(() => {
      void (async () => {
        const saveData = buildCurrentSaveData();
        const decision = getCloudSaveSyncDecision(lastCloudSavePayload.current, saveData);
        if (!decision.shouldPush) return;
        const res = await pushCloudSave(saveData);
        if (res.ok) lastCloudSavePayload.current = decision.payload;
        handleCloudSavePushResult(res);
      })();
    }, 1500);
    return () => {
      if (cloudPushTimer.current) clearTimeout(cloudPushTimer.current);
    };
  }, [account, buildCurrentSaveData, handleCloudSavePushResult]);

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
