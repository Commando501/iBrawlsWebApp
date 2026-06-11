import { useEffect, useState } from 'react';
import {
  type CharacterLoadout,
  DEFAULT_LOADOUT,
} from '../VoxelModels';
import {
  CUSTOM_ARMOR_CATALOG_STORAGE_KEY,
  type CustomArmorCatalog,
  loadCustomArmorCatalog,
  persistCustomArmorCatalog,
  sanitizeCharacterLoadoutForNetwork,
} from '../customArmor';
import { type PreviewWeapon } from './ArmoryPanel';

export const PLAYER_LOADOUT_STORAGE_KEY = 'grifball_player_loadout';

interface LoadoutStorage {
  getItem(key: string): string | null;
}

export function loadStoredPlayerLoadout(storage: LoadoutStorage = localStorage): CharacterLoadout {
  try {
    const saved = storage.getItem(PLAYER_LOADOUT_STORAGE_KEY);
    return saved ? normalizeStoredPlayerLoadout(JSON.parse(saved)) : DEFAULT_LOADOUT;
  } catch {
    return DEFAULT_LOADOUT;
  }
}

export function normalizeStoredPlayerLoadout(value: unknown): CharacterLoadout {
  const sanitized = sanitizeCharacterLoadoutForNetwork(value) as CharacterLoadout | undefined;
  return sanitized ? { ...DEFAULT_LOADOUT, ...sanitized } : DEFAULT_LOADOUT;
}

export function useCustomizationState() {
  const [customizerWeapon, setCustomizerWeapon] = useState<PreviewWeapon>('none');
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [playerLoadout, setPlayerLoadout] = useState<CharacterLoadout>(() => loadStoredPlayerLoadout());
  const [customArmorCatalog, setCustomArmorCatalog] = useState<CustomArmorCatalog>(() => loadCustomArmorCatalog());

  useEffect(() => {
    persistCustomArmorCatalog(customArmorCatalog);
  }, [customArmorCatalog]);

  useEffect(() => {
    const refreshStoredCustomization = () => {
      setPlayerLoadout(loadStoredPlayerLoadout());
      setCustomArmorCatalog(loadCustomArmorCatalog());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PLAYER_LOADOUT_STORAGE_KEY || event.key === CUSTOM_ARMOR_CATALOG_STORAGE_KEY) {
        refreshStoredCustomization();
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', refreshStoredCustomization);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', refreshStoredCustomization);
    };
  }, []);

  return {
    customizerWeapon,
    setCustomizerWeapon,
    isPainting,
    setIsPainting,
    playerLoadout,
    setPlayerLoadout,
    customArmorCatalog,
    setCustomArmorCatalog,
  };
}
