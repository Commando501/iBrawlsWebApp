-- iBrawls D1 — initial schema.
-- Phase 1 active tables: game_config + config_history (Live Tuning / Official Multiplayer Preset).
-- Remaining tables are reserved stubs for future phases (accounts, stats, saves, unlocks);
-- they are created now so later migrations are purely additive but are otherwise unused.

-- ── Active: Live tuning ──────────────────────────────────────────────────────

-- Current authoritative config, keyed singleton-style. Phase 1 uses one row: 'multiplayer_preset'.
CREATE TABLE IF NOT EXISTS game_config (
  id          TEXT    PRIMARY KEY,
  version     INTEGER NOT NULL,
  label       TEXT,
  payload     TEXT    NOT NULL,   -- JSON of the gameplay-mechanic subset (PersistedGameplaySettings)
  updated_at  INTEGER NOT NULL,   -- epoch ms
  updated_by  TEXT
);

-- Append-only audit / rollback source. Every published version lands here.
CREATE TABLE IF NOT EXISTS config_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id   TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  label       TEXT,
  payload     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_history_config ON config_history (config_id, version);

-- ── Stubs: reserved for future phases (unused in Phase 1) ────────────────────

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT    PRIMARY KEY,
  handle      TEXT    UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

CREATE TABLE IF NOT EXISTS player_stats (
  account_id  TEXT    PRIMARY KEY,
  kills       INTEGER NOT NULL DEFAULT 0,
  deaths      INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  matches     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER
);

CREATE TABLE IF NOT EXISTS cloud_saves (
  account_id  TEXT    PRIMARY KEY,
  payload     TEXT    NOT NULL,   -- future home for the SaveData blob (see src/settings/saveCodec.ts)
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS unlocks (
  account_id  TEXT    NOT NULL,
  unlock_key  TEXT    NOT NULL,
  granted_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, unlock_key)
);

-- ── Seed: official multiplayer preset v1 = current DEFAULT_ADMIN_SETTINGS subset ──
INSERT OR IGNORE INTO game_config (id, version, label, payload, updated_at, updated_by)
VALUES (
  'multiplayer_preset',
  1,
  'Default Ruleset',
  '{"aiTuneMechanicAwareIq":70,"aiTuneHighIqOverride":80,"aiTuneHammerWindupSeconds":0.32,"aiTuneScoreAheadThreshold":5,"aiTuneScoreCloseThreshold":2,"aiTuneFeintIqGate":60,"aiTuneFeintCooldownMin":3,"aiTuneFeintCooldownMax":5,"aiTuneWeaponSwapFeintDelay":0.45,"aiTuneApproachFeintBackTimer":0.55,"aiTuneLungeFakeoutForwardTimer":0.38,"aiTuneChargeAbortSidestepTimer":0.35,"aiTuneBaseGroundSpeed":5.8,"aiTuneSprintEngageGap":5,"aiTuneSprintChaseTargetSpeed":4.5,"aiTuneSlideMinGap":4,"aiTuneSlideMaxGap":13,"aiTuneSlideMinComplexity":40,"aiTuneSlideTriggerChance":0.02,"aiTuneBaseEvasionDetectRange":15,"aiTuneBaitDodgeDistance":12,"aiTuneBaitDodgeBand":1.5,"aiTuneEvasionTriggerJitter":0.2,"aiTuneArenaEdgeInset":0.6,"aiTuneComboMinWeaponSwapIq":70,"aiTuneComboAdvancedWeaponSwapIq":90,"aiTuneTempoCycleDuration":9,"aiTunePostKillPressureDuration":2.75,"aiTuneTempoSlowMult":1.38,"aiTuneTempoFastMult":0.62,"aiTuneStandoffRangeMinOffset":1.5,"aiTuneStandoffRangeMaxOffset":5.5,"aiTuneCalibrationWindowSize":10,"aiTuneMaxCalibrationDrift":0.125,"aiTuneDodgeResolveDelay":0.35,"aiTuneCounterResolveDelay":0.5,"aiTunePlayerModelEmaAlpha":0.08,"aiTuneDefaultLungeDistance":8,"aiTuneDefaultReactionTime":0.35,"aiTunePriorityTargetTtl":8,"aiTuneDamageTagTtl":6,"aiTuneAttackStaggerStep":0.38,"aiTuneMaxAirborneHeight":14,"aiTuneForcedDescentSpeed":-12,"maxHP":1,"speedForward":100,"speedSide":100,"speedBackward":100,"attackRange":3.2,"attackRadius":4.5,"dashDistance":6,"dashDuration":0.25,"dashCooldown":2,"respawnInvulnerabilityDuration":1,"hammerReloadTime":0.6,"hammerMeleeSpeed":0.24,"hammerMeleeReload":0.5,"hammerSplashVfx":"current","swordLungeVfx":"current","swordLungeDistance":14.5,"swordLungeSpeed":24,"swordSlashSpeed":0.22,"swordSlashReload":0.6,"swordLungeReload":1.2,"hammerJumpPower":6.5,"hammerJumpTriggerRadius":3.5,"hammerJumpWindow":0.6,"hammerJumpInputGate":0,"hammerJumpAirLimit":1,"visualizeJumpZone":true,"directLightIntensity":1.6,"ambientLightIntensity":0.82,"skyboxBrightness":4,"skyboxHue":224,"showSkybox":true,"enableSwordTrade":true,"enableHammerSwordTrade":true,"swordTradeWindow":350,"hammerSwordTradeWindow":350,"nameVisibilityDistance":15,"nameVisibilityColor":"#00ffff","nameVisibilityOpacity":0.8,"nameVisibilityFontSize":16,"aiDifficulty":"normal","aiReactionLatency":0.25,"aiAnticipationFactor":0.4,"aiMovementComplexity":50,"aiWeaponSwapIQ":50,"aiPlaystyle":50,"aiWeaponPrioritization":50,"aiArchetype":"none","enableBurnDecals":true,"weaponReadyTime":0.5,"weaponSwapLockout":1,"enableSlide":false,"enableSprint":false,"speedSprint":140,"speedSlide":160,"slideDistance":8,"slideCooldown":1.5}',
  0,
  'seed'
);
