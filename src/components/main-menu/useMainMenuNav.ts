import { useCallback, useState } from 'react';

export type MainMenuParent = 'play' | 'customization' | 'tools' | 'system';
export type MainMenuTab = 'single' | 'multi' | 'spec' | 'theater';
export type CustomizationChild = 'armory' | 'hotkeys' | 'gamepad' | 'identity';

export interface MainMenuNavState {
  parent: MainMenuParent;
  playChild: MainMenuTab;
  customizationChild: CustomizationChild;
}

export const MAIN_MENU_NAV_STORAGE_KEY = 'ibrawls_main_menu_nav_v1';
const LEGACY_FRAME_LAYOUT_STORAGE_KEY = 'ibrawls_main_menu_frame_layout_v1';

export const DEFAULT_MAIN_MENU_NAV: MainMenuNavState = {
  parent: 'play',
  playChild: 'single',
  customizationChild: 'armory',
};

const MAIN_MENU_PARENTS: readonly MainMenuParent[] = ['play', 'customization', 'tools', 'system'];
const MAIN_MENU_PLAY_CHILDREN: readonly MainMenuTab[] = ['single', 'multi', 'spec', 'theater'];
const MAIN_MENU_CUSTOMIZATION_CHILDREN: readonly CustomizationChild[] = ['armory', 'hotkeys', 'gamepad', 'identity'];

export function parseStoredMainMenuNav(raw: string | null): MainMenuNavState {
  if (!raw) return DEFAULT_MAIN_MENU_NAV;
  try {
    const parsed = JSON.parse(raw) as Partial<MainMenuNavState> | null;
    return {
      parent: MAIN_MENU_PARENTS.includes(parsed?.parent as MainMenuParent)
        ? (parsed?.parent as MainMenuParent)
        : DEFAULT_MAIN_MENU_NAV.parent,
      playChild: MAIN_MENU_PLAY_CHILDREN.includes(parsed?.playChild as MainMenuTab)
        ? (parsed?.playChild as MainMenuTab)
        : DEFAULT_MAIN_MENU_NAV.playChild,
      customizationChild: MAIN_MENU_CUSTOMIZATION_CHILDREN.includes(parsed?.customizationChild as CustomizationChild)
        ? (parsed?.customizationChild as CustomizationChild)
        : DEFAULT_MAIN_MENU_NAV.customizationChild,
    };
  } catch {
    return DEFAULT_MAIN_MENU_NAV;
  }
}

interface UseMainMenuNavOptions {
  onNavChange?: () => void;
}

export function useMainMenuNav({ onNavChange }: UseMainMenuNavOptions = {}) {
  const [nav, setNav] = useState<MainMenuNavState>(() => {
    try {
      localStorage.removeItem(LEGACY_FRAME_LAYOUT_STORAGE_KEY);
      return parseStoredMainMenuNav(localStorage.getItem(MAIN_MENU_NAV_STORAGE_KEY));
    } catch {
      return DEFAULT_MAIN_MENU_NAV;
    }
  });

  const updateNav = useCallback((patch: Partial<MainMenuNavState>) => {
    setNav((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(MAIN_MENU_NAV_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Persistence is best-effort; in-memory nav still changes.
      }
      return next;
    });
    onNavChange?.();
  }, [onNavChange]);

  const selectParent = useCallback((parent: MainMenuParent) => {
    updateNav({ parent });
  }, [updateNav]);

  const selectPlayChild = useCallback((playChild: MainMenuTab) => {
    updateNav({ parent: 'play', playChild });
  }, [updateNav]);

  const selectCustomizationChild = useCallback((customizationChild: CustomizationChild) => {
    updateNav({ parent: 'customization', customizationChild });
  }, [updateNav]);

  return {
    nav,
    selectParent,
    selectPlayChild,
    selectCustomizationChild,
  };
}
