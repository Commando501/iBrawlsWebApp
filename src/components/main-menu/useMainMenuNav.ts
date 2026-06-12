import { useCallback, useState } from 'react';

export type MainMenuParent = 'play' | 'customization' | 'tools' | 'system';
export type MainMenuContentParent = Exclude<MainMenuParent, 'tools'>;
export type MainMenuTab = 'single' | 'multi' | 'theater';
export type CustomizationChild = 'armory' | 'hotkeys' | 'gamepad';
export type SystemChild = 'saves' | 'service';

export interface MainMenuNavState {
  parent: MainMenuParent;
  contentParent: MainMenuContentParent;
  playChild: MainMenuTab;
  customizationChild: CustomizationChild;
  systemChild: SystemChild;
}

export const MAIN_MENU_NAV_STORAGE_KEY = 'ibrawls_main_menu_nav_v1';
const LEGACY_FRAME_LAYOUT_STORAGE_KEY = 'ibrawls_main_menu_frame_layout_v1';

export const DEFAULT_MAIN_MENU_NAV: MainMenuNavState = {
  parent: 'play',
  contentParent: 'play',
  playChild: 'single',
  customizationChild: 'armory',
  systemChild: 'saves',
};

const MAIN_MENU_PARENTS: readonly MainMenuParent[] = ['play', 'customization', 'tools', 'system'];
const MAIN_MENU_CONTENT_PARENTS: readonly MainMenuContentParent[] = ['play', 'customization', 'system'];
const MAIN_MENU_PLAY_CHILDREN: readonly MainMenuTab[] = ['single', 'multi', 'theater'];
const MAIN_MENU_CUSTOMIZATION_CHILDREN: readonly CustomizationChild[] = ['armory', 'hotkeys', 'gamepad'];
const MAIN_MENU_SYSTEM_CHILDREN: readonly SystemChild[] = ['saves', 'service'];

function isMainMenuParent(value: unknown): value is MainMenuParent {
  return MAIN_MENU_PARENTS.includes(value as MainMenuParent);
}

function isMainMenuContentParent(value: unknown): value is MainMenuContentParent {
  return MAIN_MENU_CONTENT_PARENTS.includes(value as MainMenuContentParent);
}

export function getMainMenuContentParent(nav: Pick<MainMenuNavState, 'parent'> & Partial<Pick<MainMenuNavState, 'contentParent'>>): MainMenuContentParent {
  if (isMainMenuContentParent(nav.contentParent)) {
    return nav.contentParent;
  }
  return isMainMenuContentParent(nav.parent) ? nav.parent : DEFAULT_MAIN_MENU_NAV.contentParent;
}

export function selectMainMenuParentState(previous: MainMenuNavState, parent: MainMenuParent): MainMenuNavState {
  return {
    ...previous,
    parent,
    contentParent: parent === 'tools' ? getMainMenuContentParent(previous) : parent,
  };
}

export function parseStoredMainMenuNav(raw: string | null): MainMenuNavState {
  if (!raw) return DEFAULT_MAIN_MENU_NAV;
  try {
    const parsed = JSON.parse(raw) as Partial<MainMenuNavState> | null;
    const parent = isMainMenuParent(parsed?.parent)
      ? parsed.parent
      : DEFAULT_MAIN_MENU_NAV.parent;
    return {
      parent,
      contentParent: isMainMenuContentParent(parsed?.contentParent)
        ? parsed.contentParent
        : getMainMenuContentParent({ parent }),
      playChild: MAIN_MENU_PLAY_CHILDREN.includes(parsed?.playChild as MainMenuTab)
        ? (parsed?.playChild as MainMenuTab)
        : DEFAULT_MAIN_MENU_NAV.playChild,
      customizationChild: MAIN_MENU_CUSTOMIZATION_CHILDREN.includes(parsed?.customizationChild as CustomizationChild)
        ? (parsed?.customizationChild as CustomizationChild)
        : DEFAULT_MAIN_MENU_NAV.customizationChild,
      systemChild: MAIN_MENU_SYSTEM_CHILDREN.includes(parsed?.systemChild as SystemChild)
        ? (parsed?.systemChild as SystemChild)
        : DEFAULT_MAIN_MENU_NAV.systemChild,
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
    setNav((previous) => {
      const next = selectMainMenuParentState(previous, parent);
      try {
        localStorage.setItem(MAIN_MENU_NAV_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Persistence is best-effort; in-memory nav still changes.
      }
      return next;
    });
    onNavChange?.();
  }, [onNavChange]);

  const selectPlayChild = useCallback((playChild: MainMenuTab) => {
    updateNav({ parent: 'play', contentParent: 'play', playChild });
  }, [updateNav]);

  const selectCustomizationChild = useCallback((customizationChild: CustomizationChild) => {
    updateNav({ parent: 'customization', contentParent: 'customization', customizationChild });
  }, [updateNav]);

  const selectSystemChild = useCallback((systemChild: SystemChild) => {
    updateNav({ parent: 'system', contentParent: 'system', systemChild });
  }, [updateNav]);

  return {
    nav,
    selectParent,
    selectPlayChild,
    selectCustomizationChild,
    selectSystemChild,
  };
}
