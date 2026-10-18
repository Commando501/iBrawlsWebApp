import { useCallback, useState } from 'react';
import { MENU_LOCATION_KEY, parseMenuLocation, navigateMenu, menuBackTarget, type MenuScreen, type MenuSettingsSection } from './menuNavigation';

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

  const [location, setLocation] = useState(() => {
    try { return parseMenuLocation(localStorage.getItem(MENU_LOCATION_KEY), nav); }
    catch { return parseMenuLocation(null, nav); }
  });
  const selectDestination = useCallback((screen: MenuScreen, section?: MenuSettingsSection) => {
    setLocation(previous => {
      const next = navigateMenu(previous, screen, section);
      try { localStorage.setItem(MENU_LOCATION_KEY, JSON.stringify(next)); } catch { /* In-memory navigation remains available. */ }
      return next;
    });
    onNavChange?.();
  }, [onNavChange]);
  const goBack = useCallback(() => {
    setLocation(previous => {
      const next = navigateMenu(previous, menuBackTarget(previous));
      try { localStorage.setItem(MENU_LOCATION_KEY, JSON.stringify(next)); } catch { /* In-memory navigation remains available. */ }
      return next;
    });
    onNavChange?.();
  }, [onNavChange]);

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
    selectDestination(parent === 'tools' ? 'create' : parent === 'customization' ? 'armory' : parent === 'system' ? 'settings' : 'play');
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
  }, [onNavChange, selectDestination]);

  const selectPlayChild = useCallback((playChild: MainMenuTab) => {
    selectDestination(playChild === 'theater' ? 'theater' : playChild === 'multi' ? 'online' : 'training');
    updateNav({ parent: 'play', contentParent: 'play', playChild });
  }, [updateNav, selectDestination]);

  const selectCustomizationChild = useCallback((customizationChild: CustomizationChild) => {
    selectDestination(customizationChild === 'armory' ? 'armory' : 'settings', customizationChild === 'gamepad' ? 'gamepad' : 'controls');
    updateNav({ parent: 'customization', contentParent: 'customization', customizationChild });
  }, [updateNav, selectDestination]);

  const selectSystemChild = useCallback((systemChild: SystemChild) => {
    selectDestination(systemChild === 'service' ? 'career' : 'settings', 'saves');
    updateNav({ parent: 'system', contentParent: 'system', systemChild });
  }, [updateNav, selectDestination]);

  return {
    nav,
    location,
    selectDestination,
    goBack,
    selectParent,
    selectPlayChild,
    selectCustomizationChild,
    selectSystemChild,
  };
}
