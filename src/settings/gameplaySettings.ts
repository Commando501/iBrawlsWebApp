import { UniversalSettings } from '../types';
import { buildExposedTuneDefaults } from '../game/aiBehaviorTuning';

export type PersistedGameplaySettings = Omit<UniversalSettings, 'playerHue' | 'playerName'>;

export const DEFAULT_ADMIN_SETTINGS: UniversalSettings = {
  ...buildExposedTuneDefaults(),
  maxHP: 1,
  speedForward: 100,
  speedSide: 100,
  speedBackward: 100,
  attackRange: 3.2,
  attackRadius: 4.5,
  dashDistance: 6.0,
  dashDuration: 0.25,
  dashCooldown: 2.0,
  respawnInvulnerabilityDuration: 1.0,
  hammerReloadTime: 0.6,
  hammerMeleeSpeed: 0.24,
  hammerMeleeReload: 0.5,
  hammerAttackAnimation: 'current',
  hammerSplashVfx: 'current',
  swordLungeVfx: 'current',
  swordLungeDistance: 14.5,
  swordLungeSpeed: 24.0,
  swordAttackAnimation: 'current',
  swordSlashSpeed: 0.22,
  swordSlashReload: 0.6,
  swordLungeReload: 1.2,
  hammerJumpPower: 6.5,
  hammerJumpTriggerRadius: 3.5,
  hammerJumpWindow: 0.6,
  hammerJumpInputGate: 0.0,
  hammerJumpAirLimit: 1,
  visualizeJumpZone: true,
  directLightIntensity: 1.6,
  ambientLightIntensity: 0.82,
  skyboxBrightness: 4.0,
  skyboxHue: 224,
  showSkybox: true,
  enableSwordTrade: true,
  enableHammerSwordTrade: true,
  swordTradeWindow: 350,
  hammerSwordTradeWindow: 350,
  playerHue: 200,
  nameVisibilityDistance: 15.0,
  nameVisibilityColor: '#00ffff',
  nameVisibilityOpacity: 0.8,
  nameVisibilityFontSize: 16,
  aiDifficulty: 'normal',
  aiReactionLatency: 0.25,
  aiAnticipationFactor: 0.40,
  aiMovementComplexity: 50,
  aiWeaponSwapIQ: 50,
  aiPlaystyle: 50,
  aiWeaponPrioritization: 50,
  aiArchetype: 'none',
  enableBurnDecals: true,
  weaponReadyTime: 0.5,
  weaponSwapLockout: 1.0,
  enableSlide: false,
  enableSprint: false,
  speedSprint: 140,
  speedSlide: 160,
  slideDistance: 8.0,
  slideCooldown: 1.5,

  // Grifball game mode (sandbox default preserves legacy behavior).
  gameMode: 'sandbox',
  grifballGoalTarget: 5,
  grifballRoundResetDelay: 4.0,
  grifballCountdownDuration: 3.0,
  grifballPickupRadius: 1.6,
  grifballBallReturnTimeout: 8.0,
  grifballChargeMax: 1.2,
  grifballPassSpeedMin: 9.0,
  grifballPassSpeedMax: 26.0,
  grifballPunchLungeRange: 4.5,
  grifballEscortSpacing: 4.0,
};

export const withDefaultGameplaySettings = (
  settings: Partial<PersistedGameplaySettings>
): PersistedGameplaySettings => {
  const { playerHue: _playerHue, playerName: _playerName, ...persistedDefaults } = DEFAULT_ADMIN_SETTINGS;
  return {
    ...persistedDefaults,
    ...settings,
    hammerAttackAnimation: settings.hammerAttackAnimation ?? persistedDefaults.hammerAttackAnimation,
    hammerSplashVfx: settings.hammerSplashVfx ?? persistedDefaults.hammerSplashVfx,
    swordAttackAnimation: settings.swordAttackAnimation ?? persistedDefaults.swordAttackAnimation,
    swordLungeVfx: settings.swordLungeVfx ?? persistedDefaults.swordLungeVfx,
  };
};

export const createDefaultAdminSettings = (
  playerName: string,
  playerHue = DEFAULT_ADMIN_SETTINGS.playerHue ?? 200
): UniversalSettings => ({
  ...DEFAULT_ADMIN_SETTINGS,
  playerHue,
  playerName,
});

export const stripPlayerIdentitySettings = (
  settings: UniversalSettings
): PersistedGameplaySettings => {
  const { playerHue: _playerHue, playerName: _playerName, ...restSettings } = settings;
  return restSettings;
};

export const gameplaySettingsAreEqual = (
  first: Partial<PersistedGameplaySettings>,
  second: Partial<PersistedGameplaySettings>
): boolean => {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  for (const key of keys) {
    if (
      first[key as keyof PersistedGameplaySettings] !==
      second[key as keyof PersistedGameplaySettings]
    ) {
      return false;
    }
  }
  return true;
};
