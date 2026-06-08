import { useEffect, useState } from 'react';
import {
  type CharacterLoadout,
  DEFAULT_LOADOUT,
} from '../VoxelModels';
import {
  type CustomArmorCatalog,
  loadCustomArmorCatalog,
  persistCustomArmorCatalog,
} from '../customArmor';
import { type PreviewWeapon } from './CustomizationPanel';

export type MainMenuReferenceTab = 'manual' | 'gamepad' | 'customize';

export const PLAYER_LOADOUT_STORAGE_KEY = 'grifball_player_loadout';

interface LoadoutStorage {
  getItem(key: string): string | null;
}

export function loadStoredPlayerLoadout(storage: LoadoutStorage = localStorage): CharacterLoadout {
  try {
    const saved = storage.getItem(PLAYER_LOADOUT_STORAGE_KEY);
    return saved ? { ...DEFAULT_LOADOUT, ...JSON.parse(saved) } : DEFAULT_LOADOUT;
  } catch {
    return DEFAULT_LOADOUT;
  }
}

export function useCustomizationState() {
  const [rightPanelTab, setRightPanelTab] = useState<MainMenuReferenceTab>('manual');
  const [customizerWeapon, setCustomizerWeapon] = useState<PreviewWeapon>('none');
  const [isPainting, setIsPainting] = useState<boolean>(false);
  const [playerLoadout, setPlayerLoadout] = useState<CharacterLoadout>(() => loadStoredPlayerLoadout());
  const [customArmorCatalog, setCustomArmorCatalog] = useState<CustomArmorCatalog>(() => loadCustomArmorCatalog());

  useEffect(() => {
    persistCustomArmorCatalog(customArmorCatalog);
  }, [customArmorCatalog]);

  return {
    rightPanelTab,
    setRightPanelTab,
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
