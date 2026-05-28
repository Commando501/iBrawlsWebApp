import {
  UiElementPos,
  UI_ELEMENT_SCALE_MAX,
  UI_ELEMENT_SCALE_MIN,
} from '../types';

export const MOBILE_HUD_LAYOUT_VERSION = '5';
export const MOBILE_HUD_LAYOUT_VERSION_KEY = 'grifball_mobile_hud_layout_version';

export interface UiLayoutState {
  desktop: UiElementPos[];
  mobile: UiElementPos[];
}

export const DEFAULT_DESKTOP_UI_POSITIONS: UiElementPos[] = [
  { id: 'objective', name: 'Objective Block', x: 3, y: 3, locked: true, scale: 1 },
  { id: 'scoreboard', name: 'Scoreboard', x: 50, y: 3, locked: true, scale: 1 },
  { id: 'arenaStatus', name: 'Arena Status & Controls', x: 97, y: 3, locked: true, scale: 1 },
  { id: 'technicalSpecs', name: 'Technical Specs', x: 97, y: 19, locked: true, scale: 1 },
  { id: 'eliminationFeed', name: 'Elimination Feed', x: 3, y: 45, locked: true, scale: 1 },
  { id: 'radar', name: 'Tactical Radar', x: 3, y: 65, locked: true, scale: 1 },
  { id: 'weaponDash', name: 'Gear & Thrusters', x: 3, y: 82, locked: true, scale: 1 },
  { id: 'vitality', name: 'Vitality Indicator', x: 97, y: 90, locked: true, scale: 1 },
  { id: 'crosshair', name: 'Reticle / Target Dot', x: 50, y: 50, locked: true, scale: 1 },
  { id: 'spectatorCard', name: 'Spectator Controller', x: 50, y: 88, locked: true, scale: 1 },
  { id: 'mobileLeftAnalog', name: 'Mobile Left Stick', x: 15, y: 75, locked: true, scale: 1 },
  { id: 'mobileRightButtons', name: 'Mobile Right Buttons', x: 80, y: 75, locked: true, scale: 1 },
  { id: 'medalPopup', name: 'Medal Popup Notification', x: 50, y: 67, locked: true, scale: 1 },
  { id: 'hudAdjuster', name: 'HUD Canvas Adjuster', x: 50, y: 3, locked: false, scale: 1 },
];

export const DEFAULT_MOBILE_UI_POSITIONS: UiElementPos[] = [
  { id: 'objective', name: 'Objective Block', x: 3, y: 4, locked: true, scale: 0.58 },
  { id: 'scoreboard', name: 'Scoreboard', x: 50, y: 2, locked: true, scale: 0.56 },
  { id: 'arenaStatus', name: 'Arena Status & Controls', x: 80, y: 4, locked: true, scale: 0.56 },
  { id: 'technicalSpecs', name: 'Technical Specs', x: 76, y: 18, locked: true, scale: 0.52 },
  { id: 'eliminationFeed', name: 'Elimination Feed', x: 50, y: 38, locked: true, scale: 0.56 },
  { id: 'radar', name: 'Tactical Radar', x: 3, y: 76, locked: true, scale: 0.52 },
  { id: 'weaponDash', name: 'Gear & Thrusters', x: 50, y: 76, locked: true, scale: 0.56 },
  { id: 'vitality', name: 'Vitality Indicator', x: 82, y: 86, locked: true, scale: 0.58 },
  { id: 'crosshair', name: 'Reticle / Target Dot', x: 50, y: 50, locked: true, scale: 1 },
  { id: 'spectatorCard', name: 'Spectator Controller', x: 50, y: 86, locked: true, scale: 0.7 },
  { id: 'mobileLeftAnalog', name: 'Mobile Left Stick', x: 3, y: 96, locked: true, scale: 1 },
  { id: 'mobileRightButtons', name: 'Mobile Right Buttons', x: 98, y: 96, locked: true, scale: 1 },
  { id: 'medalPopup', name: 'Medal Popup Notification', x: 50, y: 62, locked: true, scale: 0.8 },
  { id: 'hudAdjuster', name: 'HUD Canvas Adjuster', x: 50, y: 4, locked: false, scale: 1 },
];

export const clampUiScale = (scale: unknown, fallback = 1): number => {
  const numeric = typeof scale === 'number' && Number.isFinite(scale) ? scale : fallback;
  return Math.round(Math.max(UI_ELEMENT_SCALE_MIN, Math.min(UI_ELEMENT_SCALE_MAX, numeric)) * 100) / 100;
};

export const cloneUiPositions = (positions: UiElementPos[]): UiElementPos[] =>
  positions.map(position => ({
    ...position,
    scale: clampUiScale(position.scale),
  }));

export const mergeUiPositions = (
  defaults: UiElementPos[],
  saved?: UiElementPos[]
): UiElementPos[] => {
  const positions = cloneUiPositions(defaults);
  if (!Array.isArray(saved)) return positions;

  saved.forEach(item => {
    const index = positions.findIndex(position => position.id === item.id);
    if (index !== -1) {
      positions[index] = {
        ...positions[index],
        ...item,
        scale: clampUiScale(item.scale, positions[index].scale ?? 1),
      };
    }
  });
  return positions;
};

export const getDefaultUiLayouts = (): UiLayoutState => ({
  desktop: cloneUiPositions(DEFAULT_DESKTOP_UI_POSITIONS),
  mobile: cloneUiPositions(DEFAULT_MOBILE_UI_POSITIONS),
});

export const normalizeUiLayouts = (
  raw: unknown,
  resetSavedMobileLayout = false
): UiLayoutState => {
  const defaults = getDefaultUiLayouts();
  if (Array.isArray(raw)) {
    return {
      desktop: mergeUiPositions(DEFAULT_DESKTOP_UI_POSITIONS, raw),
      mobile: defaults.mobile,
    };
  }

  if (raw && typeof raw === 'object') {
    const saved = raw as Partial<UiLayoutState>;
    return {
      desktop: mergeUiPositions(DEFAULT_DESKTOP_UI_POSITIONS, saved.desktop),
      mobile: resetSavedMobileLayout
        ? defaults.mobile
        : mergeUiPositions(DEFAULT_MOBILE_UI_POSITIONS, saved.mobile),
    };
  }

  return defaults;
};
