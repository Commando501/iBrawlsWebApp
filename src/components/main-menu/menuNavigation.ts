export type MenuScreen = 'play' | 'training' | 'tournament' | 'online' | 'armory' | 'theater' | 'career' | 'create' | 'ai-editor' | 'settings' | 'profile' | 'social';
export type MenuSettingsSection = 'controls' | 'gamepad' | 'mechanics' | 'hud' | 'sound' | 'lighting' | 'saves' | 'connection' | 'about';
export interface MenuLocation { screen: MenuScreen; returnScreen: MenuScreen; settingsSection: MenuSettingsSection }
export const MENU_LOCATION_KEY = 'ibrawls_menu_location_v2';
export const DEFAULT_MENU_LOCATION: MenuLocation = { screen: 'play', returnScreen: 'play', settingsSection: 'controls' };
const screens: readonly MenuScreen[] = ['play','training','tournament','online','armory','theater','career','create','ai-editor','settings','profile','social'];
const sections: readonly MenuSettingsSection[] = ['controls','gamepad','mechanics','hud','sound','lighting','saves','connection','about'];
export const isUtilityScreen = (screen: MenuScreen) => ['settings','profile','social'].includes(screen);

export function parseMenuLocation(raw: string | null, legacy?: { parent: string; playChild: string; customizationChild: string; systemChild: string }): MenuLocation {
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (screens.includes(value?.screen)) return {
        screen: value.screen,
        returnScreen: screens.includes(value.returnScreen) && !isUtilityScreen(value.returnScreen) ? value.returnScreen : 'play',
        settingsSection: sections.includes(value.settingsSection) ? value.settingsSection : 'controls',
      };
    } catch { /* Invalid saved navigation cannot prevent opening the menu. */ }
  }
  if (!legacy) return { ...DEFAULT_MENU_LOCATION };
  if (legacy.parent === 'tools') return { ...DEFAULT_MENU_LOCATION, screen: 'create' };
  if (legacy.parent === 'customization') return { ...DEFAULT_MENU_LOCATION, screen: legacy.customizationChild === 'armory' ? 'armory' : 'settings', settingsSection: legacy.customizationChild === 'gamepad' ? 'gamepad' : 'controls' };
  if (legacy.parent === 'system') return { ...DEFAULT_MENU_LOCATION, screen: legacy.systemChild === 'service' ? 'career' : 'settings', settingsSection: 'saves' };
  if (legacy.playChild === 'theater') return { ...DEFAULT_MENU_LOCATION, screen: 'theater' };
  if (legacy.playChild === 'multi') return { ...DEFAULT_MENU_LOCATION, screen: 'online' };
  return { ...DEFAULT_MENU_LOCATION };
}

export function navigateMenu(previous: MenuLocation, screen: MenuScreen, settingsSection?: MenuSettingsSection): MenuLocation {
  return {
    screen,
    returnScreen: isUtilityScreen(screen) ? (isUtilityScreen(previous.screen) ? previous.returnScreen : previous.screen) : screen === 'ai-editor' ? 'create' : 'play',
    settingsSection: settingsSection ?? previous.settingsSection,
  };
}
export function menuBackTarget(location: MenuLocation): MenuScreen {
  return isUtilityScreen(location.screen) ? location.returnScreen : location.screen === 'ai-editor' ? 'create' : 'play';
}
