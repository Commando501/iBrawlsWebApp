import { DEFAULT_KEYBINDINGS, type Keybindings } from '../types';

export const KEYBINDINGS_STORAGE_KEY = 'grifball_keybindings';

function hasOwn(raw: Partial<Keybindings>, key: keyof Keybindings): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

export function normalizeKeybindings(raw: Partial<Keybindings> | null | undefined): Keybindings {
  const input = raw ?? {};
  const normalized: Keybindings = {
    ...DEFAULT_KEYBINDINGS,
    ...input,
  };

  if (!hasOwn(input, 'pickup')) {
    normalized.pickup = DEFAULT_KEYBINDINGS.pickup;
  }
  if (!hasOwn(input, 'gamepadPickup')) {
    normalized.gamepadPickup = DEFAULT_KEYBINDINGS.gamepadPickup;
    if (input.gamepadDash === 2) {
      normalized.gamepadDash = DEFAULT_KEYBINDINGS.gamepadDash;
    }
  }

  return normalized;
}
