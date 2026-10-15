import { useEffect, useState } from 'react';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
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
  if (sanitized?.modelSystem === 'v3' || sanitized?.characterAsset === 'iron-vanguard') {
    return resolveLoadoutForVisualPolicy({ visualModelPolicy: 'v3', loadout: sanitized });
  }
  return sanitized ? { ...DEFAULT_LOADOUT, ...sanitized } : DEFAULT_LOADOUT;
}

// Storage loaders parse fresh objects. Preserve identity when their contents have
// not changed: the game scene uses the loadout as an initialization dependency.
export function retainUnchangedCustomization<T>(current: T, stored: T): T {
  return JSON.stringify(current) === JSON.stringify(stored) ? current : stored;
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
      const storedLoadout = loadStoredPlayerLoadout();
      const storedArmorCatalog = loadCustomArmorCatalog();
      const storedSuitCatalog = loadV3SuitProfileCatalog();
      setPlayerLoadout(current => retainUnchangedCustomization(current, storedLoadout));
      setCustomArmorCatalog(current => retainUnchangedCustomization(current, storedArmorCatalog));
      setV3SuitProfileCatalog(current => retainUnchangedCustomization(current, storedSuitCatalog));
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
