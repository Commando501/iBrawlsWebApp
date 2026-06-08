import { Keybindings, UiElementPos, UniversalSettings } from '../types';
import { UiLayoutState } from '../ui/hudLayouts';
import { PersistedGameplaySettings } from './gameplaySettings';
import type { CharacterLoadout } from '../components/VoxelModels';
import type { CustomArmorCatalog } from '../components/customArmor';

export interface SaveData {
  version: number;
  playerName: string;
  playerHue: number;
  uiPositions?: UiElementPos[];
  uiLayouts?: UiLayoutState;
  adminSettings: PersistedGameplaySettings;
  keybindings?: Keybindings;
  playerLoadout?: CharacterLoadout;
  customArmorCatalog?: CustomArmorCatalog;
}

const ENCRYPTION_KEY = 'GRIFBALL_NEURAL_LINK_2026';
const SAVE_PREFIX = 'GRIF-DEC-';

export function encryptSaveData(data: SaveData): string {
  try {
    const jsonStr = JSON.stringify(data);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(jsonStr);
    const keyBytes = encoder.encode(ENCRYPTION_KEY);

    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }

    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return SAVE_PREFIX + btoa(binary);
  } catch (e) {
    console.error('Encryption failed:', e);
    throw new Error('Failed to encode neural backup.');
  }
}

export function decryptSaveCode(code: string): SaveData {
  if (!code || !code.startsWith(SAVE_PREFIX)) {
    throw new Error(`Invalid format. Code must begin with '${SAVE_PREFIX}'.`);
  }
  try {
    const base64Str = code.substring(SAVE_PREFIX.length).trim();
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const keyBytes = new TextEncoder().encode(ENCRYPTION_KEY);

    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }

    const decryptedJson = new TextDecoder().decode(bytes);
    return JSON.parse(decryptedJson) as SaveData;
  } catch (e) {
    console.error('Decryption failed:', e);
    throw new Error('Failed to decrypt neural code. Ensure it is correct and untampered.');
  }
}

export const buildSaveData = (
  settings: UniversalSettings,
  playerName: string,
  uiLayouts: UiLayoutState,
  keybindings: Keybindings,
  playerLoadout?: CharacterLoadout,
  customArmorCatalog?: CustomArmorCatalog
): SaveData => {
  const { playerHue, playerName: _settingsName, ...restSettings } = settings;
  return {
    version: 3,
    playerName,
    playerHue: playerHue ?? 200,
    uiLayouts,
    adminSettings: restSettings,
    keybindings,
    playerLoadout,
    customArmorCatalog,
  };
};
