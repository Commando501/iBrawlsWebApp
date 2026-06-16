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
import {
  V3_SUIT_PROFILE_CATALOG_STORAGE_KEY,
  type V3SuitProfileCatalog,
  loadV3SuitProfileCatalog,
  persistV3SuitProfileCatalog,
} from './v3ArmorSuitProfiles';
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
  const [v3SuitProfileCatalog, setV3SuitProfileCatalog] = useState<V3SuitProfileCatalog>(() => loadV3SuitProfileCatalog());

  useEffect(() => {
    persistCustomArmorCatalog(customArmorCatalog);
  }, [customArmorCatalog]);

  useEffect(() => {
    persistV3SuitProfileCatalog(v3SuitProfileCatalog);
  }, [v3SuitProfileCatalog]);

  useEffect(() => {
    const refreshStoredCustomization = () => {
      setPlayerLoadout(loadStoredPlayerLoadout());
      setCustomArmorCatalog(loadCustomArmorCatalog());
      setV3SuitProfileCatalog(loadV3SuitProfileCatalog());
    };

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === PLAYER_LOADOUT_STORAGE_KEY ||
        event.key === CUSTOM_ARMOR_CATALOG_STORAGE_KEY ||
        event.key === V3_SUIT_PROFILE_CATALOG_STORAGE_KEY
      ) {
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
    v3SuitProfileCatalog,
    setV3SuitProfileCatalog,
  };
}
